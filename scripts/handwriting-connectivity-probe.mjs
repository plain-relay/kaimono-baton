import { fileURLToPath } from 'node:url'
import {
  HandwritingConnectivityProbeError,
  probeHandwritingConnectivity,
  readHandwritingProbeEndpoint,
} from './lib/handwriting-connectivity-probe.mjs'
import { runCaptured } from './lib/native-command.mjs'

const scriptPath = fileURLToPath(import.meta.url)

export async function runHandwritingConnectivityProbe({
  runCapturedImplementation = runCaptured,
  fetchImplementation = fetch,
  write = console.log,
  writeError = console.error,
} = {}) {
  try {
    const endpoint = await readHandwritingProbeEndpoint({
      runCaptured: runCapturedImplementation,
    })
    const result = await probeHandwritingConnectivity(endpoint, {
      fetchImplementation,
    })

    write('HANDWRITING CONNECTIVITY PROBE PASSED')
    write(`Endpoint: ${result.endpoint}`)
    write(`HTTP status: ${result.httpStatus}`)
    write(`CORS origin: ${result.corsOrigin}`)
    write('Exposed request ID header: present and valid')
    write(`Response code: ${result.responseCode}`)
    write(`Elapsed time: ${result.elapsedMs} ms`)
    write('State-changing operations: none')
    return 0
  } catch (error) {
    const reason =
      error instanceof HandwritingConnectivityProbeError
        ? error.reason
        : 'unexpected-failure'
    writeError('HANDWRITING CONNECTIVITY PROBE FAILED')
    writeError(`Reason: ${reason}`)
    return 1
  }
}

if (process.argv[1] === scriptPath) {
  runHandwritingConnectivityProbe().then((exitCode) => {
    process.exitCode = exitCode
  })
}
