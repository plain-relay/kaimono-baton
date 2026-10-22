import { WORKER_REQUEST_ID_HEADER } from './requestId'
import type { HandwritingImportResult } from './types'

export const HANDWRITING_REQUEST_ID_HEADER = WORKER_REQUEST_ID_HEADER

function corsHeaders(
  origin: string | undefined,
  requestId: string,
): HeadersInit {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    [HANDWRITING_REQUEST_ID_HEADER]: requestId,
    ...(origin
      ? {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Expose-Headers':
            HANDWRITING_REQUEST_ID_HEADER,
          Vary: 'Origin',
        }
      : {}),
  }
}

export function handwritingJsonResponse(
  body: HandwritingImportResult | { code: string },
  status: number,
  requestId: string,
  origin?: string,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders(origin, requestId),
  })
}
