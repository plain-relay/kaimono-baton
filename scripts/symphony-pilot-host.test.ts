import { describe, expect, it } from 'vitest'

import {
  PilotError,
  extractAndValidateSafeTask,
  isPathAllowed,
  isProtectedPath,
  validateHandoff,
  validateSafeTask,
} from './symphony-pilot-host.mjs'

const validTask = () => ({
  schemaVersion: 1,
  executionId: 1,
  operation: 'implement-existing-public-spec',
  changeMode: 'modify-existing',
  scopePaths: ['src/pages'],
  referencePaths: ['docs/PROJECT_MAP.md'],
  symbols: ['HomePage'],
  acceptanceChecks: ['npm-test', 'git-diff-check'],
  risk: 'medium',
})

describe('Symphony safe task boundary', () => {
  it('accepts only the exact allowlist schema', () => {
    expect(validateSafeTask(validTask())).toEqual(validTask())
    expect(() => validateSafeTask({ ...validTask(), freeText: 'do anything' })).toThrow(PilotError)
  })

  it('extracts exactly one delimited safe task block', () => {
    const body = `Human-only text\n<!-- symphony-safe-task:v1 -->\n${JSON.stringify(validTask())}\n<!-- /symphony-safe-task -->`
    expect(extractAndValidateSafeTask(body)).toEqual(validTask())
    expect(() => extractAndValidateSafeTask(`${body}\n${body}`)).toThrow(PilotError)
  })

  it('rejects traversal and protected control paths', () => {
    expect(() => validateSafeTask({ ...validTask(), scopePaths: ['../src'] })).toThrow(PilotError)
    for (const protectedPath of [
      '.github/workflows/verify-pr.yml',
      'symphony/WORKFLOW.md',
      'AGENTS.md',
      'package.json',
      'package-lock.json',
      'scripts/symphony-pilot-host.mjs',
    ]) {
      expect(isProtectedPath(protectedPath)).toBe(true)
      expect(() => validateSafeTask({ ...validTask(), scopePaths: [protectedPath] })).toThrow(PilotError)
    }
  })

  it('allows only exact or descendant paths inside approved scopes', () => {
    expect(isPathAllowed('src/pages/HomePage.tsx', ['src/pages'])).toBe(true)
    expect(isPathAllowed('src/pages', ['src/pages'])).toBe(true)
    expect(isPathAllowed('src/styles.css', ['src/pages'])).toBe(false)
    expect(isPathAllowed('.github/workflows/x.yml', ['.github'])).toBe(false)
  })

  it('requires a new positive executionId for each authorization', () => {
    expect(() => validateSafeTask({ ...validTask(), executionId: 0 })).toThrow(PilotError)
    expect(validateSafeTask({ ...validTask(), executionId: 2 }).executionId).toBe(2)
  })
})

describe('Symphony handoff boundary', () => {
  it('requires every host-authorized acceptance check to pass', () => {
    expect(validateHandoff({
      schemaVersion: 1,
      status: 'ready',
      checks: { 'npm-test': 'pass', 'git-diff-check': 'pass' },
    }, ['npm-test', 'git-diff-check']).status).toBe('ready')

    expect(() => validateHandoff({
      schemaVersion: 1,
      status: 'ready',
      checks: { 'git-diff-check': 'pass' },
    }, ['npm-test', 'git-diff-check'])).toThrow(PilotError)
  })

  it('accepts only enumerated blocker codes and no free-form blocker text', () => {
    expect(validateHandoff({
      schemaVersion: 1,
      status: 'blocked',
      blockerCode: 'scope-conflict',
    }).status).toBe('blocked')

    expect(() => validateHandoff({
      schemaVersion: 1,
      status: 'blocked',
      blockerCode: 'scope-conflict',
      details: 'raw free text',
    })).toThrow(PilotError)
  })
})
