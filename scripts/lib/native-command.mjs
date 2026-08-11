import { spawn } from 'node:child_process'
import { win32 } from 'node:path'

const DEFAULT_MAX_OUTPUT_BYTES = 10 * 1024 * 1024

export function resolveNpxInvocation({
  platform = process.platform,
  execPath = process.execPath,
} = {}) {
  if (platform !== 'win32') {
    return { command: 'npx', argsPrefix: [] }
  }
  return {
    command: execPath,
    argsPrefix: [
      win32.join(
        win32.dirname(execPath),
        'node_modules',
        'npm',
        'bin',
        'npx-cli.js',
      ),
    ],
  }
}

export class NativeCommandError extends Error {
  constructor(command, exitCode, code = 'COMMAND_FAILED') {
    super(`${command} failed with exit code ${exitCode}.`)
    this.name = 'NativeCommandError'
    this.command = command
    this.exitCode = exitCode
    this.code = code
  }
}

function collectStream(stream, maxOutputBytes, onLimit) {
  const chunks = []
  let byteLength = 0
  stream.on('data', (chunk) => {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    byteLength += buffer.byteLength
    if (byteLength > maxOutputBytes) {
      onLimit()
      return
    }
    chunks.push(buffer)
  })
  return () => Buffer.concat(chunks).toString('utf8')
}

export function runCaptured(
  command,
  args,
  {
    cwd,
    env = process.env,
    input,
    maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
  } = {},
) {
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
    throw new TypeError('Native command arguments must be a string array.')
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let outputLimitExceeded = false
    const stopForOutputLimit = () => {
      if (outputLimitExceeded) {
        return
      }
      outputLimitExceeded = true
      child.kill()
    }
    const stdout = collectStream(
      child.stdout,
      maxOutputBytes,
      stopForOutputLimit,
    )
    const stderr = collectStream(
      child.stderr,
      maxOutputBytes,
      stopForOutputLimit,
    )

    child.once('error', () => {
      reject(new NativeCommandError(command, -1, 'COMMAND_START_FAILED'))
    })
    child.once('close', (exitCode) => {
      if (outputLimitExceeded) {
        reject(new NativeCommandError(command, -1, 'COMMAND_OUTPUT_LIMIT'))
        return
      }
      resolve({
        stdout: stdout(),
        stderr: stderr(),
        exitCode: exitCode ?? -1,
      })
    })

    if (typeof input === 'string' || Buffer.isBuffer(input)) {
      child.stdin.end(input)
    } else {
      child.stdin.end()
    }
  })
}

export function runInteractive(
  command,
  args,
  { cwd, env = process.env } = {},
) {
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
    throw new TypeError('Native command arguments must be a string array.')
  }

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      windowsHide: false,
      stdio: 'inherit',
    })
    child.once('error', () => resolve(-1))
    child.once('close', (exitCode) => resolve(exitCode ?? -1))
  })
}

export function requireSuccess(command, result) {
  if (
    !result ||
    typeof result.exitCode !== 'number' ||
    result.exitCode !== 0
  ) {
    throw new NativeCommandError(command, result?.exitCode ?? -1)
  }
  return result
}

export function parseJsonStdout(command, result) {
  requireSuccess(command, result)
  if (!result.stdout.trim()) {
    throw new NativeCommandError(command, result.exitCode, 'EMPTY_JSON_OUTPUT')
  }
  try {
    return JSON.parse(result.stdout)
  } catch {
    throw new NativeCommandError(
      command,
      result.exitCode,
      'MALFORMED_JSON_OUTPUT',
    )
  }
}
