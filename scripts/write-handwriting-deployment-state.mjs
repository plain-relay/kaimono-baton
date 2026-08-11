import { fileURLToPath } from 'node:url'
import {
  appendGitHubEnvironment,
  createDeploymentBuildEnvironment,
  createDeploymentManifest,
  writeDeploymentManifest,
} from './lib/deployment-state.mjs'

export async function main(
  command,
  {
    environment = process.env,
    now = Date.now(),
    manifestPath = fileURLToPath(
      new URL('../dist/handwriting-deployment-state.json', import.meta.url),
    ),
  } = {},
) {
  if (command === 'prepare') {
    if (!environment.GITHUB_ENV) {
      throw new Error('GITHUB_ENV is required.')
    }
    const buildEnvironment = createDeploymentBuildEnvironment({
      mode: environment.MANUAL_TEST_MODE || 'repository',
      sessionId: environment.MANUAL_TEST_SESSION_ID || '',
      repositoryImportEnabled:
        environment.REPOSITORY_HANDWRITING_IMPORT_ENABLED || 'false',
      repositoryDiagnosticsEnabled:
        environment.REPOSITORY_HANDWRITING_DIAGNOSTICS_ENABLED || 'false',
      now,
    })
    await appendGitHubEnvironment(
      environment.GITHUB_ENV,
      buildEnvironment,
    )
    return buildEnvironment
  }
  if (command === 'write') {
    const manifest = createDeploymentManifest(environment)
    await writeDeploymentManifest(manifestPath, manifest)
    return manifest
  }
  throw new Error('Expected prepare or write command.')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv[2]).catch((error) => {
    console.error(error instanceof Error ? error.message : 'Command failed.')
    process.exitCode = 1
  })
}
