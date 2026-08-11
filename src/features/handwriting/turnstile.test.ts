// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'
import {
  BrowserTurnstileTokenProvider,
  type TurnstileApi,
} from './turnstile'

function createApi(
  executeImplementation: (
    options: Parameters<TurnstileApi['render']>[1],
  ) => void,
) {
  let renderOptions:
    | Parameters<TurnstileApi['render']>[1]
    | undefined
  const api: TurnstileApi = {
    render: vi.fn((_container, options) => {
      renderOptions = options
      return 'widget-id'
    }),
    execute: vi.fn(() => {
      if (!renderOptions) {
        throw new Error('Widget was not rendered')
      }
      executeImplementation(renderOptions)
    }),
    reset: vi.fn(),
    remove: vi.fn(),
  }
  return api
}

describe('BrowserTurnstileTokenProvider', () => {
  it('uses explicit execution with the import action and resets after use', async () => {
    const api = createApi((options) => options.callback('one-use-token'))
    const container = document.createElement('div')
    const record = vi.fn()
    const clientRecord = vi.fn()
    const provider = new BrowserTurnstileTokenProvider(
      container,
      'site-key',
      async () => api,
      {
        enabled: true,
        record,
        adoptRequestId: vi.fn(),
      },
      'handwriting_import',
      { record: clientRecord },
    )

    await expect(provider.getToken()).resolves.toBe('one-use-token')
    expect(api.render).toHaveBeenCalledWith(
      container,
      expect.objectContaining({
        sitekey: 'site-key',
        action: 'handwriting_import',
        execution: 'execute',
        appearance: 'interaction-only',
        'response-field': false,
      }),
    )
    expect(api.execute).toHaveBeenCalledWith('widget-id')
    expect(record.mock.calls.map(([stage]) => stage)).toEqual([
      'turnstile-load-started',
      'turnstile-ready',
      'turnstile-execute-started',
      'turnstile-token-received',
    ])
    expect(JSON.stringify(record.mock.calls)).not.toContain(
      'one-use-token',
    )
    expect(clientRecord.mock.calls.map(([stage]) => stage)).toEqual([
      'turnstile-load-started',
      'turnstile-ready',
      'turnstile-execute-started',
      'turnstile-token-received',
    ])
    expect(JSON.stringify(clientRecord.mock.calls)).not.toContain(
      'one-use-token',
    )
    provider.reset()
    expect(api.reset).toHaveBeenCalledWith('widget-id')
  })

  it('supports an isolated action for another Worker route', async () => {
    const api = createApi((options) => options.callback('photo-token'))
    const container = document.createElement('div')
    const provider = new BrowserTurnstileTokenProvider(
      container,
      'site-key',
      async () => api,
      undefined,
      'product_photo_upload',
    )

    await expect(provider.getToken()).resolves.toBe('photo-token')
    expect(api.render).toHaveBeenCalledWith(
      container,
      expect.objectContaining({ action: 'product_photo_upload' }),
    )
  })

  it('rejects an aborted challenge and allows a reset for the next request', async () => {
    const api = createApi(() => undefined)
    const provider = new BrowserTurnstileTokenProvider(
      document.createElement('div'),
      'site-key',
      async () => api,
    )
    const controller = new AbortController()
    const token = provider.getToken({ signal: controller.signal })
    await vi.waitFor(() => expect(api.execute).toHaveBeenCalledWith('widget-id'))
    controller.abort()

    await expect(token).rejects.toMatchObject({ name: 'AbortError' })
    provider.reset()
    expect(api.reset).toHaveBeenCalledWith('widget-id')
  })

  it.each([
    'error-callback',
    'timeout-callback',
    'unsupported-callback',
  ] as const)('maps %s without returning a token', async (callbackName) => {
    const api = createApi((options) => options[callbackName]())
    const record = vi.fn()
    const provider = new BrowserTurnstileTokenProvider(
      document.createElement('div'),
      'site-key',
      async () => api,
      undefined,
      'product_photo_upload',
      { record },
    )
    await expect(provider.getToken()).rejects.toMatchObject({
      code: 'auth-failed',
    })
    expect(record.mock.calls.map(([stage]) => stage)).toEqual([
      'turnstile-load-started',
      'turnstile-ready',
      'turnstile-execute-started',
      'turnstile-token-failed',
    ])
  })

  it('records a loader failure without exposing the native error', async () => {
    const record = vi.fn()
    const provider = new BrowserTurnstileTokenProvider(
      document.createElement('div'),
      'site-key',
      async () => {
        throw new Error('private loader detail')
      },
      undefined,
      'product_photo_upload',
      { record },
    )

    await expect(provider.getToken()).rejects.toMatchObject({
      code: 'auth-failed',
    })
    expect(record.mock.calls).toEqual([
      ['turnstile-load-started'],
      ['turnstile-token-failed'],
    ])
    expect(JSON.stringify(record.mock.calls)).not.toContain(
      'private loader detail',
    )
  })

  it('removes its widget on disposal', async () => {
    const api = createApi((options) => options.callback('token'))
    const provider = new BrowserTurnstileTokenProvider(
      document.createElement('div'),
      'site-key',
      async () => api,
    )
    await provider.getToken()
    provider.dispose()
    expect(api.remove).toHaveBeenCalledWith('widget-id')
    await expect(provider.getToken()).rejects.toMatchObject({
      code: 'auth-failed',
    })
  })

  it('loads the official explicit-rendering script when no API is present', async () => {
    delete window.turnstile
    document.getElementById('otsukai-turnstile-api')?.remove()
    const api = createApi((options) => options.callback('script-token'))
    const append = vi
      .spyOn(document.head, 'append')
      .mockImplementation(() => undefined)
    const provider = new BrowserTurnstileTokenProvider(
      document.createElement('div'),
      'site-key',
    )
    const token = provider.getToken()

    await vi.waitFor(() => expect(append).toHaveBeenCalledTimes(1))
    const script = append.mock.calls[0][0] as HTMLScriptElement
    expect(script.src).toBe(
      'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
    )
    window.turnstile = api
    script.dispatchEvent(new Event('load'))

    await expect(token).resolves.toBe('script-token')
    provider.dispose()
    delete window.turnstile
    script.remove()
  })

  it('cancels while the Turnstile API loader is still pending', async () => {
    let resolveApi: (api: TurnstileApi) => void = () => undefined
    const apiPromise = new Promise<TurnstileApi>((resolve) => {
      resolveApi = resolve
    })
    const api = createApi((options) => options.callback('late-token'))
    const provider = new BrowserTurnstileTokenProvider(
      document.createElement('div'),
      'site-key',
      () => apiPromise,
    )
    const controller = new AbortController()
    const token = provider.getToken({ signal: controller.signal })
    controller.abort()

    await expect(token).rejects.toMatchObject({ name: 'AbortError' })
    resolveApi(api)
    provider.dispose()
  })

  it('maps render and execute exceptions to authentication failure', async () => {
    const renderRecord = vi.fn()
    const renderFailure: TurnstileApi = {
      render: vi.fn(() => {
        throw new Error('render detail')
      }),
      execute: vi.fn(),
      reset: vi.fn(),
      remove: vi.fn(),
    }
    const renderProvider = new BrowserTurnstileTokenProvider(
      document.createElement('div'),
      'site-key',
      async () => renderFailure,
      undefined,
      'product_photo_upload',
      { record: renderRecord },
    )
    await expect(renderProvider.getToken()).rejects.toMatchObject({
      code: 'auth-failed',
    })
    expect(renderRecord.mock.calls).toEqual([
      ['turnstile-load-started'],
      ['turnstile-ready'],
      ['turnstile-token-failed'],
    ])

    const executeFailure = createApi(() => undefined)
    const executeRecord = vi.fn()
    vi.mocked(executeFailure.execute).mockImplementation(() => {
      throw new Error('execute detail')
    })
    const executeProvider = new BrowserTurnstileTokenProvider(
      document.createElement('div'),
      'site-key',
      async () => executeFailure,
      undefined,
      'product_photo_upload',
      { record: executeRecord },
    )
    await expect(executeProvider.getToken()).rejects.toMatchObject({
      code: 'auth-failed',
    })
    expect(executeRecord.mock.calls).toEqual([
      ['turnstile-load-started'],
      ['turnstile-ready'],
      ['turnstile-execute-started'],
      ['turnstile-token-failed'],
    ])
  })
})
