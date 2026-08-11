import { describe, expect, it, vi } from 'vitest'
import {
  createOneShotRecovery,
  main,
  parseArguments,
} from './handwriting-manual-test.mjs'

describe('manual-test CLI', () => {
  it('parses only bounded refs and the supported failure injection', () => {
    expect(
      parseArguments([
        'start',
        '--ref',
        'feature/manual',
        '--inject-failure',
        'before-on-manifest',
      ]),
    ).toEqual({
      command: 'start',
      options: {
        ref: 'feature/manual',
        injectFailure: 'before-on-manifest',
      },
    })
    expect(() => parseArguments(['start', '--ref'])).toThrow()
    expect(() =>
      parseArguments(['start', '--ref', 'main; echo unsafe']),
    ).toThrow()
  })

  it('runs recovery at most once for repeated interruption events', async () => {
    const orchestrator = {
      recoverActiveSession: vi.fn(async () => ({ phase: 'complete' })),
    }
    const recovery = createOneShotRecovery(orchestrator)

    const [first, second] = await Promise.all([
      recovery.run('sigint'),
      recovery.run('sigterm'),
    ])

    expect(first).toEqual({ phase: 'complete' })
    expect(second).toEqual(first)
    expect(orchestrator.recoverActiveSession).toHaveBeenCalledTimes(1)
    expect(orchestrator.recoverActiveSession).toHaveBeenCalledWith(
      'sigint',
    )
  })

  it('keeps preflight read-only and reports the safe baseline', async () => {
    const orchestrator = {
      preflight: vi.fn(async () => ({
        worker: {
          deploymentId: 'deployment-id',
          versionId: 'version-id',
        },
      })),
      recoverActiveSession: vi.fn(),
    }
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      await expect(
        main(['preflight'], { orchestrator }),
      ).resolves.toBe(0)
      expect(orchestrator.preflight).toHaveBeenCalledWith({
        ref: 'main',
        forStart: true,
      })
      expect(orchestrator.recoverActiveSession).not.toHaveBeenCalled()
      expect(
        log.mock.calls.some(([message]) =>
          String(message).includes('MANUAL TEST PREFLIGHT PASSED'),
        ),
      ).toBe(true)
    } finally {
      log.mockRestore()
    }
  })
})
