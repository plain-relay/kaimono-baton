import type { PhotoObject } from './photoObject'
import type { SharedRequestObject } from './sharedRequestObject'

export type WorkerEnv = {
  GEMINI_API_KEY?: string
  TURNSTILE_SECRET_KEY?: string
  ALLOWED_ORIGINS?: string
  DIAGNOSTIC_MODE?: string
  PHOTO_API_ENABLED?: string
  SHARED_REQUEST_API_ENABLED?: string
  MANUAL_VALIDATION_ENABLED?: string
  MANUAL_VALIDATION_SESSION_SHA256?: string
  MANUAL_VALIDATION_EXPIRES_AT?: string
  PHOTO_OBJECTS?: DurableObjectNamespace<PhotoObject>
  SHARED_REQUEST_OBJECTS?: DurableObjectNamespace<SharedRequestObject>
}

function isEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true'
}

export function isPhotoApiEnabled(env: WorkerEnv): boolean {
  return isEnabled(env.PHOTO_API_ENABLED)
}

export function isSharedRequestApiEnabled(env: WorkerEnv): boolean {
  return isEnabled(env.SHARED_REQUEST_API_ENABLED)
}

type HandwritingConfiguredEnv = WorkerEnv & {
  GEMINI_API_KEY: string
  TURNSTILE_SECRET_KEY: string
  ALLOWED_ORIGINS: string
}

export function hasHandwritingConfiguration(
  env: WorkerEnv,
): env is HandwritingConfiguredEnv {
  return Boolean(
    env.GEMINI_API_KEY?.trim() &&
      env.TURNSTILE_SECRET_KEY?.trim() &&
      env.ALLOWED_ORIGINS?.trim(),
  )
}

type PhotoConfiguredEnv = WorkerEnv & {
  TURNSTILE_SECRET_KEY: string
  ALLOWED_ORIGINS: string
  PHOTO_OBJECTS: DurableObjectNamespace<PhotoObject>
}

export function hasPhotoConfiguration(
  env: WorkerEnv,
): env is PhotoConfiguredEnv {
  return Boolean(
    env.TURNSTILE_SECRET_KEY?.trim() &&
      env.ALLOWED_ORIGINS?.trim() &&
      env.PHOTO_OBJECTS,
  )
}

type SharedRequestConfiguredEnv = WorkerEnv & {
  TURNSTILE_SECRET_KEY: string
  ALLOWED_ORIGINS: string
  SHARED_REQUEST_OBJECTS: DurableObjectNamespace<SharedRequestObject>
}

export function hasSharedRequestConfiguration(
  env: WorkerEnv,
): env is SharedRequestConfiguredEnv {
  return Boolean(
    env.TURNSTILE_SECRET_KEY?.trim() &&
      env.ALLOWED_ORIGINS?.trim() &&
      env.SHARED_REQUEST_OBJECTS,
  )
}
