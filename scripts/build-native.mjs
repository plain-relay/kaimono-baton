import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

// Vite process env has precedence over .env files. Do not inherit optional servers.
const env = { ...process.env, BASE_PATH: '/' }
for (const key of Object.keys(env)) {
  if (key.startsWith('VITE_')) delete env[key]
}
for (const key of [
  'VITE_PRODUCT_PHOTOS_ENABLED', 'VITE_LIVE_REQUESTS_ENABLED',
  'VITE_HANDWRITING_IMPORT_ENABLED', 'VITE_HANDWRITING_DIAGNOSTICS_ENABLED',
  'VITE_MANUAL_VALIDATION_ENABLED',
]) env[key] = 'false'
for (const key of [
  'VITE_HANDWRITING_IMPORT_ENDPOINT', 'VITE_TURNSTILE_SITE_KEY',
  'VITE_HANDWRITING_MANUAL_TEST_SESSION_ID', 'VITE_HANDWRITING_MANUAL_TEST_EXPIRES_AT',
]) env[key] = ''
execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--mode', 'native'], { env, stdio: 'inherit' })
const index = readFileSync('dist-native/index.html', 'utf8')
const csp = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
writeFileSync('dist-native/index.html', index.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="${csp}">`))
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const dirty = Boolean(execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { encoding: 'utf8' }).trim())
writeFileSync('dist-native/native-build.json', JSON.stringify({
  webAssetVersion: '0.1.0', sourceCommit, dirty, optionalFeatures: false,
}, null, 2) + '\n')
