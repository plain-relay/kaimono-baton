import { describe, expect, it } from 'vitest'
import {
  NativeCommandError,
  parseJsonStdout,
  requireSuccess,
  resolveNpxInvocation,
  runCaptured,
  runInteractive,
} from './native-command.mjs'

const node = process.execPath

function runNode(source, options) {
  return runCaptured(node, ['-e', source], options)
}

describe('runCaptured', () => {
  it('keeps stdout and stderr separate', async () => {
    const result = await runNode(
      "process.stdout.write('data'); process.stderr.write('warning')",
    )

    expect(result).toEqual({
      stdout: 'data',
      stderr: 'warning',
      exitCode: 0,
    })
  })

  it('preserves multiline stdout and a nonzero exit code', async () => {
    const result = await runNode(
      "console.log('line-1'); console.log('line-2'); process.exitCode = 7",
    )

    expect(result.stdout).toBe(`line-1\nline-2\n`)
    expect(result.stderr).toBe('')
    expect(result.exitCode).toBe(7)
    expect(() => requireSuccess('node', result)).toThrow(
      NativeCommandError,
    )
  })

  it('parses JSON from stdout even when stderr contains a warning', async () => {
    const result = await runNode(
      "process.stdout.write(JSON.stringify({ value: 42 })); process.stderr.write('warning')",
    )

    expect(parseJsonStdout('node', result)).toEqual({ value: 42 })
  })

  it.each([
    {
      label: 'malformed',
      source: "process.stdout.write('{')",
      code: 'MALFORMED_JSON_OUTPUT',
    },
    {
      label: 'empty',
      source: '',
      code: 'EMPTY_JSON_OUTPUT',
    },
  ])('rejects $label JSON stdout', async ({ source, code }) => {
    const result = await runNode(source)

    expect(() => parseJsonStdout('node', result)).toThrow(
      expect.objectContaining({ code }),
    )
  })

  it('fails safely when captured output exceeds the configured limit', async () => {
    await expect(
      runNode("process.stdout.write('x'.repeat(4096))", {
        maxOutputBytes: 128,
      }),
    ).rejects.toMatchObject({
      code: 'COMMAND_OUTPUT_LIMIT',
    })
  })

  it('accepts a large stdout value within the configured limit', async () => {
    const result = await runNode(
      "process.stdout.write('x'.repeat(512 * 1024))",
    )

    expect(result.stdout).toHaveLength(512 * 1024)
    expect(result.exitCode).toBe(0)
  })

  it('does not invoke a shell to reinterpret arguments', async () => {
    const marker = 'literal && still-one-argument'
    const result = await runCaptured(node, [
      '-e',
      'process.stdout.write(process.argv[1])',
      marker,
    ])

    expect(result.stdout).toBe(marker)
  })
})

describe('runInteractive', () => {
  it('returns only a numeric exit code', async () => {
    const result = await runInteractive(node, ['-e', 'process.exit(3)'])

    expect(result).toBe(3)
    expect(Array.isArray(result)).toBe(false)
  })
})

describe('resolveNpxInvocation', () => {
  it('runs the Windows npx JavaScript entry point without a command shell', () => {
    expect(
      resolveNpxInvocation({
        platform: 'win32',
        execPath: 'C:\\Program Files\\nodejs\\node.exe',
      }),
    ).toEqual({
      command: 'C:\\Program Files\\nodejs\\node.exe',
      argsPrefix: [
        'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npx-cli.js',
      ],
    })
  })

  it('uses the native npx executable on non-Windows platforms', () => {
    expect(resolveNpxInvocation({ platform: 'linux' })).toEqual({
      command: 'npx',
      argsPrefix: [],
    })
  })
})
