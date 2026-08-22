import { execFileSync, spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import {
  CONTROL_MANIFEST_FILES, PilotError, PILOT, acquireExecutionLock, assertSafeLocalGitConfig, buildValidatedTree, captureAgentGitState, collectChangedPaths,
  consumeLaunchPermit,
  extractAndValidateApproval, extractAndValidateSafeTask, hasTrustedApproval,
  isPathAllowed, isProtectedPath, parseLsTreeRecord, permanentBlocker, persistPermanentPrepareFailure, privilegedGit, privilegedGitEnv, readSafeJson,
  runIfExecutionOwner, taskHash, validateAgentGitState, validateHandoff, validateIssueSnapshot, validateLaunchPermit,
  validatePilotAuthStore, validateRecoveryObject, validateReferencePathAtBase, validateRepoPath, validateSafeTask,
  validateTrustedPathSeparation, verifyControlManifest,
} from './symphony-pilot-host.mjs'

const dirs: string[] = []
const originalState = process.env.SYMPHONY_PILOT_STATE_DIR
const originalInstance = process.env.SYMPHONY_PILOT_INSTANCE_ID
const trustedVariables = ['SYMPHONY_PILOT_GIT_BIN', 'SYMPHONY_PILOT_NODE_BIN', 'SYMPHONY_PILOT_NPM_BIN', 'SYMPHONY_PILOT_BWRAP_BIN', 'SYMPHONY_PILOT_SHELL_BIN', 'SYMPHONY_PILOT_GIT_EXEC_PATH'] as const
const originalTrusted = new Map(trustedVariables.map((key) => [key, process.env[key]]))
function findGit() {
  if (process.platform === 'win32') return fs.realpathSync(execFileSync('where.exe', ['git.exe'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0])
  return fs.realpathSync(execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim())
}
beforeAll(() => {
  const gitBinary = findGit()
  const trustedSystemBinary = process.platform === 'linux' ? fs.realpathSync('/bin/sh') : process.execPath
  const trustedNode = process.platform === 'linux' && fs.existsSync('/usr/bin/node') ? fs.realpathSync('/usr/bin/node') : trustedSystemBinary
  process.env.SYMPHONY_PILOT_GIT_BIN = gitBinary
  process.env.SYMPHONY_PILOT_NODE_BIN = trustedNode
  process.env.SYMPHONY_PILOT_NPM_BIN = trustedSystemBinary
  process.env.SYMPHONY_PILOT_BWRAP_BIN = trustedSystemBinary
  process.env.SYMPHONY_PILOT_SHELL_BIN = trustedSystemBinary
  process.env.SYMPHONY_PILOT_GIT_EXEC_PATH = execFileSync(gitBinary, ['--exec-path'], { encoding: 'utf8' }).trim()
})
afterAll(() => {
  for (const key of trustedVariables) {
    const value = originalTrusted.get(key)
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})
function temp(name: string) { const d = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`)); dirs.push(d); return d }
afterEach(() => {
  if (originalState === undefined) delete process.env.SYMPHONY_PILOT_STATE_DIR
  else process.env.SYMPHONY_PILOT_STATE_DIR = originalState
  if (originalInstance === undefined) delete process.env.SYMPHONY_PILOT_INSTANCE_ID
  else process.env.SYMPHONY_PILOT_INSTANCE_ID = originalInstance
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
  it('protects the complete pilot control and security-evidence family', () => {
    for (const p of [
      'scripts/symphony-pilot-host.mjs', 'scripts/symphony-pilot-host.test.ts',
      'scripts/symphony-pilot-codex.sh', 'scripts/symphony-pilot-isolation-test.mjs',
      'scripts/symphony-pilot-trusted-launcher.sh', 'scripts/symphony-pilot-new-security-test.ts',
      'scripts/verify-symphony-pilot-upstream.mjs', 'scripts/install-symphony-pilot-control.sh', 'symphony/WORKFLOW.md',
      'symphony/codex/config.toml', 'symphony/patches/0001-disable-github-agent-tool.patch',
    ]) expect(isProtectedPath(p)).toBe(true)
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

describe('trusted control, pilot home, and launch permit', () => {
  const controlFiles = [...CONTROL_MANIFEST_FILES]
  function controlTree() {
    const root = temp('control')
    for (const relative of controlFiles) {
      const target = path.join(root, relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, `${relative}\n`)
    }
    const manifest = controlFiles.map((relative) => `${crypto.createHash('sha256').update(fs.readFileSync(path.join(root, relative))).digest('hex')}  ${relative}`).join('\n')
    fs.writeFileSync(path.join(root, 'symphony', 'control-manifest.sha256'), `${manifest}\n`)
    return root
  }
  it('rejects every control/workspace/state overlap direction and a control symlink into workspace', () => {
    const root = temp('separation'); const workspaceRoot = path.join(root, 'workspaces'); const workspace = path.join(workspaceRoot, 'GH-6'); const state = path.join(root, 'state'); const control = path.join(root, 'control')
    for (const d of [workspace, state, control]) fs.mkdirSync(d, { recursive: true })
    expect(() => validateTrustedPathSeparation({ controlRoot: workspace, stateRoot: state, workspaceRoot, workspace })).toThrow(PilotError)
    expect(() => validateTrustedPathSeparation({ controlRoot: path.join(workspace, 'control'), stateRoot: state, workspaceRoot, workspace })).toThrow(PilotError)
    expect(() => validateTrustedPathSeparation({ controlRoot: control, stateRoot: state, workspaceRoot: control, workspace: path.join(control, 'GH-6') })).toThrow(PilotError)
    const link = path.join(root, 'control-link')
    try {
      fs.symlinkSync(workspace, link, 'junction')
      expect(() => validateTrustedPathSeparation({ controlRoot: fs.realpathSync(link), stateRoot: state, workspaceRoot, workspace })).toThrow(PilotError)
    } catch (error: any) { if (!['EPERM', 'EACCES'].includes(error?.code)) throw error }
  })
  it('accepts an exact control manifest and rejects a modified finalizer digest', () => {
    const control = controlTree(); expect(verifyControlManifest(control, { requireRootOwner: false }).entries).toHaveLength(controlFiles.length)
    fs.appendFileSync(path.join(control, 'scripts', 'symphony-pilot-host.mjs'), 'modified\n')
    expect(() => verifyControlManifest(control, { requireRootOwner: false })).toThrow(PilotError)
  })
  it('keeps the operator installer manifest path set synchronized with the runtime verifier', () => {
    const installer = fs.readFileSync(path.resolve('scripts/install-symphony-pilot-control.sh'), 'utf8')
    const block = installer.match(/files='([^']+)'/)?.[1].split(/\r?\n/).sort()
    expect(block).toEqual(controlFiles)
  })
  it.runIf(process.platform === 'linux')('rejects a group-writable control root', () => {
    const control = controlTree(); fs.chmodSync(control, 0o775)
    expect(() => verifyControlManifest(control, { requireRootOwner: false })).toThrow(PilotError)
  })
  it('requires the durable pilot home to contain only one regular auth.json', () => {
    for (const injected of ['AGENTS.md', 'skills', 'hooks', 'config.toml', 'plugins', 'mcp.json']) {
      const home = temp('pilot-home'); fs.writeFileSync(path.join(home, 'auth.json'), '{}', { mode: 0o600 })
      const target = path.join(home, injected)
      if (injected === 'skills' || injected === 'hooks' || injected === 'plugins') fs.mkdirSync(target)
      else fs.writeFileSync(target, 'bad')
      expect(() => validatePilotAuthStore(home)).toThrow(PilotError)
    }
    const clean = temp('pilot-home-clean'); fs.writeFileSync(path.join(clean, 'auth.json'), '{}', { mode: 0o600 })
    expect(validatePilotAuthStore(clean)).toBe(path.join(clean, 'auth.json'))
  })
  it('explicitly disables Codex 0.147.0 skills, hooks, plugins, apps, and orchestrator sources', () => {
    const config = fs.readFileSync(path.resolve('symphony/codex/config.toml'), 'utf8')
    for (const required of [
      '[skills]\ninclude_instructions = false\nbundled = { enabled = false }',
      '[orchestrator.skills]\nenabled = false', '[orchestrator.mcp]\nenabled = false',
      'hooks = false', 'apps = false', 'plugins = false', 'connectors = false',
    ]) expect(config).toContain(required)
  })
  it('uses the exact Codex 0.147.0 granular fail-closed approval policy everywhere', () => {
    const config = fs.readFileSync(path.resolve('symphony/codex/config.toml'), 'utf8')
    const workflow = fs.readFileSync(path.resolve('symphony/WORKFLOW.md'), 'utf8')
    expect(config).toContain('approval_policy = { granular = { sandbox_approval = false, rules = false, skill_approval = false, mcp_elicitations = false, request_permissions = false } }')
    expect(config).not.toContain('reject =')
    expect(workflow).toContain([
      '  approval_policy:', '    granular:', '      sandbox_approval: false',
      '      rules: false', '      skill_approval: false', '      mcp_elicitations: false',
      '      request_permissions: false',
    ].join('\n'))
    expect(workflow).not.toContain('    reject:')
  })
  it('grants only the exact trusted Codex re-entry executable outside minimal and workspace access', () => {
    const config = fs.readFileSync(path.resolve('symphony/codex/config.toml'), 'utf8')
    const operations = fs.readFileSync(path.resolve('docs/operations/SYMPHONY_PILOT.md'), 'utf8')
    for (const value of [config, operations]) expect(value).toContain('"/pilot-runtime/codex" = "read"')
    expect(config).not.toContain('":root" = "read"')
    expect(config).not.toContain('"/pilot-runtime" = "read"')
  })
  it('rejects missing and mismatched one-use launch permits', () => {
    const stateRoot = temp('permit'); process.env.SYMPHONY_PILOT_STATE_DIR = stateRoot
    process.env.SYMPHONY_PILOT_INSTANCE_ID = '11111111-1111-4111-8111-111111111111'
    const workspace = path.join(temp('workspaces'), 'GH-6'); fs.mkdirSync(workspace)
    const state = { state: 'claimed', issueNumber: 6, executionId: 9, taskHash: 'a'.repeat(64), baseSha: 'b'.repeat(40), ownerInstanceId: process.env.SYMPHONY_PILOT_INSTANCE_ID }
    fs.writeFileSync(path.join(stateRoot, 'GH-6.json'), JSON.stringify(state))
    expect(() => consumeLaunchPermit(workspace)).toThrow(PilotError)
    const valid = { schemaVersion: 1, issueNumber: 6, executionId: 9, taskHash: state.taskHash, baseSha: state.baseSha, ownerInstanceId: state.ownerInstanceId, issuedAt: new Date().toISOString(), nonce: 'c'.repeat(48) }
    expect(validateLaunchPermit(valid, state, state.ownerInstanceId).executionId).toBe(9)
    for (const mutation of [
      { executionId: 10 }, { taskHash: 'd'.repeat(64) }, { baseSha: 'e'.repeat(40) },
      { ownerInstanceId: '22222222-2222-4222-8222-222222222222' },
    ]) expect(() => validateLaunchPermit({ ...valid, ...mutation }, state, state.ownerInstanceId)).toThrow(PilotError)
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
  it('makes a competing owner finalizer a cross-process no-op', async () => {
    const root = temp('owners'); const marker = path.join(root, 'finalized'); const url = pathToFileURL(path.resolve('scripts/symphony-pilot-host.mjs')).href
    const ownerA = '11111111-1111-4111-8111-111111111111'; const ownerB = '22222222-2222-4222-8222-222222222222'
    acquireExecutionLock(root, 6, 9) // owner A's successful prepare claim
    const code = `import fs from 'node:fs';import {acquireExecutionLock,runIfExecutionOwner} from ${JSON.stringify(url)};if(process.argv[1]!==${JSON.stringify(ownerA)}){try{acquireExecutionLock(process.argv[3],6,9);process.exit(91)}catch{}}const result=runIfExecutionOwner({ownerInstanceId:${JSON.stringify(ownerA)}},process.argv[1],()=>fs.appendFileSync(process.argv[2],process.argv[1]));if(result.status==='non-owner')process.exit(23)`
    const run = (owner: string) => new Promise<number>((resolve) => { const child = spawn(process.execPath, ['--input-type=module', '-e', code, owner, marker, root]); child.on('exit', (c) => resolve(c ?? 99)) })
    expect(await run(ownerB)).toBe(23); expect(fs.existsSync(marker)).toBe(false)
    expect(await run(ownerA)).toBe(0); expect(fs.readFileSync(marker, 'utf8')).toBe(ownerA)
    expect(runIfExecutionOwner({ ownerInstanceId: ownerA }, ownerB, () => { throw new Error('must not execute') }).status).toBe('non-owner')
  })
  it('classifies deterministic pre-launch failures as durable blockers and remote reads as transient', () => {
    for (const code of ['invalid-task-schema', 'matching-trusted-approval-missing', 'invalid-base-sha', 'unsafe-file-type', 'symphony-version-mismatch', 'trusted-path-overlap']) {
      expect(permanentBlocker(new PilotError(code))).not.toBeNull()
    }
    expect(permanentBlocker(new PilotError('github-transient-failure'))).toBeNull()
    expect(permanentBlocker(new PilotError('remote-transport-transient'))).toBeNull()
    expect(permanentBlocker(new PilotError('issue-lock-held'))).toBeNull()
    const root = temp('permanent-state'); process.env.SYMPHONY_PILOT_STATE_DIR = root
    const owner = '11111111-1111-4111-8111-111111111111'; const task = validTask({ baseSha: 'b'.repeat(40), executionId: 17 })
    expect(persistPermanentPrepareFailure(6, owner, task, new PilotError('invalid-task-schema'))).toBe('repository-state-conflict')
    const state = JSON.parse(fs.readFileSync(path.join(root, 'GH-6.json'), 'utf8'))
    expect(state).toMatchObject({ state: 'blocked', executionId: 17, ownerInstanceId: owner, blockerCode: 'repository-state-conflict' })
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
    const treeSha = buildValidatedTree(root, baseSha, changed, ['src/pages'], 'modify-or-add')
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
    try { fs.symlinkSync(path.join(root, 'docs', 'PROJECT_MAP.md'), link); expect(() => buildValidatedTree(root, baseSha, ['src/pages/link.ts'], ['src/pages'], 'add-file')).toThrow(PilotError) }
    catch (error: any) { if (!['EPERM', 'EACCES'].includes(error?.code)) throw error }
  })
  it('enforces changeMode against the approved base tree', () => {
    const validModify = repo(); fs.writeFileSync(path.join(validModify.root, 'src', 'pages', 'Home.tsx'), 'new\n')
    expect(() => buildValidatedTree(validModify.root, validModify.baseSha, ['src/pages/Home.tsx'], ['src/pages'], 'modify-existing')).not.toThrow()
    const addUnderModify = repo(); fs.writeFileSync(path.join(addUnderModify.root, 'src', 'pages', 'Added.tsx'), 'new\n')
    expect(() => buildValidatedTree(addUnderModify.root, addUnderModify.baseSha, ['src/pages/Added.tsx'], ['src/pages'], 'modify-existing')).toThrow(PilotError)
    const deleteUnderModify = repo(); fs.unlinkSync(path.join(deleteUnderModify.root, 'src', 'pages', 'Home.tsx'))
    expect(() => buildValidatedTree(deleteUnderModify.root, deleteUnderModify.baseSha, ['src/pages/Home.tsx'], ['src/pages'], 'modify-existing')).toThrow(PilotError)
    const overwriteUnderAdd = repo(); fs.writeFileSync(path.join(overwriteUnderAdd.root, 'src', 'pages', 'Home.tsx'), 'new\n')
    expect(() => buildValidatedTree(overwriteUnderAdd.root, overwriteUnderAdd.baseSha, ['src/pages/Home.tsx'], ['src/pages'], 'add-file')).toThrow(PilotError)
    const validAdd = repo(); fs.writeFileSync(path.join(validAdd.root, 'src', 'pages', 'Added.tsx'), 'new\n')
    expect(() => buildValidatedTree(validAdd.root, validAdd.baseSha, ['src/pages/Added.tsx'], ['src/pages'], 'add-file')).not.toThrow()
  }, 30_000)
})

describe('privileged Git boundary', () => {
  it('uses an absolute Git and fixed helper path instead of a workspace-controlled PATH', () => {
    const { root } = repo(); const attack = path.join(root, 'attack-bin'); fs.mkdirSync(attack)
    const marker = path.join(root, 'fake-git-ran')
    if (process.platform === 'win32') fs.writeFileSync(path.join(attack, 'git.cmd'), `@echo bad>"${marker}"\r\n`)
    else { fs.writeFileSync(path.join(attack, 'git'), `#!/bin/sh\nprintf bad > "${marker}"\n`); fs.chmodSync(path.join(attack, 'git'), 0o755) }
    fs.writeFileSync(path.join(attack, 'git-remote-https'), `fake helper`)
    const originalPath = process.env.PATH
    try {
      process.env.PATH = `${attack}${path.delimiter}${originalPath || ''}`
      expect(privilegedGit(root, ['rev-parse', '--is-inside-work-tree'])).toBe('true')
      const env = privilegedGitEnv()
      expect(env.PATH?.split(path.delimiter)).not.toContain(attack)
      expect(env.GIT_EXEC_PATH).toBe(fs.realpathSync(process.env.SYMPHONY_PILOT_GIT_EXEC_PATH!))
      expect(env.GIT_CONFIG_NOSYSTEM).toBe('1')
      expect(fs.existsSync(marker)).toBe(false)
    } finally { process.env.PATH = originalPath }
  })
  it('rejects local credential, rewrite, hook, filter, and SSH configuration before push authorization', () => {
    const attacks: Array<[string, string]> = [
      ['credential.helper', '!malicious'], ['url.https://evil.invalid/.insteadOf', 'https://github.com/'],
      ['core.hooksPath', '.git/hooks'], ['filter.poison.clean', 'malicious'], ['core.sshCommand', 'malicious'],
    ]
    for (const [key, value] of attacks) {
      const { root } = repo(); git(root, ['config', '--local', key, value])
      expect(() => assertSafeLocalGitConfig(root)).toThrow(PilotError)
    }
  })
  it('fails closed if the trusted empty hooks directory is not empty', () => {
    const root = temp('trusted-hooks'); process.env.SYMPHONY_PILOT_STATE_DIR = path.join(root, 'state')
    const first = privilegedGitEnv(); fs.writeFileSync(path.join(first.GIT_CONFIG_VALUE_0!, 'pre-push'), 'malicious')
    expect(() => privilegedGitEnv()).toThrow(PilotError)
  })
  it('disables global/system config and agent-controlled pre-push and reference-transaction hooks', () => {
    const { root } = repo(); const marker = path.join(root, 'agent-hook-ran'); const credentialMarker = path.join(root, 'agent-hook-saw-synthetic-credential'); const hooks = path.join(root, '.git', 'hooks')
    for (const name of ['pre-push', 'reference-transaction']) {
      fs.writeFileSync(path.join(hooks, name), `#!/bin/sh\nprintf hook > ${JSON.stringify(marker)}\nif test -n "$PILOT_TEST_CREDENTIAL_SENTINEL"; then printf credential > ${JSON.stringify(credentialMarker)}; fi\n`)
      try { fs.chmodSync(path.join(hooks, name), 0o755) } catch {}
    }
    git(root, ['config', 'core.hooksPath', '.git/hooks']); const fake = path.join(root, 'system.gitconfig'); fs.writeFileSync(fake, '[alias]\nupdate-ref = !echo bad\n[credential]\nhelper = !echo bad\n[core]\nhooksPath = .git/hooks\n')
    const env = privilegedGitEnv({ GIT_CONFIG_SYSTEM: fake }); expect(path.resolve(git(root, ['config', '--get', 'core.hooksPath'], env))).not.toBe(path.resolve(hooks))
    git(root, ['update-ref', 'refs/heads/safe', 'HEAD'], env); expect(fs.existsSync(marker)).toBe(false)
    const bare = temp('bare-remote'); git(bare, ['init', '--bare'])
    const pushEnv = { ...env, GIT_CONFIG_VALUE_3: 'always', PILOT_TEST_CREDENTIAL_SENTINEL: 'synthetic-nonsecret' }
    git(root, ['push', bare, 'HEAD:refs/heads/test'], pushEnv)
    expect(fs.existsSync(marker)).toBe(false)
    expect(fs.existsSync(credentialMarker)).toBe(false)
  })
})
