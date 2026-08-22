import { execFileSync, spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import {
  CONTROL_MANIFEST_FILES, PilotError, PILOT, acquireExecutionLock, assertSafeLocalGitConfig, buildValidatedTree, captureAgentGitState, classifyGitHubResponse, classifyGitHubTransportError, collectChangedPaths,
  consumeLaunchPermit,
  extractAndValidateApproval, extractAndValidateSafeTask, hasTrustedApproval,
  isPathAllowed, isProtectedPath, parseLsTreeRecord, permanentBlocker, persistPermanentPrepareFailure, privilegedGit, privilegedGitEnv, readSafeJson,
  runIfExecutionOwner, taskHash, validateAgentGitState, validateHandoff, validateIssueSnapshot, validateLaunchPermit,
  validatePilotAuthStore, validateRecoveryObject, validateReferencePathAtBase, validateRepoPath, validateSafeTask,
  validateTrustedGitRuntime, validateTrustedPathSeparation, verifyControlManifest, verifySymphonyRuntime,
} from './symphony-pilot-host.mjs'

const dirs: string[] = []
const SYMPHONY_RUNTIME_ERROR = 'symphony-runtime-integrity-invalid'
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

const symphonyPatchedPaths = [
  'elixir/lib/symphony_elixir/codex/app_server.ex',
  'elixir/lib/symphony_elixir/config.ex',
  'elixir/lib/symphony_elixir/config/schema.ex',
  'elixir/lib/symphony_elixir/github/adapter.ex',
  'elixir/lib/symphony_elixir/workspace.ex',
  'elixir/test/symphony_elixir/app_server_test.exs',
  'elixir/test/symphony_elixir/github_adapter_test.exs',
].sort()

function symphonyFixture() {
  const root = temp('symphony-runtime')
  const control = temp('symphony-control')
  process.env.SYMPHONY_PILOT_STATE_DIR = temp('symphony-state')
  git(root, ['init'])
  for (const relativePath of [...symphonyPatchedPaths, 'README.md', '.gitignore']) {
    const target = path.join(root, relativePath)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, relativePath === '.gitignore' ? 'ignored-runtime/\n' : [`${relativePath} header`, 'old marker', ...Array.from({ length: 20 }, (_, index) => `unchanged ${index}`), ''].join('\n'))
  }
  git(root, ['add', '--all'])
  git(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'base'])
  const baseSha = git(root, ['rev-parse', 'HEAD'])
  for (const relativePath of symphonyPatchedPaths) {
    const target = path.join(root, relativePath)
    fs.writeFileSync(target, fs.readFileSync(target, 'utf8').replace('old marker', 'approved pilot change'))
  }
  const patch = git(root, ['diff', '--binary', '--full-index'])
  const patchFile = path.join(control, 'symphony', 'patches', '0001-disable-github-agent-tool.patch')
  fs.mkdirSync(path.dirname(patchFile), { recursive: true })
  fs.writeFileSync(patchFile, `${patch}\n`)
  const index = path.join(temp('symphony-expected-index'), 'index')
  const indexEnv = { ...process.env, GIT_INDEX_FILE: index }
  git(root, ['read-tree', baseSha], indexEnv)
  git(root, ['apply', '--cached', patchFile], indexEnv)
  const expectedTreeSha = git(root, ['write-tree'], indexEnv)
  git(root, ['reset', '--hard', baseSha])
  git(root, ['apply', patchFile])
  const identity = {
    schemaVersion: 1,
    symphonyBaseSha: baseSha,
    approvedPatchSha256: crypto.createHash('sha256').update(fs.readFileSync(patchFile)).digest('hex'),
    expectedPostPatchTreeSha: expectedTreeSha,
  }
  const identityFile = path.join(control, 'symphony', 'runtime-identity.json')
  fs.writeFileSync(identityFile, `${JSON.stringify(identity, null, 2)}\n`)
  return { root, control, patchFile, identityFile, identity, controlManifest: { controlRoot: control, entries: [] } }
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
    for (const p of ['SECURITY.md', 'AGENTS.md', '.github/x', '.codex/x', '.agents/x', 'symphony/WORKFLOW.md', '.npmrc', '.gitmodules', '.gitattributes', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json', 'worker/tsconfig.json']) {
      expect(isProtectedPath(p)).toBe(true)
      expect(() => validateSafeTask(validTask({ scopePaths: [p] }))).toThrow(PilotError)
      expect(() => validateSafeTask(validTask({ referencePaths: [p] }))).toThrow(PilotError)
      expect(isPathAllowed(p, [p.includes('/') ? p.split('/')[0] : '.'])).toBe(false)
    }
  })
  it('rejects protected TypeScript validation files during trusted finalization', () => {
    const { root } = repo()
    fs.mkdirSync(path.join(root, 'worker'))
    const configs = ['tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json', 'worker/tsconfig.json']
    for (const config of configs) fs.writeFileSync(path.join(root, config), '{}\n')
    git(root, ['add', '--', ...configs])
    git(root, ['commit', '-m', 'worker-config'])
    const baseSha = git(root, ['rev-parse', 'HEAD'])
    for (const config of configs) {
      fs.writeFileSync(path.join(root, config), '{"compilerOptions":{}}\n')
      expect(() => buildValidatedTree(root, baseSha, [config], [config.includes('/') ? 'worker' : config], 'modify-existing')).toThrow(PilotError)
      git(root, ['checkout', '--', config])
    }
  })
  it('protects the complete pilot control and security-evidence family', () => {
    for (const p of [
      'scripts/symphony-pilot-host.mjs', 'scripts/symphony-pilot-host.test.ts',
      'scripts/symphony-pilot-codex.sh', 'scripts/symphony-pilot-isolation-test.mjs',
      'scripts/symphony-pilot-owner-identity.sh',
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
    expect(config).toContain('"/usr/local" = "deny"')
    expect(config).toContain('"/usr/src" = "deny"')
  })
  it('requires and pins the separate Codex Code Mode host without granting it to model commands', () => {
    const wrapper = fs.readFileSync(path.resolve('scripts/symphony-pilot-codex.sh'), 'utf8')
    const host = fs.readFileSync(path.resolve('scripts/symphony-pilot-host.mjs'), 'utf8')
    const isolation = fs.readFileSync(path.resolve('scripts/symphony-pilot-isolation-test.mjs'), 'utf8')
    const operations = fs.readFileSync(path.resolve('docs/operations/SYMPHONY_PILOT.md'), 'utf8')
    const digest = '00ecf5d040865b97884c488883abd342581c2a432debe7a54e4646bceee3d2d6'
    for (const source of [wrapper, host, isolation, operations]) expect(source).toContain('SYMPHONY_PILOT_CODE_MODE_HOST_BIN')
    expect(wrapper).toContain(digest)
    expect(host).toContain(digest)
    expect(isolation).toContain(digest)
    expect(wrapper).toContain('--ro-bind "$code_mode_host_bin" /pilot-runtime/codex-code-mode-host')
    expect(fs.readFileSync(path.resolve('symphony/codex/config.toml'), 'utf8')).not.toContain('"/pilot-runtime/codex-code-mode-host" = "read"')
  })
  it('rejects missing and mismatched one-use launch permits', () => {
    const stateRoot = temp('permit'); process.env.SYMPHONY_PILOT_STATE_DIR = stateRoot
    process.env.SYMPHONY_PILOT_INSTANCE_ID = '11111111-1111-4111-8111-111111111111'
    const workspace = path.join(temp('workspaces'), 'GH-6'); fs.mkdirSync(workspace)
    const ownerProcessIdentity = 'c'.repeat(64)
    const state = { state: 'claimed', issueNumber: 6, executionId: 9, taskHash: 'a'.repeat(64), baseSha: 'b'.repeat(40), ownerInstanceId: process.env.SYMPHONY_PILOT_INSTANCE_ID, ownerProcessIdentity }
    fs.writeFileSync(path.join(stateRoot, 'GH-6.json'), JSON.stringify(state))
    expect(() => consumeLaunchPermit(workspace)).toThrow(PilotError)
    const valid = { schemaVersion: 1, issueNumber: 6, executionId: 9, taskHash: state.taskHash, baseSha: state.baseSha, ownerInstanceId: state.ownerInstanceId, ownerProcessIdentity, issuedAt: new Date().toISOString(), nonce: 'c'.repeat(48) }
    expect(validateLaunchPermit(valid, state, state.ownerInstanceId, ownerProcessIdentity).executionId).toBe(9)
    for (const mutation of [
      { executionId: 10 }, { taskHash: 'd'.repeat(64) }, { baseSha: 'e'.repeat(40) },
      { ownerInstanceId: '22222222-2222-4222-8222-222222222222' },
      { ownerProcessIdentity: 'd'.repeat(64) },
    ]) expect(() => validateLaunchPermit({ ...valid, ...mutation }, state, state.ownerInstanceId, ownerProcessIdentity)).toThrow(PilotError)
  })
})

describe('exact immutable Symphony runtime', () => {
  it('accepts the exact approved post-patch tree', () => {
    const fixture = symphonyFixture()
    const result = verifySymphonyRuntime(fixture.root, fixture.controlManifest, { requireRootOwner: false, expectedBaseSha: fixture.identity.symphonyBaseSha })
    expect(result).toMatchObject({
      symphonyBaseSha: fixture.identity.symphonyBaseSha,
      approvedPatchSha256: fixture.identity.approvedPatchSha256,
      expectedPostPatchTreeSha: fixture.identity.expectedPostPatchTreeSha,
      actualPostPatchTreeSha: fixture.identity.expectedPostPatchTreeSha,
    })
  }, 20_000)
  it('reproduces the old extra-hunk bypass and rejects it with the exact tree validator', () => {
    const fixture = symphonyFixture()
    fs.appendFileSync(path.join(fixture.root, 'elixir/lib/symphony_elixir/codex/app_server.ex'), 'def unreviewed_runtime_code, do: :accepted\n')
    expect(git(fixture.root, ['rev-parse', 'HEAD'])).toBe(fixture.identity.symphonyBaseSha)
    expect(git(fixture.root, ['diff', '--name-only']).split(/\r?\n/).sort()).toEqual(symphonyPatchedPaths)
    expect(() => git(fixture.root, ['apply', '--reverse', '--check', fixture.patchFile])).not.toThrow()
    expect(() => verifySymphonyRuntime(fixture.root, fixture.controlManifest, { requireRootOwner: false, expectedBaseSha: fixture.identity.symphonyBaseSha })).toThrow(SYMPHONY_RUNTIME_ERROR)
  }, 20_000)
  it('rejects another tracked-file modification, untracked and ignored files, and a staged change', () => {
    const tracked = symphonyFixture()
    fs.appendFileSync(path.join(tracked.root, 'README.md'), 'unexpected\n')
    expect(() => verifySymphonyRuntime(tracked.root, tracked.controlManifest, { requireRootOwner: false, expectedBaseSha: tracked.identity.symphonyBaseSha })).toThrow(SYMPHONY_RUNTIME_ERROR)

    const untracked = symphonyFixture()
    fs.writeFileSync(path.join(untracked.root, 'runtime-injection.exs'), 'unexpected\n')
    expect(() => verifySymphonyRuntime(untracked.root, untracked.controlManifest, { requireRootOwner: false, expectedBaseSha: untracked.identity.symphonyBaseSha })).toThrow(SYMPHONY_RUNTIME_ERROR)

    const ignored = symphonyFixture()
    fs.mkdirSync(path.join(ignored.root, 'ignored-runtime'))
    fs.writeFileSync(path.join(ignored.root, 'ignored-runtime', 'instruction.exs'), 'unexpected\n')
    expect(() => verifySymphonyRuntime(ignored.root, ignored.controlManifest, { requireRootOwner: false, expectedBaseSha: ignored.identity.symphonyBaseSha })).toThrow(SYMPHONY_RUNTIME_ERROR)

    const staged = symphonyFixture()
    fs.appendFileSync(path.join(staged.root, 'README.md'), 'staged\n')
    git(staged.root, ['add', '--', 'README.md'])
    expect(() => verifySymphonyRuntime(staged.root, staged.controlManifest, { requireRootOwner: false, expectedBaseSha: staged.identity.symphonyBaseSha })).toThrow(SYMPHONY_RUNTIME_ERROR)
  }, 20_000)
  it('rejects the wrong patch digest, expected tree, and base HEAD', () => {
    const digest = symphonyFixture()
    fs.appendFileSync(digest.patchFile, '# changed approved patch\n')
    expect(() => verifySymphonyRuntime(digest.root, digest.controlManifest, { requireRootOwner: false, expectedBaseSha: digest.identity.symphonyBaseSha })).toThrow(SYMPHONY_RUNTIME_ERROR)

    const tree = symphonyFixture()
    fs.writeFileSync(tree.identityFile, `${JSON.stringify({ ...tree.identity, expectedPostPatchTreeSha: 'a'.repeat(40) })}\n`)
    expect(() => verifySymphonyRuntime(tree.root, tree.controlManifest, { requireRootOwner: false, expectedBaseSha: tree.identity.symphonyBaseSha })).toThrow(SYMPHONY_RUNTIME_ERROR)

    const head = symphonyFixture()
    git(head.root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'wrong-head'])
    expect(() => verifySymphonyRuntime(head.root, head.controlManifest, { requireRootOwner: false, expectedBaseSha: head.identity.symphonyBaseSha })).toThrow(SYMPHONY_RUNTIME_ERROR)
  }, 20_000)
  it.runIf(process.platform === 'linux')('rejects writable runtime and .git members', () => {
    const runtime = symphonyFixture()
    fs.chmodSync(path.join(runtime.root, 'elixir/lib/symphony_elixir/codex/app_server.ex'), 0o666)
    expect(() => verifySymphonyRuntime(runtime.root, runtime.controlManifest, { requireRootOwner: false, expectedBaseSha: runtime.identity.symphonyBaseSha })).toThrow(SYMPHONY_RUNTIME_ERROR)

    const metadata = symphonyFixture()
    fs.chmodSync(path.join(metadata.root, '.git', 'config'), 0o666)
    expect(() => verifySymphonyRuntime(metadata.root, metadata.controlManifest, { requireRootOwner: false, expectedBaseSha: metadata.identity.symphonyBaseSha })).toThrow(SYMPHONY_RUNTIME_ERROR)
  }, 20_000)
  it.runIf(process.platform === 'linux' && process.getuid?.() !== 0)('rejects a service-UID-owned Symphony source and .git tree', () => {
    const fixture = symphonyFixture()
    expect(() => verifySymphonyRuntime(fixture.root, fixture.controlManifest, { expectedBaseSha: fixture.identity.symphonyBaseSha })).toThrow(SYMPHONY_RUNTIME_ERROR)
  }, 20_000)
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
    const ownerA = '11111111-1111-4111-8111-111111111111'; const ownerB = '22222222-2222-4222-8222-222222222222'; const identityA = 'a'.repeat(64); const identityB = 'b'.repeat(64)
    acquireExecutionLock(root, 6, 9) // owner A's successful prepare claim
    const code = `import fs from 'node:fs';import {acquireExecutionLock,runIfExecutionOwner} from ${JSON.stringify(url)};if(process.argv[1]!==${JSON.stringify(ownerA)}){try{acquireExecutionLock(process.argv[4],6,9);process.exit(91)}catch{}}const result=runIfExecutionOwner({ownerInstanceId:${JSON.stringify(ownerA)},ownerProcessIdentity:${JSON.stringify(identityA)}},process.argv[1],process.argv[2],()=>fs.appendFileSync(process.argv[3],process.argv[1]));if(result.status==='non-owner')process.exit(23)`
    const run = (owner: string, identity: string) => new Promise<number>((resolve) => { const child = spawn(process.execPath, ['--input-type=module', '-e', code, owner, identity, marker, root]); child.on('exit', (c) => resolve(c ?? 99)) })
    expect(await run(ownerA, identityB)).toBe(23); expect(fs.existsSync(marker)).toBe(false)
    expect(await run(ownerA, identityA)).toBe(0); expect(fs.readFileSync(marker, 'utf8')).toBe(ownerA)
    expect(runIfExecutionOwner({ ownerInstanceId: ownerA, ownerProcessIdentity: identityA }, ownerA, identityB, () => { throw new Error('must not execute') }).status).toBe('non-owner')
  })
  it.runIf(process.platform === 'linux')('derives distinct owner process identities for two live processes with the same UUID', async () => {
    const helper = path.resolve('scripts/symphony-pilot-owner-identity.sh')
    const instanceId = '11111111-1111-4111-8111-111111111111'
    const code = `import {spawnSync} from 'node:child_process';const result=spawnSync('/bin/sh',['-c','. "$1"; symphony_pilot_owner_process_identity "$2" "$PPID"','sh',process.argv[1],process.argv[2]],{encoding:'utf8'});if(result.status!==0)process.exit(1);process.stdout.write(result.stdout.trim())`
    const run = () => new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', code, helper, instanceId])
      let output = ''; child.stdout.on('data', (chunk) => { output += chunk })
      child.on('exit', (status) => status === 0 ? resolve(output.trim()) : reject(new Error(`identity-child-${status}`)))
    })
    const [identityA, identityB] = await Promise.all([run(), run()])
    expect(identityA).toMatch(/^[0-9a-f]{64}$/)
    expect(identityB).toMatch(/^[0-9a-f]{64}$/)
    expect(identityA).not.toBe(identityB)
    expect(runIfExecutionOwner({ ownerInstanceId: instanceId, ownerProcessIdentity: identityA }, instanceId, identityB, () => { throw new Error('loser-executed') }).status).toBe('non-owner')
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
    const ownerProcessIdentity = 'a'.repeat(64)
    expect(persistPermanentPrepareFailure(6, owner, ownerProcessIdentity, task, new PilotError('invalid-task-schema'))).toBe('repository-state-conflict')
    const state = JSON.parse(fs.readFileSync(path.join(root, 'GH-6.json'), 'utf8'))
    expect(state).toMatchObject({ state: 'blocked', executionId: 17, ownerInstanceId: owner, ownerProcessIdentity, blockerCode: 'repository-state-conflict' })
  })

  it('classifies GitHub HTTP failures once, with expected endpoint 404s distinct from permanent failures', () => {
    const response = (status: number) => ({ status, ok: status >= 200 && status < 300 })
    expect(classifyGitHubResponse(response(401))).toBe('permanent')
    expect(classifyGitHubResponse(response(403))).toBe('permanent')
    expect(classifyGitHubResponse(response(404))).toBe('permanent')
    expect(classifyGitHubResponse(response(404), { expectedStatuses: [404] })).toBe('expected')
    for (const status of [408, 429, 500, 503]) expect(classifyGitHubResponse(response(status))).toBe('transient')
    expect(classifyGitHubTransportError()).toBe('transient')
    expect(permanentBlocker(new PilotError('github-transient-failure'))).toBeNull()
    expect(permanentBlocker(new PilotError('github-permanent-failure'))).toBe('repository-state-conflict')
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
  function trustedGitRuntimeFixture() {
    const root = path.join(temp('trusted-git-runtime'), 'git-2.50.1')
    const bin = path.join(root, 'bin'); const exec = path.join(root, 'libexec', 'git-core')
    fs.mkdirSync(bin, { recursive: true }); fs.mkdirSync(exec, { recursive: true })
    const gitBinary = path.join(bin, process.platform === 'win32' ? 'git.exe' : 'git')
    fs.writeFileSync(gitBinary, 'trusted git\n'); fs.chmodSync(gitBinary, 0o755)
    for (const name of ['git-remote-http', 'git-remote-https']) {
      const helper = path.join(exec, name); fs.writeFileSync(helper, 'trusted helper\n'); fs.chmodSync(helper, 0o755)
    }
    const inspect = (_command: string, args: string[]) => args[0] === '--version' ? 'git version 2.50.1' : exec
    return { root, gitBinary, exec, inspect }
  }
  it('fails closed unless the configured Git runtime has the exact in-tree HTTP(S) helpers', () => {
    const fixture = trustedGitRuntimeFixture()
    const verify = (overrides: Record<string, unknown> = {}) => validateTrustedGitRuntime({
      git: fixture.gitBinary, gitExecPath: fixture.exec, inspect: fixture.inspect, requireRootOwner: false, ...overrides,
    })
    expect(() => verify()).not.toThrow()
    fs.rmSync(path.join(fixture.exec, 'git-remote-https'))
    expect(() => verify()).toThrow(PilotError)
  })
  it('rejects an outside-root helper, a writable helper, and an observed exec-path mismatch', () => {
    const outside = trustedGitRuntimeFixture(); const outsideHelper = path.join(temp('outside-helper'), 'git-remote-https')
    fs.writeFileSync(outsideHelper, 'outside\n'); fs.chmodSync(outsideHelper, 0o755)
    fs.unlinkSync(path.join(outside.exec, 'git-remote-https'))
    try { fs.symlinkSync(outsideHelper, path.join(outside.exec, 'git-remote-https')) } catch (error: any) { if (!['EPERM', 'EACCES'].includes(error?.code)) throw error }
    expect(() => validateTrustedGitRuntime({ git: outside.gitBinary, gitExecPath: outside.exec, inspect: outside.inspect, requireRootOwner: false })).toThrow(PilotError)

    const writable = trustedGitRuntimeFixture(); fs.chmodSync(path.join(writable.exec, 'git-remote-https'), 0o777)
    if (process.platform === 'linux') expect(() => validateTrustedGitRuntime({ git: writable.gitBinary, gitExecPath: writable.exec, inspect: writable.inspect, requireRootOwner: false })).toThrow(PilotError)

    const mismatch = trustedGitRuntimeFixture()
    expect(() => validateTrustedGitRuntime({
      git: mismatch.gitBinary, gitExecPath: mismatch.exec,
      inspect: (_command: string, args: string[]) => args[0] === '--version' ? 'git version 2.50.1' : path.join(mismatch.root, 'wrong-exec'),
      requireRootOwner: false,
    })).toThrow(PilotError)
  })
  it('does not accept a PATH helper or inherited GIT_EXEC_PATH in place of the configured trusted runtime', () => {
    const fixture = trustedGitRuntimeFixture(); const attack = temp('git-path-helper')
    fs.writeFileSync(path.join(attack, 'git-remote-https'), 'fake helper\n')
    const original = process.env.GIT_EXEC_PATH
    try {
      process.env.GIT_EXEC_PATH = attack
      expect(() => validateTrustedGitRuntime({ git: fixture.gitBinary, gitExecPath: fixture.exec, inspect: fixture.inspect, requireRootOwner: false })).not.toThrow()
    } finally {
      if (original === undefined) delete process.env.GIT_EXEC_PATH
      else process.env.GIT_EXEC_PATH = original
    }
  })
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
