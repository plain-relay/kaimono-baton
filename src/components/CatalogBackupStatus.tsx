import { useState } from 'react'
import type { HouseholdCatalogV1 } from '../types/householdCatalog'
import {
  createCatalogRecoveryBundle,
  type CatalogRecoveryBundle,
} from '../utils/catalogRecovery'
import type { CatalogBackupStatus as BackupStatus } from '../utils/catalogFingerprint'
import { shareText } from '../utils/shareText'

type CatalogBackupStatusProps = {
  catalog: HouseholdCatalogV1
  backupStatus: BackupStatus
  onConfirmBackup: (fingerprint: string) => boolean
  compact?: boolean
}

type PendingBackupConfirmation = {
  fingerprint: string
  kind: 'link' | 'json'
} | null

const RECOVERY_SHARE_TITLE = '買いものバトンの商品リスト復旧用リンク'

function getRecoveryBaseUrl(): string {
  return window.location.href.split('#', 1)[0]
}

export function downloadCatalogRecoveryJson(
  bundle: Pick<CatalogRecoveryBundle, 'fileName' | 'json'>,
): boolean {
  try {
    const blob = new Blob([bundle.json], {
      type: 'application/json;charset=utf-8',
    })
    const objectUrl = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = bundle.fileName
    anchor.click()
    URL.revokeObjectURL(objectUrl)
    return true
  } catch {
    return false
  }
}

export function CatalogBackupStatus({
  catalog,
  backupStatus,
  onConfirmBackup,
  compact = false,
}: CatalogBackupStatusProps) {
  const [isSharing, setIsSharing] = useState(false)
  const [notice, setNotice] = useState('')
  const [pendingConfirmation, setPendingConfirmation] =
    useState<PendingBackupConfirmation>(null)

  const handleSaveRecovery = async () => {
    if (isSharing) {
      return
    }
    setIsSharing(true)
    setNotice('')
    setPendingConfirmation(null)
    try {
      const bundle = createCatalogRecoveryBundle(
        getRecoveryBaseUrl(),
        catalog,
      )
      if (!bundle.isWithinUrlLimit) {
        if (!downloadCatalogRecoveryJson(bundle)) {
          setNotice(
            '復旧用JSONファイルを書き出せませんでした。ブラウザのダウンロード設定を確認してください。',
          )
          return
        }
        setNotice(
          '復旧リンクが2,200文字を超えるため、復旧用JSONファイルを書き出しました。',
        )
        setPendingConfirmation({
          fingerprint: bundle.fingerprint,
          kind: 'json',
        })
        return
      }

      const result = await shareText({
        title: RECOVERY_SHARE_TITLE,
        text: [
          '買いものバトンの商品リスト復旧用リンクです。',
          'このメッセージを削除せず保存してください。',
          '',
          bundle.url,
        ].join('\n'),
      })
      if (result === 'shared') {
        setNotice(
          '共有画面を開きました。LINEやメモを選択して復旧リンクを保存してください。',
        )
        setPendingConfirmation({
          fingerprint: bundle.fingerprint,
          kind: 'link',
        })
      } else if (result === 'copied') {
        setNotice(
          '復旧リンクをコピーしました。LINEやメモへ貼り付けて保存してください。',
        )
        setPendingConfirmation({
          fingerprint: bundle.fingerprint,
          kind: 'link',
        })
      } else if (result === 'cancelled') {
        setNotice(
          '共有をキャンセルしました。商品リストの変更は端末内に保存されています。',
        )
      } else {
        setNotice(
          '復旧リンクを共有またはコピーできませんでした。ブラウザの共有設定を確認してください。',
        )
      }
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : '復旧用データを作成できませんでした。',
      )
    } finally {
      setIsSharing(false)
    }
  }

  const handleConfirmSaved = () => {
    if (!pendingConfirmation) {
      return
    }
    if (!onConfirmBackup(pendingConfirmation.fingerprint)) {
      setNotice(
        'バックアップ済みの記録を保存できませんでした。復旧データ自体はそのまま利用できます。',
      )
      return
    }
    setPendingConfirmation(null)
    setNotice('現在の商品リストをバックアップ済みとして記録しました。')
  }

  const statusText =
    backupStatus === 'standard'
      ? '商品リストは標準状態です。'
      : backupStatus === 'backed-up'
        ? '現在の変更はバックアップ済みです。'
        : '商品リストに未バックアップの変更があります。'

  return (
    <section
      className={`info-card catalog-backup-status${compact ? ' is-compact' : ''}`}
    >
      {!compact ? <h2>復旧リンクのバックアップ</h2> : null}
      <p className="catalog-backup-state">{statusText}</p>
      {backupStatus !== 'standard' ? (
        <button
          type="button"
          className={compact ? 'ghost-button' : 'secondary-button'}
          disabled={isSharing}
          onClick={() => void handleSaveRecovery()}
        >
          {isSharing ? '復旧データを準備しています…' : '復旧リンクを保存'}
        </button>
      ) : null}

      {notice ? (
        <p className="helper-text" role="status" aria-live="polite">
          {notice}
        </p>
      ) : null}

      {pendingConfirmation ? (
        <div className="catalog-backup-confirmation">
          <p>
            {pendingConfirmation.kind === 'link'
              ? '復旧リンクをLINEやメモへ保存しましたか？'
              : '復旧用JSONファイルを安全な場所へ保存しましたか？'}
          </p>
          <div className="catalog-backup-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={handleConfirmSaved}
            >
              保存した
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                setPendingConfirmation(null)
                setNotice(
                  '未バックアップのままです。保存後にもう一度確認してください。',
                )
              }}
            >
              まだ保存していない
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
