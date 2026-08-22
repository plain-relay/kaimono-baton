import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

import {
  PilotError, PILOT, acquireExecutionLock, buildValidatedTree, captureAgentGitState, collectChangedPaths,
  extractAndValidateApproval, extractAndValidateSafeTask, hasTrustedApproval,
  isPathAllowed, isProtectedPath, parseLsTreeRecord, privilegedGitEnv, readSafeJson,
  taskHash, validateAgentGitState, validateHandoff, validateIssueSnapshot, validateRecoveryObject,
  validateReferencePathAtBase, validateRepoPath, validateSafeTask,
} from './symphony-pilot-host.mjs'

const dirs: string[] = []
const originalState = process.env.SYMPHONY_PILOT_STATE_DIR
function temp(name: string) { const d = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`)); dirs.push(d); return d }
afterEach(() => {
  if (originalState === undefined) delete process.env.SYMPHONY_PILOT_STATE_DIR
  else process.env.SYMPHONY_PILOT_STATE_DIR = originalState
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

const validTask = (overrides = {}) => ({
  schemaVersion: 2, executionId: 1, baseSha: 'a'.repeat(40),
  operation: 'implement-existing-public-spec', changeMode: 'modify-existing',
  scopePaths: ['src/pages'], referencePaths: ['docs/PROJECT_MAP.md'], symbols: ['HomePage'],
  acceptanceChecks: ['npm-test', 'git-diff-check'], risk: 'medium', ...overrides,
})
function approval(task: any = validTask(), overrides = {}) {
  return `<!-- symphony-approval:v2 -->\n${JSON.stringify({ schemaVersion: 2, executionId: task.executionId, taskSha256: taskHash(task), ...overrides })}\n<!-- /symphony-approval -->`
}
function snapshot(task: any = validTask(), comments = [approval(task)]) {
  return {
    issue: { state: 'open', user: { login: PILOT.owner }, labels: [{ name: 'codex-ready' }], body: `<!-- symphony-safe-task:v2 -->\n${JSON.stringify(task)}\n<!-- /symphony-safe-task -->` },
    comments: comments.map((body, index) => ({ user: { login: index ? 'mallory' : PILOT.owner }, body })),
  }
}
function git(cwd: string, args: string[], env: NodeJS.ProcessEnv = process.env) {
  return execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim()
}
function repo() {
  const root = temp('pilot-git'); process.env.SYMPHONY_PILOT_STATE_DIR = path.join(root, 'state')
  git(root, ['init']); git(root, ['config', 'user.name', 'Test']); git(root, ['config', 'user.email', 'test@example.invalid'])
  fs.mkdirSync(path.join(root, 'docs')); fs.mkdirSync(path.join(root, 'src', 'pages'), { recursive: true })
  fs.writeFileSync(path.join(root, 'docs', 'PROJECT_MAP.md'), 'map\n'); fs.writeFileSync(path.join(root, 'src', 'pages', 'Home.tsx'), 'old\n')
  git(root, ['add', '--', 'docs/PROJECT_MAP.md', 'src/pages/Home.tsx']); git(root, ['commit', '-m', 'base'])
  return { root, baseSha: git(root, ['rev-parse', 'HEAD']) }
}

describe('safe task and approval', () => {
  it('requires the exact v2 schema and a full base SHA', () => {
    expect(validateSafeTask(validTask())).toEqual(validTask())
    expect(() => validateSafeTask({ ...validTask(), freeText: 'bad' })).toThrow(PilotError)
    const missing: any = validTask(); delete missing.baseSha
    expect(() => validateSafeTask(missing)).toThrow(PilotError)
    expect(() => validateSafeTask(validTask({ baseSha: 'abc' }))).toThrow(PilotError)
  })
  it('binds baseSha and executionId into the exact approval', () => {
    const task = validTask(); const moved = validTask({ baseSha: 'b'.repeat(40) })
    expect(taskHash(task)).not.toBe(taskHash(moved))
    expect(extractAndValidateApproval(approval(task), task).taskSha256).toBe(taskHash(task))
    expect(() => extractAndValidateApproval(approval(task), moved)).toThrow(PilotError)
    expect(() => extractAndValidateApproval(approval(task, { executionId: 2 }), task)).toThrow(PilotError)
    expect(() => extractAndValidateApproval(approval(task, { note: 'bad' }), task)).toThrow(PilotError)
  })
  it('rejects duplicate blocks, malicious approvals, and approval of an old task', () => {
    const body = snapshot().issue.body
    expect(extractAndValidateSafeTask(body)).toEqual(validTask())
    expect(() => extractAndValidateSafeTask(`${body}${body}`)).toThrow(PilotError)
    const current = validTask({ executionId: 2 })
    expect(hasTrustedApproval([{ user: { login: 'mallory' }, body: approval(current) }, { user: { login: PILOT.owner }, body: approval(validTask()) }], current)).toBe(false)
  })
  it('revalidation detects label, task, approval, and base changes', () => {
    const expected = validTask(); const noLabel = snapshot(expected); noLabel.issue.labels = []
    expect(() => validateIssueSnapshot(noLabel, expected)).toThrow(PilotError)
    expect(() => validateIssueSnapshot(snapshot(validTask({ symbols: ['Other'] })), expected)).toThrow(PilotError)
    expect(() => validateIssueSnapshot(snapshot(expected, [approval(validTask({ executionId: 2 }))]), expected)).toThrow(PilotError)
    expect(() => validateIssueSnapshot(snapshot(validTask({ baseSha: 'b'.repeat(40) })), expected)).toThrow(PilotError)
  })
})

describe('paths and approved-base references', () => {
  it('rejects traversal, absolute/backslash, Unicode, sibling-prefix, and protected surfaces', () => {
    for (const p of ['../src', '/src', 'C:/src', 'src\\pages', 'src/ページ']) expect(() => validateRepoPath(p)).toThrow(PilotError)
    expect(isPathAllowed('src/pages2/x.ts', ['src/pages'])).toBe(false)
    expect(isPathAllowed('src/pages/x.ts', ['src/pages'])).toBe(true)
    for (const p of ['SECURITY.md', 'AGENTS.md', '.github/x', '.codex/x', '.agents/x', 'symphony/WORKFLOW.md', '.npmrc', '.gitmodules', '.gitattributes', 'package.json', 'package-lock.json']) {
      expect(isProtectedPath(p)).toBe(true)
      expect(() => validateSafeTask(validTask({ scopePaths: [p] }))).toThrow(PilotError)
    }
  })
  it('accepts a tracked regular blob and rejects absent, untracked, directory, and protected references', () => {
    const { root, baseSha } = repo()
    expect(validateReferencePathAtBase(root, baseSha, 'docs/PROJECT_MAP.md').mode).toBe('100644')
    fs.writeFileSync(path.join(root, 'untracked.txt'), 'x')
    for (const p of ['untracked.txt', 'docs', 'SECURITY.md']) expect(() => validateReferencePathAtBase(root, baseSha, p)).toThrow(PilotError)
  })
  it('recognizes symlink and submodule modes so callers reject them', () => {
    expect(parseLsTreeRecord(`120000 blob ${'a'.repeat(40)}\tlink\0`, 'link').mode).toBe('120000')
    expect(parseLsTreeRecord(`160000 commit ${'a'.repeat(40)}\tsub\0`, 'sub').type).toBe('commit')
  })
})

describe('handoff and safe JSON', () => {
  it('requires exactly every selected check to be pass and allows no prose', () => {
    expect(validateHandoff({ schemaVersion: 1, status: 'ready', checks: { 'npm-test': 'pass', 'git-diff-check': 'pass' } }, ['npm-test', 'git-diff-check']).status).toBe('ready')
    for (const value of [
      { schemaVersion: 1, status: 'ready', checks: { 'git-diff-check': 'pass' } },
      { schemaVersion: 1, status: 'ready', checks: { 'npm-test': 'fail', 'git-diff-check': 'pass' } },
      { schemaVersion: 1, status: 'ready', checks: { 'npm-test': 'pass', 'git-diff-check': 'pass' }, prose: 'bad' },
    ]) expect(() => validateHandoff(value, ['npm-test', 'git-diff-check'])).toThrow(PilotError)
  })
  it('rejects symlinked and nonregular handoff files', () => {
    const root = temp('safe-json'); fs.mkdirSync(path.join(root, '.symphony')); fs.writeFileSync(path.join(root, 'outside.json'), '{}')
    const target = path.join(root, '.symphony', 'handoff.json')
    try { fs.symlinkSync(path.join(root, 'outside.json'), target); expect(() => readSafeJson(root, '.symphony/handoff.json')).toThrow(PilotError) }
    catch (error: any) { if (!['EPERM', 'EACCES'].includes(error?.code)) throw error }
    if (fs.existsSync(target)) fs.unlinkSync(target); fs.mkdirSync(target)
    expect(() => readSafeJson(root, '.symphony/handoff.json')).toThrow(PilotError)
  })
})

describe('atomic execution and exact tree', () => {
  it('allows only one of two concurrent processes to acquire a claim', async () => {
    const root = temp('race'); const url = pathToFileURL(path.resolve('scripts/symphony-pilot-host.mjs')).href
    const code = `import {acquireExecutionLock} from ${JSON.stringify(url)};try{acquireExecutionLock(process.argv[1],6,9);setTimeout(()=>process.exit(0),400)}catch{process.exit(23)}`
    const run = () => new Promise<number>((resolve) => { const child = spawn(process.execPath, ['--input-type=module', '-e', code, root]); child.on('exit', (c) => resolve(c ?? 99)) })
    expect((await Promise.all([run(), run()])).sort((a, b) => a - b)).toEqual([0, 23])
  })
  it('does not break an old lock by age', () => {
    const root = temp('stale-lock'); acquireExecutionLock(root, 6, 1)
    fs.utimesSync(path.join(root, 'locks', 'GH-6-1.lock'), new Date(0), new Date(0))
    expect(() => acquireExecutionLock(root, 6, 1)).toThrow(PilotError)
  })
  it('removes stale untracked and ignored files before another execution', () => {
    const { root } = repo(); fs.writeFileSync(path.join(root, '.gitignore'), 'ignored.tmp\n'); git(root, ['add', '--', '.gitignore']); git(root, ['commit', '-m', 'ignore'])
    fs.writeFileSync(path.join(root, 'stale.tmp'), 'x'); fs.writeFileSync(path.join(root, 'ignored.tmp'), 'x'); git(root, ['clean', '-ffdx'])
    expect(fs.existsSync(path.join(root, 'stale.tmp'))).toBe(false); expect(fs.existsSync(path.join(root, 'ignored.tmp'))).toBe(false)
    expect(git(root, ['status', '--porcelain=v1', '--untracked-files=all'])).toBe('')
  })
  it('writes an exact trusted tree and recovers only the persisted commit object', () => {
    const { root, baseSha } = repo(); fs.writeFileSync(path.join(root, 'src', 'pages', 'Home.tsx'), 'new\n'); fs.writeFileSync(path.join(root, 'src', 'pages', 'Added.tsx'), 'added\n')
    const changed = collectChangedPaths(root, baseSha); expect(changed).toEqual(['src/pages/Added.tsx', 'src/pages/Home.tsx'])
    const treeSha = buildValidatedTree(root, baseSha, changed, ['src/pages'])
    const env = { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' }
    const commitSha = git(root, ['commit-tree', treeSha, '-p', baseSha, '-m', 'trusted'], env); git(root, ['branch', 'codex/gh-1', baseSha])
    validateRecoveryObject(root, { treeSha, commitSha, baseSha, branchName: 'codex/gh-1' })
    expect(git(root, ['rev-parse', 'refs/heads/codex/gh-1'])).toBe(commitSha)
    expect(() => validateRecoveryObject(root, { treeSha, commitSha: baseSha, baseSha, branchName: 'codex/gh-1' })).toThrow(PilotError)
  }, 15_000)
  it('detects agent mutation of HEAD/index, refs, Git config, and origin', () => {
    const { root, baseSha } = repo(); git(root, ['branch', '-M', 'codex/gh-1']); git(root, ['remote', 'add', 'origin', PILOT.repositoryUrl])
    const prepared = { branchName: 'codex/gh-1', baseSha }; const state = captureAgentGitState(root)
    expect(() => validateAgentGitState(root, prepared, state)).not.toThrow()
    fs.writeFileSync(path.join(root, 'src', 'pages', 'Home.tsx'), 'index mutation\n'); git(root, ['add', '--', 'src/pages/Home.tsx'])
    expect(() => validateAgentGitState(root, prepared, state)).toThrow(PilotError)
    git(root, ['reset', '--hard', baseSha]); const cleanState = captureAgentGitState(root)
    git(root, ['update-ref', 'refs/heads/extra', baseSha]); expect(() => validateAgentGitState(root, prepared, cleanState)).toThrow(PilotError)
    git(root, ['update-ref', '-d', 'refs/heads/extra']); const configState = captureAgentGitState(root)
    git(root, ['config', 'core.hooksPath', '.git/hooks']); expect(() => validateAgentGitState(root, prepared, configState)).toThrow(PilotError)
  }, 15_000)
  it('rejects a newly introduced symlink', () => {
    const { root, baseSha } = repo(); const link = path.join(root, 'src', 'pages', 'link.ts')
    try { fs.symlinkSync(path.join(root, 'docs', 'PROJECT_MAP.md'), link); expect(() => buildValidatedTree(root, baseSha, ['src/pages/link.ts'], ['src/pages'])).toThrow(PilotError) }
    catch (error: any) { if (!['EPERM', 'EACCES'].includes(error?.code)) throw error }
  })
})

describe('privileged Git boundary', () => {
  it('disables global/system config and both pre-push and reference-transaction hooks', () => {
    const { root } = repo(); const marker = path.join(root, 'hook-ran'); const hooks = path.join(root, '.git', 'hooks')
    for (const name of ['pre-push', 'reference-transaction']) { fs.writeFileSync(path.join(hooks, name), `#!/bin/sh\necho bad > ${JSON.stringify(marker)}\n`); try { fs.chmodSync(path.join(hooks, name), 0o755) } catch {} }
    git(root, ['config', 'core.hooksPath', '.git/hooks']); const fake = path.join(root, 'system.gitconfig'); fs.writeFileSync(fake, '[alias]\nupdate-ref = !echo bad\n[credential]\nhelper = !echo bad\n[core]\nhooksPath = .git/hooks\n')
    const env = privilegedGitEnv({ GIT_CONFIG_SYSTEM: fake }); expect(path.resolve(git(root, ['config', '--get', 'core.hooksPath'], env))).not.toBe(path.resolve(hooks))
    git(root, ['update-ref', 'refs/heads/safe', 'HEAD'], env); expect(fs.existsSync(marker)).toBe(false)
    const bare = temp('bare-remote'); git(bare, ['init', '--bare'])
    const pushEnv = { ...env, GIT_CONFIG_VALUE_3: 'always' }
    git(root, ['push', bare, 'HEAD:refs/heads/test'], pushEnv); expect(fs.existsSync(marker)).toBe(false)
  })
})
