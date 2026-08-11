import { describe, expect, it, vi } from 'vitest'
import {
  createCloudflareWorkerClient,
  toSafeWorkerError,
} from './cloudflare-worker.mjs'
import { NativeCommandError } from './native-command.mjs'

const initialVersion = 'a4d01088-76b4-4176-8b08-86542147e5be'
const diagnosticVersion = 'b4d01088-76b4-4176-8b08-86542147e5be'

function captured(value) {
  return {
    stdout: JSON.stringify(value),
    stderr: '',
    exitCode: 0,
  }
}

function deployment(versionId, deploymentId = 'deployment-id') {
  return {
    id: deploymentId,
    versions: [{ version_id: versionId, percentage: 100 }],
  }
}

function version(diagnosticMode) {
  return {
    resources: {
      bindings: [
        {
          name: 'DIAGNOSTIC_MODE',
          type: 'plain_text',
          text: diagnosticMode,
        },
        {
          name: 'ALLOWED_ORIGINS',
          type: 'plain_text',
          text: 'https://plain-relay.github.io',
        },
      ],
    },
  }
}

function clientWith(runCaptured, runInteractive = async () => 0) {
  return createCloudflareWorkerClient({
    repositoryRoot: 'C:\\repo',
    workerConfig: 'C:\\repo\\worker\\wrangler.toml',
    workerName: 'kaimono-baton-handwriting-import',
    allowedOrigin: 'https://plain-relay.github.io',
    expectedHostname: 'plain-relay.github.io',
    runCaptured,
    runInteractive,
    npxCommand: 'npx.cmd',
  })
}

describe('Cloudflare Worker client', () => {
  it('reads the active deployment and safe plain-text bindings', async () => {
    const runCaptured = vi.fn(async (_command, args) => {
      if (args.includes('status')) {
        return captured(deployment(initialVersion))
      }
      return captured(version('false'))
    })

    await expect(
      clientWith(runCaptured).getActiveWorker(),
    ).resolves.toEqual({
      deploymentId: 'deployment-id',
      versionId: initialVersion,
      diagnosticMode: 'false',
      allowedOrigin: 'https://plain-relay.github.io',
    })
  })

  it('checks only required Secret names and the exact hostname', async () => {
    const runCaptured = vi.fn(async (_command, args) => {
      if (args.includes('secret')) {
        return captured([
          { name: 'GEMINI_API_KEY', type: 'secret_text' },
          { name: 'TURNSTILE_SECRET_KEY', type: 'secret_text' },
        ])
      }
      return captured([
        {
          name: 'kaimono-baton-handwriting-import',
          domains: ['plain-relay.github.io'],
        },
      ])
    })

    await expect(
      clientWith(runCaptured).verifyPreflightResources(),
    ).resolves.toBeUndefined()
    expect(JSON.stringify(runCaptured.mock.calls)).not.toContain(
      'secret-value',
    )
  })

  it('deploys diagnostics with only the existing safe origin variable', async () => {
    const runCaptured = vi.fn(async (_command, args) => {
      if (args.includes('status')) {
        return captured(deployment(diagnosticVersion, 'diagnostic-deploy'))
      }
      return captured(version('true'))
    })
    const runInteractive = vi.fn(async () => 0)

    const result = await clientWith(
      runCaptured,
      runInteractive,
    ).deployDiagnosticsEnabled()

    expect(result.versionId).toBe(diagnosticVersion)
    expect(runInteractive).toHaveBeenCalledWith(
      'npx.cmd',
      [
        'wrangler',
        'deploy',
        '--config',
        'C:\\repo\\worker\\wrangler.toml',
        '--var',
        'ALLOWED_ORIGINS:https://plain-relay.github.io',
        '--var',
        'DIAGNOSTIC_MODE:true',
        '--strict',
      ],
      { cwd: 'C:\\repo' },
    )
  })

  it('restores the exact saved version at 100 percent', async () => {
    const runCaptured = vi.fn(async (_command, args) => {
      if (args.includes('status')) {
        return captured(deployment(initialVersion, 'restored-deploy'))
      }
      return captured(version('false'))
    })
    const runInteractive = vi.fn(async () => 0)

    const result = await clientWith(
      runCaptured,
      runInteractive,
    ).restoreExactVersion(initialVersion)

    expect(result).toMatchObject({
      versionId: initialVersion,
      deploymentId: 'restored-deploy',
    })
    expect(runInteractive).toHaveBeenCalledWith(
      'npx.cmd',
      [
        'wrangler',
        'versions',
        'deploy',
        `${initialVersion}@100`,
        '--config',
        'C:\\repo\\worker\\wrangler.toml',
        '--yes',
      ],
      { cwd: 'C:\\repo' },
    )
  })

  it('does not expose captured stderr through its safe error mapping', () => {
    const error = new NativeCommandError('npx.cmd', 1)
    error.stderr = 'GEMINI_API_KEY=secret-value'

    expect(JSON.stringify(toSafeWorkerError(error))).not.toContain(
      'secret-value',
    )
  })
})
