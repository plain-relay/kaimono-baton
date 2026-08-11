import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ManualTestStateError,
  acquireManualTestLock,
  isIncompleteManualTestState,
  readManualTestState,
  resolveStatePaths,
  writeManualTestStateAtomic,
} from './manual-test-state.mjs'

const temporaryDirectories = []

async function temporaryRepository() {
  const path = await mkdtemp(join(tmpdir(), 'kaimono-baton-manual-state-'))
  temporaryDirectories.push(path)
  return path
}

function validState(overrides = {}) {
  return {
    schemaVersion: 1,
    sessionId: 'session-1',
    phase: 'prepared',
    startTime: '2026-07-28T00:00:00.000Z',
    expirationTime: '2026-07-28T00:45:00.000Z',
    repository: 'plain-relay/kaimono-baton',
    ref: 'main',
    mainSha: 'a'.repeat(40),
    actor: 'plain-relay',
    initialRepositoryVariables: {
      importEnabled: 'false',
      diagnosticsEnabled: 'false',
      endpointConfigured: true,
      turnstileSiteKeyConfigured: true,
      fingerprint: 'f'.repeat(64),
    },
    initialWorkerDeploymentId:
      '11111111-1111-4111-8111-111111111111',
    initialWorkerVersionId:
      '22222222-2222-4222-8222-222222222222',
    manualURL:
      'https://plain-relay.github.io/kaimono-baton/?handwritingDiagnostics=1&manualTestSessionId=session-1#/create',
    recoveryStatus: 'not-required',
    ...overrides,
  }
}

afterEach(async () => {
  for (const path of temporaryDirectories.splice(0)) {
    await rm(path, { recursive: true, force: true })
  }
})

describe('manual-test state', () => {
  it('atomically creates and replaces a valid state file', async () => {
    const root = await temporaryRepository()
    const { statePath } = resolveStatePaths(root)

    await writeManualTestStateAtomic(statePath, validState())
    await writeManualTestStateAtomic(
      statePath,
      validState({ phase: 'active' }),
    )

    expect(await readManualTestState(statePath)).toMatchObject({
      phase: 'active',
      sessionId: 'session-1',
    })
    expect(await readFile(statePath, 'utf8')).not.toContain('.tmp')
  })

  it('rejects corrupt and structurally invalid state', async () => {
    const root = await temporaryRepository()
    const { statePath } = resolveStatePaths(root)
    await writeFile(statePath, '{', 'utf8').catch(async () => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(root, '.manual-test'), { recursive: true })
      await writeFile(statePath, '{', 'utf8')
    })

    await expect(readManualTestState(statePath)).rejects.toMatchObject({
      code: 'CORRUPT_STATE',
    })
    await expect(
      writeManualTestStateAtomic(
        statePath,
        validState({ phase: 'not-a-phase' }),
      ),
    ).rejects.toBeInstanceOf(ManualTestStateError)
    await expect(
      writeManualTestStateAtomic(
        statePath,
        validState({ sourceText: 'forbidden' }),
      ),
    ).rejects.toBeInstanceOf(ManualTestStateError)
  })

  it('reads the recoverable backup if a Windows fallback was interrupted', async () => {
    const root = await temporaryRepository()
    const { statePath } = resolveStatePaths(root)
    const { mkdir } = await import('node:fs/promises')
    await mkdir(join(root, '.manual-test'), { recursive: true })
    await writeFile(
      `${statePath}.backup`,
      JSON.stringify(validState({ phase: 'recovery-required' })),
      'utf8',
    )

    await expect(readManualTestState(statePath)).resolves.toMatchObject({
      phase: 'recovery-required',
    })
    expect(JSON.parse(await readFile(statePath, 'utf8'))).toMatchObject({
      phase: 'recovery-required',
    })
  })

  it('prevents concurrent use and releases the lock idempotently', async () => {
    const root = await temporaryRepository()
    const { lockPath } = resolveStatePaths(root)
    const release = await acquireManualTestLock(lockPath)

    await expect(acquireManualTestLock(lockPath)).rejects.toMatchObject({
      code: 'LOCKED',
    })
    await release()
    await release()
    const secondRelease = await acquireManualTestLock(lockPath)
    await secondRelease()
  })

  it('reclaims a stale lock without trusting its session text', async () => {
    const root = await temporaryRepository()
    const { lockPath } = resolveStatePaths(root)
    const { mkdir } = await import('node:fs/promises')
    await mkdir(join(root, '.manual-test'), { recursive: true })
    await writeFile(
      lockPath,
      JSON.stringify({
        pid: 2147483647,
        sessionId: 'stale',
      }),
      'utf8',
    )

    const release = await acquireManualTestLock(lockPath)
    await release()
  })

  it('identifies only non-complete sessions as unfinished', () => {
    expect(isIncompleteManualTestState(undefined)).toBe(false)
    expect(isIncompleteManualTestState(validState())).toBe(true)
    expect(
      isIncompleteManualTestState(validState({ phase: 'complete' })),
    ).toBe(false)
  })
})
