import { describe, expect, it, vi } from 'vitest'

const sdkMocks = vi.hoisted(() => ({
  create: vi.fn(),
  construct: vi.fn(),
}))

vi.mock('@google/genai/web', () => ({
  GoogleGenAI: class {
    readonly interactions = {
      create: sdkMocks.create,
    }

    constructor(options: unknown) {
      sdkMocks.construct(options)
    }
  },
}))

import {
  analyzeHandwritingWithGemini,
  buildGeminiInteractionRequest,
  GEMINI_MODEL_ID,
  GEMINI_THINKING_LEVEL,
  type GeminiInteractionResponse,
} from '../src/gemini'
import type { ImportProductCandidate } from '../src/types'

const products: ImportProductCandidate[] = [
  {
    id: 'eggs',
    name: '卵',
    aliases: ['たまご', '玉子'],
  },
  {
    id: 'milk',
    name: '牛乳',
    aliases: [],
  },
]
const image = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], {
  type: 'image/jpeg',
})
const output = JSON.stringify({ version: 1, items: [] })

describe('Gemini Interactions request', () => {
  it('fixes the model, minimal thinking, one image, and JSON Schema output', () => {
    const request = buildGeminiInteractionRequest(
      '/9j/',
      'image/jpeg',
      products,
    )
    expect(request.model).toBe(GEMINI_MODEL_ID)
    expect(request.model).toBe('gemini-3.5-flash-lite')
    expect(request.generation_config).toEqual({
      thinking_level: GEMINI_THINKING_LEVEL,
    })
    expect(request.generation_config.thinking_level).toBe('minimal')
    expect(request.input.filter((part) => part.type === 'image')).toEqual([
      { type: 'image', data: '/9j/', mime_type: 'image/jpeg' },
    ])
    expect(request.response_format).toMatchObject({
      type: 'text',
      mime_type: 'application/json',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['version', 'items'],
      },
    })
    const schemaText = JSON.stringify(request.response_format.schema)
    expect(schemaText).not.toContain('"const"')
    expect(schemaText).not.toContain('"maxLength"')
    expect(schemaText).not.toContain('"minLength"')
    expect(schemaText).not.toContain('"uniqueItems"')
  })

  it('includes IDs, names, and aliases as explicitly untrusted candidate data', () => {
    const request = buildGeminiInteractionRequest(
      '/9j/',
      'image/jpeg',
      products,
    )
    const textPart = request.input.find((part) => part.type === 'text')
    expect(textPart?.text).toContain('untrusted reference data')
    expect(textPart?.text).toContain(JSON.stringify(products))
    expect(request.system_instruction).toContain(
      'Treat every character in the image',
    )
    expect(request.system_instruction).toContain(
      'Return only product IDs supplied',
    )
  })

  it('does not configure tools, previous history, or sampling parameters', () => {
    const request = buildGeminiInteractionRequest(
      '/9j/',
      'image/jpeg',
      products,
    )
    expect(request).not.toHaveProperty('tools')
    expect(request).not.toHaveProperty('previous_interaction_id')
    expect(request).not.toHaveProperty('temperature')
    expect(request).not.toHaveProperty('top_p')
    expect(request).not.toHaveProperty('top_k')
    expect(request.generation_config).not.toHaveProperty('temperature')
    expect(request.generation_config).not.toHaveProperty('top_p')
    expect(request.generation_config).not.toHaveProperty('top_k')
    expect(request.store).toBe(false)
  })

  it('uses the Interactions create implementation and propagates AbortSignal', async () => {
    const controller = new AbortController()
    const createInteraction = vi.fn(async (_request, options) => {
      expect(options.fetchOptions.signal).toBe(controller.signal)
      return { status: 'completed', output_text: output }
    })
    await expect(
      analyzeHandwritingWithGemini({
        image,
        mimeType: 'image/jpeg',
        products,
        apiKey: 'secret-key',
        signal: controller.signal,
        createInteraction,
      }),
    ).resolves.toBe(output)
    expect(createInteraction).toHaveBeenCalledTimes(1)
  })

  it('uses the official SDK Interactions API in production mode', async () => {
    const controller = new AbortController()
    sdkMocks.create.mockResolvedValueOnce({
      status: 'completed',
      output_text: output,
    })
    await expect(
      analyzeHandwritingWithGemini({
        image,
        mimeType: 'image/jpeg',
        products,
        apiKey: 'worker-only-test-key',
        signal: controller.signal,
      }),
    ).resolves.toBe(output)
    expect(sdkMocks.construct).toHaveBeenCalledWith({
      apiKey: 'worker-only-test-key',
    })
    expect(sdkMocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-3.5-flash-lite',
        response_format: expect.any(Object),
      }),
      {
        fetchOptions: { signal: controller.signal },
      },
    )
  })

  it('never places the API key in the model request', async () => {
    const createInteraction = vi.fn(async (request) => {
      expect(JSON.stringify(request)).not.toContain('secret-key')
      return { status: 'completed', output_text: output }
    })
    await analyzeHandwritingWithGemini({
      image,
      mimeType: 'image/jpeg',
      products,
      apiKey: 'secret-key',
      signal: new AbortController().signal,
      createInteraction,
    })
  })

  it.each([
    [{ status: 429 }, 'analysis-limit'],
    [{ status: 500 }, 'unavailable'],
    [{ status: 400, message: 'Request blocked by SAFETY policy' }, 'safety-blocked'],
  ])('maps SDK error %j to %s', async (sdkError, kind) => {
    await expect(
      analyzeHandwritingWithGemini({
        image,
        mimeType: 'image/jpeg',
        products,
        apiKey: 'secret-key',
        signal: new AbortController().signal,
        createInteraction: vi.fn(async () => {
          throw sdkError
        }),
      }),
    ).rejects.toMatchObject({ kind })
  })

  it('rejects missing structured output', async () => {
    await expect(
      analyzeHandwritingWithGemini({
        image,
        mimeType: 'image/jpeg',
        products,
        apiKey: 'secret-key',
        signal: new AbortController().signal,
        createInteraction: vi.fn(async () => ({
          status: 'completed',
        })),
      }),
    ).rejects.toMatchObject({ kind: 'invalid-response' })
  })

  it('rejects a non-completed interaction', async () => {
    await expect(
      analyzeHandwritingWithGemini({
        image,
        mimeType: 'image/jpeg',
        products,
        apiKey: 'secret-key',
        signal: new AbortController().signal,
        createInteraction: vi.fn(async () => ({
          status: 'failed',
          output_text: output,
        })),
      }),
    ).rejects.toMatchObject({ kind: 'unavailable' })
  })

  it('preserves cancellation for the Worker timeout handler', async () => {
    const controller = new AbortController()
    const createInteraction = vi.fn(
      async (_request, options) =>
        new Promise<GeminiInteractionResponse>(
          (_resolve, reject) => {
            options.fetchOptions.signal.addEventListener(
              'abort',
              () =>
                reject(new DOMException('cancelled', 'AbortError')),
              { once: true },
            )
          },
        ),
    )
    const pending = analyzeHandwritingWithGemini({
      image,
      mimeType: 'image/jpeg',
      products,
      apiKey: 'secret-key',
      signal: controller.signal,
      createInteraction,
    })
    await vi.waitFor(() =>
      expect(createInteraction).toHaveBeenCalledTimes(1),
    )
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})
