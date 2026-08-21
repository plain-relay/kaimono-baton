#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const REPOSITORY = 'plain-relay/kaimono-baton'
const REPOSITORY_OWNER = 'plain-relay'
const REPOSITORY_NAME = 'kaimono-baton'
const DISPATCH_LABEL = 'codex-ready'
const BLOCK_START = '<!-- symphony-safe-task:v1 -->'
const BLOCK_END = '<!-- /symphony-safe-task -->'

const OPERATIONS = new Set([
  'update-docs-to-existing-contract',
  'add-tests-for-existing-contract',
  'repair-existing-public-contract',
  'refactor-no-contract-change',
  'implement-existing-public-spec',
])
const CHANGE_MODES = new Set(['modify-existing', 'add-file', 'modify-or-add'])
const RISKS = new Set(['low', 'medium'])
const ACCEPTANCE_CHECKS = new Set([
  'npm-test',
  'worker-tests',
  'worker-typecheck',
  'worker-bundle-check',
  'coverage',
  'build',
  'git-diff-check',
])
const BLOCKER_CODES = new Set([
  'validation-failed',
  'scope-conflict',
  'missing-local-tool',
  'repository-state-conflict',
  'unsafe-request',
  'other',
])
const TASK_KEYS = new Set([
  'schemaVersion',
  'operation',
  'changeMode',
  'scopePaths',
  'referencePaths',
  'symbols',
  'acceptanceChecks',
  'risk',
])
const HANDOFF_READY_KEYS = new Set(['schemaVersion', 'status', 'checks'])
const HANDOFF_BLOCKED_KEYS = new Set(['schemaVersion', 'status', 'blockerCode'])

class PilotError extends Error {
  constructor(code) {
    super(code)
    this.code = code
  }
}

function assert(condition, code) {
  if (!condition) throw new PilotError(code)
}

function exactKeys(value, allowed, code) {
  assert(value && typeof value === 'object' && !Array.isArray(value), code)
  const keys = Object.keys(value)
  assert(keys.every((key) => allowed.has(key)), code)
  assert(keys.length === allowed.size && [...allowed].every((key) => keys.includes(key)), code)
}

function validateRepoPath(value, { scope = false } = {}) {
  assert(typeof value === 'string' && value.length >= 1 && value.length <= 180, 'invalid-path')
  assert(!value.startsWith('/') && !value.includes('\\'), 'invalid-path')
  const segments = value.split('/')
  assert(segments.every((segment) => segment && segment !== '.' && segment !== '..'), 'invalid-path')
  assert(segments.every((segment) => /^[A-Za-z0-9_.@+-]+$/.test(segment)), 'invalid-path')

  if (scope) {
    const protectedExact = new Set([
      'AGENTS.md',
      'docs/CODEX_WORKFLOW.md',
      'docs/operations/AI_AGENT_POLICY.md',
      'docs/operations/AI_MERGE_APPROVAL.md',
    ])
    assert(!protectedExact.has(value), 'protected-scope-path')
    assert(segments[0] !== '.git' && segments[0] !== '.github' && segments[0] !== 'symphony', 'protected-scope-path')
  }

  return value
}

function validateStringArray(value, { min, max, item, code }) {
  assert(Array.isArray(value) && value.length >= min && value.length <= max, code)
  const validated = value.map(item)
  assert(new Set(validated).size === validated.length, code)
  return validated
}

export function extractAndValidateSafeTask(issueBody) {
  assert(typeof issueBody === 'string' && issueBody.length <= 100_000, 'invalid-issue-body')
  const start = issueBody.indexOf(BLOCK_START)
  const end = issueBody.indexOf(BLOCK_END)
  assert(start >= 0 && end > start, 'missing-safe-task-block')
  assert(issueBody.indexOf(BLOCK_START, start + BLOCK_START.length) === -1, 'duplicate-safe-task-block')
  assert(issueBody.indexOf(BLOCK_END, end + BLOCK_END.length) === -1, 'duplicate-safe-task-block')
  const raw = issueBody.slice(start + BLOCK_START.length, end).trim()
  assert(raw.length > 1 && raw.length <= 8_192, 'invalid-safe-task-size')

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new PilotError('invalid-safe-task-json')
  }
  return validateSafeTask(parsed)
}

export function validateSafeTask(value) {
  exactKeys(value, TASK_KEYS, 'invalid-safe-task-schema')
  assert(value.schemaVersion === 1, 'invalid-schema-version')
  assert(OPERATIONS.has(value.operation), 'invalid-operation')
  assert(CHANGE_MODES.has(value.changeMode), 'invalid-change-mode')
  assert(RISKS.has(value.risk), 'invalid-risk')

  const scopePaths = validateStringArray(value.scopePaths, {
    min: 1,
    max: 12,
    code: 'invalid-scope-paths',
    item: (item) => validateRepoPath(item, { scope: true }),
  })
  const referencePaths = validateStringArray(value.referencePaths, {
    min: 1,
    max: 16,
    code: 'invalid-reference-paths',
    item: (item) => validateRepoPath(item),
  })
  const symbols = validateStringArray(value.symbols, {
    min: 0,
    max: 16,
    code: 'invalid-symbols',
    item: (item) => {
      assert(typeof item === 'string' && /^[A-Za-z_$][A-Za-z0-9_.$:#-]{0,79}$/.test(item), 'invalid-symbol')
      return item
    },
  })
  const acceptanceChecks = validateStringArray(value.acceptanceChecks, {
    min: 1,
    max: ACCEPTANCE_CHECKS.size,
    code: 'invalid-acceptance-checks',
    item: (item) => {
      assert(ACCEPTANCE_CHECKS.has(item), 'invalid-acceptance-check')
      return item
    },
  })
  assert(acceptanceChecks.includes('git-diff-check'), 'missing-git-diff-check')

  return Object.freeze({
    schemaVersion: 1,
    operation: value.operation,
    changeMode: value.changeMode,
    scopePaths,
    referencePaths,
    symbols,
    acceptanceChecks,
    risk: value.risk,
  })
}

export function validateHandoff(value) {
  assert(value && typeof value === 'object' && !Array.isArray(value), 'invalid-handoff')
  assert(value.schemaVersion === 1, 'invalid-handoff-version')
  assert(value.status === 'ready' || value.status === 'blocked', 'invalid-handoff-status')

  if (value.status === 'ready') {
    exactKeys(value, HANDOFF_READY_KEYS, 'invalid-ready-handoff-schema')
    assert(value.checks && typeof value.checks === 'object' && !Array.isArray(value.checks), 'invalid-handoff-checks')
    const keys = Object.keys(value.checks)
    assert(keys.length >= 1 && keys.every((key) => ACCEPTANCE_CHECKS.has(key)), 'invalid-handoff-checks')
    assert(keys.every((key) => value.checks[key] === 'pass'), 'handoff-check-not-pass')
    return value
  }

  exactKeys(value, HANDOFF_BLOCKED_KEYS, 'invalid-blocked-handoff-schema')
  assert(BLOCKER_CODES.has(value.blockerCode), 'invalid-blocker-code')
  return value
}

function stateDir(cwd) {
  return path.join(cwd, '.symphony')
}

function statePath(cwd, name) {
  return path.join(stateDir(cwd), name)
}

function writeState(cwd, name, value) {
  fs.mkdirSync(stateDir(cwd), { recursive: true })
  fs.writeFileSync(statePath(cwd, name), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
}

function removeState(cwd, name) {
  try {
    fs.rmSync(statePath(cwd, name), { force: true })
  } catch {
    // Fail closed elsewhere; cleanup of a local marker is best effort.
  }
}

function deriveIssueNumber(cwd) {
  const match = path.basename(cwd).match(/^GH-(\d+)$/)
  assert(match, 'invalid-workspace-identifier')
  const issueNumber = Number.parseInt(match[1], 10)
  assert(Number.isSafeInteger(issueNumber) && issueNumber > 0, 'invalid-issue-number')
  return issueNumber
}

function token() {
  const value = process.env.GITHUB_TOKEN
  assert(typeof value === 'string' && value.length > 0, 'missing-github-token')
  return value
}

async function github(pathname, options = {}) {
  const response = await fetch(`https://api.github.com${pathname}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token()}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'kaimono-baton-symphony-pilot',
      ...(options.headers || {}),
    },
  })
  return response
}

function runGit(cwd, args) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch {
    throw new PilotError('git-command-failed')
  }
}

async function prepare(cwd) {
  fs.mkdirSync(stateDir(cwd), { recursive: true })
  assert(!fs.existsSync(statePath(cwd, 'handoff-complete')), 'handoff-already-complete')
  assert(!fs.existsSync(statePath(cwd, 'quarantine')), 'workspace-quarantined')
  writeState(cwd, 'quarantine', { schemaVersion: 1, reasonCode: 'prepare-in-progress' })

  const issueNumber = deriveIssueNumber(cwd)
  let response
  try {
    response = await github(`/repos/${REPOSITORY}/issues/${issueNumber}`)
  } catch {
    throw new PilotError('github-issue-fetch-failed')
  }
  assert(response.ok, `github-issue-fetch-status-${response.status}`)

  let issue
  try {
    issue = await response.json()
  } catch {
    throw new PilotError('github-issue-payload-invalid')
  }

  const task = extractAndValidateSafeTask(issue.body ?? '')
  for (const referencePath of task.referencePaths) {
    assert(fs.existsSync(path.join(cwd, referencePath)), 'reference-path-missing')
  }

  const payload = {
    ...task,
    repository: REPOSITORY,
    issueNumber,
    issueIdentifier: `GH-${issueNumber}`,
    branchName: `codex/gh-${issueNumber}-work`,
  }
  writeState(cwd, 'task.json', payload)
  removeState(cwd, 'quarantine')
  console.log(`[symphony-pilot] prepared validated task for GH-${issueNumber}`)
}

function deterministicPrBody({ issueNumber, baseSha, headSha, risk, checks }) {
  const checkLines = Object.entries(checks)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, status]) => `- ${name}: ${status}`)
    .join('\n')

  return [
    `Automated Symphony Pilot handoff for GH-${issueNumber}.`,
    '',
    `Base SHA: \`${baseSha}\``,
    `Head SHA: \`${headSha}\``,
    `Risk: \`${risk}\``,
    '',
    'Reported local checks:',
    checkLines,
    '',
    'This PR is Draft. Merge and Production remain separate human-approved operations under the repository policy.',
  ].join('\n')
}

async function createOrFindDraftPr({ issueNumber, branchName, baseSha, headSha, risk, checks }) {
  const headQuery = encodeURIComponent(`${REPOSITORY_OWNER}:${branchName}`)
  const listResponse = await github(`/repos/${REPOSITORY}/pulls?state=open&head=${headQuery}`)
  assert(listResponse.ok, `github-pr-list-status-${listResponse.status}`)
  const existing = await listResponse.json()
  assert(Array.isArray(existing) && existing.length <= 1, 'duplicate-open-prs')
  if (existing.length === 1) return existing[0].number

  const body = deterministicPrBody({ issueNumber, baseSha, headSha, risk, checks })
  const createResponse = await github(`/repos/${REPOSITORY}/pulls`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: `Codex implementation for GH-${issueNumber}`,
      head: branchName,
      base: 'main',
      body,
      draft: true,
    }),
  })
  assert(createResponse.ok, `github-pr-create-status-${createResponse.status}`)
  const created = await createResponse.json()
  assert(Number.isInteger(created.number), 'github-pr-create-payload-invalid')
  return created.number
}

async function removeDispatchLabel(issueNumber) {
  let response
  try {
    response = await github(`/repos/${REPOSITORY}/issues/${issueNumber}/labels/${encodeURIComponent(DISPATCH_LABEL)}`, {
      method: 'DELETE',
    })
  } catch {
    throw new PilotError('github-label-cleanup-failed')
  }
  assert(response.ok || response.status === 404, `github-label-cleanup-status-${response.status}`)
}

async function finalize(cwd) {
  fs.mkdirSync(stateDir(cwd), { recursive: true })
  const issueNumber = deriveIssueNumber(cwd)
  const taskPath = statePath(cwd, 'task.json')
  const handoffPath = statePath(cwd, 'handoff.json')

  let handoff
  try {
    assert(fs.existsSync(taskPath), 'safe-task-missing')
    assert(fs.existsSync(handoffPath), 'handoff-missing')
    const task = JSON.parse(fs.readFileSync(taskPath, 'utf8'))
    handoff = validateHandoff(JSON.parse(fs.readFileSync(handoffPath, 'utf8')))

    if (handoff.status === 'blocked') {
      writeState(cwd, 'quarantine', { schemaVersion: 1, reasonCode: handoff.blockerCode })
      await removeDispatchLabel(issueNumber)
      console.log(`[symphony-pilot] quarantined blocked task GH-${issueNumber}`)
      return
    }

    writeState(cwd, 'quarantine', { schemaVersion: 1, reasonCode: 'finalizing' })
    const expectedBranch = task.branchName
    const currentBranch = runGit(cwd, ['branch', '--show-current'])
    assert(currentBranch === expectedBranch, 'unexpected-branch')
    assert(runGit(cwd, ['status', '--porcelain']) === '', 'worktree-not-clean')

    const baseSha = runGit(cwd, ['rev-parse', 'origin/main'])
    const headSha = runGit(cwd, ['rev-parse', 'HEAD'])
    assert(baseSha !== headSha, 'no-implementation-commit')
    runGit(cwd, ['diff', '--check', `${baseSha}...${headSha}`])

    runGit(cwd, ['push', '--set-upstream', 'origin', `HEAD:refs/heads/${expectedBranch}`])
    const prNumber = await createOrFindDraftPr({
      issueNumber,
      branchName: expectedBranch,
      baseSha,
      headSha,
      risk: task.risk,
      checks: handoff.checks,
    })
    await removeDispatchLabel(issueNumber)
    removeState(cwd, 'quarantine')
    writeState(cwd, 'handoff-complete', { schemaVersion: 1, prNumber, baseSha, headSha })
    console.log(`[symphony-pilot] Draft PR #${prNumber} handed off for GH-${issueNumber}`)
  } catch (error) {
    const code = error instanceof PilotError ? error.code : 'finalize-failed'
    writeState(cwd, 'quarantine', { schemaVersion: 1, reasonCode: code })
    try {
      await removeDispatchLabel(issueNumber)
    } catch {
      // The quarantine marker remains. Future retries fail before Codex starts.
    }
    throw error instanceof PilotError ? error : new PilotError('finalize-failed')
  }
}

async function main() {
  const mode = process.argv[2]
  const cwd = process.cwd()
  try {
    if (mode === 'prepare') await prepare(cwd)
    else if (mode === 'finalize') await finalize(cwd)
    else throw new PilotError('usage')
  } catch (error) {
    const code = error instanceof PilotError ? error.code : 'unexpected-failure'
    console.error(`[symphony-pilot] ${code}`)
    process.exitCode = 1
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (invokedDirectly) await main()
