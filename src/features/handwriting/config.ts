export type HandwritingImportConfig = {
  enabled: boolean
  diagnosticsEnabled: boolean
  endpoint: string
  turnstileSiteKey: string
}

type HandwritingEnvironment = {
  VITE_HANDWRITING_IMPORT_ENABLED?: string
  VITE_HANDWRITING_DIAGNOSTICS_ENABLED?: string
  VITE_HANDWRITING_IMPORT_ENDPOINT?: string
  VITE_HANDWRITING_MANUAL_TEST_EXPIRES_AT?: string
  VITE_HANDWRITING_MANUAL_TEST_SESSION_ID?: string
  VITE_TURNSTILE_SITE_KEY?: string
}

function isAllowedEndpoint(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' ||
      (url.protocol === 'http:' &&
        (url.hostname === 'localhost' || url.hostname === '127.0.0.1'))
    )
  } catch {
    return false
  }
}

export function resolveHandwritingImportConfig(
  environment: HandwritingEnvironment,
  locationHref = 'https://example.invalid/',
  now = Date.now(),
): HandwritingImportConfig {
  const endpoint =
    environment.VITE_HANDWRITING_IMPORT_ENDPOINT?.trim() ?? ''
  const turnstileSiteKey =
    environment.VITE_TURNSTILE_SITE_KEY?.trim() ?? ''
  const requested =
    environment.VITE_HANDWRITING_IMPORT_ENABLED?.trim().toLowerCase() ===
    'true'
  const diagnosticsRequested =
    environment.VITE_HANDWRITING_DIAGNOSTICS_ENABLED
      ?.trim()
      .toLowerCase() === 'true'
  const manualTestSessionId =
    environment.VITE_HANDWRITING_MANUAL_TEST_SESSION_ID?.trim() ?? ''
  const manualTestExpiresAt =
    environment.VITE_HANDWRITING_MANUAL_TEST_EXPIRES_AT?.trim() ?? ''
  const isManualTestBuild = Boolean(
    manualTestSessionId || manualTestExpiresAt,
  )
  let diagnosticsQueryEnabled = false
  let manualTestAccessGranted = !isManualTestBuild
  try {
    const url = new URL(locationHref)
    diagnosticsQueryEnabled =
      url.searchParams.get('handwritingDiagnostics') === '1'
    const expiresAt = Date.parse(manualTestExpiresAt)
    manualTestAccessGranted =
      !isManualTestBuild ||
      (diagnosticsQueryEnabled &&
        Boolean(manualTestSessionId) &&
        url.searchParams.get('manualTestSessionId') ===
          manualTestSessionId &&
        !Number.isNaN(expiresAt) &&
        now < expiresAt)
  } catch {
    diagnosticsQueryEnabled = false
    manualTestAccessGranted = !isManualTestBuild
  }

  return {
    enabled:
      requested &&
      manualTestAccessGranted &&
      Boolean(turnstileSiteKey) &&
      isAllowedEndpoint(endpoint),
    diagnosticsEnabled:
      diagnosticsRequested &&
      diagnosticsQueryEnabled &&
      manualTestAccessGranted,
    endpoint,
    turnstileSiteKey,
  }
}

export function getHandwritingImportConfig(): HandwritingImportConfig {
  return resolveHandwritingImportConfig(
    import.meta.env,
    window.location.href,
    Date.now(),
  )
}
