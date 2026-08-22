#!/usr/bin/env node

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export const PILOT = Object.freeze({
  repository: 'plain-relay/kaimono-baton',
  owner: 'plain-relay',
  repositoryUrl: 'https://github.com/plain-relay/kaimono-baton.git',
  baseRef: 'refs/remotes/origin/main',
  label: 'codex-ready',
  symphonySha: '8001b52e3062495a16e520e4ceaf8f9de868c4d0',
  codexVersion: '0.147.0',
  permissionProfile: 'symphony-pilot',
})

const TASK_START = '<!-- symphony-safe-task:v2 -->'
const TASK_END = '<!-- /symphony-safe-task -->'
const APPROVAL_START = '<!-- symphony-approval:v2 -->'
const APPROVAL_END = '<!-- /symphony-approval -->'
const SHA40 = /^[0-9a-f]{40}$/
const SHA64 = /^[0-9a-f]{64}$/
const OPERATIONS = new Set([
  'update-docs-to-existing-contract',
  'add-tests-for-existing-contract',
  'repair-existing-public-contract',
  'refactor-no-contract-change',
  'implement-existing-public-spec',
])
const CHANGE_MODES = new Set(['modify-existing', 'add-file', 'modify-or-add'])
const RISKS = new Set(['low', 'medium'])
const CHECKS = new Set([
  'npm-test', 'worker-tests', 'worker-typecheck', 'worker-bundle-check',
  'coverage', 'build', 'git-diff-check',
])
const BLOCKERS = new Set([
  'validation-failed', 'scope-conflict', 'missing-local-tool',
  'repository-state-conflict', 'unsafe-request', 'agent-no-handoff',
  'interrupted-run', 'approval-stale', 'base-moved', 'reference-invalid', 'other',
])
const TASK_KEYS = new Set([
  'schemaVersion', 'executionId', 'baseSha', 'operation', 'changeMode',
  'scopePaths', 'referencePaths', 'symbols', 'acceptanceChecks', 'risk',
])
const APPROVAL_KEYS = new Set(['schemaVersion', 'executionId', 'taskSha256'])
const PREPARED_KEYS = new Set([
  'schemaVersion', 'repository', 'issueNumber', 'issueIdentifier', 'executionId',
  'branchName', 'baseSha', 'task',
])
const LAUNCH_PERMIT_KEYS = new Set([
  'schemaVersion', 'issueNumber', 'executionId', 'taskHash', 'baseSha',
  'ownerInstanceId', 'ownerProcessIdentity', 'issuedAt', 'nonce',
])
const INSTANCE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
export const CONTROL_MANIFEST_FILES = Object.freeze([
  'scripts/symphony-pilot-codex.sh',
  'scripts/symphony-pilot-host.mjs',
  'scripts/symphony-pilot-isolation-test.mjs',
  'scripts/symphony-pilot-owner-identity.sh',
  'scripts/symphony-pilot-trusted-launcher.sh',
  'scripts/verify-symphony-pilot-upstream.mjs',
  'symphony/WORKFLOW.md',
  'symphony/codex/config.toml',
  'symphony/patches/0001-disable-github-agent-tool.patch',
].sort())

const PROTECTED_EXACT = new Set([
  '.gitignore', '.npmrc', '.gitmodules', '.gitattributes', 'SECURITY.md', 'AGENTS.md',
  'package.json', 'package-lock.json', 'vite.config.ts',
  'docs/CODEX_WORKFLOW.md',
  'docs/operations/AI_AGENT_POLICY.md',
  'docs/operations/AI_MERGE_APPROVAL.md',
  'docs/operations/SYMPHONY_PILOT.md',
])
const PROTECTED_ROOTS = new Set(['.git', '.github', '.codex', '.agents', 'symphony'])
const PROTECTED_PREFIXES = Object.freeze([
  'scripts/symphony-pilot-', 'scripts/verify-symphony-pilot-', 'scripts/install-symphony-pilot-',
])

export class PilotError extends Error {
  constructor(code) {
    super(code)
    this.code = code
  }
}

function assert(condition, code) {
  if (!condition) throw new PilotError(code)
}

function exactKeys(value, expected, code) {
  assert(value && typeof value === 'object' && !Array.isArray(value), code)
  const keys = Object.keys(value)
  assert(keys.length === expected.size, code)
  assert(keys.every((key) => expected.has(key)), code)
  assert([...expected].every((key) => Object.hasOwn(value, key)), code)
}

function validateStringArray(value, { min, max, item, code }) {
  assert(Array.isArray(value) && value.length >= min && value.length <= max, code)
  const result = value.map(item)
  assert(new Set(result).size === result.length, code)
  return result
}

export function isProtectedPath(repoPath) {
  if (PROTECTED_EXACT.has(repoPath)) return true
  if (PROTECTED_PREFIXES.some((prefix) => repoPath.startsWith(prefix))) return true
  return PROTECTED_ROOTS.has(repoPath.split('/')[0])
}

export function validateRepoPath(value, { scope = false, reference = false } = {}) {
  assert(typeof value === 'string' && value.length >= 1 && value.length <= 180, 'invalid-path')
  assert(!value.startsWith('/') && !value.includes('\\') && !value.includes('\0'), 'invalid-path')
  assert(!/^[A-Za-z]:/.test(value), 'invalid-path')
  const segments = value.split('/')
  assert(segments.every((segment) => segment && segment !== '.' && segment !== '..'), 'invalid-path')
  // Pilot paths are deliberately ASCII-only so Git/OS Unicode normalization cannot widen scope.
  assert(segments.every((segment) => /^[A-Za-z0-9_.@+-]+$/.test(segment)), 'invalid-path')
  if (scope) assert(!isProtectedPath(value), 'protected-scope-path')
  if (reference) assert(!isProtectedPath(value) && !value.startsWith('.symphony/'), 'protected-reference-path')
  return value
}

export function isPathAllowed(changedPath, scopePaths) {
  try { validateRepoPath(changedPath) } catch { return false }
  if (isProtectedPath(changedPath) || changedPath.startsWith('.symphony/')) return false
  return scopePaths.some((scope) => changedPath === scope || changedPath.startsWith(`${scope}/`))
}

export function validateSafeTask(value) {
  exactKeys(value, TASK_KEYS, 'invalid-safe-task-schema')
  assert(value.schemaVersion === 2, 'invalid-schema-version')
  assert(Number.isSafeInteger(value.executionId) && value.executionId >= 1, 'invalid-execution-id')
  assert(typeof value.baseSha === 'string' && SHA40.test(value.baseSha), 'invalid-base-sha')
  assert(OPERATIONS.has(value.operation), 'invalid-operation')
  assert(CHANGE_MODES.has(value.changeMode), 'invalid-change-mode')
  assert(RISKS.has(value.risk), 'invalid-risk')
  const scopePaths = validateStringArray(value.scopePaths, {
    min: 1, max: 12, code: 'invalid-scope-paths',
    item: (item) => validateRepoPath(item, { scope: true }),
  })
  const referencePaths = validateStringArray(value.referencePaths, {
    min: 1, max: 16, code: 'invalid-reference-paths',
    item: (item) => validateRepoPath(item, { reference: true }),
  })
  const symbols = validateStringArray(value.symbols, {
    min: 0, max: 16, code: 'invalid-symbols',
    item: (item) => {
      assert(typeof item === 'string' && /^[A-Za-z_$][A-Za-z0-9_.$:#-]{0,79}$/.test(item), 'invalid-symbol')
      return item
    },
  })
  const acceptanceChecks = validateStringArray(value.acceptanceChecks, {
    min: 1, max: CHECKS.size, code: 'invalid-acceptance-checks',
    item: (item) => { assert(CHECKS.has(item), 'invalid-acceptance-check'); return item },
  })
  assert(acceptanceChecks.includes('git-diff-check'), 'missing-git-diff-check')
  return Object.freeze({
    schemaVersion: 2,
    executionId: value.executionId,
    baseSha: value.baseSha,
    operation: value.operation,
    changeMode: value.changeMode,
    scopePaths,
    referencePaths,
    symbols,
    acceptanceChecks,
    risk: value.risk,
  })
}

function extractBlock(text, startMarker, endMarker, maxLength, missingCode, duplicateCode, jsonCode) {
  assert(typeof text === 'string' && text.length <= 100_000, 'invalid-block-source')
  const start = text.indexOf(startMarker)
  const end = text.indexOf(endMarker)
  assert(start >= 0 && end > start, missingCode)
  assert(text.indexOf(startMarker, start + startMarker.length) === -1, duplicateCode)
  assert(text.indexOf(endMarker, end + endMarker.length) === -1, duplicateCode)
  const raw = text.slice(start + startMarker.length, end).trim()
  assert(raw.length > 1 && raw.length <= maxLength, jsonCode)
  try { return JSON.parse(raw) } catch { throw new PilotError(jsonCode) }
}

export function extractAndValidateSafeTask(issueBody) {
  return validateSafeTask(extractBlock(
    issueBody, TASK_START, TASK_END, 8192,
    'missing-safe-task-block', 'duplicate-safe-task-block', 'invalid-safe-task-json',
  ))
}

export function taskHash(task) {
  return crypto.createHash('sha256').update(JSON.stringify(validateSafeTask(task))).digest('hex')
}

export function extractAndValidateApproval(commentBody, task) {
  const approval = extractBlock(
    commentBody, APPROVAL_START, APPROVAL_END, 1024,
    'missing-approval-block', 'duplicate-approval-block', 'invalid-approval-json',
  )
  exactKeys(approval, APPROVAL_KEYS, 'invalid-approval-schema')
  assert(approval.schemaVersion === 2, 'invalid-approval-version')
  assert(approval.executionId === task.executionId, 'approval-execution-mismatch')
  assert(typeof approval.taskSha256 === 'string' && SHA64.test(approval.taskSha256), 'invalid-approval-hash')
  assert(approval.taskSha256 === taskHash(task), 'approval-task-hash-mismatch')
  return approval
}

export function hasTrustedApproval(comments, task, trustedLogins = new Set([PILOT.owner])) {
  return comments.some((comment) => {
    if (!trustedLogins.has(comment?.user?.login) || typeof comment.body !== 'string') return false
    try { extractAndValidateApproval(comment.body, task); return true } catch { return false }
  })
}

export function validateHandoff(value, requiredChecks = []) {
  assert(value && typeof value === 'object' && !Array.isArray(value), 'invalid-handoff')
  assert(value.schemaVersion === 1, 'invalid-handoff-version')
  assert(value.status === 'ready' || value.status === 'blocked', 'invalid-handoff-status')
  if (value.status === 'blocked') {
    exactKeys(value, new Set(['schemaVersion', 'status', 'blockerCode']), 'invalid-blocked-handoff-schema')
    assert(BLOCKERS.has(value.blockerCode), 'invalid-blocker-code')
    return value
  }
  exactKeys(value, new Set(['schemaVersion', 'status', 'checks']), 'invalid-ready-handoff-schema')
  assert(value.checks && typeof value.checks === 'object' && !Array.isArray(value.checks), 'invalid-handoff-checks')
  const actual = Object.keys(value.checks).sort()
  const required = [...requiredChecks].sort()
  assert(JSON.stringify(actual) === JSON.stringify(required), 'invalid-handoff-checks')
  assert(actual.every((key) => CHECKS.has(key) && value.checks[key] === 'pass'), 'handoff-check-not-pass')
  return value
}

function safeInside(root, candidate) {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

export function pathsOverlap(left, right) {
  const a = path.resolve(left)
  const b = path.resolve(right)
  return safeInside(a, b) || safeInside(b, a)
}

export function validateTrustedPathSeparation({ controlRoot, stateRoot: state, workspaceRoot, workspace, binaries = [] }) {
  const control = path.resolve(controlRoot)
  const durableState = path.resolve(state)
  const workspaces = path.resolve(workspaceRoot)
  const issueWorkspace = path.resolve(workspace)
  assert(safeInside(workspaces, issueWorkspace), 'workspace-outside-pilot-root')
  for (const [left, right] of [
    [control, issueWorkspace], [control, workspaces], [control, durableState],
    [durableState, issueWorkspace], [durableState, workspaces],
  ]) assert(!pathsOverlap(left, right), 'trusted-path-overlap')
  for (const binary of binaries) {
    assert(!pathsOverlap(binary, issueWorkspace) && !pathsOverlap(binary, workspaces), 'trusted-binary-overlap')
  }
  return { controlRoot: control, stateRoot: durableState, workspaceRoot: workspaces, workspace: issueWorkspace }
}

function assertPosixTrusted(pathname, { rootOwned = false, directory = false } = {}) {
  const stat = fs.lstatSync(pathname)
  assert(!stat.isSymbolicLink() && (directory ? stat.isDirectory() : stat.isFile()), 'trusted-path-type-invalid')
  if (process.platform === 'linux') {
    assert(!rootOwned || stat.uid === 0, 'trusted-path-owner-invalid')
    assert((stat.mode & 0o022) === 0, 'trusted-path-writable')
    if (rootOwned) {
      let current = directory ? pathname : path.dirname(pathname)
      while (true) {
        const ancestor = fs.lstatSync(current)
        assert(ancestor.isDirectory() && !ancestor.isSymbolicLink() && ancestor.uid === 0, 'trusted-path-owner-invalid')
        assert((ancestor.mode & 0o022) === 0, 'trusted-path-writable')
        const parent = path.dirname(current)
        if (parent === current) break
        current = parent
      }
    }
  }
}

export function verifyControlManifest(controlRoot, { requireRootOwner = process.platform === 'linux' } = {}) {
  const control = fs.realpathSync(controlRoot)
  assertPosixTrusted(control, { rootOwned: requireRootOwner, directory: true })
  const manifest = path.join(control, 'symphony', 'control-manifest.sha256')
  assertPosixTrusted(manifest, { rootOwned: requireRootOwner })
  const lines = fs.readFileSync(manifest, 'utf8').trim().split(/\r?\n/).filter(Boolean)
  const entries = lines.map((line) => {
    const match = line.match(/^([0-9a-f]{64})  ([A-Za-z0-9_./@+-]+)$/)
    assert(match, 'control-manifest-invalid')
    validateRepoPath(match[2])
    return { sha256: match[1], relativePath: match[2] }
  })
  assert(JSON.stringify(entries.map((entry) => entry.relativePath).sort()) === JSON.stringify(CONTROL_MANIFEST_FILES), 'control-manifest-path-set-mismatch')
  for (const entry of entries) {
    const target = path.resolve(control, entry.relativePath)
    assert(safeInside(control, target), 'control-manifest-path-escape')
    assertPosixTrusted(target, { rootOwned: requireRootOwner })
    assert(fs.realpathSync(target) === target, 'control-file-not-canonical')
    assert(fileHash(target) === entry.sha256, 'control-file-digest-mismatch')
  }
  return { controlRoot: control, manifest, entries }
}

export function validatePilotAuthStore(authRoot) {
  const root = fs.realpathSync(authRoot)
  const names = fs.readdirSync(root).sort()
  assert(JSON.stringify(names) === JSON.stringify(['auth.json']), 'pilot-home-unexpected-content')
  const authPath = path.join(root, 'auth.json')
  const stat = fs.lstatSync(authPath)
  assert(stat.isFile() && !stat.isSymbolicLink(), 'pilot-auth-invalid')
  if (process.platform === 'linux') {
    assert(stat.uid === process.getuid(), 'pilot-auth-owner-invalid')
    assert((stat.mode & 0o077) === 0, 'pilot-auth-permissions-invalid')
  }
  assert(fs.realpathSync(authPath) === authPath, 'pilot-auth-invalid')
  return authPath
}

export function readSafeJson(workspace, relativePath) {
  validateRepoPath(relativePath)
  const root = fs.realpathSync(workspace)
  const target = path.resolve(root, relativePath)
  assert(safeInside(root, target), 'unsafe-json-path')
  const parent = path.dirname(target)
  const parentStat = fs.lstatSync(parent)
  assert(parentStat.isDirectory() && !parentStat.isSymbolicLink(), 'unsafe-json-parent')
  assert(safeInside(root, fs.realpathSync(parent)), 'unsafe-json-parent')
  const stat = fs.lstatSync(target)
  assert(stat.isFile() && !stat.isSymbolicLink(), 'unsafe-json-file')
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)
  const fd = fs.openSync(target, flags)
  try {
    assert(fs.fstatSync(fd).isFile(), 'unsafe-json-file')
    const parsed = JSON.parse(fs.readFileSync(fd, 'utf8'))
    assert(safeInside(root, fs.realpathSync(target)), 'unsafe-json-path')
    return parsed
  } catch (error) {
    if (error instanceof PilotError) throw error
    throw new PilotError('invalid-json-file')
  } finally { fs.closeSync(fd) }
}

function writeExclusiveJson(workspace, relativePath, value) {
  validateRepoPath(relativePath)
  const root = fs.realpathSync(workspace)
  const target = path.resolve(root, relativePath)
  assert(safeInside(root, target), 'unsafe-json-path')
  const parent = path.dirname(target)
  if (!fs.existsSync(parent)) fs.mkdirSync(parent, { mode: 0o700 })
  const parentStat = fs.lstatSync(parent)
  assert(parentStat.isDirectory() && !parentStat.isSymbolicLink(), 'unsafe-json-parent')
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0)
  const fd = fs.openSync(target, flags, 0o600)
  try { fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
}

export function stateRoot() {
  const configured = process.env.SYMPHONY_PILOT_STATE_DIR?.trim()
  return path.resolve(configured || path.join(os.homedir(), '.local', 'state', 'kaimono-baton-symphony'))
}

function statePath(issueNumber) { return path.join(stateRoot(), `GH-${issueNumber}.json`) }
function lockPath(issueNumber, executionId) { return path.join(stateRoot(), 'locks', `GH-${issueNumber}-${executionId}.lock`) }
function issueLockPath(issueNumber) { return path.join(stateRoot(), 'locks', `GH-${issueNumber}.coordination.lock`) }
function launchPermitPath(issueNumber, executionId) { return path.join(stateRoot(), 'launch-permits', `GH-${issueNumber}-${executionId}.json`) }

export function currentInstanceId() {
  const value = process.env.SYMPHONY_PILOT_INSTANCE_ID?.trim().toLowerCase()
  assert(value && INSTANCE_ID.test(value), 'invalid-instance-id')
  return value
}

function linuxOwnerProcessIdentity(ownerInstanceId) {
  assert(process.platform === 'linux', 'owner-process-identity-invalid')
  const bootId = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()
  assert(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(bootId), 'owner-process-identity-invalid')
  let pid = process.ppid
  for (let depth = 0; depth < 32 && pid > 1; depth += 1) {
    let stat; let comm
    try {
      const raw = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').trim()
      const close = raw.lastIndexOf(')')
      assert(close >= 0, 'owner-process-identity-invalid')
      stat = raw.slice(close + 2).split(/\s+/)
      comm = fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim()
    } catch { throw new PilotError('owner-process-identity-invalid') }
    const parent = Number(stat[1]); const start = stat[19]
    assert(Number.isSafeInteger(parent) && parent > 0 && /^\d+$/.test(start), 'owner-process-identity-invalid')
    if (!['sh', 'bash', 'dash', 'zsh'].includes(comm) && !comm.startsWith('symphony-pilot-')) {
      return crypto.createHash('sha256').update(`${ownerInstanceId}\n${bootId}\n${pid}\n${start}\n`).digest('hex')
    }
    pid = parent
  }
  throw new PilotError('owner-process-identity-invalid')
}

export function currentOwnerProcessIdentity(ownerInstanceId, suppliedIdentity) {
  assert(typeof suppliedIdentity === 'string' && SHA64.test(suppliedIdentity), 'owner-process-identity-invalid')
  const computed = linuxOwnerProcessIdentity(ownerInstanceId)
  assert(crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(suppliedIdentity)), 'owner-process-identity-mismatch')
  return computed
}

function durableWriteJson(target, value) {
  const root = path.dirname(target)
  fs.mkdirSync(root, { recursive: true, mode: 0o700 })
  const temp = `${target}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`
  const fd = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600)
  try { fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  fs.renameSync(temp, target)
  const dirFd = fs.openSync(root, fs.constants.O_RDONLY)
  try {
    try { fs.fsyncSync(dirFd) } catch (error) {
      if (process.platform !== 'win32' || !['EINVAL', 'EPERM'].includes(error?.code)) throw error
    }
  } finally { fs.closeSync(dirFd) }
}

export function acquireExecutionLock(root, issueNumber, executionId) {
  const lock = path.join(path.resolve(root), 'locks', `GH-${issueNumber}-${executionId}.lock`)
  fs.mkdirSync(path.dirname(lock), { recursive: true, mode: 0o700 })
  try { fs.mkdirSync(lock, { mode: 0o700 }) } catch (error) {
    if (error?.code === 'EEXIST') throw new PilotError('execution-lock-held')
    throw error
  }
  durableWriteJson(path.join(lock, 'owner.json'), {
    schemaVersion: 1, issueNumber, executionId, pid: process.pid,
    ownerToken: crypto.randomBytes(24).toString('hex'),
  })
  return lock
}

function acquireIssueLock(issueNumber) {
  const lock = issueLockPath(issueNumber)
  fs.mkdirSync(path.dirname(lock), { recursive: true, mode: 0o700 })
  try { fs.mkdirSync(lock, { mode: 0o700 }) } catch (error) {
    if (error?.code === 'EEXIST') throw new PilotError('issue-lock-held')
    throw error
  }
  return lock
}

function releaseExecutionLock(lock) {
  const owner = path.join(lock, 'owner.json')
  if (fs.existsSync(owner)) fs.unlinkSync(owner)
  fs.rmdirSync(lock)
}


function releaseIssueLock(lock) {
  fs.rmdirSync(lock)
}

function readState(issueNumber) {
  const file = statePath(issueNumber)
  if (!fs.existsSync(file)) return null
  const stat = fs.lstatSync(file)
  assert(stat.isFile() && !stat.isSymbolicLink(), 'persistent-state-invalid')
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { throw new PilotError('persistent-state-invalid') }
}

function writeState(issueNumber, state) {
  durableWriteJson(statePath(issueNumber), { ...state, updatedAt: new Date().toISOString() })
}

function writeExclusiveHostJson(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 })
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0)
  const fd = fs.openSync(target, flags, 0o600)
  try { fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
}

function readHostJson(target) {
  const stat = fs.lstatSync(target)
  assert(stat.isFile() && !stat.isSymbolicLink(), 'host-json-invalid')
  const fd = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
  try {
    assert(fs.fstatSync(fd).isFile(), 'host-json-invalid')
    return JSON.parse(fs.readFileSync(fd, 'utf8'))
  } catch (error) {
    if (error instanceof PilotError) throw error
    throw new PilotError('host-json-invalid')
  } finally { fs.closeSync(fd) }
}

export function validateLaunchPermit(permit, state, ownerInstanceId, ownerProcessIdentity, now = Date.now()) {
  exactKeys(permit, LAUNCH_PERMIT_KEYS, 'launch-permit-invalid')
  assert(permit.schemaVersion === 1, 'launch-permit-invalid')
  assert(Number.isSafeInteger(permit.issueNumber) && permit.issueNumber > 0, 'launch-permit-invalid')
  assert(Number.isSafeInteger(permit.executionId) && permit.executionId > 0, 'launch-permit-invalid')
  assert(SHA64.test(permit.taskHash) && SHA40.test(permit.baseSha), 'launch-permit-invalid')
  assert(INSTANCE_ID.test(permit.ownerInstanceId) && permit.ownerInstanceId === ownerInstanceId, 'launch-permit-owner-mismatch')
  assert(SHA64.test(permit.ownerProcessIdentity) && permit.ownerProcessIdentity === ownerProcessIdentity, 'launch-permit-owner-mismatch')
  assert(typeof permit.nonce === 'string' && /^[0-9a-f]{48}$/.test(permit.nonce), 'launch-permit-invalid')
  const issuedAt = Date.parse(permit.issuedAt)
  assert(Number.isFinite(issuedAt) && issuedAt <= now + 5_000 && now - issuedAt <= 60_000, 'launch-permit-expired')
  assert(state?.state === 'claimed', 'launch-state-invalid')
  assert(state.issueNumber === permit.issueNumber && state.executionId === permit.executionId, 'launch-permit-state-mismatch')
  assert(state.taskHash === permit.taskHash && state.baseSha === permit.baseSha, 'launch-permit-state-mismatch')
  assert(state.ownerInstanceId === permit.ownerInstanceId && state.ownerProcessIdentity === permit.ownerProcessIdentity, 'launch-permit-owner-mismatch')
  return permit
}

function issueLaunchPermit(issueNumber, state) {
  const target = launchPermitPath(issueNumber, state.executionId)
  assert(!fs.existsSync(target), 'launch-permit-already-exists')
  writeExclusiveHostJson(target, {
    schemaVersion: 1, issueNumber, executionId: state.executionId,
    taskHash: state.taskHash, baseSha: state.baseSha,
    ownerInstanceId: state.ownerInstanceId, ownerProcessIdentity: state.ownerProcessIdentity,
    issuedAt: new Date().toISOString(), nonce: crypto.randomBytes(24).toString('hex'),
  })
}

export function consumeLaunchPermit(cwd, ownerProcessIdentity) {
  const issueNumber = deriveIssueNumber(cwd)
  const state = readState(issueNumber)
  assert(state, 'persistent-state-missing')
  const target = launchPermitPath(issueNumber, state.executionId)
  assert(fs.existsSync(target), 'launch-permit-missing')
  validateLaunchPermit(readHostJson(target), { ...state, issueNumber }, currentInstanceId(), ownerProcessIdentity)
  const consumed = `${target}.consumed-${process.pid}-${crypto.randomBytes(8).toString('hex')}`
  fs.renameSync(target, consumed)
  fs.unlinkSync(consumed)
  console.log(`[symphony-pilot] launch-permit-consumed GH-${issueNumber}`)
}

export function runIfExecutionOwner(state, ownerInstanceId, ownerProcessIdentity, action) {
  if (state?.ownerInstanceId !== ownerInstanceId || state?.ownerProcessIdentity !== ownerProcessIdentity) return { status: 'non-owner' }
  return { status: 'owner', value: action() }
}

function childEnv(extra = {}) {
  const runtime = trustedRuntimePaths()
  const hostTemp = path.join(stateRoot(), 'host-tmp')
  fs.mkdirSync(hostTemp, { recursive: true, mode: 0o700 })
  assertPosixTrusted(hostTemp, { directory: true })
  assert(safeInside(fs.realpathSync(stateRoot()), fs.realpathSync(hostTemp)), 'trusted-temp-path-escape')
  const env = {
    PATH: runtime.path,
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    TMPDIR: hostTemp,
  }
  return { ...env, ...extra }
}

const TRUSTED_BINARY_ENV = Object.freeze({
  git: 'SYMPHONY_PILOT_GIT_BIN',
  node: 'SYMPHONY_PILOT_NODE_BIN',
  npm: 'SYMPHONY_PILOT_NPM_BIN',
  bwrap: 'SYMPHONY_PILOT_BWRAP_BIN',
  shell: 'SYMPHONY_PILOT_SHELL_BIN',
})

function trustedBinary(kind) {
  const variable = TRUSTED_BINARY_ENV[kind]
  const configured = process.env[variable]?.trim()
  assert(configured && path.isAbsolute(configured), 'trusted-binary-missing')
  const resolved = fs.realpathSync(configured)
  assertPosixTrusted(resolved, { rootOwned: process.platform === 'linux' })
  if (process.platform !== 'win32') assert((fs.statSync(resolved).mode & 0o111) !== 0, 'trusted-binary-not-executable')
  return resolved
}

export function trustedRuntimePaths() {
  const binaries = Object.fromEntries(Object.keys(TRUSTED_BINARY_ENV).map((kind) => [kind, trustedBinary(kind)]))
  const configuredExecPath = process.env.SYMPHONY_PILOT_GIT_EXEC_PATH?.trim()
  assert(configuredExecPath && path.isAbsolute(configuredExecPath), 'trusted-git-exec-path-missing')
  const gitExecPath = fs.realpathSync(configuredExecPath)
  assertPosixTrusted(gitExecPath, { rootOwned: process.platform === 'linux', directory: true })
  const trustedDirectories = [...new Set(Object.values(binaries).map((binary) => path.dirname(binary)))]
  for (const directory of trustedDirectories) assertPosixTrusted(directory, { rootOwned: process.platform === 'linux', directory: true })
  return { ...binaries, gitExecPath, path: trustedDirectories.join(path.delimiter) }
}

function trustedGitHome() {
  const root = path.join(stateRoot(), 'trusted-git')
  const home = path.join(root, 'home')
  const hooks = path.join(root, 'empty-hooks')
  const xdg = path.join(root, 'xdg')
  for (const dir of [root, home, hooks, xdg]) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    assertPosixTrusted(dir, { directory: true })
    assert(safeInside(fs.realpathSync(stateRoot()), fs.realpathSync(dir)), 'trusted-git-path-escape')
  }
  for (const dir of [home, hooks, xdg]) assert(fs.readdirSync(dir).length === 0, 'trusted-git-directory-not-empty')
  return { home, hooks, xdg }
}

export function privilegedGitEnv(extra = {}) {
  const { home, hooks, xdg } = trustedGitHome()
  const runtime = trustedRuntimePaths()
  return childEnv({
    HOME: home,
    XDG_CONFIG_HOME: xdg,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: os.platform() === 'win32' ? 'NUL' : '/dev/null',
    GIT_EXEC_PATH: runtime.gitExecPath,
    GIT_CONFIG_COUNT: '4',
    GIT_CONFIG_KEY_0: 'core.hooksPath',
    GIT_CONFIG_VALUE_0: hooks,
    GIT_CONFIG_KEY_1: 'credential.helper',
    GIT_CONFIG_VALUE_1: '',
    GIT_CONFIG_KEY_2: 'core.fsmonitor',
    GIT_CONFIG_VALUE_2: 'false',
    GIT_CONFIG_KEY_3: 'protocol.file.allow',
    GIT_CONFIG_VALUE_3: 'never',
    ...extra,
  })
}

function run(cwd, command, args, { env = childEnv(), stdio = ['ignore', 'pipe', 'pipe'] } = {}) {
  try { return execFileSync(command, args, { cwd, env, stdio, encoding: 'utf8' }).trim() }
  catch { throw new PilotError(`${path.basename(command)}-command-failed`) }
}
function git(cwd, args, options = {}) { return run(cwd, trustedRuntimePaths().git, args, options) }
export function privilegedGit(cwd, args, extraEnv = {}) { return git(cwd, args, { env: privilegedGitEnv(extraEnv) }) }

function fileHash(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') }
function refsHash(cwd) { return crypto.createHash('sha256').update(privilegedGit(cwd, ['for-each-ref', '--format=%(refname) %(objectname)'])).digest('hex') }

export function captureAgentGitState(cwd) {
  return {
    gitConfigHash: fileHash(path.join(cwd, '.git', 'config')),
    indexHash: fileHash(workspaceIndexPath(cwd)),
    refsHash: refsHash(cwd),
  }
}

export function parseLsTreeRecord(record, expectedPath) {
  const nul = record.indexOf('\0')
  const line = nul >= 0 ? record.slice(0, nul) : record
  const match = line.match(/^(\d{6}) (\w+) ([0-9a-f]{40})\t(.+)$/)
  assert(match && match[4] === expectedPath, 'reference-invalid')
  return { mode: match[1], type: match[2], sha: match[3], name: match[4] }
}

export function validateReferencePathAtBase(cwd, baseSha, referencePath) {
  validateRepoPath(referencePath, { reference: true })
  const output = privilegedGit(cwd, ['ls-tree', '-z', baseSha, '--', referencePath])
  assert(output, 'reference-invalid')
  const entry = parseLsTreeRecord(output, referencePath)
  assert(entry.type === 'blob' && (entry.mode === '100644' || entry.mode === '100755'), 'reference-invalid')
  return entry
}

function assertOrigin(cwd) {
  const fetchUrls = privilegedGit(cwd, ['remote', 'get-url', '--all', 'origin']).split(/\r?\n/).filter(Boolean)
  const pushUrls = privilegedGit(cwd, ['remote', 'get-url', '--push', '--all', 'origin']).split(/\r?\n/).filter(Boolean)
  assert(fetchUrls.length === 1 && fetchUrls[0] === PILOT.repositoryUrl, 'unexpected-origin-url')
  assert(pushUrls.length === 1 && pushUrls[0] === PILOT.repositoryUrl, 'unexpected-origin-url')
}

export function assertSafeLocalGitConfig(cwd) {
  const keys = splitNull(privilegedGit(cwd, ['config', '--local', '--name-only', '--null', '--list'])).map((key) => key.toLowerCase())
  const allowed = keys.every((key) =>
    ['core.repositoryformatversion', 'core.filemode', 'core.bare', 'core.logallrefupdates', 'core.ignorecase', 'core.symlinks', 'remote.origin.url', 'remote.origin.fetch'].includes(key)
    || /^branch\.[a-z0-9_./-]+\.(remote|merge)$/.test(key)
  )
  assert(allowed, 'unsafe-local-git-config')
}

function fetchOriginMain(cwd) {
  try { privilegedGit(cwd, ['fetch', '--no-tags', '--depth', '1', 'origin', 'main']) }
  catch { throw new PilotError('remote-transport-transient') }
}

function cleanToApprovedBase(cwd, baseSha) {
  assertOrigin(cwd)
  fetchOriginMain(cwd)
  const fetched = privilegedGit(cwd, ['rev-parse', PILOT.baseRef])
  assert(fetched === baseSha, 'base-moved')
  const branch = `codex/gh-${deriveIssueNumber(cwd)}`
  privilegedGit(cwd, ['checkout', '-B', branch, baseSha])
  privilegedGit(cwd, ['reset', '--hard', baseSha])
  privilegedGit(cwd, ['clean', '-ffdx'])
  assert(privilegedGit(cwd, ['status', '--porcelain=v1', '--untracked-files=all']) === '', 'workspace-not-pristine')
  return branch
}

function deriveIssueNumber(cwd) {
  const match = path.basename(cwd).match(/^GH-(\d+)$/)
  assert(match, 'invalid-workspace-identifier')
  const value = Number.parseInt(match[1], 10)
  assert(Number.isSafeInteger(value) && value > 0, 'invalid-issue-number')
  return value
}

export function classifyGitHubResponse(response, { expectedStatuses = [] } = {}) {
  const status = response?.status
  if (expectedStatuses.includes(status)) return 'expected'
  if (response?.ok) return 'ok'
  if (status === 408 || status === 429 || (Number.isInteger(status) && status >= 500 && status <= 599)) return 'transient'
  return 'permanent'
}

export function classifyGitHubTransportError() {
  return 'transient'
}

function requireGitHubResponse(response, options = {}) {
  const classification = classifyGitHubResponse(response, options)
  if (classification === 'ok' || classification === 'expected') return classification
  throw new PilotError(classification === 'transient' ? 'github-transient-failure' : 'github-permanent-failure')
}

async function githubRequest(pathname, { method = 'GET', body, authenticated = false } = {}) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'kaimono-baton-symphony-pilot',
  }
  if (authenticated) {
    const token = process.env.GITHUB_TOKEN
    assert(typeof token === 'string' && token.length > 0, 'missing-github-token')
    headers.Authorization = `Bearer ${token}`
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  try { return await fetch(`https://api.github.com${pathname}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }) }
  catch { throw new PilotError(classifyGitHubTransportError() === 'transient' ? 'github-transient-failure' : 'github-permanent-failure') }
}

async function fetchIssueSnapshot(issueNumber) {
  const issueResponse = await githubRequest(`/repos/${PILOT.repository}/issues/${issueNumber}`)
  requireGitHubResponse(issueResponse)
  const issue = await issueResponse.json()
  const comments = []
  for (let page = 1; page <= 10; page += 1) {
    const response = await githubRequest(`/repos/${PILOT.repository}/issues/${issueNumber}/comments?per_page=100&page=${page}`)
    requireGitHubResponse(response)
    const items = await response.json()
    assert(Array.isArray(items), 'github-transient-failure')
    comments.push(...items)
    if (items.length < 100) break
    assert(page < 10, 'approval-comment-limit-exceeded')
  }
  return { issue, comments }
}

export function validateIssueSnapshot(snapshot, expectedTask = null) {
  const issue = snapshot?.issue
  assert(issue?.state === 'open' && !issue.pull_request, 'issue-not-dispatchable')
  assert(issue.user?.login === PILOT.owner, 'untrusted-issue-author')
  const labels = (issue.labels || []).map((label) => typeof label === 'string' ? label : label.name).filter(Boolean)
  assert(labels.some((label) => label.toLowerCase() === PILOT.label), 'dispatch-label-missing')
  const task = extractAndValidateSafeTask(issue.body ?? '')
  if (expectedTask) assert(taskHash(task) === taskHash(expectedTask), 'approval-stale')
  assert(hasTrustedApproval(snapshot.comments || [], task), 'matching-trusted-approval-missing')
  return task
}

async function ensureNoRemoteHandoff(issueNumber, branchName) {
  const branch = await githubRequest(`/repos/${PILOT.repository}/branches/${encodeURIComponent(branchName)}`)
  assert(requireGitHubResponse(branch, { expectedStatuses: [404] }) === 'expected', 'remote-branch-already-exists')
  const head = encodeURIComponent(`${PILOT.owner}:${branchName}`)
  const prs = await githubRequest(`/repos/${PILOT.repository}/pulls?state=open&head=${head}`)
  requireGitHubResponse(prs)
  assert((await prs.json()).length === 0, 'open-pr-already-exists')
}

function verifyRuntimePins(cwd) {
  assert(process.platform === 'linux', 'wsl-linux-required')
  const configuredRoot = process.env.SYMPHONY_PILOT_SYMPHONY_ROOT?.trim()
  const configuredControl = process.env.SYMPHONY_PILOT_CONTROL_ROOT?.trim()
  const configuredWorkspaceRoot = process.env.SYMPHONY_PILOT_WORKSPACE_ROOT?.trim()
  const configuredLauncher = process.env.SYMPHONY_PILOT_TRUSTED_LAUNCHER?.trim()
  const configuredCodex = process.env.SYMPHONY_PILOT_CODEX_BIN?.trim()
  const configuredAuthHome = process.env.SYMPHONY_PILOT_CODEX_HOME?.trim()
  assert(configuredRoot && configuredControl && configuredWorkspaceRoot && configuredLauncher && configuredCodex && configuredAuthHome, 'pilot-runtime-path-missing')
  const root = fs.realpathSync(configuredRoot)
  const controlManifest = verifyControlManifest(configuredControl)
  const control = controlManifest.controlRoot
  const workspace = fs.realpathSync(cwd)
  const workspaceRoot = fs.realpathSync(configuredWorkspaceRoot)
  const durableState = fs.realpathSync(stateRoot())
  const launcher = fs.realpathSync(configuredLauncher)
  const codex = fs.realpathSync(configuredCodex)
  const authHome = fs.realpathSync(configuredAuthHome)
  const runtime = trustedRuntimePaths()
  assertPosixTrusted(workspaceRoot, { directory: true })
  assertPosixTrusted(durableState, { directory: true })
  assertPosixTrusted(root, { directory: true })
  assertPosixTrusted(authHome, { directory: true })
  validatePilotAuthStore(authHome)
  assertPosixTrusted(launcher, { rootOwned: true })
  assertPosixTrusted(codex, { rootOwned: true })
  assert(!safeInside(control, launcher), 'trusted-launcher-inside-control-root')
  const launcherEntry = controlManifest.entries.find((entry) => entry.relativePath === 'scripts/symphony-pilot-trusted-launcher.sh')
  assert(launcherEntry && fileHash(launcher) === launcherEntry.sha256, 'trusted-launcher-integrity-failed')
  validateTrustedPathSeparation({
    controlRoot: control, stateRoot: durableState, workspaceRoot, workspace,
    binaries: [launcher, codex, runtime.git, runtime.node, runtime.npm, runtime.bwrap, runtime.shell, runtime.gitExecPath],
  })
  assert(!pathsOverlap(authHome, workspace) && !pathsOverlap(authHome, workspaceRoot) && !pathsOverlap(authHome, control), 'pilot-auth-path-overlap')
  assert(fs.realpathSync(path.join(control, 'scripts', 'symphony-pilot-host.mjs')) === fs.realpathSync(process.argv[1]), 'untrusted-host-entrypoint')
  assert(fs.realpathSync(path.join(control, 'scripts', 'symphony-pilot-codex.sh')) === path.join(control, 'scripts', 'symphony-pilot-codex.sh'), 'untrusted-wrapper-path')
  assert(fs.realpathSync(path.join(control, 'symphony', 'codex', 'config.toml')) === path.join(control, 'symphony', 'codex', 'config.toml'), 'untrusted-config-path')
  assert(privilegedGit(root, ['rev-parse', 'HEAD']) === PILOT.symphonySha, 'symphony-version-mismatch')
  const changed = privilegedGit(root, ['diff', '--name-only']).split(/\r?\n/).filter(Boolean).sort()
  assert(JSON.stringify(changed) === JSON.stringify([
    'elixir/lib/symphony_elixir/codex/app_server.ex',
    'elixir/lib/symphony_elixir/config.ex',
    'elixir/lib/symphony_elixir/config/schema.ex',
    'elixir/lib/symphony_elixir/github/adapter.ex',
    'elixir/lib/symphony_elixir/workspace.ex',
    'elixir/test/symphony_elixir/app_server_test.exs',
    'elixir/test/symphony_elixir/github_adapter_test.exs',
  ]), 'symphony-patch-mismatch')
  privilegedGit(root, ['apply', '--reverse', '--check', path.join(control, 'symphony', 'patches', '0001-disable-github-agent-tool.patch')])
  assertOrigin(cwd)
}

function runNpmCi(cwd) {
  const home = path.join(stateRoot(), 'npm-home')
  fs.mkdirSync(home, { recursive: true, mode: 0o700 })
  run(cwd, trustedRuntimePaths().npm, ['ci'], {
    stdio: 'inherit',
    env: childEnv({ HOME: home, XDG_CONFIG_HOME: path.join(home, 'xdg'), CI: 'true', npm_config_audit: 'false', npm_config_fund: 'false' }),
  })
}

function validatePrepared(value) {
  exactKeys(value, PREPARED_KEYS, 'invalid-prepared-task-schema')
  assert(value.schemaVersion === 2 && value.repository === PILOT.repository, 'invalid-prepared-task')
  assert(Number.isSafeInteger(value.issueNumber) && value.issueNumber > 0, 'invalid-prepared-task')
  assert(value.issueIdentifier === `GH-${value.issueNumber}`, 'invalid-prepared-task')
  assert(value.branchName === `codex/gh-${value.issueNumber}`, 'invalid-prepared-task')
  const task = validateSafeTask(value.task)
  assert(value.baseSha === task.baseSha && value.executionId === task.executionId, 'invalid-prepared-task')
  return { ...value, task }
}

function workspaceIndexPath(cwd) {
  const gitDir = privilegedGit(cwd, ['rev-parse', '--git-dir'])
  return path.resolve(cwd, gitDir, 'index')
}

async function prepare(cwd) {
  const issueNumber = deriveIssueNumber(cwd)
  const ownerInstanceId = currentInstanceId()
  const ownerProcessIdentity = currentOwnerProcessIdentity(ownerInstanceId, process.argv[3])
  const issueLock = acquireIssueLock(issueNumber)
  let task = null
  let executionLock = null
  try {
    verifyRuntimePins(cwd)
    const first = await fetchIssueSnapshot(issueNumber)
    task = validateIssueSnapshot(first)
    const existing = readState(issueNumber)
    if (existing) {
      assert(task.executionId > existing.executionId, 'stale-execution-id')
      assert(existing.state === 'blocked', 'prior-execution-not-retryable')
    }
    executionLock = acquireExecutionLock(stateRoot(), issueNumber, task.executionId)
    writeState(issueNumber, {
      schemaVersion: 3, state: 'preparing', issueNumber, executionId: task.executionId,
      taskHash: taskHash(task), baseSha: task.baseSha,
      branchName: `codex/gh-${issueNumber}`, ownerInstanceId, ownerProcessIdentity,
      claimGeneration: crypto.randomBytes(16).toString('hex'),
    })
    // No other process may mutate this deterministic execution workspace after this point.
    const branchName = cleanToApprovedBase(cwd, task.baseSha)
    for (const referencePath of task.referencePaths) validateReferencePathAtBase(cwd, task.baseSha, referencePath)
    await ensureNoRemoteHandoff(issueNumber, branchName)
    runNpmCi(cwd)
    const prepared = {
      schemaVersion: 2, repository: PILOT.repository, issueNumber,
      issueIdentifier: `GH-${issueNumber}`, executionId: task.executionId,
      branchName, baseSha: task.baseSha, task,
    }
    const symphonyDir = path.join(cwd, '.symphony')
    if (fs.existsSync(symphonyDir)) fs.rmSync(symphonyDir, { recursive: true, force: true })
    fs.mkdirSync(symphonyDir, { mode: 0o700 })
    writeExclusiveJson(cwd, '.symphony/task.json', prepared)
    const index = workspaceIndexPath(cwd)
    // This final remote read is the authorization boundary. Later Issue edits do not revoke this claim.
    const current = await fetchIssueSnapshot(issueNumber)
    const currentTask = validateIssueSnapshot(current, task)
    fetchOriginMain(cwd)
    assert(privilegedGit(cwd, ['rev-parse', PILOT.baseRef]) === currentTask.baseSha, 'base-moved')
    const claimed = {
      schemaVersion: 3, state: 'claimed', issueNumber, executionId: task.executionId,
      taskHash: taskHash(task), baseSha: task.baseSha, branchName,
      ownerInstanceId, ownerProcessIdentity, claimedAt: new Date().toISOString(),
      claimGeneration: crypto.randomBytes(16).toString('hex'),
      gitConfigHash: fileHash(path.join(cwd, '.git', 'config')),
      indexHash: fileHash(index), refsHash: refsHash(cwd),
      baseTreeSha: privilegedGit(cwd, ['rev-parse', `${task.baseSha}^{tree}`]),
    }
    writeState(issueNumber, claimed)
    issueLaunchPermit(issueNumber, claimed)
  } catch (error) {
    const blockerCode = persistPermanentPrepareFailure(issueNumber, ownerInstanceId, ownerProcessIdentity, task, error)
    if (blockerCode) {
      // This is the last operation in the failed prepare phase; no npm/test/application command follows credential use.
      try { await removeLabel(issueNumber) } catch {}
    }
    throw error
  } finally {
    if (executionLock) releaseExecutionLock(executionLock)
    releaseIssueLock(issueLock)
  }
  console.log(`[symphony-pilot] claimed GH-${issueNumber}`)
}

export function permanentBlocker(error) {
  const code = error instanceof PilotError ? error.code : 'other'
  if (['github-transient-failure', 'remote-transport-transient', 'issue-lock-held', 'execution-lock-held'].includes(code)) return null
  if (code === 'base-moved') return 'base-moved'
  if (code.startsWith('reference')) return 'reference-invalid'
  if (code.includes('approval') || code.includes('label') || code.includes('issue')) return 'approval-stale'
  if (code.includes('npm')) return 'validation-failed'
  return 'repository-state-conflict'
}

export function persistPermanentPrepareFailure(issueNumber, ownerInstanceId, ownerProcessIdentity, task, error) {
  const blockerCode = permanentBlocker(error)
  if (!blockerCode) return null
  const state = readState(issueNumber)
  if (task && state?.executionId === task.executionId && state.state === 'preparing' && state.ownerInstanceId === ownerInstanceId && state.ownerProcessIdentity === ownerProcessIdentity) {
    writeState(issueNumber, { ...state, state: 'blocked', blockerCode })
  } else if (!state) {
    writeState(issueNumber, {
      schemaVersion: 3, state: 'blocked', issueNumber,
      executionId: task?.executionId ?? 0,
      taskHash: task ? taskHash(task) : null, baseSha: task?.baseSha ?? null,
      branchName: `codex/gh-${issueNumber}`, ownerInstanceId, ownerProcessIdentity, blockerCode,
    })
  }
  return blockerCode
}

function splitNull(output) { return output.split('\0').filter(Boolean) }

export function collectChangedPaths(cwd, baseSha) {
  const tracked = splitNull(privilegedGit(cwd, ['diff', '--name-only', '--no-renames', '-z', baseSha]))
  const untracked = splitNull(privilegedGit(cwd, ['ls-files', '--others', '--exclude-standard', '-z']))
  return [...new Set([...tracked, ...untracked])].filter((name) => !name.startsWith('.symphony/')).sort()
}

function baseTreeEntry(cwd, baseSha, repoPath) {
  const existing = privilegedGit(cwd, ['ls-tree', '-z', baseSha, '--', repoPath])
  return existing ? parseLsTreeRecord(`${existing}\0`, repoPath) : null
}

export function buildValidatedTree(cwd, baseSha, changedPaths, scopePaths, changeMode) {
  assert(CHANGE_MODES.has(changeMode), 'invalid-change-mode')
  fs.mkdirSync(stateRoot(), { recursive: true, mode: 0o700 })
  const tempIndexDir = fs.mkdtempSync(path.join(stateRoot(), 'index-'))
  const indexFile = path.join(tempIndexDir, 'index')
  const env = { GIT_INDEX_FILE: indexFile }
  try {
    privilegedGit(cwd, ['read-tree', baseSha], env)
    for (const repoPath of changedPaths) {
      assert(isPathAllowed(repoPath, scopePaths), 'change-outside-allowed-scope')
      const baseEntry = baseTreeEntry(cwd, baseSha, repoPath)
      if (baseEntry) assert(baseEntry.type === 'blob' && ['100644', '100755'].includes(baseEntry.mode), 'unsafe-file-type')
      const absolute = path.join(cwd, repoPath)
      const outputExists = fs.existsSync(absolute)
      // No approved pilot mode authorizes deletion. The remaining semantics are
      // evaluated against the exact approved base tree, not the working diff.
      assert(outputExists, 'change-mode-deletion-forbidden')
      if (changeMode === 'modify-existing') assert(baseEntry, 'change-mode-add-forbidden')
      if (changeMode === 'add-file') assert(!baseEntry, 'change-mode-overwrite-forbidden')
      const stat = fs.lstatSync(absolute)
      assert(stat.isFile() && !stat.isSymbolicLink(), 'unsafe-file-type')
      const blob = privilegedGit(cwd, ['hash-object', '-w', '--no-filters', '--', repoPath])
      const mode = baseEntry?.mode ?? '100644'
      privilegedGit(cwd, ['update-index', '--add', '--cacheinfo', `${mode},${blob},${repoPath}`], env)
    }
    const treeSha = privilegedGit(cwd, ['write-tree'], env)
    const actual = splitNull(privilegedGit(cwd, ['diff-tree', '--no-commit-id', '--name-only', '--no-renames', '-r', '-z', baseSha, treeSha])).sort()
    assert(JSON.stringify(actual) === JSON.stringify([...changedPaths].sort()), 'validated-tree-mismatch')
    privilegedGit(cwd, ['diff', '--check', baseSha, treeSha])
    return treeSha
  } finally {
    if (fs.existsSync(indexFile)) fs.unlinkSync(indexFile)
    fs.rmdirSync(tempIndexDir)
  }
}

function createCommitObject(cwd, treeSha, baseSha, issueNumber) {
  return privilegedGit(cwd, [
    '-c', 'user.name=Kaimono Baton Symphony Host',
    '-c', 'user.email=symphony-host@users.noreply.github.com',
    'commit-tree', treeSha, '-p', baseSha, '-m', `chore: implement GH-${issueNumber}`,
  ])
}

export function validateRecoveryObject(cwd, state) {
  assert(SHA40.test(state.commitSha) && SHA40.test(state.treeSha), 'finalization-state-invalid')
  assert(privilegedGit(cwd, ['rev-parse', `${state.commitSha}^{tree}`]) === state.treeSha, 'finalization-object-mismatch')
  assert(privilegedGit(cwd, ['rev-parse', `${state.commitSha}^`]) === state.baseSha, 'finalization-object-mismatch')
  const current = privilegedGit(cwd, ['rev-parse', `refs/heads/${state.branchName}`])
  assert(current === state.baseSha || current === state.commitSha, 'finalization-ref-mismatch')
  if (current === state.baseSha) privilegedGit(cwd, ['update-ref', `refs/heads/${state.branchName}`, state.commitSha, state.baseSha])
}

export function validateAgentGitState(cwd, prepared, state) {
  assert(privilegedGit(cwd, ['symbolic-ref', '--short', 'HEAD']) === prepared.branchName, 'unexpected-branch')
  assert(privilegedGit(cwd, ['rev-parse', 'HEAD']) === prepared.baseSha, 'agent-created-commit')
  assert(fileHash(path.join(cwd, '.git', 'config')) === state.gitConfigHash, 'git-config-changed')
  assert(fileHash(workspaceIndexPath(cwd)) === state.indexHash, 'agent-index-changed')
  assert(refsHash(cwd) === state.refsHash, 'agent-ref-changed')
  assertOrigin(cwd)
}

function pushPersistedCommit(cwd, state) {
  assert(state.branchName === `codex/gh-${deriveIssueNumber(cwd)}`, 'unexpected-push-branch')
  assert(SHA40.test(state.commitSha), 'invalid-persisted-commit')
  assertOrigin(cwd)
  assertSafeLocalGitConfig(cwd)
  trustedRuntimePaths()
  const token = process.env.GITHUB_TOKEN
  assert(typeof token === 'string' && token.length > 0, 'missing-github-token')
  const encoded = Buffer.from(`x-access-token:${token}`).toString('base64')
  const env = privilegedGitEnv({
    GIT_CONFIG_COUNT: '5',
    GIT_CONFIG_KEY_4: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_4: `AUTHORIZATION: basic ${encoded}`,
  })
  git(cwd, ['push', PILOT.repositoryUrl, `${state.commitSha}:refs/heads/${state.branchName}`], { env })
}

function prBody({ issueNumber, baseSha, commitSha, changedPaths }) {
  return [
    `Closes #${issueNumber}`,
    '',
    'Host-finalized Symphony pilot handoff. Raw Issue prose and provider errors are excluded.',
    '',
    `- Exact base SHA: \`${baseSha}\``,
    `- Exact head SHA: \`${commitSha}\``,
    '- Draft PR only; independent review and CI are pending.',
    '- No merge, Production, deployment, settings, Secrets, DNS, billing, migration, or user-data operation was performed.',
    '',
    'Changed files:',
    ...changedPaths.map((name) => `- \`${name}\``),
  ].join('\n')
}

async function createDraftPr(issueNumber, state) {
  const head = encodeURIComponent(`${PILOT.owner}:${state.branchName}`)
  const list = await githubRequest(`/repos/${PILOT.repository}/pulls?state=open&head=${head}`)
  requireGitHubResponse(list)
  const existing = await list.json()
  assert(Array.isArray(existing) && existing.length <= 1, 'github-pr-list-invalid')
  const body = prBody({ issueNumber, baseSha: state.baseSha, commitSha: state.commitSha, changedPaths: state.changedPaths })
  if (existing.length === 1) {
    const pr = existing[0]
    assert(pr.draft === true && pr.base?.ref === 'main' && pr.head?.ref === state.branchName, 'existing-pr-not-safe-draft')
    const update = await githubRequest(`/repos/${PILOT.repository}/pulls/${pr.number}`, {
      method: 'PATCH', authenticated: true, body: { body },
    })
    requireGitHubResponse(update)
    return pr.number
  }
  const response = await githubRequest(`/repos/${PILOT.repository}/pulls`, {
    method: 'POST', authenticated: true,
    body: {
      title: `Implement approved task for GH-${issueNumber}`,
      head: state.branchName, base: 'main', draft: true,
      body,
    },
  })
  requireGitHubResponse(response)
  const pr = await response.json()
  assert(Number.isInteger(pr.number) && pr.draft === true, 'github-pr-create-invalid')
  return pr.number
}

async function removeLabel(issueNumber) {
  const response = await githubRequest(`/repos/${PILOT.repository}/issues/${issueNumber}/labels/${encodeURIComponent(PILOT.label)}`, { method: 'DELETE', authenticated: true })
  requireGitHubResponse(response, { expectedStatuses: [404] })
}

async function finalize(cwd) {
  const issueNumber = deriveIssueNumber(cwd)
  let state = readState(issueNumber)
  assert(state, 'persistent-state-missing')
  const ownerInstanceId = currentInstanceId()
  const ownerProcessIdentity = currentOwnerProcessIdentity(ownerInstanceId, process.argv[3])
  if (runIfExecutionOwner(state, ownerInstanceId, ownerProcessIdentity, () => true).status === 'non-owner') {
    // A losing Symphony process must not inspect another owner's workspace handoff,
    // alter its state, remove its label, commit, push, or update its PR.
    console.log(`[symphony-pilot] non-owner-finalize-noop GH-${issueNumber}`)
    return
  }
  verifyRuntimePins(cwd)
  if (state.state === 'completed') { await removeLabel(issueNumber); return }
  if (state.state === 'finalizing') {
    // Recovery trusts only the already validated and durably persisted object identity.
    validateRecoveryObject(cwd, state)
    pushPersistedCommit(cwd, state)
    const prNumber = await createDraftPr(issueNumber, state)
    writeState(issueNumber, { ...state, state: 'completed', prNumber })
    try { await removeLabel(issueNumber) } catch {}
    return
  }
  try {
    const prepared = validatePrepared(readSafeJson(cwd, '.symphony/task.json'))
    assert(prepared.executionId === state.executionId && taskHash(prepared.task) === state.taskHash, 'safe-task-integrity-failed')
    let handoff
    try { handoff = validateHandoff(readSafeJson(cwd, '.symphony/handoff.json'), prepared.task.acceptanceChecks) }
    catch { throw new PilotError('agent-no-handoff') }
    if (handoff.status === 'blocked') {
      writeState(issueNumber, { ...state, state: 'blocked', blockerCode: handoff.blockerCode })
      await removeLabel(issueNumber)
      return
    }
    if (state.state === 'claimed') {
      validateAgentGitState(cwd, prepared, state)
      const changedPaths = collectChangedPaths(cwd, prepared.baseSha)
      assert(changedPaths.length > 0, 'no-implementation-change')
      const treeSha = buildValidatedTree(cwd, prepared.baseSha, changedPaths, prepared.task.scopePaths, prepared.task.changeMode)
      const commitSha = createCommitObject(cwd, treeSha, prepared.baseSha, issueNumber)
      state = { ...state, state: 'finalizing', treeSha, commitSha, changedPaths }
      // The exact commit is durable before the branch ref is changed.
      writeState(issueNumber, state)
    }
    assert(state.state === 'finalizing', 'finalization-state-invalid')
    validateRecoveryObject(cwd, state)
    // Credentialed phase begins here. No repository/application/test command follows.
    pushPersistedCommit(cwd, state)
    const prNumber = await createDraftPr(issueNumber, state)
    state = { ...state, state: 'completed', prNumber }
    writeState(issueNumber, state)
    try { await removeLabel(issueNumber) } catch {}
    console.log(`[symphony-pilot] completed GH-${issueNumber}`)
  } catch (error) {
    const latest = readState(issueNumber)
    if (latest?.state === 'claimed' && latest.ownerInstanceId === ownerInstanceId && latest.ownerProcessIdentity === ownerProcessIdentity) {
      writeState(issueNumber, { ...latest, state: 'blocked', blockerCode: error instanceof PilotError && BLOCKERS.has(error.code) ? error.code : 'repository-state-conflict' })
      try { await removeLabel(issueNumber) } catch {}
    } else if (latest?.state === 'finalizing' && latest.ownerInstanceId === ownerInstanceId && latest.ownerProcessIdentity === ownerProcessIdentity && permanentBlocker(error)) {
      // A persistent API rejection cannot become an unbounded recovery loop.
      writeState(issueNumber, { ...latest, state: 'blocked', blockerCode: permanentBlocker(error) })
      try { await removeLabel(issueNumber) } catch {}
    }
    // finalizing retains its exact durable object identity for host-only recovery.
    throw error
  }
}

function operatorBlock(issueNumber, executionId) {
  assert(Number.isSafeInteger(issueNumber) && issueNumber > 0, 'invalid-issue-number')
  assert(Number.isSafeInteger(executionId) && executionId > 0, 'invalid-execution-id')
  const lock = lockPath(issueNumber, executionId)
  assert(!fs.existsSync(lock), 'execution-lock-held')
  const state = readState(issueNumber)
  assert(state?.executionId === executionId && ['preparing', 'claimed'].includes(state.state), 'operator-block-not-allowed')
  writeState(issueNumber, { ...state, state: 'blocked', blockerCode: 'interrupted-run' })
}

async function main() {
  const [mode, ownerProcessIdentity, issueArg, executionArg] = process.argv.slice(2)
  try {
    if (mode === 'prepare') await prepare(process.cwd())
    else if (mode === 'finalize') await finalize(process.cwd())
    else if (mode === 'consume-launch-permit') { verifyRuntimePins(process.cwd()); consumeLaunchPermit(process.cwd(), currentOwnerProcessIdentity(currentInstanceId(), ownerProcessIdentity)) }
    else if (mode === 'validate-pilot-auth-store') {
      verifyRuntimePins(process.cwd())
      validatePilotAuthStore(process.env.SYMPHONY_PILOT_CODEX_HOME?.trim() || '')
    }
    else if (mode === 'operator-block') operatorBlock(Number(issueArg), Number(executionArg))
    else throw new PilotError('usage')
  } catch (error) {
    console.error(`[symphony-pilot] ${error instanceof PilotError ? error.code : 'unexpected-failure'}`)
    process.exitCode = 1
  }
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (direct) await main()
