import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    base: env.BASE_PATH || '/',
    resolve: {
      alias: {
        'cloudflare:workers': fileURLToPath(
          new URL('./worker/test/cloudflareWorkersMock.ts', import.meta.url),
        ),
      },
    },
    plugins: [react()],
    test: {
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json-summary'],
        reportsDirectory: 'coverage',
        include: ['src/**/*.{ts,tsx}'],
        exclude: [
          'src/**/*.test.{ts,tsx}',
          'src/main.tsx',
          'src/vite-env.d.ts',
          'src/data/**',
          'src/testFixtures/**',
          'src/types/**',
        ],
        thresholds: {
          statements: 90,
          branches: 84,
          functions: 93,
          lines: 90,
        },
      },
    },
  }
})
