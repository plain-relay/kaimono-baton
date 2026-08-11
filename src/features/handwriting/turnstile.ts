import { HandwritingImportError, isAbortError } from './errors'
import type { HandwritingDiagnosticsReporter } from './diagnostics'

type TurnstileWidgetId = string

type TurnstileRenderOptions = {
  sitekey: string
  action: string
  execution: 'execute'
  appearance: 'interaction-only'
  callback: (token: string) => void
  'error-callback': () => void
  'expired-callback': () => void
  'timeout-callback': () => void
  'unsupported-callback': () => void
  'response-field': false
}

export type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: TurnstileRenderOptions,
  ) => TurnstileWidgetId
  execute: (widgetId: TurnstileWidgetId) => void
  reset: (widgetId: TurnstileWidgetId) => void
  remove: (widgetId: TurnstileWidgetId) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

export interface TurnstileTokenProvider {
  getToken(options?: { signal?: AbortSignal }): Promise<string>
  reset(): void
  dispose(): void
}

export type TurnstileClientDiagnosticStage =
  | 'turnstile-load-started'
  | 'turnstile-ready'
  | 'turnstile-execute-started'
  | 'turnstile-token-received'
  | 'turnstile-token-failed'

export interface TurnstileClientDiagnosticsReporter {
  record(stage: TurnstileClientDiagnosticStage): void
}

type PendingToken = {
  resolve: (token: string) => void
  reject: (error: unknown) => void
  cleanup: () => void
}

const TURNSTILE_SCRIPT_ID = 'otsukai-turnstile-api'
const TURNSTILE_SCRIPT_URL =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
let scriptLoadPromise: Promise<TurnstileApi> | undefined

function loadTurnstileApi(): Promise<TurnstileApi> {
  if (window.turnstile) {
    return Promise.resolve(window.turnstile)
  }
  if (scriptLoadPromise) {
    return scriptLoadPromise
  }

  scriptLoadPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const existing = document.getElementById(
      TURNSTILE_SCRIPT_ID,
    ) as HTMLScriptElement | null
    const script = existing ?? document.createElement('script')
    const handleLoad = () => {
      cleanup()
      if (window.turnstile) {
        resolve(window.turnstile)
      } else {
        scriptLoadPromise = undefined
        reject(new HandwritingImportError('auth-failed'))
      }
    }
    const handleError = () => {
      cleanup()
      scriptLoadPromise = undefined
      reject(new HandwritingImportError('auth-failed'))
    }
    const cleanup = () => {
      script.removeEventListener('load', handleLoad)
      script.removeEventListener('error', handleError)
    }

    script.addEventListener('load', handleLoad, { once: true })
    script.addEventListener('error', handleError, { once: true })
    if (!existing) {
      script.id = TURNSTILE_SCRIPT_ID
      script.src = TURNSTILE_SCRIPT_URL
      script.async = true
      script.defer = true
      document.head.append(script)
    }
  })
  return scriptLoadPromise
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError')
}

async function withAbort<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) {
    return promise
  }
  if (signal.aborted) {
    throw abortError()
  }
  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => {
      cleanup()
      reject(abortError())
    }
    const cleanup = () => signal.removeEventListener('abort', handleAbort)
    signal.addEventListener('abort', handleAbort, { once: true })
    promise.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error: unknown) => {
        cleanup()
        reject(error)
      },
    )
  })
}

export class BrowserTurnstileTokenProvider
  implements TurnstileTokenProvider
{
  private api?: TurnstileApi
  private widgetId?: TurnstileWidgetId
  private pending?: PendingToken
  private disposed = false

  constructor(
    private readonly container: HTMLElement,
    private readonly siteKey: string,
    private readonly apiLoader: () => Promise<TurnstileApi> =
      loadTurnstileApi,
    private readonly diagnostics?: HandwritingDiagnosticsReporter,
    private readonly action = 'handwriting_import',
    private readonly clientDiagnostics?: TurnstileClientDiagnosticsReporter,
  ) {}

  private recordClientStage(stage: TurnstileClientDiagnosticStage): void {
    try {
      this.clientDiagnostics?.record(stage)
    } catch {
      // Diagnostics must never change the authentication flow.
    }
  }

  private recordStage(
    stage: Exclude<TurnstileClientDiagnosticStage, 'turnstile-token-failed'>,
  ): void {
    this.diagnostics?.record(stage)
    this.recordClientStage(stage)
  }

  private finishPending(error?: unknown, token?: string): void {
    const pending = this.pending
    this.pending = undefined
    if (!pending) {
      return
    }
    pending.cleanup()
    if (typeof token === 'string' && token) {
      this.recordStage('turnstile-token-received')
      pending.resolve(token)
    } else {
      pending.reject(error ?? new HandwritingImportError('auth-failed'))
    }
  }

  private ensureWidget(api: TurnstileApi): TurnstileWidgetId {
    if (this.widgetId) {
      return this.widgetId
    }
    try {
      this.widgetId = api.render(this.container, {
        sitekey: this.siteKey,
        action: this.action,
        execution: 'execute',
        appearance: 'interaction-only',
        callback: (token) => this.finishPending(undefined, token),
        'error-callback': () =>
          this.finishPending(new HandwritingImportError('auth-failed')),
        'expired-callback': () =>
          this.finishPending(new HandwritingImportError('auth-failed')),
        'timeout-callback': () =>
          this.finishPending(new HandwritingImportError('auth-failed')),
        'unsupported-callback': () =>
          this.finishPending(new HandwritingImportError('auth-failed')),
        'response-field': false,
      })
    } catch (error) {
      throw new HandwritingImportError('auth-failed', error)
    }
    if (!this.widgetId) {
      throw new HandwritingImportError('auth-failed')
    }
    return this.widgetId
  }

  async getToken(options: { signal?: AbortSignal } = {}): Promise<string> {
    if (this.disposed || this.pending) {
      throw new HandwritingImportError('auth-failed')
    }
    try {
      this.recordStage('turnstile-load-started')
      const api = await withAbort(this.apiLoader(), options.signal)
      if (options.signal?.aborted) {
        throw abortError()
      }
      if (this.disposed) {
        throw new HandwritingImportError('auth-failed')
      }
      this.api = api
      this.recordStage('turnstile-ready')
      const widgetId = this.ensureWidget(api)

      return await new Promise<string>((resolve, reject) => {
        if (options.signal?.aborted) {
          reject(abortError())
          return
        }
        const handleAbort = () => this.finishPending(abortError())
        options.signal?.addEventListener('abort', handleAbort, { once: true })
        this.pending = {
          resolve,
          reject,
          cleanup: () =>
            options.signal?.removeEventListener('abort', handleAbort),
        }
        try {
          this.recordStage('turnstile-execute-started')
          api.execute(widgetId)
        } catch (error) {
          this.finishPending(new HandwritingImportError('auth-failed', error))
        }
      })
    } catch (error) {
      if (isAbortError(error)) {
        throw error
      }
      this.recordClientStage('turnstile-token-failed')
      throw error instanceof HandwritingImportError
        ? error
        : new HandwritingImportError('auth-failed')
    }
  }

  reset(): void {
    this.finishPending(abortError())
    if (this.api && this.widgetId) {
      this.api.reset(this.widgetId)
    }
  }

  dispose(): void {
    this.disposed = true
    this.finishPending(abortError())
    if (this.api && this.widgetId) {
      this.api.remove(this.widgetId)
    }
    this.widgetId = undefined
  }
}
