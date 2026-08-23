#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const INSTALLER_SOURCE_FILES = Object.freeze([
  'scripts/symphony-pilot-codex.sh',
  'scripts/symphony-pilot-host.mjs',
  'scripts/symphony-pilot-isolation-test.mjs',
  'scripts/symphony-pilot-owner-identity.sh',
  'scripts/symphony-pilot-trusted-launcher.sh',
  'scripts/verify-symphony-pilot-upstream.mjs',
  'symphony/WORKFLOW.md',
  'symphony/codex/config.toml',
  'symphony/patches/0001-disable-github-agent-tool.patch',
  'symphony/runtime-identity.json',
])

const SHA40 = /^[0-9a-f]{40}$/
const DEFAULT_REPOSITORY_URL = 'https://github.com/plain-relay/kaimono-baton.git'
const SAFE_LOCAL_GIT_KEYS = new Set([
  'core.repositoryformatversion', 'core.filemode', 'core.bare', 'core.logallrefupdates',
  'core.ignorecase', 'core.precomposeunicode', 'core.symlinks', 'core.worktree',
  'remote.origin.url', 'remote.origin.fetch',
])

export class InstallerSourceError extends Error {
  constructor(code) {
    super(code)
    this.code = code
  }
}

function assert(condition, code) {
  if (!condition) throw new InstallerSourceError(code)
}

function safeInside(root, candidate) {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function pathsOverlap(left, right) {
  const leftPath = path.resolve(left)
  const rightPath = path.resolve(right)
  return leftPath === rightPath || safeInside(leftPath, rightPath) || safeInside(rightPath, leftPath)
}

function resolveTrustedPath(target, code) {
  try { return fs.realpathSync(target) } catch { throw new InstallerSourceError(code) }
}

function assertTrustedEntry(target, { requireRootOwner, directory, file } = {}) {
  const stat = fs.lstatSync(target)
  assert(!stat.isSymbolicLink(), 'installer-source-symlink')
  if (directory) assert(stat.isDirectory(), 'installer-source-file-type-invalid')
  if (file) assert(stat.isFile(), 'installer-source-file-type-invalid')
  if (process.platform === 'linux') {
    assert((stat.mode & 0o022) === 0, 'installer-source-writable')
    if (requireRootOwner) assert(stat.uid === 0, 'installer-source-owner-invalid')
  }
  return stat
}

function assertTrustedTree(root, { requireRootOwner }) {
  assertTrustedEntry(root, { requireRootOwner, directory: true })
  for (const name of fs.readdirSync(root)) {
    const target = path.join(root, name)
    const stat = assertTrustedEntry(target, { requireRootOwner })
    if (stat.isDirectory()) assertTrustedTree(target, { requireRootOwner })
    else assert(stat.isFile(), 'installer-source-file-type-invalid')
  }
}

function assertTrustedAncestors(target, { requireRootOwner, trustAnchor }) {
  const anchor = path.resolve(trustAnchor)
  let current = target
  while (true) {
    assertTrustedEntry(current, { requireRootOwner, directory: true })
    if (current === anchor) return
    const parent = path.dirname(current)
    assert(parent !== current && safeInside(anchor, current), 'installer-source-ancestor-invalid')
    current = parent
  }
}

function assertTrustedNodeTree(root, { requireRootOwner, trustedRoot = root }) {
  const stat = assertTrustedEntry(root, { requireRootOwner, directory: true })
  assert(stat.isDirectory(), 'trusted-node-root-invalid')
  for (const name of fs.readdirSync(root)) {
    const target = path.join(root, name)
    const entry = fs.lstatSync(target)
    if (entry.isSymbolicLink()) {
      if (process.platform === 'linux' && requireRootOwner) assert(entry.uid === 0, 'trusted-node-root-owner-invalid')
      const resolved = resolveTrustedPath(target, 'trusted-node-root-symlink-escape')
      assert(resolved !== trustedRoot && safeInside(trustedRoot, resolved), 'trusted-node-root-symlink-escape')
      continue
    }
    const trusted = assertTrustedEntry(target, { requireRootOwner })
    if (trusted.isDirectory()) assertTrustedNodeTree(target, { requireRootOwner, trustedRoot })
    else assert(trusted.isFile(), 'trusted-node-root-file-type-invalid')
  }
}

function trustedNodeEntry(root, entry, { requireRootOwner }) {
  let entryStat
  try { entryStat = fs.lstatSync(entry) } catch { throw new InstallerSourceError('trusted-node-root-invalid') }
  assert(entryStat.isFile() || entryStat.isSymbolicLink(), 'trusted-node-root-invalid')
  if (process.platform === 'linux' && requireRootOwner) assert(entryStat.uid === 0, 'trusted-node-root-owner-invalid')
  const resolved = resolveTrustedPath(entry, 'trusted-node-root-invalid')
  assert(resolved !== root && safeInside(root, resolved), 'trusted-node-root-symlink-escape')
  assertTrustedAncestors(path.dirname(resolved), { requireRootOwner, trustAnchor: root })
  const target = assertTrustedEntry(resolved, { requireRootOwner, file: true })
  if (process.platform !== 'win32') assert((target.mode & 0o111) !== 0, 'trusted-node-root-invalid')
  return resolved
}

function runTrustedNode(command, args, { env, commandRunner }) {
  try {
    return String(commandRunner(command, args, { env })).trim()
  } catch {
    throw new InstallerSourceError('trusted-node-runtime-invalid')
  }
}

export function validateTrustedNodeRoot({
  trustedNodeRoot,
  sourceRoot,
  protectedRoots = [],
  trustedHome = '/var/empty',
  trustedXdg = '/var/empty',
  requireRootOwner = process.platform === 'linux',
  trustAnchor = path.parse(path.resolve(trustedNodeRoot || '/')).root,
  commandRunner = (command, args, options) => execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], ...options }),
} = {}) {
  assert(typeof trustedNodeRoot === 'string' && path.isAbsolute(trustedNodeRoot), 'trusted-node-root-not-absolute')
  assert(typeof sourceRoot === 'string' && path.isAbsolute(sourceRoot), 'trusted-node-root-invalid')
  assert(typeof trustedHome === 'string' && path.isAbsolute(trustedHome), 'trusted-node-root-invalid')
  assert(typeof trustedXdg === 'string' && path.isAbsolute(trustedXdg), 'trusted-node-root-invalid')
  const root = resolveTrustedPath(trustedNodeRoot, 'trusted-node-root-invalid')
  assert(root === trustedNodeRoot, 'trusted-node-root-not-canonical')
  assertTrustedAncestors(root, { requireRootOwner, trustAnchor })
  for (const protectedRoot of [sourceRoot, ...protectedRoots]) {
    assert(typeof protectedRoot === 'string' && path.isAbsolute(protectedRoot), 'trusted-node-root-invalid')
    assert(!pathsOverlap(root, protectedRoot), 'trusted-node-root-overlap')
  }
  assertTrustedNodeTree(root, { requireRootOwner })

  const nodeBin = trustedNodeEntry(root, path.join(root, 'bin', 'node'), { requireRootOwner })
  const npmBin = trustedNodeEntry(root, path.join(root, 'bin', 'npm'), { requireRootOwner })
  const env = {
    PATH: `${path.join(root, 'bin')}:/usr/bin:/bin`,
    HOME: trustedHome,
    XDG_CONFIG_HOME: trustedXdg,
    NPM_CONFIG_USERCONFIG: process.platform === 'win32' ? 'NUL' : '/dev/null',
  }
  const nodeVersion = runTrustedNode(nodeBin, ['--version'], { env, commandRunner })
  assert(/^v22\.\d+\.\d+$/.test(nodeVersion), 'trusted-node-version-invalid')
  const npmVersion = runTrustedNode(npmBin, ['--version'], { env, commandRunner })
  assert(/^\d+\.\d+\.\d+(?:[-+].*)?$/.test(npmVersion), 'trusted-node-runtime-invalid')
  return { trustedNodeRoot: root, nodeBin, npmBin, nodeVersion, npmVersion }
}

function gitEnvironment({ home, xdg, hooks, gitBin, gitExecPath }) {
  return {
    PATH: `${path.dirname(gitBin)}:${gitExecPath}:/usr/bin:/bin`,
    HOME: home,
    XDG_CONFIG_HOME: xdg,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_EXEC_PATH: gitExecPath,
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_CONFIG_COUNT: '4',
    GIT_CONFIG_KEY_0: 'core.hooksPath',
    GIT_CONFIG_VALUE_0: hooks,
    GIT_CONFIG_KEY_1: 'credential.helper',
    GIT_CONFIG_VALUE_1: '',
    GIT_CONFIG_KEY_2: 'core.fsmonitor',
    GIT_CONFIG_VALUE_2: 'false',
    GIT_CONFIG_KEY_3: 'protocol.file.allow',
    GIT_CONFIG_VALUE_3: 'never',
  }
}

function runGit(gitBin, sourceRoot, args, env, { buffer = false } = {}) {
  try {
    return execFileSync(gitBin, ['-C', sourceRoot, ...args], {
      encoding: buffer ? 'buffer' : 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      env,
    })
  } catch {
    throw new InstallerSourceError('installer-source-git-invalid')
  }
}

function assertSafeLocalGitConfig(gitBin, sourceRoot, env) {
  const keys = String(runGit(gitBin, sourceRoot, ['config', '--local', '--name-only', '--null', '--list'], env))
    .split('\0').filter(Boolean).map((key) => key.toLowerCase())
  const safe = keys.every((key) => SAFE_LOCAL_GIT_KEYS.has(key) || /^branch\.[a-z0-9_./-]+\.(remote|merge)$/.test(key))
  assert(safe, 'installer-source-unsafe-git-config')
}

function equalBytes(left, right) {
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

export function validateInstallerSourceSnapshot({
  sourceRoot,
  sourceCommit,
  installerPath,
  gitBin,
  gitExecPath,
  trustedHome,
  trustedXdg,
  trustedHooks,
  repositoryUrl = DEFAULT_REPOSITORY_URL,
  selectedFiles = INSTALLER_SOURCE_FILES,
  requireRootOwner = process.platform === 'linux',
  trustAnchor = path.parse(path.resolve(sourceRoot)).root,
} = {}) {
  assert(typeof sourceRoot === 'string' && path.isAbsolute(sourceRoot), 'installer-source-root-not-absolute')
  assert(typeof installerPath === 'string' && path.isAbsolute(installerPath), 'installer-self-path-mismatch')
  assert(typeof sourceCommit === 'string' && SHA40.test(sourceCommit), 'installer-source-commit-invalid')
  assert(typeof gitBin === 'string' && path.isAbsolute(gitBin), 'installer-source-git-invalid')
  assert(typeof gitExecPath === 'string' && path.isAbsolute(gitExecPath), 'installer-source-git-invalid')
  for (const value of [trustedHome, trustedXdg, trustedHooks]) assert(typeof value === 'string' && path.isAbsolute(value), 'installer-source-git-invalid')

  const source = fs.realpathSync(sourceRoot)
  const expectedInstaller = path.join(source, 'scripts', 'install-symphony-pilot-control.sh')
  assert(source === sourceRoot, 'installer-source-root-not-canonical')
  assert(fs.realpathSync(installerPath) === expectedInstaller && installerPath === expectedInstaller, 'installer-self-path-mismatch')
  assertTrustedAncestors(source, { requireRootOwner, trustAnchor })
  assertTrustedTree(source, { requireRootOwner })
  assert(fs.lstatSync(path.join(source, '.git')).isDirectory(), 'installer-source-git-invalid')

  const env = gitEnvironment({ home: trustedHome, xdg: trustedXdg, hooks: trustedHooks, gitBin, gitExecPath })
  assertSafeLocalGitConfig(gitBin, source, env)
  assert(runGit(gitBin, source, ['rev-parse', '--verify', 'HEAD'], env).trim() === sourceCommit, 'installer-source-head-mismatch')
  const tree = runGit(gitBin, source, ['rev-parse', '--verify', `${sourceCommit}^{tree}`], env).trim()
  assert(SHA40.test(tree), 'installer-source-tree-invalid')
  assert(runGit(gitBin, source, ['rev-parse', 'HEAD^{tree}'], env).trim() === tree, 'installer-source-tree-invalid')
  const gitDir = fs.realpathSync(runGit(gitBin, source, ['rev-parse', '--absolute-git-dir'], env).trim())
  const expectedGitDir = fs.statSync(path.join(source, '.git'))
  const actualGitDir = fs.statSync(gitDir)
  assert(actualGitDir.dev === expectedGitDir.dev && actualGitDir.ino === expectedGitDir.ino, 'installer-source-git-invalid')
  assert(!fs.existsSync(path.join(gitDir, 'objects', 'info', 'alternates')), 'installer-source-alternate-objects')
  assert(runGit(gitBin, source, ['for-each-ref', '--format=%(refname)', 'refs/replace/'], env).trim() === '', 'installer-source-replace-refs')
  assert(runGit(gitBin, source, ['status', '--porcelain=v1', '--untracked-files=all', '--ignored=matching'], env) === '', 'installer-source-not-clean')
  const originUrls = runGit(gitBin, source, ['remote', 'get-url', '--all', 'origin'], env).trim().split(/\r?\n/).filter(Boolean)
  assert(originUrls.length === 1 && originUrls[0] === repositoryUrl, 'installer-source-repository-invalid')

  for (const relativePath of selectedFiles) {
    const target = path.resolve(source, relativePath)
    assert(safeInside(source, target), 'installer-source-control-file-invalid')
    assertTrustedEntry(target, { requireRootOwner, file: true })
    const expected = runGit(gitBin, source, ['show', `${sourceCommit}:${relativePath}`], env, { buffer: true })
    assert(equalBytes(expected, fs.readFileSync(target)), 'installer-source-blob-mismatch')
  }
  return { sourceRoot: source, sourceCommit, sourceTree: tree }
}

function main() {
  const [sourceRoot, sourceCommit, installerPath, gitBin, gitExecPath, trustedHome, trustedXdg, trustedHooks, trustedNodeRoot, ...protectedRoots] = process.argv.slice(2)
  try {
    validateInstallerSourceSnapshot({ sourceRoot, sourceCommit, installerPath, gitBin, gitExecPath, trustedHome, trustedXdg, trustedHooks })
    const trustedNode = validateTrustedNodeRoot({ trustedNodeRoot, sourceRoot, protectedRoots, trustedHome, trustedXdg })
    process.stdout.write(`[symphony-pilot-install] source-snapshot=PASS trusted-node=PASS node=${trustedNode.nodeVersion} npm=${trustedNode.npmVersion}\n`)
  } catch (error) {
    process.stderr.write(`[symphony-pilot-install] ${error instanceof InstallerSourceError ? error.code : 'installer-source-invalid'}\n`)
    process.exitCode = 1
  }
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (direct) main()
