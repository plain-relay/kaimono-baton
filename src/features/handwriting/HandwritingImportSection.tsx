import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { EffectiveProduct } from '../../types/householdCatalog'
import { createId } from '../../utils/id'
import type { HandwritingImportApplyReason } from './applyImport'
import type { HandwritingImportConfig } from './config'
import {
  HandwritingImportError,
  isAbortError,
  toHandwritingErrorMessage,
} from './errors'
import { GeminiHandwritingImportProvider } from './GeminiHandwritingImportProvider'
import {
  MAX_HANDWRITING_SOURCE_IMAGE_BYTES,
  preprocessHandwritingImage,
  type ImagePreprocessOptions,
} from './imagePreprocessing'
import {
  HandwritingImagePicker,
  type HandwritingImagePreview,
} from './HandwritingImagePicker'
import { buildImportProductCandidates } from './productCandidates'
import { parseHandwritingImportResult } from './resultValidation'
import {
  BrowserTurnstileTokenProvider,
  type TurnstileTokenProvider,
} from './turnstile'
import {
  createHandwritingDiagnosticsStore,
  createHandwritingRequestId,
} from './diagnostics'
import { HandwritingDiagnosticsPanel } from './HandwritingDiagnosticsPanel'
import type {
  HandwritingAnalyzedItem,
  HandwritingImportProvider,
  HandwritingImportSelection,
  ImportProductCandidate,
} from './types'

type HandwritingImportPhase =
  | 'idle'
  | 'previewing'
  | 'preparing'
  | 'analyzing'
  | 'confirmation'
  | 'failed'

type ApplySelectionsResult = {
  accepted: boolean
  changedItemCount: number
  reason?: HandwritingImportApplyReason
}

type DisplayItem = {
  id: string
  analysis: HandwritingAnalyzedItem
}

type HandwritingImportSectionProps = {
  config: HandwritingImportConfig
  effectiveProducts: readonly EffectiveProduct[]
  onApplySelections: (
    selections: readonly HandwritingImportSelection[],
  ) => ApplySelectionsResult
  importProvider?: HandwritingImportProvider
  preprocessImage?: (
    file: File,
    options?: ImagePreprocessOptions,
  ) => Promise<Blob>
  createCustomItemId?: () => string
  createPreviewUrl?: (file: File) => string
  revokePreviewUrl?: (url: string) => void
}

const SUPPORTED_PREVIEW_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
])

function defaultCreatePreviewUrl(file: File): string {
  return URL.createObjectURL(file)
}

function defaultRevokePreviewUrl(url: string): void {
  URL.revokeObjectURL(url)
}

function productName(
  productId: string,
  productsById: ReadonlyMap<string, ImportProductCandidate>,
): string {
  return productsById.get(productId)?.name ?? '候補を確認できません'
}

function candidateIds(item: HandwritingAnalyzedItem): string[] {
  if (item.status === 'matched' && item.productId) {
    return [item.productId]
  }
  return item.candidateProductIds
}

function candidateSummary(
  item: HandwritingAnalyzedItem,
  productsById: ReadonlyMap<string, ImportProductCandidate>,
): string {
  const names = candidateIds(item).map((id) => productName(id, productsById))
  return names.length > 0 ? names.join('、') : '候補なし'
}

function selectedChoiceLabel(
  item: HandwritingAnalyzedItem,
  choice: string,
  productsById: ReadonlyMap<string, ImportProductCandidate>,
): string {
  if (choice === 'custom') {
    return `リストにないものとして「${item.sourceText}」を追加`
  }
  if (choice.startsWith('product:')) {
    return productName(choice.slice('product:'.length), productsById)
  }
  return '無視'
}

function applyFailureMessage(reason?: HandwritingImportApplyReason): string {
  if (reason === 'invalid-selection') {
    return '選択内容を確認できませんでした。候補を選び直してください。'
  }
  return '依頼上限により追加できません。現在の依頼内容は変更していません。'
}

function orderedProductChoices(
  item: HandwritingAnalyzedItem,
  products: readonly ImportProductCandidate[],
): ImportProductCandidate[] {
  const preferredIds = candidateIds(item)
  const preferred = new Set(preferredIds)
  const productsById = new Map(products.map((product) => [product.id, product]))
  return [
    ...preferredIds
      .map((id) => productsById.get(id))
      .filter((product): product is ImportProductCandidate => Boolean(product)),
    ...products.filter((product) => !preferred.has(product.id)),
  ]
}

export function HandwritingImportSection({
  config,
  effectiveProducts,
  onApplySelections,
  importProvider,
  preprocessImage = preprocessHandwritingImage,
  createCustomItemId = () => createId('custom'),
  createPreviewUrl = defaultCreatePreviewUrl,
  revokePreviewUrl = defaultRevokePreviewUrl,
}: HandwritingImportSectionProps) {
  const turnstileContainerRef = useRef<HTMLDivElement>(null)
  const abortControllerRef = useRef<AbortController>()
  const previewUrlRef = useRef<string>()
  const diagnosticsStore = useMemo(
    () =>
      createHandwritingDiagnosticsStore(config.diagnosticsEnabled),
    [config.diagnosticsEnabled],
  )
  const [diagnosticsView, setDiagnosticsView] = useState(() =>
    diagnosticsStore.getView(),
  )
  const [defaultProvider, setDefaultProvider] =
    useState<HandwritingImportProvider>()
  const [phase, setPhase] = useState<HandwritingImportPhase>('idle')
  const [preview, setPreview] = useState<HandwritingImagePreview>()
  const [items, setItems] = useState<DisplayItem[]>([])
  const [choices, setChoices] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')
  const [dialogError, setDialogError] = useState('')
  const productCandidates = useMemo(
    () => buildImportProductCandidates(effectiveProducts),
    [effectiveProducts],
  )
  const productsById = useMemo(
    () =>
      new Map(
        productCandidates.map((product) => [product.id, product]),
      ),
    [productCandidates],
  )
  const releasePreviewUrl = useCallback(() => {
    const currentUrl = previewUrlRef.current
    if (!currentUrl) {
      return
    }
    previewUrlRef.current = undefined
    revokePreviewUrl(currentUrl)
  }, [revokePreviewUrl])

  const clearPreview = useCallback(() => {
    releasePreviewUrl()
    setPreview(undefined)
  }, [releasePreviewUrl])

  useEffect(() => {
    setDiagnosticsView(diagnosticsStore.getView())
    return diagnosticsStore.subscribe(setDiagnosticsView)
  }, [diagnosticsStore])

  useEffect(() => {
    if (
      !config.enabled ||
      importProvider ||
      !turnstileContainerRef.current
    ) {
      return
    }
    const turnstile: TurnstileTokenProvider =
      new BrowserTurnstileTokenProvider(
        turnstileContainerRef.current,
        config.turnstileSiteKey,
        undefined,
        diagnosticsStore,
      )
    setDefaultProvider(
      new GeminiHandwritingImportProvider(
        config.endpoint,
        turnstile,
        fetch,
        diagnosticsStore,
      ),
    )

    return () => {
      turnstile.dispose()
    }
  }, [
    config.enabled,
    config.endpoint,
    config.turnstileSiteKey,
    diagnosticsStore,
    importProvider,
  ])

  useEffect(() => {
    if (phase === 'confirmation' && items.length > 0) {
      diagnosticsStore.record('confirmation-rendered')
    }
  }, [diagnosticsStore, items.length, phase])

  useEffect(
    () => () => {
      abortControllerRef.current?.abort()
      releasePreviewUrl()
    },
    [releasePreviewUrl],
  )

  if (!config.enabled) {
    return null
  }

  const provider = importProvider ?? defaultProvider
  const isProcessing =
    phase === 'preparing' || phase === 'analyzing'

  const handleFileChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const input = event.currentTarget
    const file = input.files?.[0]
    input.value = ''
    if (!file || abortControllerRef.current || isProcessing) {
      return
    }

    releasePreviewUrl()
    setPreview(undefined)
    setItems([])
    setChoices({})
    setMessage('')
    setDialogError('')

    if (
      !SUPPORTED_PREVIEW_MIME_TYPES.has(file.type) ||
      file.size > MAX_HANDWRITING_SOURCE_IMAGE_BYTES
    ) {
      const error = new HandwritingImportError(
        file.size > MAX_HANDWRITING_SOURCE_IMAGE_BYTES
          ? 'image-too-large'
          : 'unsupported-image',
      )
      setMessage(toHandwritingErrorMessage(error))
      setPhase('failed')
      return
    }

    try {
      const objectUrl = createPreviewUrl(file)
      previewUrlRef.current = objectUrl
      setPreview({
        file,
        objectUrl,
        mime: file.type,
        sizeBytes: file.size,
        decodeFailed: false,
      })
      setPhase('previewing')
    } catch {
      setMessage(
        toHandwritingErrorMessage(
          new HandwritingImportError('request-invalid'),
        ),
      )
      setPhase('failed')
    }
  }

  const handlePreviewLoad = (
    objectUrl: string,
    width: number,
    height: number,
  ) => {
    if (width <= 0 || height <= 0) {
      return
    }
    setPreview((current) =>
      current?.objectUrl === objectUrl
        ? { ...current, width, height, decodeFailed: false }
        : current,
    )
  }

  const handlePreviewError = (objectUrl: string) => {
    setPreview((current) =>
      current?.objectUrl === objectUrl
        ? {
            ...current,
            width: undefined,
            height: undefined,
            decodeFailed: true,
          }
        : current,
    )
  }

  const handlePreviewCancel = () => {
    if (isProcessing) {
      return
    }
    clearPreview()
    setMessage('')
    setDialogError('')
    setPhase('idle')
  }

  const handleStartAnalysis = async () => {
    if (
      phase !== 'previewing' ||
      !preview ||
      preview.decodeFailed ||
      !preview.width ||
      !preview.height ||
      !provider ||
      abortControllerRef.current
    ) {
      return
    }

    const file = preview.file
    clearPreview()
    const controller = new AbortController()
    const requestId = createHandwritingRequestId()
    abortControllerRef.current = controller
    diagnosticsStore.begin({
      requestId,
      sourceImageBytes: file.size,
      sourceMime: file.type,
    })
    setItems([])
    setChoices({})
    setMessage('')
    setDialogError('')
    setPhase('preparing')

    try {
      const image = await preprocessImage(file, {
        signal: controller.signal,
        adjustment: { mode: 'none' },
        diagnostics: diagnosticsStore,
      })
      if (controller.signal.aborted) {
        throw new HandwritingImportError('cancelled')
      }
      setPhase('analyzing')
      const rawResult = await provider.analyze(
        image,
        productCandidates,
        { signal: controller.signal, requestId },
      )
      const result = parseHandwritingImportResult(
        rawResult,
        productCandidates,
      )
      if (!result) {
        throw new HandwritingImportError('invalid-analysis-response')
      }
      if (result.items.length === 0) {
        throw new HandwritingImportError('no-products-detected')
      }

      const nextItems = result.items.map((analysis, index) => ({
        id: `analysis-item-${index + 1}`,
        analysis,
      }))
      diagnosticsStore.record('confirmation-render-started', {
        resultItemCount: result.items.length,
        matchedCount: result.items.filter(
          (item) => item.status === 'matched',
        ).length,
        ambiguousCount: result.items.filter(
          (item) => item.status === 'ambiguous',
        ).length,
        unknownCount: result.items.filter(
          (item) => item.status === 'unknown',
        ).length,
      })
      setItems(nextItems)
      setChoices(
        Object.fromEntries(
          nextItems.map(({ id, analysis }) => [
            id,
            analysis.status === 'matched' && analysis.productId
              ? `product:${analysis.productId}`
              : 'ignore',
          ]),
        ),
      )
      setPhase('confirmation')
    } catch (error) {
      const diagnosticError =
        isAbortError(error)
          ? new HandwritingImportError('cancelled')
          : error instanceof HandwritingImportError
            ? error
            : new HandwritingImportError('service-unavailable')
      diagnosticsStore.record(
        diagnosticError.code === 'cancelled' ? 'cancelled' : 'failed',
        { errorCode: diagnosticError.code },
      )
      setMessage(
        toHandwritingErrorMessage(diagnosticError),
      )
      setPhase('failed')
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = undefined
      }
    }
  }

  const selectedCount = Object.values(choices).filter(
    (choice) => choice !== 'ignore',
  ).length

  const handleApply = () => {
    const selections: HandwritingImportSelection[] = []
    for (const { id, analysis } of items) {
      const choice = choices[id] ?? 'ignore'
      if (choice === 'custom') {
        selections.push({
          itemId: id,
          kind: 'custom',
          name: analysis.sourceText,
          customItemId: createCustomItemId(),
        })
      } else if (choice.startsWith('product:')) {
        const productId = choice.slice('product:'.length)
        if (productsById.has(productId)) {
          selections.push({
            itemId: id,
            kind: 'product',
            productId,
          })
        }
      }
    }

    const result = onApplySelections(selections)
    if (!result.accepted) {
      setDialogError(applyFailureMessage(result.reason))
      return
    }
    setDialogError('')
    setItems([])
    setChoices({})
    setPhase('idle')
    setMessage(
      result.changedItemCount > 0
        ? `${result.changedItemCount}件の商品を依頼へ追加しました。`
        : '選択した商品はすでに依頼へ追加されています。',
    )
  }

  const closeConfirmation = () => {
    setItems([])
    setChoices({})
    setDialogError('')
    setPhase('idle')
  }

  return (
    <>
      <section
        className="info-card handwriting-import-section"
        data-handwriting-phase={phase}
      >
        <div className="section-heading handwriting-import-heading">
          <div>
            <p className="eyebrow">画像から商品候補を選ぶ</p>
            <h2>手書きメモから追加</h2>
          </div>
        </div>
        <p className="helper-text">
          手書きメモの写真から商品名を読み取り、
          <br />
          商品リストにある商品を候補として表示します。
          <br />
          <br />
          個数や条件は読み取りません。
          <br />
          結果を確認してから依頼へ追加してください。
        </p>
        <p className="helper-text handwriting-privacy-note">
          読み取りのため、画像と商品候補をGoogle Geminiへ送信します。
          <br />
          画像はこのアプリやWorkerには保存しません。
          <br />
          無料枠では、送信内容がGoogleのサービス改善に使用される場合があります。
        </p>

        <p className="handwriting-form-link">
          <a
            href={`${import.meta.env.BASE_URL}handwriting-form-v1.html`}
            target="_blank"
            rel="noreferrer"
          >
            印刷用フォームを開く
          </a>
        </p>

        <HandwritingImagePicker
          preview={preview}
          disabled={isProcessing}
          analysisReady={Boolean(provider)}
          onFileChange={handleFileChange}
          onPreviewLoad={handlePreviewLoad}
          onPreviewError={handlePreviewError}
          onStart={() => void handleStartAnalysis()}
          onCancel={handlePreviewCancel}
        />

        {isProcessing ? (
          <div className="handwriting-progress" aria-live="polite">
            <p>
              {phase === 'preparing'
                ? '画像を準備中'
                : 'メモを分析中'}
            </p>
            <button
              type="button"
              className="ghost-button"
              onClick={() => abortControllerRef.current?.abort()}
            >
              キャンセル
            </button>
          </div>
        ) : null}

        {message ? (
          <p className="handwriting-message" role="status">
            {message}
          </p>
        ) : null}

        <div
          ref={turnstileContainerRef}
          className="handwriting-turnstile"
          aria-label="認証確認"
        />
        {config.diagnosticsEnabled ? (
          <HandwritingDiagnosticsPanel
            store={diagnosticsStore}
            view={diagnosticsView}
          />
        ) : null}
      </section>

      {phase === 'confirmation' && items.length > 0 ? (
        <div className="dialog-backdrop">
          <section
            className="dialog-card handwriting-confirmation"
            role="dialog"
            aria-modal="true"
            aria-labelledby="handwriting-confirmation-title"
          >
            <div className="section-heading">
              <div>
                <p className="eyebrow">追加前の確認</p>
                <h2 id="handwriting-confirmation-title">
                  読み取った商品を確認
                </h2>
              </div>
              <span>{items.length}件</span>
            </div>
            <p className="helper-text">
              一意に対応した商品だけを選択済みにしています。
              複数候補は内容を確認して選んでください。
            </p>

            <div className="handwriting-match-list">
              {items.map(({ id, analysis }) => {
                const choice = choices[id] ?? 'ignore'
                return (
                  <article
                    key={id}
                    className="handwriting-match-card"
                  >
                    <p>
                      メモから読み取った内容：
                      <strong>{analysis.sourceText}</strong>
                    </p>
                    <p className="helper-text">
                      商品候補：
                      {candidateSummary(analysis, productsById)}
                    </p>
                    <label>
                      <span>候補を選択</span>
                      <select
                        value={choice}
                        onChange={(event) =>
                          setChoices((current) => ({
                            ...current,
                            [id]: event.target.value,
                          }))
                        }
                        aria-label={`${analysis.sourceText}の候補を選択`}
                      >
                        <option value="ignore">無視</option>
                        {orderedProductChoices(
                          analysis,
                          productCandidates,
                        ).map((product) => (
                          <option
                            key={product.id}
                            value={`product:${product.id}`}
                          >
                            {product.name}
                          </option>
                        ))}
                        <option value="custom">
                          リストにないものとして追加
                        </option>
                      </select>
                    </label>
                    <p className="handwriting-selection-state">
                      選択状態：
                      {selectedChoiceLabel(
                        analysis,
                        choice,
                        productsById,
                      )}
                    </p>
                    {choice === 'custom' ? (
                      <p className="helper-text">
                        単位は仮に個です。追加後に変更できます。
                      </p>
                    ) : null}
                  </article>
                )
              })}
            </div>

            {dialogError ? (
              <p className="handwriting-dialog-error" role="alert">
                {dialogError}
              </p>
            ) : null}

            <div className="dialog-actions">
              <button
                type="button"
                className="ghost-button"
                onClick={closeConfirmation}
              >
                確認を閉じる
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={selectedCount === 0}
                onClick={handleApply}
              >
                選択した商品を追加
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  )
}
