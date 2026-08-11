import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdtempSync,
  rmSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { runCaptured } from './lib/native-command.mjs'

const scriptsDirectory = dirname(fileURLToPath(import.meta.url))
const temporaryDirectories = []

function createFakeNode() {
  const directory = mkdtempSync(join(tmpdir(), 'kaimono-baton-fake-node-'))
  temporaryDirectories.push(directory)
  writeFileSync(
    join(directory, 'node.cmd'),
    [
      '@echo off',
      'echo FAKE_NODE_ARGS:%*',
      'if "%FAKE_NODE_EXIT_CODE%"=="" exit /b 0',
      'exit /b %FAKE_NODE_EXIT_CODE%',
      '',
    ].join('\r\n'),
    'utf8',
  )
  const originalPath = process.env.PATH ?? process.env.Path ?? ''
  return {
    ...process.env,
    PATH: `${directory};${originalPath}`,
    Path: `${directory};${originalPath}`,
  }
}

const powerShellExecutables =
  process.platform === 'win32'
    ? [
        {
          name: 'Windows PowerShell 5.1',
          path: join(
            process.env.SystemRoot ?? 'C:\\Windows',
            'System32',
            'WindowsPowerShell',
            'v1.0',
            'powershell.exe',
          ),
        },
        {
          name: 'PowerShell 7',
          path:
            process.env.OTSUKAI_TEST_PWSH_PATH ??
            'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
        },
      ]
    : []

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})

describe('manual-test PowerShell wrappers', () => {
  it('routes start and preflight to the Node CLI only', () => {
    const script = readFileSync(
      join(scriptsDirectory, 'start-handwriting-manual-test.ps1'),
      'utf8',
    )

    expect(script).toContain(
      "$commandName = if ($PreflightOnly) { 'preflight' } else { 'start' }",
    )
    expect(script).toContain(
      "& node $CliPath $commandName '--ref' $Ref",
    )
    expect(script).toContain('exit $LASTEXITCODE')
    expect(script).not.toMatch(
      /ConvertFrom-Json|wrangler|gh\s|Invoke-WebRequest|Repository Variable/u,
    )
  })

  it('routes stop to the Node CLI only', () => {
    const script = readFileSync(
      join(scriptsDirectory, 'stop-handwriting-manual-test.ps1'),
      'utf8',
    )

    expect(script).toContain("& node $CliPath 'stop' '--ref' $Ref")
    expect(script).toContain('exit $LASTEXITCODE')
    expect(script).not.toMatch(
      /ConvertFrom-Json|wrangler|gh\s|Invoke-WebRequest|Repository Variable/u,
    )
  })

  for (const powerShell of powerShellExecutables) {
    it.skipIf(!existsSync(powerShell.path))(
      `runs the thin wrappers with ${powerShell.name}`,
      async () => {
        const environment = createFakeNode()
        const start = await runCaptured(
          powerShell.path,
          [
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            join(scriptsDirectory, 'start-handwriting-manual-test.ps1'),
            '-PreflightOnly',
            '-Ref',
            'refactor/manual-test-orchestration',
          ],
          { env: environment },
        )
        const stop = await runCaptured(
          powerShell.path,
          [
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            join(scriptsDirectory, 'stop-handwriting-manual-test.ps1'),
            '-Ref',
            'refactor/manual-test-orchestration',
          ],
          { env: environment },
        )

        expect(start).toMatchObject({ exitCode: 0, stderr: '' })
        expect(start.stdout).toMatch(
          /handwriting-manual-test\.mjs"? preflight --ref refactor\/manual-test-orchestration/u,
        )
        expect(stop).toMatchObject({ exitCode: 0, stderr: '' })
        expect(stop.stdout).toMatch(
          /handwriting-manual-test\.mjs"? stop --ref refactor\/manual-test-orchestration/u,
        )
      },
    )

    it.skipIf(!existsSync(powerShell.path))(
      `propagates the Node exit code with ${powerShell.name}`,
      async () => {
        const environment = {
          ...createFakeNode(),
          FAKE_NODE_EXIT_CODE: '23',
        }
        const result = await runCaptured(
          powerShell.path,
          [
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            join(scriptsDirectory, 'start-handwriting-manual-test.ps1'),
            '-PreflightOnly',
          ],
          { env: environment },
        )

        expect(result.exitCode).toBe(23)
      },
    )
  }
})
