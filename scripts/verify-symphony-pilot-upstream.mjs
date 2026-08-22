#!/usr/bin/env node

import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'

const PIN = '8001b52e3062495a16e520e4ceaf8f9de868c4d0'
const EXPECTED = [
  'elixir/lib/symphony_elixir/codex/app_server.ex',
  'elixir/lib/symphony_elixir/config.ex',
  'elixir/lib/symphony_elixir/config/schema.ex',
  'elixir/lib/symphony_elixir/github/adapter.ex',
  'elixir/test/symphony_elixir/app_server_test.exs',
  'elixir/test/symphony_elixir/github_adapter_test.exs',
].sort()

function fail(code) { console.error(`[symphony-upstream] ${code}`); process.exit(1) }
function git(cwd, args) { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() }

const checkout = path.resolve(process.argv[2] || '')
const applyAndTest = process.argv.includes('--apply-and-test')
if (!process.argv[2]) fail('checkout-required')
let controlRoot
try { controlRoot = git(process.cwd(), ['rev-parse', '--show-toplevel']) } catch { fail('control-checkout-required') }
const patchFile = path.join(controlRoot, 'symphony', 'patches', '0001-disable-github-agent-tool.patch')

try {
  if (git(checkout, ['rev-parse', 'HEAD']) !== PIN) fail('symphony-sha-mismatch')
  if (git(checkout, ['status', '--porcelain=v1']) !== '') fail('symphony-checkout-not-clean')
  git(checkout, ['apply', '--check', patchFile])
  console.log('[symphony-upstream] patch-apply-check=PASS')
  if (!applyAndTest) process.exit(0)
  git(checkout, ['apply', patchFile])
  const changed = git(checkout, ['diff', '--name-only']).split(/\r?\n/).filter(Boolean).sort()
  if (JSON.stringify(changed) !== JSON.stringify(EXPECTED)) fail('patched-path-set-mismatch')
} catch { fail('patch-validation-failed') }

const elixirRoot = path.join(checkout, 'elixir')
const runner = spawnSync('mise', ['exec', '--', 'mix', 'test', 'test/symphony_elixir/app_server_test.exs', 'test/symphony_elixir/github_adapter_test.exs'], { cwd: elixirRoot, stdio: 'inherit' })
if (runner.error?.code === 'ENOENT') {
  const direct = spawnSync('mix', ['test', 'test/symphony_elixir/app_server_test.exs', 'test/symphony_elixir/github_adapter_test.exs'], { cwd: elixirRoot, stdio: 'inherit' })
  if (direct.status !== 0) fail(direct.error?.code === 'ENOENT' ? 'elixir-toolchain-missing' : 'focused-upstream-tests-failed')
} else if (runner.status !== 0) fail('focused-upstream-tests-failed')
console.log('[symphony-upstream] focused-tests=PASS')
