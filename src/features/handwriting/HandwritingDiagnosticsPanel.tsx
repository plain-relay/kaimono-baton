import { useState } from 'react'
import type {
  HandwritingDiagnosticStage,
  HandwritingDiagnosticsStore,
  HandwritingDiagnosticsView,
} from './diagnostics'

type HandwritingDiagnosticsPanelProps = {
  store: HandwritingDiagnosticsStore
  view: HandwritingDiagnosticsView
}

function bytes(value?: number): string {
  if (typeof value !== 'number') {
    return '—'
  }
  return `${value.toLocaleString('ja-JP')} bytes`
}

function dimensions(width?: number, height?: number): string {
  return typeof width === 'number' && typeof height === 'number'
    ? `${width} × ${height}`
    : '—'
}

function valueOrDash(value?: string | number): string {
  return typeof value === 'undefined' || value === '' ? '—' : String(value)
}

const STAGE_LABELS: Record<HandwritingDiagnosticStage, string> = {
  idle: '待機',
  'file-selected': 'ファイル選択',
  'source-validated': '元画像の検証完了',
  'decode-started': '画像デコード開始',
  'decode-completed': '画像デコード完了',
  'resize-calculated': 'リサイズ寸法の計算完了',
  'canvas-render-started': 'Canvas描画開始',
  'canvas-render-completed': 'Canvas描画完了',
  'encode-started': '画像エンコード開始',
  'encode-completed': '画像エンコード完了',
  'preprocessing-completed': '画像前処理完了',
  'turnstile-load-started': 'Turnstile読み込み開始',
  'turnstile-ready': 'Turnstile準備完了',
  'turnstile-execute-started': 'Turnstileトークン取得開始',
  'turnstile-token-received': 'Turnstileトークン取得完了',
  'worker-request-started': 'Workerへの送信開始',
  'worker-response-received': 'Worker応答受信',
  'worker-response-validated': 'Worker応答検証完了',
  'confirmation-render-started': '確認画面描画開始',
  'confirmation-rendered': '確認画面描画完了',
  failed: '失敗',
  cancelled: 'キャンセル',
}

function stageLabel(stage?: HandwritingDiagnosticStage): string {
  return stage ? STAGE_LABELS[stage] : '—'
}

export function HandwritingDiagnosticsPanel({
  store,
  view,
}: HandwritingDiagnosticsPanelProps) {
  const [copyMessage, setCopyMessage] = useState('')
  const current = view.current

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(store.serialize())
      setCopyMessage('診断情報をコピーしました。')
    } catch {
      setCopyMessage('診断情報をコピーできませんでした。')
    }
  }

  const handleClear = () => {
    store.clear()
    setCopyMessage('診断情報を消去しました。')
  }

  return (
    <section
      className="handwriting-diagnostics-panel"
      aria-labelledby="handwriting-diagnostics-title"
    >
      <div className="section-heading">
        <div>
          <p className="eyebrow">手動検証専用</p>
          <h3 id="handwriting-diagnostics-title">手書き取り込み診断</h3>
        </div>
      </div>
      <dl className="handwriting-diagnostics-grid">
        <div>
          <dt>現在のstage</dt>
          <dd>{current?.stage ?? 'idle'}</dd>
        </div>
        <div>
          <dt>失敗直前</dt>
          <dd>{stageLabel(current?.failedAfterStage)}</dd>
        </div>
        <div>
          <dt>最終更新</dt>
          <dd>{valueOrDash(current?.timestamp)}</dd>
        </div>
        <div>
          <dt>経過時間</dt>
          <dd>
            {typeof current?.elapsedMs === 'number'
              ? `${current.elapsedMs} ms`
              : '—'}
          </dd>
        </div>
        <div>
          <dt>元画像サイズ</dt>
          <dd>{bytes(current?.sourceImageBytes)}</dd>
        </div>
        <div>
          <dt>デコード寸法</dt>
          <dd>
            {dimensions(current?.decodedWidth, current?.decodedHeight)}
          </dd>
        </div>
        <div>
          <dt>リサイズ寸法</dt>
          <dd>
            {dimensions(current?.resizedWidth, current?.resizedHeight)}
          </dd>
        </div>
        <div>
          <dt>出力サイズ</dt>
          <dd>{bytes(current?.encodedBytes)}</dd>
        </div>
        <div>
          <dt>requestId</dt>
          <dd className="handwriting-diagnostics-request-id">
            {valueOrDash(current?.requestId)}
          </dd>
        </div>
        <div>
          <dt>Worker HTTP status</dt>
          <dd>{valueOrDash(current?.httpStatus)}</dd>
        </div>
        <div>
          <dt>安全なエラーコード</dt>
          <dd>
            {valueOrDash(current?.workerErrorCode ?? current?.errorCode)}
          </dd>
        </div>
        <div>
          <dt>結果件数</dt>
          <dd>
            {typeof current?.resultItemCount === 'number'
              ? `${current.resultItemCount}件（matched ${
                  current.matchedCount ?? 0
                } / ambiguous ${current.ambiguousCount ?? 0} / unknown ${
                  current.unknownCount ?? 0
                }）`
              : '—'}
          </dd>
        </div>
        <div>
          <dt>前回セッションの最終stage</dt>
          <dd>{view.previous?.stage ?? '—'}</dd>
        </div>
      </dl>
      <div className="handwriting-diagnostics-actions">
        <button type="button" className="ghost-button" onClick={handleCopy}>
          診断情報をコピー
        </button>
        <button type="button" className="ghost-button" onClick={handleClear}>
          診断情報を消去
        </button>
      </div>
      {copyMessage ? (
        <p className="handwriting-diagnostics-message" aria-live="polite">
          {copyMessage}
        </p>
      ) : null}
    </section>
  )
}
