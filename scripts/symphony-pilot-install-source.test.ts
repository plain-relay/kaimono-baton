import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { INSTALLER_SOURCE_FILES, validateInstallerSourceSnapshot } from './symphony-pilot-install-source.mjs'

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
