export const LINE_EXTERNAL_BROWSER_PARAMETER = 'openExternalBrowser'
export const LINE_EXTERNAL_BROWSER_VALUE = '1'

export function addLineExternalBrowserHint(requestUrl: string): string {
  const url = new URL(requestUrl)
  url.searchParams.set(
    LINE_EXTERNAL_BROWSER_PARAMETER,
    LINE_EXTERNAL_BROWSER_VALUE,
  )
  return url.toString()
}

export function buildLineDeliveryRequestUrl(compactRequestUrl: string): string {
  return addLineExternalBrowserHint(compactRequestUrl)
}
