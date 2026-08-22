#!/usr/bin/env node

import path from 'node:path'
import fs from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'

const PIN = '8001b52e3062495a16e520e4ceaf8f9de868c4d0'
const EXPECTED = [
  'elixir/lib/symphony_elixir/codex/app_server.ex',
  'elixir/lib/symphony_elixir/config.ex',
  'elixir/lib/symphony_elixir/config/schema.ex',
  'elixir/lib/symphony_elixir/github/adapter.ex',
  'elixir/lib/symphony_elixir/workspace.ex',
  'elixir/test/symphony_elixir/app_server_test.exs',
  'elixir/test/symphony_elixir/github_adapter_test.exs',
].sort()

function fail(code) { console.error(`[symphony-upstream] ${code}`); process.exit(1) }
function git(cwd, args) { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() }
function mix(cwd, args, failureCode) {
  const runner = spawnSync('mise', ['exec', '--', 'mix', ...args], { cwd, stdio: 'inherit' })
  if (runner.error?.code !== 'ENOENT') {
    if (runner.status !== 0) fail(failureCode)
    return
  }
  const direct = spawnSync('mix', args, { cwd, stdio: 'inherit' })
  if (direct.status !== 0) fail(direct.error?.code === 'ENOENT' ? 'elixir-toolchain-missing' : failureCode)
}

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
  git(checkout, ['diff', '--check'])
  console.log('[symphony-upstream] diff-check=PASS')
} catch { fail('patch-validation-failed') }

const elixirRoot = path.join(checkout, 'elixir')
const adapterSource = fs.readFileSync(path.join(elixirRoot, 'lib/symphony_elixir/github/adapter.ex'), 'utf8')
const adapterTest = fs.readFileSync(path.join(elixirRoot, 'test/symphony_elixir/github_adapter_test.exs'), 'utf8')
const appServerSource = fs.readFileSync(path.join(elixirRoot, 'lib/symphony_elixir/codex/app_server.ex'), 'utf8')
const appServerTest = fs.readFileSync(path.join(elixirRoot, 'test/symphony_elixir/app_server_test.exs'), 'utf8')
if (!adapterSource.includes('def agent_tool_specs, do: []')) fail('github-tool-boundary-missing')
if (adapterTest.includes('assert [%{"name" => "github_api"}] = binding.tool_specs')) fail('stale-github-tool-test-expectation')
const localEnvironmentCount = appServerSource.split('"environmentId" => "local"').length - 1
const runtimeRootCount = appServerSource.split('"runtimeWorkspaceRoots" => [workspace]').length - 1
if (localEnvironmentCount !== 2 || runtimeRootCount !== 3 || appServerSource.includes('"environments" => []')) fail('local-environment-contract-missing')
if (!appServerTest.includes('assert thread["params"]["environments"] == expected_environment') || !appServerTest.includes('assert turn["params"]["environments"] == expected_environment') || !appServerTest.includes('assert thread["params"]["runtimeWorkspaceRoots"] == expected_runtime_workspace_roots') || !appServerTest.includes('assert turn["params"]["runtimeWorkspaceRoots"] == expected_runtime_workspace_roots')) fail('local-environment-regression-missing')
mix(elixirRoot, ['format', '--check-formatted'], 'upstream-format-check-failed')
console.log('[symphony-upstream] format-check=PASS')
mix(elixirRoot, ['test', 'test/symphony_elixir/app_server_test.exs', 'test/symphony_elixir/github_adapter_test.exs'], 'focused-upstream-tests-failed')
console.log('[symphony-upstream] focused-tests=PASS')
