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

const workspace = fs.realpathSync(process.cwd())
const controlRoot = requireEnv('SYMPHONY_PILOT_CONTROL_ROOT')
const pilotHome = requireEnv('SYMPHONY_PILOT_CODEX_HOME')
const stateRoot = requireEnv('SYMPHONY_PILOT_STATE_DIR')
const launcher = requireEnv('SYMPHONY_PILOT_TRUSTED_LAUNCHER')
if (process.platform !== 'linux') fail('wsl-linux-required')
const bwrap = requireEnv('SYMPHONY_PILOT_BWRAP_BIN')
if (spawnSync(bwrap, ['--version']).status !== 0) fail('bwrap-missing')
if (spawnSync('/usr/bin/curl', ['--version']).status !== 0) fail('curl-missing')
if (!fs.statSync(launcher).isFile()) fail('trusted-launcher-missing')

const unexpectedPilotHomeEntries = [
  { path: path.join(pilotHome, 'AGENTS.md'), kind: 'file', content: 'UNTRUSTED_INSTRUCTION\n' },
  { path: path.join(pilotHome, 'skills'), kind: 'directory' },
  { path: path.join(pilotHome, 'hooks'), kind: 'directory' },
  { path: path.join(pilotHome, 'config.toml'), kind: 'file', content: '[mcp_servers.untrusted]\ncommand = "false"\n' },
  { path: path.join(pilotHome, 'plugins'), kind: 'directory' },
]
for (const entry of unexpectedPilotHomeEntries) {
  try {
    if (entry.kind === 'directory') fs.mkdirSync(entry.path, { mode: 0o700 })
    else fs.writeFileSync(entry.path, entry.content, { flag: 'wx', mode: 0o600 })
    const rejected = spawnSync(launcher, ['codex', 'app-server'], {
      cwd: workspace,
      env: process.env,
      encoding: 'utf8',
      timeout: 15000,
    })
    if (rejected.status === 0 || !rejected.stderr.includes('pilot-home-unexpected-content')) fail('pilot-home-injection-not-rejected')
  } finally {
    if (entry.kind === 'directory') {
      try { fs.rmdirSync(entry.path) } catch {}
    } else {
      try { fs.unlinkSync(entry.path) } catch {}
    }
  }
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

fs.mkdirSync(codexDir, { recursive: true, mode: 0o700 })
fs.mkdirSync(path.dirname(workspaceCanary), { recursive: true, mode: 0o700 })
for (const file of [homeCanary, codexCanary, outsideCanary, workspaceCanary]) fs.writeFileSync(file, 'CANARY_CONTENT_MUST_NOT_BE_EMITTED\n', { mode: 0o600 })

const child = spawn(launcher, ['codex', 'app-server'], {
  cwd: workspace,
  env: process.env,
  stdio: ['pipe', 'pipe', 'inherit'],
})

let buffer = ''
let nextId = 1
const pending = new Map()
child.stdout.setEncoding('utf8')
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

const cleanup = () => {
  try { child.stdin.end() } catch {}
  try { child.kill('SIGTERM') } catch {}
  const forceKill = setTimeout(() => {
    if (child.exitCode === null) {
      try { child.kill('SIGKILL') } catch {}
    }
  }, 1000)
  forceKill.unref()
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
  } else {
    const shell = [
      'set -eu',
      `test -r ${quote(workspaceCanary)}`,
      `printf probe > ${quote(workspaceProbe)}`,
      `test ! -r ${quote(homeCanary)}`,
      `test ! -r ${quote(codexCanary)}`,
      `test ! -r ${quote(durableAuth)}`,
      'test ! -r "$CODEX_HOME/auth.json"',
      `test ! -r ${quote(outsideCanary)}`,
      'test ! -r /mnt/c/Windows/win.ini',
      `test ! -e ${quote(controlRoot)}`,
      `test ! -w ${quote(launcher)}`,
      "if curl --silent --show-error --max-time 3 https://example.com >/dev/null 2>&1; then exit 71; fi",
      "printf 'workspace_read=pass\\nworkspace_write=pass\\nhome_read=blocked\\nnormal_codex_read=blocked\\npilot_auth_read=blocked\\noutside_read=blocked\\nmnt_c_read=blocked\\nnetwork=blocked\\ncontrol_write=blocked\\n'",
    ].join('; ')
    const result = await rpc('command/exec', {
      command: ['/bin/sh', '-c', shell],
      cwd: workspace,
      permissionProfile: PROFILE,
      timeoutMs: 15000,
      outputBytesCap: 4096,
    })
    if (result?.exitCode !== 0) fail('negative-isolation-command-failed')
    const expected = ['workspace_read=pass', 'workspace_write=pass', 'home_read=blocked', 'normal_codex_read=blocked', 'pilot_auth_read=blocked', 'outside_read=blocked', 'mnt_c_read=blocked', 'network=blocked', 'control_write=blocked']
    if (result.stdout.trim().split(/\r?\n/).join('|') !== expected.join('|')) fail('negative-isolation-result-mismatch')
    console.log(`[symphony-pilot-isolation] PASS profile=${PROFILE} approval=granular-fail-closed pilot_home_injection=blocked control_write=blocked codex=0.147.0`)
  }
} finally {
  cleanup()
}
