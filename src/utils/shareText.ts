export type NativeShareResult = 'shared' | 'copied' | 'cancelled' | 'failed'

export type NativeShareInput = {
  title: string
  text: string
}

export type NativeShareDependencies = {
  share?: (data: ShareData) => Promise<void>
  writeClipboardText?: (text: string) => Promise<void>
}

export function isShareCancellation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'AbortError'
  )
}

export function isNativeShareAvailable(
  share: unknown = typeof navigator === 'undefined' ? undefined : navigator.share,
): boolean {
  return typeof share === 'function'
}

function getBrowserDependencies(): NativeShareDependencies {
  if (typeof navigator === 'undefined') {
    return {}
  }

  return {
    share:
      typeof navigator.share === 'function'
        ? navigator.share.bind(navigator)
        : undefined,
    writeClipboardText:
      typeof navigator.clipboard?.writeText === 'function'
        ? navigator.clipboard.writeText.bind(navigator.clipboard)
        : undefined,
  }
}

export async function shareText(
  input: NativeShareInput,
  dependencies: NativeShareDependencies = getBrowserDependencies(),
): Promise<NativeShareResult> {
  if (dependencies.share) {
    try {
      await dependencies.share({ title: input.title, text: input.text })
      return 'shared'
    } catch (error) {
      if (isShareCancellation(error)) {
        return 'cancelled'
      }
    }
  }

  if (!dependencies.writeClipboardText) {
    return 'failed'
  }

  try {
    await dependencies.writeClipboardText(input.text)
    return 'copied'
  } catch {
    return 'failed'
  }
}
