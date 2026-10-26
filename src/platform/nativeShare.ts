import { Share, type ShareOptions } from '@capacitor/share'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import type { NativeShareInput, NativeShareResult } from '../utils/shareText'
import type { CatalogRecoveryBundle } from '../utils/catalogRecovery'

export async function presentNativeShare(options: ShareOptions): Promise<NativeShareResult> {
  try {
    await Share.share(options)
    // The OS sheet cannot prove delivery or that a backup was saved.
    return 'shared'
  } catch (error) {
    return error instanceof Error && error.message === 'Share canceled'
      ? 'cancelled' : 'failed'
  }
}

export function shareNativeText(input: NativeShareInput): Promise<NativeShareResult> {
  // Use text only to keep the established LINE message and final URL intact.
  return presentNativeShare({ title: input.title, text: input.text })
}

export async function exportNativeCatalogJson(
  bundle: Pick<CatalogRecoveryBundle, 'json' | 'fileName'>,
): Promise<NativeShareResult> {
  try {
    // Only an app-created cache file is exposed. No storage permission is needed.
    // Replace the previous export, but keep it after sharing for delayed readers.
    const { uri } = await Filesystem.writeFile({
      path: 'catalog-backups/catalog-backup.json',
      data: bundle.json,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
      recursive: true,
    })
    return await presentNativeShare({ title: bundle.fileName, files: [uri] })
  } catch {
    return 'failed'
  }
}
