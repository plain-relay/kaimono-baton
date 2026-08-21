#!/usr/bin/env node

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const REPOSITORY = 'plain-relay/kaimono-baton'
const REPOSITORY_OWNER = 'plain-relay'
const REPOSITORY_URL = 'https://github.com/plain-relay/kaimono-baton.git'
const DISPATCH_LABEL = 'codex-ready'
const BLOCK_START = '<!-- symphony-safe-task:v1 -->'
const BLOCK_END = '<!-- /symphony-safe-task -->'
const APPROVAL_BLOCK_START = '<!-- symphony-approval:v1 -->'
const APPROVAL_BLOCK_END = '<!-- /symphony-approval -->'
const APPROVER_LOGINS = new Set([REPOSITORY_OWNER])

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
  'agent-no-handoff',
  'interrupted-run',
  'other',
])
const TASK_KEYS = new Set([
  'schemaVersion',
  'executionId',
  'operation',
  'changeMode',
  'scopePaths',
  'referencePaths',
  'symbols',
  'acceptanceChecks',
  'risk',
])
const APPROVAL_KEYS = new Set(['schemaVersion', 'executionId', 'taskSha256'])
const HANDOFF_READY_KEYS = new Set(['schemaVersion', 'status', 'checks'])
const HANDOFF_BLOCKED_KEYS = new Set(['schemaVersion', 'status', 'blockerCode'])
const PREPARED_TASK_KEYS = new Set([
  'schemaVersion',
  'repository',
  'issueNumber',
  'issueIdentifier',
  'executionId',
  'branchName',
  'baseSha',
  'task',
])

const PROTECTED_EXACT = new Set([
  '.gitignore',
  'AGENTS.md',
  'package.json',
  'package-lock.json',
  'docs/CODEX_WORKFLOW.md',
  'docs/operations/AI_AGENT_POLICY.md',
  'docs/operations/AI_MERGE_APPROVAL.md',
  'docs/operations/SYMPHONY_PILOT.md',
  'scripts/symphony-pilot-host.mjs',
])
const PROTECTED_TOP_LEVEL = new Set(['.git', '.github', '.codex', 'symphony'])

export class PilotError extends Error {
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
  assert(keys.length === allowed.size, code)
  assert(keys.every((key) => allowed.has(key)), code)
  assert([...allowed].every((key) => keys.includes(key)), code)
}

function validateRepoPath(value, { scope = false } = {}) {
  assert(typeof value === 'string' && value.length >= 1 && value.length <= 180, 'invalid-path')
  assert(!value.startsWith('/') && !value.includes('\\') && !value.includes('\0'), 'invalid-path')
  const segments = value.split('/')
  assert(segments.every((segment) => segment && segment !== '.' && segment !== '..'), 'invalid-path')
  assert(segments.every((segment) => /^[A-Za-z0-9_.@+-]+$/.test(segment)), 'invalid-path')
  if (scope) assert(!isProtectedPath(value), 'protected-scope-path')
  return value
}

function validateStringArray(value, { min, max, item, code }) {
  assert(Array.isArray(value) && value.length >= min && value.length <= max, code)
  const validated = value.map(item)
  assert(new Set(validated).size === validated.length, code)
  return validated
}

export function isProtectedPath(value) {
  if (PROTECTED_EXACT.has(value)) return true
  const [top] = value.split('/')
  return PROTECTED_TOP_LEVEL.has(top)
}

export function isPathAllowed(changedPath, scopePaths) {
  if (isProtectedPath(changedPath)) return false
  return scopePaths.some((scopePath) => changedPath === scopePath || changedPath.startsWith(`${scopePath}/`))
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
  assert(Number.isSafeInteger(value.executionId) && value.executionId >= 1, 'invalid-execution-id')
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
    executionId: value.executionId,
    operation: value.operation,
    changeMode: value.changeMode,
    scopePaths,
    referencePaths,
    symbols,
    acceptanceChecks,
    risk: value.risk,
  })
}

export function taskHash(task) {
  const validated = validateSafeTask(task)
  return crypto.createHash('sha256').update(JSON.stringify(validated)).digest('hex')
}

export function extractAndValidateApproval(commentBody, task) {
  assert(typeof commentBody === 'string' && commentBody.length <= 20_000, 'invalid-approval-comment')
  const start = commentBody.indexOf(APPROVAL_BLOCK_START)
  const end = commentBody.indexOf(APPROVAL_BLOCK_END)
  assert(start >= 0 && end > start, 'missing-approval-block')
  assert(commentBody.indexOf(APPROVAL_BLOCK_START, start + APPROVAL_BLOCK_START.length) === -1, 'duplicate-approval-block')
  assert(commentBody.indexOf(APPROVAL_BLOCK_END, end + APPROVAL_BLOCK_END.length) === -1, 'duplicate-approval-block')
  const raw = commentBody.slice(start + APPROVAL_BLOCK_START.length, end).trim()
  assert(raw.length > 1 && raw.length <= 1_024, 'invalid-approval-size')
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new PilotError('invalid-approval-json')
  }
  exactKeys(parsed, APPROVAL_KEYS, 'invalid-approval-schema')
  assert(parsed.schemaVersion === 1, 'invalid-approval-version')
  assert(parsed.executionId === task.executionId, 'approval-execution-mismatch')
  assert(typeof parsed.taskSha256 === 'string' && /^[0-9a-f]{64}$/.test(parsed.taskSha256), 'invalid-approval-hash')
  assert(parsed.taskSha256 === taskHash(task), 'approval-task-hash-mismatch')
  return parsed
}

export function validateHandoff(value, requiredChecks = []) {
  assert(value && typeof value === 'object' && !Array.isArray(value), 'invalid-handoff')
  assert(value.schemaVersion === 1, 'invalid-handoff-version')
  assert(value.status === 'ready' || value.status === 'blocked', 'invalid-handoff-status')

  if (value.status === 'ready') {
    exactKeys(value, HANDOFF_READY_KEYS, 'invalid-ready-handoff-schema')
    assert(value.checks && typeof value.checks === 'object' && !Array.isArray(value.checks), 'invalid-handoff-checks')
    const keys = Object.keys(value.checks)
    assert(keys.length >= 1 && keys.every((key) => ACCEPTANCE_CHECKS.has(key)), 'invalid-handoff-checks')
    assert(keys.every((key) => value.checks[key] === 'pass'), 'handoff-check-not-pass')
    assert(requiredChecks.every((key) => value.checks[key] === 'pass'), 'required-handoff-check-missing')
    return value
  }

  exactKeys(value, HANDOFF_BLOCKED_KEYS, 'invalid-blocked-handoff-schema')
  assert(BLOCKER_CODES.has(value.blockerCode), 'invalid-blocker-code')
  return value
}

function validatePreparedTask(value) {
  exactKeys(value, PREPARED_TASK_KEYS, 'invalid-prepared-task-schema')
  assert(value.schemaVersion === 1 && value.repository === REPOSITORY, 'invalid-prepared-task')
  assert(Number.isSafeInteger(value.issueNumber) && value.issueNumber > 0, 'invalid-prepared-task')
  assert(value.issueIdentifier === `GH-${value.issueNumber}`, 'invalid-prepared-task')
  assert(value.branchName === `codex/gh-${value.issueNumber}`, 'invalid-prepared-task')
  assert(/^[0-9a-f]{40}$/.test(value.baseSha), 'invalid-prepared-task')
  const task = validateSafeTask(value.task)
  assert(task.executionId === value.executionId, 'invalid-prepared-task')
  return { ...value, task }
}

function fileHash(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function stateRoot() {
  const configured = process.env.SYMPHONY_PILOT_STATE_DIR
  const root = configured && configured.trim()
    ? configured
    : path.join(os.homedir(), '.local', 'state', 'kaimono-baton-symphony')
  return path.resolve(root)
}

function stateFile(issueNumber) {
  return path.join(stateRoot(), `GH-${issueNumber}.json`)
}

function readPersistentState(issueNumber) {
  const file = stateFile(issueNumber)
  if (!fs.existsSync(file)) return null
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    throw new PilotError('persistent-state-invalid')
  }
}

function writePersistentState(issueNumber, state) {
  const root = stateRoot()
  fs.mkdirSync(root, { recursive: true, mode: 0o700 })
  const target = stateFile(issueNumber)
  const temp = `${target}.${process.pid}.tmp`
  fs.writeFileSync(temp, `${JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temp, target)
}

function workspaceStateDir(cwd) {
  return path.join(cwd, '.symphony')
}

function workspaceStatePath(cwd, name) {
  return path.join(workspaceStateDir(cwd), name)
}

function writeWorkspaceState(cwd, name, value) {
  fs.mkdirSync(workspaceStateDir(cwd), { recursive: true, mode: 0o700 })
  fs.writeFileSync(workspaceStatePath(cwd, name), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
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
  return fetch(`https://api.github.com${pathname}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token()}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'kaimono-baton-symphony-pilot',
      ...(options.headers || {}),
    },
  })
}

function safeChildEnv(extra = {}) {
  const keys = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR', 'USER', 'LOGNAME', 'SHELL']
  const env = {}
  for (const key of keys) if (process.env[key]) env[key] = process.env[key]
  return { ...env, ...extra }
}

function run(cwd, command, args, { stdio = ['ignore', 'pipe', 'pipe'], env = safeChildEnv() } = {}) {
  try {
    return execFileSync(command, args, { cwd, encoding: 'utf8', stdio, env }).trim()
  } catch {
    throw new PilotError(`${command}-command-failed`)
  }
}

function runGit(cwd, args, options = {}) {
  return run(cwd, 'git', args, options)
}

function runNpmCi(cwd) {
  const npmHome = path.join(stateRoot(), 'npm-home')
  fs.mkdirSync(npmHome, { recursive: true, mode: 0o700 })
  run(cwd, 'npm', ['ci'], {
    stdio: 'inherit',
    env: safeChildEnv({
      HOME: npmHome,
      CI: 'true',
      npm_config_audit: 'false',
      npm_config_fund: 'false',
    }),
  })
}

async function fetchIssue(issueNumber) {
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
  assert(issue.state === 'open' && !issue.pull_request, 'issue-not-dispatchable')
  assert(issue.user?.login === REPOSITORY_OWNER, 'untrusted-issue-author')
  const labels = (issue.labels || []).map((label) => typeof label === 'string' ? label : label.name).filter(Boolean)
  assert(labels.some((label) => label.toLowerCase() === DISPATCH_LABEL), 'dispatch-label-missing')
  return issue
}

async function fetchIssueComments(issueNumber) {
  const comments = []
  for (let page = 1; page <= 10; page += 1) {
    let response
    try {
      response = await github(`/repos/${REPOSITORY}/issues/${issueNumber}/comments?per_page=100&page=${page}`)
    } catch {
      throw new PilotError('github-comments-fetch-failed')
    }
    assert(response.ok, `github-comments-fetch-status-${response.status}`)
    let payload
    try {
      payload = await response.json()
    } catch {
      throw new PilotError('github-comments-payload-invalid')
    }
    assert(Array.isArray(payload), 'github-comments-payload-invalid')
    comments.push(...payload)
    if (payload.length < 100) return comments
  }
  throw new PilotError('approval-comment-limit-exceeded')
}

async function verifyApproval(issueNumber, task) {
  const comments = await fetchIssueComments(issueNumber)
  const approved = comments.some((comment) => {
    if (!APPROVER_LOGINS.has(comment.user?.login)) return false
    if (typeof comment.body !== 'string' || !comment.body.includes(APPROVAL_BLOCK_START)) return false
    try {
      extractAndValidateApproval(comment.body, task)
      return true
    } catch {
      return false
    }
  })
  assert(approved, 'matching-trusted-approval-missing')
}

async function removeDispatchLabel(issueNumber) {
  let response
  try {
    response = await github(`/repos/${REPOSITORY}/issues/${issueNumber}/labels/${encodeURIComponent(DISPATCH_LABEL)}`, { method: 'DELETE' })
  } catch {
    throw new PilotError('github-label-cleanup-failed')
  }
  assert(response.ok || response.status === 404, `github-label-cleanup-status-${response.status}`)
}

async function postDeterministicBlocker(issueNumber, executionId, blockerCode) {
  try {
    await github(`/repos/${REPOSITORY}/issues/${issueNumber}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        body: `Symphony pilot execution ${executionId} stopped with blocker code \`${blockerCode}\`. Re-authorize only after resolving the blocker, incrementing \`executionId\`, and recording a matching trusted approval hash.`,
      }),
    })
  } catch {
    // Visibility is best effort. Persistent state remains the dispatch safety boundary.
  }
}

function gitConfigHash(cwd) {
  const configPath = path.join(cwd, '.git', 'config')
  assert(fs.existsSync(configPath), 'git-config-missing')
  return fileHash(configPath)
}

function assertExpectedRemote(cwd) {
  assert(runGit(cwd, ['remote', 'get-url', 'origin']) === REPOSITORY_URL, 'unexpected-origin-url')
}

async function ensureNoExistingHandoff(issueNumber, branchName) {
  const branchResponse = await github(`/repos/${REPOSITORY}/branches/${encodeURIComponent(branchName)}`)
  assert(branchResponse.status === 404, 'remote-branch-already-exists')
  const headQuery = encodeURIComponent(`${REPOSITORY_OWNER}:${branchName}`)
  const prResponse = await github(`/repos/${REPOSITORY}/pulls?state=open&head=${headQuery}`)
  assert(prResponse.ok, `github-pr-list-status-${prResponse.status}`)
  const prs = await prResponse.json()
  assert(Array.isArray(prs) && prs.length === 0, 'open-pr-already-exists')
}

async function prepare(cwd) {
  const issueNumber = deriveIssueNumber(cwd)
  const issue = await fetchIssue(issueNumber)
  const task = extractAndValidateSafeTask(issue.body ?? '')
  await verifyApproval(issueNumber, task)
  const currentTaskHash = taskHash(task)
  const branchName = `codex/gh-${issueNumber}`
  const existing = readPersistentState(issueNumber)

  if (existing && existing.executionId === task.executionId) {
    if (existing.state === 'finalizing') {
      await finalize(cwd, { recovery: true })
      throw new PilotError('finalization-recovered-no-agent-run')
    }
    if (existing.state === 'completed' || existing.state === 'blocked') {
      try { await removeDispatchLabel(issueNumber) } catch {}
      throw new PilotError('execution-already-terminal')
    }
    if (existing.state === 'claimed') {
      writePersistentState(issueNumber, { ...existing, state: 'blocked', blockerCode: 'interrupted-run' })
      try { await removeDispatchLabel(issueNumber) } catch {}
      await postDeterministicBlocker(issueNumber, task.executionId, 'interrupted-run')
      throw new PilotError('interrupted-run-requires-reauthorization')
    }
  }

  if (existing) {
    assert(task.executionId > existing.executionId, 'stale-execution-id')
    assert(existing.state === 'blocked', 'prior-execution-not-retryable')
  }

  assertExpectedRemote(cwd)
  assert(runGit(cwd, ['status', '--porcelain', '--untracked-files=no']) === '', 'tracked-worktree-not-clean')
  runGit(cwd, ['fetch', '--depth', '1', 'origin', 'main'])
  runGit(cwd, ['checkout', '-B', branchName, 'origin/main'])
  runGit(cwd, ['reset', '--hard', 'origin/main'])
  assertExpectedRemote(cwd)
  await ensureNoExistingHandoff(issueNumber, branchName)

  for (const referencePath of task.referencePaths) {
    assert(fs.existsSync(path.join(cwd, referencePath)), 'reference-path-missing')
  }

  runNpmCi(cwd)
  const baseSha = runGit(cwd, ['rev-parse', 'HEAD'])
  const prepared = {
    schemaVersion: 1,
    repository: REPOSITORY,
    issueNumber,
    issueIdentifier: `GH-${issueNumber}`,
    executionId: task.executionId,
    branchName,
    baseSha,
    task,
  }
  writeWorkspaceState(cwd, 'task.json', prepared)
  try { fs.rmSync(workspaceStatePath(cwd, 'handoff.json'), { force: true }) } catch {}
  writePersistentState(issueNumber, {
    schemaVersion: 1,
    state: 'claimed',
    executionId: task.executionId,
    taskHash: currentTaskHash,
    branchName,
    baseSha,
    gitConfigHash: gitConfigHash(cwd),
  })
  console.log(`[symphony-pilot] claimed approved execution ${task.executionId} for GH-${issueNumber}`)
}

function collectChangedPaths(cwd) {
  const tracked = runGit(cwd, ['diff', '--name-only', '--no-renames', '-z', 'HEAD'])
    .split('\0').filter(Boolean)
  const untracked = runGit(cwd, ['ls-files', '--others', '--exclude-standard', '-z'])
    .split('\0').filter(Boolean)
  return [...new Set([...tracked, ...untracked])]
    .filter((name) => !name.startsWith('.symphony/'))
    .sort()
}

function deterministicPrBody({ issueNumber, executionId, baseSha, headSha, risk, checks, changedPaths }) {
  const changedLines = changedPaths.map((name) => `- \`${name}\``).join('\n')
  const checkResult = (name) => checks[name] === 'pass' ? 'PASS' : 'not requested'
  return [
    '## Issue and exact range',
    '',
    `- Issue: #${issueNumber}`,
    '- Base branch: `main`',
    `- Exact base SHA: \`${baseSha}\``,
    `- Exact head SHA: \`${headSha}\``,
    `- Risk: ${risk === 'low' ? 'Low' : 'Medium'}`,
    `- Symphony execution: \`${executionId}\``,
    '',
    '## Purpose',
    '',
    `Implements the host-validated, trusted-approval-bound AI-safe task for Issue #${issueNumber}. Raw Issue title/body was not supplied to Codex.`,
    '',
    '## Changed files',
    '',
    changedLines,
    '',
    '## Invariants and scope',
    '',
    '- [x] Changes were restricted to host-validated `scopePaths`.',
    '- [x] Protected governance, workflow, dependency, and Symphony control files were blocked from the agent change set.',
    '- [x] Codex had workspace-write only, network disabled, and no advertised GitHub provider tool.',
    '- [x] GitHub write operations were performed only by the trusted host finalizer.',
    '',
    'Runtime/compatibility notes: scope-specific behavior remains subject to independent review and PR CI.',
    '',
    '## Validation',
    '',
    '| Check | Result |',
    '| --- | --- |',
    '| `npm ci` | PASS (trusted host pre-run) |',
    `| \`npm test\` | ${checkResult('npm-test')} |`,
    `| \`npm run test:worker\` | ${checkResult('worker-tests')} |`,
    `| \`npm run typecheck:worker\` | ${checkResult('worker-typecheck')} |`,
    `| \`npm run check:worker-bundle\` | ${checkResult('worker-bundle-check')} |`,
    `| \`npm run test:coverage\` | ${checkResult('coverage')} |`,
    `| \`npm run build\` | ${checkResult('build')} |`,
    '| `git diff --check` | PASS (agent report + trusted host re-check) |',
    '',
    '- CI workflow/run: pending',
    '- CI result: pending',
    '- Not run / not applicable checks and reason: checks not present in the validated task were not authorized for this run.',
    '',
    '## Risk and rollback',
    '',
    `- Classification rationale: host-validated task risk is \`${risk}\`.`,
    '- Failure modes: implementation defects or scope mismatch; CI and independent review remain mandatory.',
    '- Rollback: revert the eventual merged implementation commit/PR. No Production operation is part of this handoff.',
    '- Non-waivable Paid Beta / Public Release conditions affected: none asserted by the automation.',
    '',
    '## AI and operational boundaries',
    '',
    '- [x] No Production deploy or Production workflow operation was performed.',
    '- [x] No Cloudflare, DNS, Environment, Secret, Variable, billing, migration, customer communication, or user-data operation was performed.',
    '- [x] Raw Issue text was handled only by the deterministic host parser; Codex received only the validated allowlist payload.',
    '- [x] The executed task hash matched a structured approval comment authored by the trusted approver.',
    '- [x] Codex received no tracker credential and no GitHub write tool.',
    '- [x] This PR remains Draft; merge and Production are separate human gates.',
    '',
    '## Independent review',
    '',
    '- Required reviewer: separate fresh Codex session or separate GitHub-connected ChatGPT review',
    '- Reason: autonomous implementation and host orchestration require exact-range independent review.',
    `- Review exact base SHA: \`${baseSha}\``,
    `- Review exact head SHA: \`${headSha}\``,
    '- Status: pending',
    '- Findings: pending (P0 / P1 / P2 / P3)',
    '',
    '- [x] The implementation session is not being treated as the final independent reviewer.',
    '- [x] Any head/base movement invalidates the final independent review.',
    '',
    '## Merge and Production approval',
    '',
    '- [x] This PR is Draft.',
    '- [x] Auto-merge was not enabled.',
    '- [x] No merge was performed.',
    '- [x] Merge requires later explicit exact-head human approval.',
    '- [x] Merge approval is not Production approval.',
  ].join('\n')
}

function commitHostChanges(cwd, issueNumber, changedPaths) {
  runGit(cwd, ['add', '--', ...changedPaths])
  runGit(cwd, [
    '-c', 'user.name=Kaimono Baton Symphony Host',
    '-c', 'user.email=symphony-host@users.noreply.github.com',
    'commit', '-m', `chore: implement GH-${issueNumber}`,
  ])
  return runGit(cwd, ['rev-parse', 'HEAD'])
}

function pushExpectedBranch(cwd, branchName) {
  assert(branchName === `codex/gh-${deriveIssueNumber(cwd)}`, 'unexpected-push-branch')
  assertExpectedRemote(cwd)
  const encoded = Buffer.from(`x-access-token:${token()}`).toString('base64')
  const env = safeChildEnv({
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${encoded}`,
  })
  runGit(cwd, ['push', '--no-verify', '--set-upstream', 'origin', `HEAD:refs/heads/${branchName}`], { env })
}

async function createOrUpdateDraftPr({ issueNumber, branchName, body }) {
  const headQuery = encodeURIComponent(`${REPOSITORY_OWNER}:${branchName}`)
  const listResponse = await github(`/repos/${REPOSITORY}/pulls?state=open&head=${headQuery}`)
  assert(listResponse.ok, `github-pr-list-status-${listResponse.status}`)
  const existing = await listResponse.json()
  assert(Array.isArray(existing) && existing.length <= 1, 'duplicate-open-prs')

  if (existing.length === 1) {
    const pr = existing[0]
    assert(pr.base?.ref === 'main' && pr.head?.ref === branchName && pr.draft === true, 'existing-pr-not-safe-draft')
    const update = await github(`/repos/${REPOSITORY}/pulls/${pr.number}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    })
    assert(update.ok, `github-pr-update-status-${update.status}`)
    return pr.number
  }

  const create = await github(`/repos/${REPOSITORY}/pulls`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: `Implement approved task for GH-${issueNumber}`,
      head: branchName,
      base: 'main',
      body,
      draft: true,
    }),
  })
  assert(create.ok, `github-pr-create-status-${create.status}`)
  const pr = await create.json()
  assert(Number.isInteger(pr.number), 'github-pr-create-payload-invalid')
  return pr.number
}

async function blockExecution(cwd, issueNumber, prepared, state, blockerCode) {
  writePersistentState(issueNumber, {
    ...state,
    state: 'blocked',
    blockerCode,
    executionId: prepared?.executionId ?? state?.executionId ?? 0,
  })
  try { await removeDispatchLabel(issueNumber) } catch {}
  if ((prepared?.executionId ?? state?.executionId) > 0) {
    await postDeterministicBlocker(issueNumber, prepared?.executionId ?? state.executionId, blockerCode)
  }
  console.log(`[symphony-pilot] blocked GH-${issueNumber}: ${blockerCode}`)
}

async function finalize(cwd, { recovery = false } = {}) {
  const issueNumber = deriveIssueNumber(cwd)
  const taskPath = workspaceStatePath(cwd, 'task.json')
  const handoffPath = workspaceStatePath(cwd, 'handoff.json')
  const state = readPersistentState(issueNumber)
  assert(state, 'persistent-state-missing')

  if (state.state === 'completed') {
    try { await removeDispatchLabel(issueNumber) } catch {}
    return
  }

  let prepared
  try {
    assert(fs.existsSync(taskPath), 'safe-task-missing')
    prepared = validatePreparedTask(JSON.parse(fs.readFileSync(taskPath, 'utf8')))
    assert(prepared.executionId === state.executionId, 'execution-state-mismatch')
    assert(taskHash(prepared.task) === state.taskHash, 'safe-task-integrity-failed')
    assert(prepared.baseSha === state.baseSha && prepared.branchName === state.branchName, 'prepared-state-mismatch')
    assert(gitConfigHash(cwd) === state.gitConfigHash, 'git-config-changed')
    assertExpectedRemote(cwd)

    if (!fs.existsSync(handoffPath)) {
      await blockExecution(cwd, issueNumber, prepared, state, 'agent-no-handoff')
      return
    }
    const handoff = validateHandoff(JSON.parse(fs.readFileSync(handoffPath, 'utf8')), prepared.task.acceptanceChecks)
    if (handoff.status === 'blocked') {
      await blockExecution(cwd, issueNumber, prepared, state, handoff.blockerCode)
      return
    }

    const currentBranch = runGit(cwd, ['branch', '--show-current'])
    assert(currentBranch === prepared.branchName, 'unexpected-branch')

    let headSha = state.headSha ?? null
    if (!headSha) {
      assert(runGit(cwd, ['rev-parse', 'HEAD']) === prepared.baseSha, 'agent-created-commit')
      assert(runGit(cwd, ['diff', '--cached', '--name-only']) === '', 'agent-staged-changes')
      const changedPaths = collectChangedPaths(cwd)
      assert(changedPaths.length > 0, 'no-implementation-change')
      assert(changedPaths.every((name) => isPathAllowed(name, prepared.task.scopePaths)), 'change-outside-allowed-scope')
      runGit(cwd, ['diff', '--check'])
      writePersistentState(issueNumber, { ...state, state: 'finalizing' })
      headSha = commitHostChanges(cwd, issueNumber, changedPaths)
      writePersistentState(issueNumber, { ...state, state: 'finalizing', headSha, changedPaths })
    }

    const currentState = readPersistentState(issueNumber)
    assert(currentState?.state === 'finalizing', 'finalization-state-invalid')
    assert(runGit(cwd, ['rev-parse', 'HEAD']) === currentState.headSha, 'finalization-head-mismatch')
    assert(gitConfigHash(cwd) === currentState.gitConfigHash, 'git-config-changed')
    pushExpectedBranch(cwd, prepared.branchName)

    const body = deterministicPrBody({
      issueNumber,
      executionId: prepared.executionId,
      baseSha: prepared.baseSha,
      headSha: currentState.headSha,
      risk: prepared.task.risk,
      checks: JSON.parse(fs.readFileSync(handoffPath, 'utf8')).checks,
      changedPaths: currentState.changedPaths,
    })
    const prNumber = await createOrUpdateDraftPr({ issueNumber, branchName: prepared.branchName, body })

    writePersistentState(issueNumber, {
      ...currentState,
      state: 'completed',
      prNumber,
    })
    try { await removeDispatchLabel(issueNumber) } catch {
      console.error(`[symphony-pilot] completed GH-${issueNumber}, but label cleanup will be retried on the next poll`)
    }
    console.log(`[symphony-pilot] Draft PR #${prNumber} handed off for GH-${issueNumber}`)
  } catch (error) {
    const code = error instanceof PilotError ? error.code : 'other'
    const latestState = readPersistentState(issueNumber)
    if (latestState?.state === 'finalizing' && latestState.headSha) {
      console.error(`[symphony-pilot] finalization for GH-${issueNumber} remains pending and will be retried host-side`)
    } else if (prepared && latestState?.state !== 'completed') {
      await blockExecution(cwd, issueNumber, prepared, latestState ?? state, BLOCKER_CODES.has(code) ? code : 'repository-state-conflict')
    }
    if (!recovery) throw error instanceof PilotError ? error : new PilotError('finalize-failed')
    throw error instanceof PilotError ? error : new PilotError('finalize-recovery-failed')
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
