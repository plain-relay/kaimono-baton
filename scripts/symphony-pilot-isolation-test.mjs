#!/usr/bin/env node

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'

const PROFILE = 'symphony-pilot'
const APPROVAL_FIELDS = ['mcp_elicitations', 'request_permissions', 'rules', 'sandbox_approval', 'skill_approval']
const configOnly = process.argv[2] === '--config-only'
if (process.argv.length > (configOnly ? 3 : 2)) fail('unexpected-argument')

function fail(code) { throw new Error(code) }
function requireEnv(name) { const value = process.env[name]?.trim(); if (!value) fail(`missing-${name.toLowerCase()}`); return path.resolve(value) }
function quote(value) { return `'${value.replaceAll("'", `'\"'\"'`)}'` }
function reportInvariant(id, label, passed, status = '') {
  console.log(`ISOLATION-${id} ${label} ${passed ? 'PASS' : `FAIL ${status || 'status=unknown'}`}`)
}

const workspace = fs.realpathSync(process.cwd())
const controlRoot = requireEnv('SYMPHONY_PILOT_CONTROL_ROOT')
const pilotHome = requireEnv('SYMPHONY_PILOT_CODEX_HOME')
const stateRoot = requireEnv('SYMPHONY_PILOT_STATE_DIR')
const launcher = requireEnv('SYMPHONY_PILOT_TRUSTED_LAUNCHER')
if (process.platform !== 'linux') fail('wsl-linux-required')
const bwrap = requireEnv('SYMPHONY_PILOT_BWRAP_BIN')
const bwrapVersion = spawnSync(bwrap, ['--version'], { encoding: 'utf8' })
if (bwrapVersion.status !== 0) fail('bwrap-missing')
if (bwrapVersion.stdout.trim() !== 'bubblewrap 0.11.2') fail('bwrap-version-mismatch')
const bwrapHelp = spawnSync(bwrap, ['--help'], { encoding: 'utf8' })
if (bwrapHelp.status !== 0 || !`${bwrapHelp.stdout}${bwrapHelp.stderr}`.includes('--perms')) fail('bwrap-perms-unsupported')
if (spawnSync('/usr/bin/curl', ['--version']).status !== 0) fail('curl-missing')
if (!fs.statSync(launcher).isFile()) fail('trusted-launcher-missing')

const unexpectedPilotHomeEntries = [
  { id: '10A', label: 'pilot-home-AGENTS', path: path.join(pilotHome, 'AGENTS.md'), kind: 'file', content: 'UNTRUSTED_INSTRUCTION\n' },
  { id: '10B', label: 'pilot-home-skills', path: path.join(pilotHome, 'skills'), kind: 'directory' },
  { id: '10C', label: 'pilot-home-hooks', path: path.join(pilotHome, 'hooks'), kind: 'directory' },
  { id: '10D', label: 'pilot-home-MCP-config', path: path.join(pilotHome, 'config.toml'), kind: 'file', content: '[mcp_servers.untrusted]\ncommand = "false"\n' },
  { id: '10E', label: 'pilot-home-plugins', path: path.join(pilotHome, 'plugins'), kind: 'directory' },
]
const pilotHomeInjectionResults = []
for (const entry of unexpectedPilotHomeEntries) {
  let passed = false
  let status = 'status=host-error'
  let created = false
  try {
    if (entry.kind === 'directory') fs.mkdirSync(entry.path, { mode: 0o700 })
    else fs.writeFileSync(entry.path, entry.content, { flag: 'wx', mode: 0o600 })
    created = true
    const rejected = spawnSync(launcher, ['codex', 'app-server'], {
      cwd: workspace,
      env: process.env,
      encoding: 'utf8',
      timeout: 15000,
    })
    passed = rejected.status !== 0 && !rejected.error && typeof rejected.stderr === 'string' && rejected.stderr.includes('pilot-home-unexpected-content')
    if (!passed) {
      if (rejected.error) status = 'status=launcher-error'
      else if (Number.isInteger(rejected.status)) status = `exit=${rejected.status}`
      else status = 'status=launcher-signal'
    }
  } finally {
    if (!created) {
      // A pre-existing unexpected entry is not test-owned and must not be removed.
    } else if (entry.kind === 'directory') {
      try { fs.rmdirSync(entry.path) } catch {}
    } else {
      try { fs.unlinkSync(entry.path) } catch {}
    }
  }
  reportInvariant(entry.id, entry.label, passed, status)
  pilotHomeInjectionResults.push(passed)
}

const issueMatch = path.basename(workspace).match(/^GH-([1-9]\d*)$/)
if (!issueMatch) fail('dedicated-gh-workspace-required')
const issueNumber = Number(issueMatch[1])
const executionId = Number(`9${crypto.randomInt(100000, 999999)}`)
const ownerInstanceId = process.env.SYMPHONY_PILOT_INSTANCE_ID?.trim()
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(ownerInstanceId || '')) fail('invalid-instance-id')
const statePath = path.join(stateRoot, `GH-${issueNumber}.json`)
const permitsDir = path.join(stateRoot, 'launch-permits')
const permitPath = path.join(permitsDir, `GH-${issueNumber}-${executionId}.json`)
if (fs.existsSync(statePath) || fs.existsSync(permitPath)) fail('isolation-state-not-empty')
fs.mkdirSync(permitsDir, { recursive: true, mode: 0o700 })
const claim = { schemaVersion: 3, state: 'claimed', issueNumber, executionId, taskHash: crypto.randomBytes(32).toString('hex'), baseSha: crypto.randomBytes(20).toString('hex'), ownerInstanceId }
const permit = { schemaVersion: 1, issueNumber, executionId, taskHash: claim.taskHash, baseSha: claim.baseSha, ownerInstanceId, issuedAt: new Date().toISOString(), nonce: crypto.randomBytes(24).toString('hex') }
fs.writeFileSync(statePath, `${JSON.stringify(claim)}\n`, { flag: 'wx', mode: 0o600 })
fs.writeFileSync(permitPath, `${JSON.stringify(permit)}\n`, { flag: 'wx', mode: 0o600 })

const nonce = crypto.randomBytes(12).toString('hex')
const normalHome = os.homedir()
if (path.resolve(normalHome) === pilotHome) fail('normal-home-equals-pilot-home')
const homeCanary = path.join(normalHome, `.symphony-pilot-home-${nonce}`)
const codexDir = path.join(normalHome, '.codex')
const codexCanary = path.join(codexDir, `.symphony-pilot-${nonce}`)
const durableAuth = path.join(pilotHome, 'auth.json')
const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'symphony-pilot-outside-'))
const outsideCanary = path.join(outsideRoot, 'canary')
const workspaceCanary = path.join(workspace, '.symphony', `workspace-read-${nonce}`)
const workspaceProbe = path.join(workspace, '.symphony', `workspace-write-${nonce}`)
const workspaceProbeMarker = 'SYMPHONY_PILOT_WORKSPACE_WRITE_PROBE\n'
const controlFinalizer = path.join(controlRoot, 'scripts', 'symphony-pilot-host.mjs')

fs.mkdirSync(codexDir, { recursive: true, mode: 0o700 })
fs.mkdirSync(path.dirname(workspaceCanary), { recursive: true, mode: 0o700 })
for (const file of [homeCanary, codexCanary, outsideCanary, workspaceCanary]) fs.writeFileSync(file, 'CANARY_CONTENT_MUST_NOT_BE_EMITTED\n', { mode: 0o600 })

const child = spawn(launcher, ['codex', 'app-server'], {
  cwd: workspace,
  env: process.env,
  stdio: ['pipe', 'pipe', 'pipe'],
  detached: true,
})

let buffer = ''
let nextId = 1
const pending = new Map()
child.stdout.setEncoding('utf8')
child.stderr.resume()
child.stdout.on('data', (chunk) => {
  buffer += chunk
  while (buffer.includes('\n')) {
    const index = buffer.indexOf('\n')
    const line = buffer.slice(0, index); buffer = buffer.slice(index + 1)
    if (!line.trim()) continue
    let message
    try { message = JSON.parse(line) } catch { continue }
    if (message.id !== undefined && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id); pending.delete(message.id)
      if (message.error) reject(new Error('app-server-rpc-error')); else resolve(message.result)
    }
  }
})
child.on('exit', () => {
  for (const { reject } of pending.values()) reject(new Error('app-server-exited'))
  pending.clear()
})

function rpc(method, params) {
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
  })
}

function waitForChildExit(timeoutMs) {
  if (child.exitCode !== null) return Promise.resolve(true)
  return new Promise((resolve) => {
    const exited = () => { clearTimeout(timer); resolve(true) }
    const timer = setTimeout(() => { child.off('exit', exited); resolve(false) }, timeoutMs)
    child.once('exit', exited)
  })
}

function commandFailureStatus(result) {
  // Never emit command stderr: command paths can contain host-only canary names.
  const stderr = typeof result?.stderr === 'string' ? result.stderr : ''
  if (/bubblewrap is unavailable/i.test(stderr)) return 'status=codex-inner-bwrap-unavailable'
  if (/bwrap/i.test(stderr) && /(?:namespace|unshare)/i.test(stderr)) return 'status=nested-bwrap-namespace'
  if (/bwrap/i.test(stderr)) return 'status=bwrap-launch-failed'
  if (/(?:seccomp|landlock|sandbox)/i.test(stderr)) return 'status=codex-sandbox-denied'
  if (/(?:operation not permitted|permission denied|read-only file system)/i.test(stderr)) return 'status=filesystem-denied'
  return Number.isInteger(result?.exitCode) ? `exit=${result.exitCode}` : 'status=missing-exit'
}

async function runInvariant({ id, label, command, expectedExit = 0, expectedStdout = '', timeoutMs = 15000, hostCheck }) {
  let passed = false
  let status = 'status=unknown'
  try {
    const result = await rpc('command/exec', {
      command,
      cwd: workspace,
      permissionProfile: PROFILE,
      timeoutMs,
      outputBytesCap: 1024,
    })
    if (result?.exitCode !== expectedExit) {
      status = commandFailureStatus(result)
    } else if (String(result?.stdout ?? '') !== expectedStdout) {
      status = 'status=unexpected-output'
    } else {
      try {
        if (hostCheck) hostCheck()
        passed = true
      } catch {
        status = 'status=host-verification'
      }
    }
  } catch (error) {
    status = error?.message === 'app-server-exited' ? 'status=app-server-exited' : 'status=app-server-rpc-error'
  }
  reportInvariant(id, label, passed, status)
  return passed
}

async function runControlVisibilityInvariant() {
  let status = 'status=unknown'
  try {
    const result = await rpc('command/exec', {
      command: ['/bin/sh', '-c', `test ! -e ${quote(controlRoot)}`],
      cwd: workspace,
      permissionProfile: PROFILE,
      timeoutMs: 15000,
      outputBytesCap: 1024,
    })
    if (String(result?.stdout ?? '') !== '') status = 'status=unexpected-output'
    else if (result?.exitCode === 0) status = 'state=absent'
    else if (result?.exitCode === 1) status = 'state=visible'
    else status = commandFailureStatus(result)
  } catch (error) {
    status = error?.message === 'app-server-exited' ? 'status=app-server-exited' : 'status=app-server-rpc-error'
  }
  const passed = status === 'state=absent' || status === 'state=visible'
  reportInvariant('11A', 'control-visibility', passed, status)
  return passed
}

function verifyControlFilesNotWritableByServiceUser() {
  for (const file of [controlRoot, controlFinalizer, launcher]) {
    let writable = false
    try {
      fs.accessSync(file, fs.constants.W_OK)
      writable = true
    } catch (error) {
      if (error?.code !== 'EACCES' && error?.code !== 'EPERM') throw error
    }
    if (writable) throw new Error('control-file-writable')
  }
}

const cleanup = async () => {
  try { child.stdin.end() } catch {}
  if (!(await waitForChildExit(5000))) {
    try { process.kill(-child.pid, 'SIGTERM') } catch {}
    if (!(await waitForChildExit(5000))) {
      try { process.kill(-child.pid, 'SIGKILL') } catch {}
      await waitForChildExit(1000)
    }
  }
  for (const file of [homeCanary, codexCanary, outsideCanary, workspaceCanary, workspaceProbe, statePath, permitPath, `${permitPath}.consuming`]) {
    try { fs.unlinkSync(file) } catch {}
  }
  try { fs.rmdirSync(outsideRoot) } catch {}
}

try {
  await rpc('initialize', {
    clientInfo: { name: 'symphony-pilot-isolation-test', version: '1.0.0' },
    capabilities: { experimentalApi: true },
  })
  child.stdin.write(`${JSON.stringify({ method: 'initialized', params: {} })}\n`)
  const config = await rpc('config/read', { includeLayers: false, cwd: workspace })
  const granular = config?.config?.approval_policy?.granular
  if (!granular || Object.keys(granular).sort().join('|') !== APPROVAL_FIELDS.join('|')) fail('effective-approval-policy-mismatch')
  if (APPROVAL_FIELDS.some((field) => granular[field] !== false)) fail('effective-approval-policy-not-fail-closed')
  const thread = await rpc('thread/start', {
    cwd: workspace,
    permissions: PROFILE,
    environments: [],
    selectedCapabilityRoots: [],
    dynamicTools: [],
    ephemeral: true,
  })
  if (thread?.activePermissionProfile?.id !== PROFILE) fail('active-permission-profile-mismatch')
  if (configOnly) {
    console.log(`[symphony-pilot-config] PASS profile=${PROFILE} approval=granular-fail-closed codex=0.147.0`)
    if (!pilotHomeInjectionResults.every(Boolean)) process.exitCode = 1
  } else {
    const results = [...pilotHomeInjectionResults]
    results.push(await runInvariant({
      id: '01',
      label: 'workspace-read',
      command: ['/bin/sh', '-c', `test -r ${quote(workspaceCanary)}`],
    }))
    results.push(await runInvariant({
      id: '02',
      label: 'workspace-write',
      command: ['/bin/sh', '-c', `printf '%s\\n' ${quote(workspaceProbeMarker.trim())} > ${quote(workspaceProbe)}`],
      hostCheck: () => {
        if (fs.readFileSync(workspaceProbe, 'utf8') !== workspaceProbeMarker) throw new Error('workspace-write-marker-mismatch')
      },
    }))
    results.push(await runInvariant({
      id: '03',
      label: 'normal-home-read',
      command: ['/bin/sh', '-c', `test ! -r ${quote(homeCanary)}`],
    }))
    results.push(await runInvariant({
      id: '04',
      label: 'normal-codex-read',
      command: ['/bin/sh', '-c', `test ! -r ${quote(codexCanary)}`],
    }))
    results.push(await runInvariant({
      id: '05A',
      label: 'durable-pilot-auth',
      command: ['/bin/sh', '-c', `test ! -r ${quote(durableAuth)}`],
    }))
    results.push(await runInvariant({
      id: '05B',
      label: 'runtime-auth',
      command: ['/bin/sh', '-c', 'test -n "${CODEX_HOME:-}" && test ! -r "$CODEX_HOME/auth.json"'],
    }))
    results.push(await runInvariant({
      id: '06',
      label: 'outside-workspace-read',
      command: ['/bin/sh', '-c', `test ! -r ${quote(outsideCanary)}`],
    }))
    results.push(await runInvariant({
      id: '07',
      label: 'mnt-c',
      command: ['/bin/sh', '-c', 'test ! -e /mnt/c'],
    }))
    const routeIsolated = await runInvariant({
      id: '08A',
      label: 'network-route',
      command: ['/bin/sh', '-c', "test ! -r /proc/net/route || ! /bin/grep -Eq '^[^[:space:]]+[[:space:]]+00000000[[:space:]]+' /proc/net/route"],
    })
    const httpIsolated = await runInvariant({
      id: '08B',
      label: 'network-http',
      command: ['/bin/sh', '-c', 'if ! test -x /usr/bin/curl; then exit 72; fi; if /usr/bin/curl --silent --show-error --connect-timeout 2 --max-time 5 https://example.com >/dev/null 2>&1; then exit 71; fi; exit 0'],
      timeoutMs: 10000,
    })
    const networkIsolated = routeIsolated && httpIsolated
    reportInvariant('08', 'network', networkIsolated, 'status=subcheck-failed')
    results.push(networkIsolated)
    reportInvariant('09', 'active-profile', true)
    results.push(true)
    const pilotHomeInjectionBlocked = pilotHomeInjectionResults.every(Boolean)
    reportInvariant('10', 'injection-rejection', pilotHomeInjectionBlocked, 'status=subcheck-failed')
    results.push(pilotHomeInjectionBlocked)
    results.push(await runControlVisibilityInvariant())
    results.push(await runInvariant({
      id: '11B',
      label: 'control-writability',
      command: ['/bin/sh', '-c', `if test ! -e ${quote(controlRoot)}; then exit 0; fi; test ! -w ${quote(controlRoot)} && test ! -w ${quote(controlFinalizer)} && test ! -w ${quote(launcher)}`],
      hostCheck: verifyControlFilesNotWritableByServiceUser,
    }))
    const passed = results.every(Boolean)
    console.log(`OVERALL ${passed ? 'PASS' : 'FAIL'}`)
    if (!passed) process.exitCode = 1
  }
} finally {
  await cleanup()
}
