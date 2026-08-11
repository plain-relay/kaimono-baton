export const allowedOrigin = 'https://plain-relay.github.io'
export const validPhotoTokens = [
  'p1_AAECAwQFBgcICQoLDA0ODxAREhMUFRYX',
  'p1_AQECAwQFBgcICQoLDA0ODxAREhMUFRYX',
  'p1_AgECAwQFBgcICQoLDA0ODxAREhMUFRYX',
  'p1_AwECAwQFBgcICQoLDA0ODxAREhMUFRYX',
] as const

function uint16(value: number): [number, number] {
  return [(value >>> 8) & 0xff, value & 0xff]
}

export function createJpegBytes(
  width = 640,
  height = 480,
  options: {
    app1?: boolean
    size?: number
    secondSof?: { width: number; height: number }
    omitSos?: boolean
  } = {},
): Uint8Array<ArrayBuffer> {
  const bytes: number[] = [0xff, 0xd8]
  bytes.push(0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46)
  if (options.app1) {
    bytes.push(
      0xff,
      0xe1,
      0x00,
      0x08,
      0x45,
      0x78,
      0x69,
      0x66,
      0x00,
      0x00,
    )
  }
  bytes.push(
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    ...uint16(height),
    ...uint16(width),
    0x03,
    0x01,
    0x11,
    0x00,
    0x02,
    0x11,
    0x00,
    0x03,
    0x11,
    0x00,
  )
  if (options.secondSof) {
    bytes.push(
      0xff,
      0xc0,
      0x00,
      0x11,
      0x08,
      ...uint16(options.secondSof.height),
      ...uint16(options.secondSof.width),
      0x03,
      0x01,
      0x11,
      0x00,
      0x02,
      0x11,
      0x00,
      0x03,
      0x11,
      0x00,
    )
  }
  if (!options.omitSos) {
    bytes.push(
      0xff,
      0xda,
      0x00,
      0x0c,
      0x03,
      0x01,
      0x00,
      0x02,
      0x00,
      0x03,
      0x00,
      0x00,
      0x3f,
      0x00,
    )
  }

  const targetSize = Math.max(options.size ?? bytes.length + 2, bytes.length + 2)
  const output = new Uint8Array(new ArrayBuffer(targetSize))
  output.set(bytes)
  output[targetSize - 2] = 0xff
  output[targetSize - 1] = 0xd9
  return output
}

export function photoBatchRequest(options: {
  count?: number
  origin?: string
  files?: File[]
  metadata?: unknown
  token?: string
  contentLength?: number
  pathname?: string
  method?: string
  validationSessionToken?: string
  validationSessionHeader?: string
} = {}): Request {
  const count = options.count ?? options.files?.length ?? 1
  const files =
    options.files ??
    Array.from({ length: count }, (_, index) =>
      new File([createJpegBytes().buffer], `ignored-${index}.jpg`, {
        type: 'image/jpeg',
      }),
    )
  const metadata =
    options.metadata ??
    Array.from({ length: count }, (_, index) => ({
      token: validPhotoTokens[index],
      itemKey: `item-${index}`,
    }))
  const formData = new FormData()
  if (options.validationSessionToken !== undefined) {
    formData.append(
      'validationSessionToken',
      options.validationSessionToken,
    )
  }
  formData.append('turnstileToken', options.token ?? 'single-use-token')
  formData.append('metadata', JSON.stringify(metadata))
  for (const file of files) {
    formData.append('photo', file)
  }
  return new Request(
    `https://import.example.workers.dev${options.pathname ?? '/v1/photos/batch'}`,
    {
      method: options.method ?? 'POST',
      headers: {
        Origin: options.origin ?? allowedOrigin,
        ...(options.validationSessionHeader === undefined
          ? {}
          : {
              'X-Otsukai-Validation-Session':
                options.validationSessionHeader,
            }),
        ...(options.contentLength === undefined
          ? {}
          : { 'Content-Length': String(options.contentLength) }),
      },
      ...((options.method ?? 'POST') === 'GET' ? {} : { body: formData }),
    },
  )
}
