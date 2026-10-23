import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { INSTALLER_SOURCE_FILES, validateInstallerSourceSnapshot, validateTrustedNodeRoot } from './symphony-pilot-install-source.mjs'

const dirs: string[] = []
const repositoryUrl = 'https://github.com/plain-relay/kaimono-baton.git'

function temp(name: string) {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`))
  try { fs.chmodSync(target, 0o700) } catch {}
  dirs.push(target)
  return target
}

function git(cwd: string, args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function fixture() {
  const root = temp('installer-source')
  const source = path.join(root, 'source')
  fs.mkdirSync(path.join(source, 'scripts'), { recursive: true })
  for (const relativePath of INSTALLER_SOURCE_FILES) {
    const target = path.join(source, relativePath)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, `${relativePath}\n`)
  }
  const installerPath = path.join(source, 'scripts', 'install-symphony-pilot-control.sh')
  fs.writeFileSync(installerPath, '#!/bin/sh\nexit 0\n')
  git(source, ['init'])
  git(source, ['remote', 'add', 'origin', repositoryUrl])
  git(source, ['add', '--all'])
  git(source, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'source'])
  const sourceCommit = git(source, ['rev-parse', 'HEAD'])
  const trusted = path.join(root, 'trusted')
  const home = path.join(trusted, 'home'); const xdg = path.join(trusted, 'xdg'); const hooks = path.join(trusted, 'hooks')
  fs.mkdirSync(home, { recursive: true }); fs.mkdirSync(xdg); fs.mkdirSync(hooks)
  return {
    root, source, installerPath, sourceCommit, home, xdg, hooks,
    gitBin: process.platform === 'win32'
      ? fs.realpathSync(execFileSync('where.exe', ['git.exe'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0])
      : fs.realpathSync(execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim()),
  }
}

function validate(input: ReturnType<typeof fixture>, overrides: Record<string, unknown> = {}) {
  return validateInstallerSourceSnapshot({
    sourceRoot: input.source,
    sourceCommit: input.sourceCommit,
    installerPath: input.installerPath,
    gitBin: input.gitBin,
    gitExecPath: git(input.source, ['--exec-path']),
    trustedHome: input.home,
    trustedXdg: input.xdg,
    trustedHooks: input.hooks,
    repositoryUrl,
    requireRootOwner: false,
    trustAnchor: input.root,
    ...overrides,
  })
}

function expectCode(action: () => unknown, code: string) {
  try { action() } catch (error: any) { expect(error).toMatchObject({ code }); return }
  throw new Error(`expected-${code}`)
}

function trustedNodeFixture() {
  const root = temp('trusted-node')
  const nodeRoot = path.join(root, 'node-22')
  const nodeBin = path.join(nodeRoot, 'bin', 'node')
  const npmTarget = path.join(nodeRoot, 'lib', 'npm', 'npm-cli.js')
  fs.mkdirSync(path.dirname(nodeBin), { recursive: true })
  fs.mkdirSync(path.dirname(npmTarget), { recursive: true })
  fs.writeFileSync(nodeBin, 'node\n')
  fs.writeFileSync(npmTarget, 'npm\n')
  fs.chmodSync(nodeBin, 0o755)
  fs.chmodSync(npmTarget, 0o755)
  if (process.platform === 'win32') fs.copyFileSync(npmTarget, path.join(nodeRoot, 'bin', 'npm'))
  else fs.symlinkSync(npmTarget, path.join(nodeRoot, 'bin', 'npm'))
  return { root, nodeRoot, nodeBin, npmTarget, npmBin: fs.realpathSync(path.join(nodeRoot, 'bin', 'npm')) }
}

function validateNode(input: ReturnType<typeof trustedNodeFixture>, overrides: Record<string, unknown> = {}) {
  const calls: Array<{ command: string; args: string[]; env: NodeJS.ProcessEnv }> = []
  const commandRunner = (command: string, args: string[], options: { env: NodeJS.ProcessEnv }) => {
    calls.push({ command, args, env: options.env })
    if (command === input.nodeBin) return 'v22.23.2\n'
    if (command === input.npmBin) return '10.9.8\n'
    throw new Error('unexpected-command')
  }
  const result = validateTrustedNodeRoot({
    trustedNodeRoot: input.nodeRoot,
    sourceRoot: path.join(input.root, 'source'),
    protectedRoots: [path.join(input.root, 'control'), path.join(input.root, 'symphony')],
    trustedHome: path.join(input.root, 'home'),
    trustedXdg: path.join(input.root, 'xdg'),
    requireRootOwner: false,
    trustAnchor: input.root,
    commandRunner,
    ...overrides,
  })
  return { result, calls }
}

afterEach(() => {
  for (const target of dirs.splice(0)) fs.rmSync(target, { recursive: true, force: true })
})

describe('installer immutable source snapshot', () => {
  it('accepts the exact clean source commit and tree', () => {
    const input = fixture()
    expect(validate(input)).toMatchObject({ sourceRoot: input.source, sourceCommit: input.sourceCommit })
  })
  it.runIf(process.platform === 'linux' && process.getuid?.() !== 0)('rejects a non-root source root when root ownership is required', () => {
    const input = fixture()
    expectCode(() => validate(input, { requireRootOwner: true }), 'installer-source-owner-invalid')
  })
  it.runIf(process.platform === 'linux')('rejects group-writable source and ancestor paths', () => {
    const writableSource = fixture(); fs.chmodSync(writableSource.source, 0o770)
    expectCode(() => validate(writableSource), 'installer-source-writable')
    const writableAncestor = fixture(); fs.chmodSync(writableAncestor.root, 0o770)
    expectCode(() => validate(writableAncestor), 'installer-source-writable')
  })
  it('rejects an installer path outside the selected source root', () => {
    const input = fixture(); const other = path.join(input.root, 'other-installer.sh'); fs.writeFileSync(other, '#!/bin/sh\n')
    expectCode(() => validate(input, { installerPath: other }), 'installer-self-path-mismatch')
  })
  it('rejects a mismatched HEAD, dirty tracked content, and an untracked injection', () => {
    const head = fixture(); fs.writeFileSync(path.join(head.source, 'README.md'), 'next\n'); git(head.source, ['add', '--all']); git(head.source, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'next'])
    expectCode(() => validate(head), 'installer-source-head-mismatch')
    const dirty = fixture(); fs.appendFileSync(path.join(dirty.source, INSTALLER_SOURCE_FILES[0]), 'dirty\n')
    expectCode(() => validate(dirty), 'installer-source-not-clean')
    const untracked = fixture(); fs.writeFileSync(path.join(untracked.source, 'injected-control.mjs'), 'injected\n')
    expectCode(() => validate(untracked), 'installer-source-not-clean')
  }, 20_000)
  it.runIf(process.platform === 'linux')('rejects selected-control symlinks, alternate object stores, replacement refs, and unsafe Git config', () => {
    const symlink = fixture(); const target = path.join(symlink.source, INSTALLER_SOURCE_FILES[0]); fs.unlinkSync(target); fs.symlinkSync('/etc/passwd', target)
    expectCode(() => validate(symlink), 'installer-source-symlink')
    const alternates = fixture(); const alternate = path.join(alternates.source, '.git', 'objects', 'info', 'alternates'); fs.mkdirSync(path.dirname(alternate), { recursive: true }); fs.writeFileSync(alternate, '/tmp/objects\n')
    expectCode(() => validate(alternates), 'installer-source-alternate-objects')
    const replacement = fixture(); git(replacement.source, ['update-ref', `refs/replace/${replacement.sourceCommit}`, replacement.sourceCommit])
    expectCode(() => validate(replacement), 'installer-source-replace-refs')
    const config = fixture(); git(config.source, ['config', '--local', 'filter.poison.clean', 'malicious'])
    expectCode(() => validate(config), 'installer-source-unsafe-git-config')
  })
})

describe('trusted Node root', () => {
  it('requires an explicit trusted Node root instead of fixed or inherited Node paths', () => {
    const installer = fs.readFileSync(path.resolve('scripts/install-symphony-pilot-control.sh'), 'utf8')
    expect(installer).toContain('CLEAN_SYMPHONY_SOURCE_ROOT TRUSTED_NODE_ROOT [LAUNCHER_PATH]')
    expect(installer).toContain('node_entry="$trusted_node_root/bin/node"')
    expect(installer).toContain('npm_entry="$trusted_node_root/bin/npm"')
    expect(installer).not.toContain('/usr/bin/readlink -f -- /usr/bin/node')
    expect(installer).not.toContain('/usr/bin/readlink -f -- /usr/bin/npm')
  })
  it('accepts a Node 22 root', () => {
    const input = trustedNodeFixture()
    const { result, calls } = validateNode(input)
    expect(result).toMatchObject({ trustedNodeRoot: input.nodeRoot, nodeBin: input.nodeBin, npmBin: input.npmBin, nodeVersion: 'v22.23.2', npmVersion: '10.9.8' })
    expect(calls).toHaveLength(2)
  })
  it('rejects missing, relative, and overlapping Node roots', () => {
    const input = trustedNodeFixture()
    expectCode(() => validateNode(input, { trustedNodeRoot: path.join(input.root, 'missing') }), 'trusted-node-root-invalid')
    const missingNode = trustedNodeFixture(); fs.unlinkSync(missingNode.nodeBin)
    expectCode(() => validateNode(missingNode), 'trusted-node-root-invalid')
    expectCode(() => validateNode(input, { trustedNodeRoot: 'relative-node-root' }), 'trusted-node-root-not-absolute')
    expectCode(() => validateNode(input, { protectedRoots: [input.nodeRoot] }), 'trusted-node-root-overlap')
  })
  it.runIf(process.platform !== 'win32')('rejects a writable Node root', () => {
    const input = trustedNodeFixture()
    fs.chmodSync(input.nodeRoot, 0o770)
    expectCode(() => validateNode(input), 'installer-source-writable')
  })
  it.runIf(process.platform !== 'win32')('rejects writable ancestors', () => {
    const ancestor = trustedNodeFixture(); fs.chmodSync(ancestor.root, 0o770)
    expectCode(() => validateNode(ancestor), 'installer-source-writable')
  })
  it.runIf(process.platform === 'linux')('accepts an in-root npm symlink and rejects node/npm symlink escapes', () => {
    const valid = trustedNodeFixture()
    expect(validateNode(valid).result.npmBin).toBe(valid.npmTarget)
    const nodeEscape = trustedNodeFixture(); fs.unlinkSync(nodeEscape.nodeBin); fs.symlinkSync('/bin/sh', nodeEscape.nodeBin)
    expectCode(() => validateNode(nodeEscape), 'trusted-node-root-symlink-escape')
    const npmEscape = trustedNodeFixture(); fs.unlinkSync(path.join(npmEscape.nodeRoot, 'bin', 'npm')); fs.symlinkSync('/bin/sh', path.join(npmEscape.nodeRoot, 'bin', 'npm'))
    expectCode(() => validateNode(npmEscape), 'trusted-node-root-symlink-escape')
  })
  it('rejects a Node major other than 22', () => {
    const input = trustedNodeFixture()
    expectCode(() => validateNode(input, { commandRunner: () => 'v20.19.0\n' }), 'trusted-node-version-invalid')
  })
  it('does not inherit caller PATH or NODE_BIN/NPM_BIN values', () => {
    const input = trustedNodeFixture()
    const oldPath = process.env.PATH; const oldNode = process.env.NODE_BIN; const oldNpm = process.env.NPM_BIN
    try {
      process.env.PATH = path.join(input.root, 'fake-bin')
      process.env.NODE_BIN = path.join(input.root, 'fake-node')
      process.env.NPM_BIN = path.join(input.root, 'fake-npm')
      const { calls } = validateNode(input)
      for (const call of calls) {
        expect(call.env.PATH).toBe(`${path.join(input.nodeRoot, 'bin')}:/usr/bin:/bin`)
        expect(call.command).not.toBe(process.env.NODE_BIN)
        expect(call.command).not.toBe(process.env.NPM_BIN)
      }
    } finally {
      if (oldPath === undefined) delete process.env.PATH; else process.env.PATH = oldPath
      if (oldNode === undefined) delete process.env.NODE_BIN; else process.env.NODE_BIN = oldNode
      if (oldNpm === undefined) delete process.env.NPM_BIN; else process.env.NPM_BIN = oldNpm
    }
  })
  it.runIf(process.platform === 'linux' && process.getuid?.() !== 0)('rejects a user-owned Node root when root ownership is required', () => {
    const input = trustedNodeFixture()
    expectCode(() => validateNode(input, { requireRootOwner: true }), 'installer-source-owner-invalid')
  })
})
