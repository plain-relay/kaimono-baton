import { describe, expect, it, vi } from 'vitest'
import { runHandwritingConnectivityProbe } from './handwriting-connectivity-probe.mjs'
import {
  HANDWRITING_PROBE_ORIGIN,
  HANDWRITING_PROBE_REQUEST_ID_HEADER,
  HANDWRITING_PROBE_WORKER_ORIGIN,
} from './lib/handwriting-connectivity-probe.mjs'

function safeResponse() {
  return Response.json(
    { code: 'REQUEST_INVALID' },
    {
      status: 400,
      headers: {
        'Access-Control-Allow-Origin': HANDWRITING_PROBE_ORIGIN,
        'Access-Control-Expose-Headers':
          HANDWRITING_PROBE_REQUEST_ID_HEADER,
        [HANDWRITING_PROBE_REQUEST_ID_HEADER]: 'safe-request-123',
        'Cache-Control': 'no-store',
      },
    },
  )
}

describe('handwriting connectivity probe CLI', () => {
  it('prints only the safe result summary and performs no mutations', async () => {
    const write = vi.fn()
    const writeError = vi.fn()
    const runCapturedImplementation = vi.fn(async () => ({
      stdout: `${HANDWRITING_PROBE_WORKER_ORIGIN}/\n`,
      stderr: '',
      exitCode: 0,
    }))
    const fetchImplementation = vi.fn(async () => safeResponse())

    await expect(
      runHandwritingConnectivityProbe({
        runCapturedImplementation,
        fetchImplementation,
        write,
        writeError,
      }),
    ).resolves.toBe(0)

    expect(writeError).not.toHaveBeenCalled()
    expect(write.mock.calls.flat().join('\n')).toContain(
      'HANDWRITING CONNECTIVITY PROBE PASSED',
    )
    expect(write.mock.calls.flat().join('\n')).toContain(
      'State-changing operations: none',
    )
    expect(runCapturedImplementation).toHaveBeenCalledTimes(1)
    expect(fetchImplementation).toHaveBeenCalledTimes(1)
    const allOutput = JSON.stringify([
      ...write.mock.calls,
      ...writeError.mock.calls,
    ])
    expect(allOutput).not.toContain('TURNSTILE')
    expect(allOutput).not.toContain('GEMINI')
    expect(allOutput).not.toContain('token')
    expect(allOutput).not.toContain('products')
  })

  it('prints only a finite failure reason', async () => {
    const write = vi.fn()
    const writeError = vi.fn()
    const rawDetail = 'credential-and-response-body-detail'

    await expect(
      runHandwritingConnectivityProbe({
        runCapturedImplementation: vi.fn(async () => ({
          stdout: '',
          stderr: rawDetail,
          exitCode: 1,
        })),
        fetchImplementation: vi.fn(),
        write,
        writeError,
      }),
    ).resolves.toBe(1)

    expect(write).not.toHaveBeenCalled()
    const output = writeError.mock.calls.flat().join('\n')
    expect(output).toContain(
      'HANDWRITING CONNECTIVITY PROBE FAILED',
    )
    expect(output).toContain('Reason: endpoint-unavailable')
    expect(output).not.toContain(rawDetail)
  })
})
