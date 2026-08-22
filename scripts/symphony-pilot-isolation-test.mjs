#!/usr/bin/env node

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'

const PROFILE = 'symphony-pilot'
const APPROVAL_FIELDS = ['mcp_elicitations', 'request_permissions', 'rules', 'sandbox_approval', 'skill_approval']
const options = new Set(process.argv.slice(2))
if ([...options].some((option) => !['--config-only', '--model-turn', '--model-edit'].includes(option)) || options.size > 1) fail('unexpected-argument')
const configOnly = options.has('--config-only')
const modelTurn = options.has('--model-turn')
const modelEdit = options.has('--model-edit')

function fail(code) { throw new Error(code) }
function requireEnv(name) { const value = process.env[name]?.trim(); if (!value) fail(`missing-${name.toLowerCase()}`); return path.resolve(value) }
function quote(value) { return `'${value.replaceAll("'", `'\"'\"'`)}'` }
function reportInvariant(id, label, passed, status = '') {
  console.log(`ISOLATION-${id} ${label} ${passed ? 'PASS' : `FAIL ${status || 'status=unknown'}`}`)
}

const workspace = fs.realpathSync(process.cwd())
const localEnvironment = Object.freeze([Object.freeze({
  environmentId: 'local',
  cwd: workspace,
  runtimeWorkspaceRoots: Object.freeze([workspace]),
})])
function hasExactLocalEnvironment(value) {
  return Array.isArray(value) && value.length === 1 &&
    value[0]?.environmentId === 'local' &&
    value[0]?.cwd === workspace &&
    Array.isArray(value[0]?.runtimeWorkspaceRoots) &&
    value[0].runtimeWorkspaceRoots.length === 1 &&
    value[0].runtimeWorkspaceRoots[0] === workspace
}
if (!hasExactLocalEnvironment(localEnvironment)) fail('local-environment-contract-invalid')
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
const identityHelper = path.join(controlRoot, 'scripts', 'symphony-pilot-owner-identity.sh')
if (!fs.statSync(identityHelper).isFile()) fail('owner-identity-helper-missing')

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
const ownerIdentityResult = spawnSync('/bin/sh', ['-c', '. "$1"; symphony_pilot_owner_process_identity "$2" "$PPID"', 'sh', identityHelper, ownerInstanceId], { encoding: 'utf8' })
const ownerProcessIdentity = ownerIdentityResult.status === 0 ? ownerIdentityResult.stdout.trim() : ''
if (!/^[0-9a-f]{64}$/.test(ownerProcessIdentity)) fail('owner-process-identity-invalid')
const statePath = path.join(stateRoot, `GH-${issueNumber}.json`)
const permitsDir = path.join(stateRoot, 'launch-permits')
const permitPath = path.join(permitsDir, `GH-${issueNumber}-${executionId}.json`)
if (fs.existsSync(statePath) || fs.existsSync(permitPath)) fail('isolation-state-not-empty')
fs.mkdirSync(permitsDir, { recursive: true, mode: 0o700 })
const claim = { schemaVersion: 3, state: 'claimed', issueNumber, executionId, taskHash: crypto.randomBytes(32).toString('hex'), baseSha: crypto.randomBytes(20).toString('hex'), ownerInstanceId, ownerProcessIdentity }
const permit = { schemaVersion: 1, issueNumber, executionId, taskHash: claim.taskHash, baseSha: claim.baseSha, ownerInstanceId, ownerProcessIdentity, issuedAt: new Date().toISOString(), nonce: crypto.randomBytes(24).toString('hex') }
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
const modelFixture = path.join(workspace, 'pilot-fixture.txt')
let modelFixtureCreated = false
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
const notifications = []
const notificationWaiters = []
let childStderr = ''
child.stdout.setEncoding('utf8')
child.stderr.setEncoding('utf8')
child.stderr.on('data', (chunk) => { childStderr += chunk.slice(0, 4096) })
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
    } else if (typeof message.method === 'string') {
      notifications.push(message)
      for (const waiter of notificationWaiters.splice(0)) waiter()
    }
  }
})
function appServerExitError() {
  const explicit = childStderr.match(/\[symphony-pilot\] ([a-z0-9-]+)/)?.[1]
  if (explicit) return new Error(`app-server-exited-${explicit}`)
  const known = ['owner-process-identity-mismatch', 'owner-process-identity-invalid', 'launch-permit', 'control-file-digest-mismatch', 'inner-bwrap-discovery-failed']
  const code = known.find((candidate) => childStderr.includes(candidate))
  return new Error(code ? `app-server-exited-${code}` : 'app-server-exited')
}
child.on('exit', () => {
  for (const { reject } of pending.values()) reject(appServerExitError())
  pending.clear()
})

function rpc(method, params) {
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
  })
}

async function waitForNotification(method, predicate, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const found = notifications.find((message) => message.method === method && predicate(message.params))
    if (found) return found
    await new Promise((resolve) => {
      const remaining = Math.max(1, deadline - Date.now())
      const timer = setTimeout(resolve, remaining)
      notificationWaiters.push(() => { clearTimeout(timer); resolve() })
    })
  }
  throw new Error('app-server-notification-timeout')
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
  return runInvariant({
    id: '11A',
    label: 'control-visibility',
    command: ['/bin/sh', '-c', `test ! -e ${quote(controlRoot)} && test ! -e ${quote(launcher)} && test ! -r /usr/local && test ! -r /usr/src`],
  })
}

async function runAuthenticatedModelTurn(thread) {
  const turn = await rpc('turn/start', {
    threadId: thread.thread.id,
    cwd: workspace,
    permissions: PROFILE,
    environments: localEnvironment,
    input: [{ type: 'text', text: 'Return exactly PILOT_MODEL_OK. Do not call tools.' }],
  })
  const completed = await waitForNotification('turn/completed', (params) => params?.turn?.id === turn?.turn?.id)
  const items = completed.params?.turn?.items
  if (completed.params?.turn?.status !== 'completed' || !Array.isArray(items)) {
    const status = String(completed.params?.turn?.status ?? 'unknown').replace(/[^a-z-]/gi, '')
    const code = String(completed.params?.turn?.error?.code ?? 'no-code').replace(/[^a-z-]/gi, '')
    throw new Error(`model-turn-not-completed-${status}-${code}`)
  }
  const usedTool = items.some((item) => /(?:command|tool|mcp|web|function|exec)/i.test(String(item?.type ?? '')))
  const messages = items.filter((item) => item?.type === 'agentMessage').map((item) => item.text)
  if (usedTool || messages.length !== 1 || messages[0]?.trim() !== 'PILOT_MODEL_OK') throw new Error('model-turn-output-invalid')
}

async function runModelEditTurn(thread) {
  if (fs.existsSync(modelFixture)) throw new Error('model-fixture-already-exists')
  fs.writeFileSync(modelFixture, 'BEFORE\n', { flag: 'wx', mode: 0o600 })
  modelFixtureCreated = true
  const turn = await rpc('turn/start', {
    threadId: thread.thread.id,
    cwd: workspace,
    permissions: PROFILE,
    environments: localEnvironment,
    input: [{ type: 'text', text: 'You must modify the workspace file `pilot-fixture.txt`. Use the available command execution tool to replace its entire contents with:\n\nAFTER\n\nDo not merely describe the change. Do not use network access. After making the change, verify the file and respond exactly:\n\nPILOT_EDIT_OK' }],
  })
  const completed = await waitForNotification('turn/completed', (params) => params?.turn?.id === turn?.turn?.id)
  const items = completed.params?.turn?.items
  if (completed.params?.turn?.status !== 'completed' || !Array.isArray(items)) throw new Error('model-edit-not-completed')
  const commandSucceeded = items.some((item) => item?.type === 'commandExecution' && item?.status === 'completed' && (item?.exitCode === 0 || item?.exitCode === undefined))
  const messages = items.filter((item) => item?.type === 'agentMessage').map((item) => item.text)
  if (!commandSucceeded) throw new Error('model-command-execution-not-successful')
  if (fs.readFileSync(modelFixture, 'utf8') !== 'AFTER\n') throw new Error('model-fixture-content-invalid')
  if (messages.at(-1)?.trim() !== 'PILOT_EDIT_OK') throw new Error('model-edit-output-invalid')
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
  for (const file of [homeCanary, codexCanary, outsideCanary, workspaceCanary, workspaceProbe, modelFixtureCreated ? modelFixture : null, statePath, permitPath, `${permitPath}.consuming`]) {
    if (!file) continue
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
    environments: localEnvironment,
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
    let authenticatedModelTurn = true
    let modelTurnStatus = ''
    if (modelTurn || modelEdit) {
      try { await runAuthenticatedModelTurn(thread) }
      catch (error) {
        authenticatedModelTurn = false
        modelTurnStatus = /^(?:app-server-exited|app-server-rpc-error|app-server-notification-timeout|model-turn-[a-z-]+)$/.test(error?.message || '') ? `status=${error.message}` : 'status=model-turn-failed'
      }
    }
    let localEnvironmentUsable = !modelEdit
    let modelEditSucceeded = !modelEdit
    let modelEditStatus = ''
    if (modelEdit) {
      if (!authenticatedModelTurn) {
        reportInvariant('13', 'exact-local-environment', false, 'status=model-transport-prerequisite')
      } else {
        localEnvironmentUsable = await runInvariant({
          id: '13',
          label: 'exact-local-environment',
          command: ['/bin/true'],
        })
        if (localEnvironmentUsable) {
          try { await runModelEditTurn(thread) }
          catch (error) {
            modelEditSucceeded = false
            modelEditStatus = /^(?:app-server-exited|app-server-rpc-error|app-server-notification-timeout|model-(?:edit|command|fixture)-[a-z-]+)$/.test(error?.message || '') ? `status=${error.message}` : 'status=model-edit-failed'
          }
        }
      }
    }
    // This command probe deliberately runs after the real provider turn.  It
    // proves the outer provider network did not leak into Codex command/exec.
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
    if (modelTurn || modelEdit) {
      reportInvariant('12', 'authenticated-model-turn', authenticatedModelTurn, modelTurnStatus)
      results.push(authenticatedModelTurn)
    }
    if (modelEdit) {
      const exactRuntimeRoots = authenticatedModelTurn && localEnvironmentUsable && hasExactLocalEnvironment(localEnvironment)
      reportInvariant('14', 'exact-runtime-workspace-roots', exactRuntimeRoots)
      results.push(localEnvironmentUsable && exactRuntimeRoots)
      results.push(await runInvariant({
        id: '15',
        label: 'no-remote-environment',
        command: ['/bin/sh', '-c', 'test -z "${CODEX_EXEC_SERVER_URL:-}"'],
      }))
      reportInvariant('MODEL-EXEC', 'synthetic-workspace-edit', modelEditSucceeded, modelEditStatus)
      results.push(modelEditSucceeded)
    }
    const passed = results.every(Boolean)
    console.log(`OVERALL ${passed ? 'PASS' : 'FAIL'}`)
    if (!passed) process.exitCode = 1
  }
} finally {
  await cleanup()
}
