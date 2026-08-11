import { describe, expect, it, vi } from 'vitest'
import {
  GitHubPagesError,
  PRODUCTION_WORKFLOW_FILENAME,
  createGitHubPagesClient,
  expectedManualRunTitle,
  selectManualWorkflowRun,
  validateDeploymentManifest,
} from './github-pages.mjs'

const session = {
  sessionId: 'session-123',
  headSha: 'a'.repeat(40),
  actor: 'kouhei',
}

function workflowRun(overrides = {}) {
  return {
    id: 101,
    event: 'workflow_dispatch',
    display_title: expectedManualRunTitle(session.sessionId),
    head_sha: session.headSha,
    actor: { login: session.actor },
    status: 'queued',
    conclusion: null,
    created_at: 'not-a-date',
    ...overrides,
  }
}

function capturedJson(value, exitCode = 0, stderr = '') {
  return {
    stdout: JSON.stringify(value),
    stderr,
    exitCode,
  }
}

describe('selectManualWorkflowRun', () => {
  it('selects only the exact session, SHA, event, and actor', () => {
    const exact = workflowRun()
    const runs = [
      workflowRun({ id: 1, display_title: 'Deploy Pages [manual:other]' }),
      workflowRun({ id: 2, head_sha: 'b'.repeat(40) }),
      workflowRun({ id: 3, actor: { login: 'other' } }),
      workflowRun({ id: 4, event: 'push' }),
      exact,
    ]

    expect(selectManualWorkflowRun(runs, session)).toBe(exact)
  })

  it('does not inspect or sort by created_at', () => {
    const exact = workflowRun({
      created_at: { deliberately: 'not a Date' },
    })

    expect(
      selectManualWorkflowRun(
        [
          exact,
          workflowRun({
            id: 202,
            display_title: 'Deploy Pages [manual:another-session]',
            created_at: new Date(),
          }),
        ],
        session,
      ),
    ).toBe(exact)
  })

  it('rejects multiple exact matches instead of guessing', () => {
    expect(() =>
      selectManualWorkflowRun(
        [workflowRun({ id: 1 }), workflowRun({ id: 2 })],
        session,
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'AMBIGUOUS_RUN',
      }),
    )
  })
})

describe('GitHub Pages client', () => {
  it('accepts only an exact custom deployment branch policy', async () => {
    const responses = [
      {
        deployment_branch_policy: {
          protected_branches: false,
          custom_branch_policies: true,
        },
      },
      [
        {
          branch_policies: [
            {
              type: 'branch',
              name: 'refactor/manual-test-orchestration',
            },
          ],
        },
      ],
    ]
    const client = createGitHubPagesClient({
      repository: 'plain-relay/kaimono-baton',
      repositoryRoot: 'C:\\repo',
      runCaptured: async () => capturedJson(responses.shift()),
      runInteractive: async () => 0,
    })

    await expect(
      client.verifyDeploymentRefAllowed(
        'refactor/manual-test-orchestration',
      ),
    ).resolves.toBeUndefined()
  })

  it('rejects a ref before deployment when policy does not allow it', async () => {
    const responses = [
      {
        deployment_branch_policy: {
          protected_branches: false,
          custom_branch_policies: true,
        },
      },
      [
        {
          branch_policies: [
            { type: 'branch', name: 'main' },
          ],
        },
      ],
    ]
    const client = createGitHubPagesClient({
      repository: 'plain-relay/kaimono-baton',
      repositoryRoot: 'C:\\repo',
      runCaptured: async () => capturedJson(responses.shift()),
      runInteractive: async () => 0,
    })

    await expect(
      client.verifyDeploymentRefAllowed('feature/not-allowed'),
    ).rejects.toMatchObject({
      code: 'DEPLOYMENT_REF_NOT_ALLOWED',
    })
  })

  it('dispatches typed inputs and finds the matching run amid others', async () => {
    expect(PRODUCTION_WORKFLOW_FILENAME).toBe(
      'stable-free-core-production.yml',
    )
    const capturedCalls = []
    let listAttempt = 0
    const runCaptured = vi.fn(async (_command, args) => {
      capturedCalls.push(args)
      if (args[0] === 'workflow') {
        expect(args).toContain(PRODUCTION_WORKFLOW_FILENAME)
        return { stdout: '', stderr: '', exitCode: 0 }
      }
      if (
        args.some((argument) =>
          argument.includes(
            `/actions/workflows/${PRODUCTION_WORKFLOW_FILENAME}/runs`,
          ),
        )
      ) {
        listAttempt += 1
        return capturedJson({
          workflow_runs:
            listAttempt === 1
              ? [workflowRun({ display_title: 'unrelated' })]
              : [workflowRun()],
        })
      }
      if (String(args[1] ?? '').includes('/actions/runs/')) {
        return capturedJson({
          status: 'completed',
          conclusion: 'success',
        })
      }
      throw new Error(`Unexpected args: ${args.join(' ')}`)
    })
    const runInteractive = vi.fn(async () => 0)
    const client = createGitHubPagesClient({
      repository: 'plain-relay/kaimono-baton',
      repositoryRoot: 'C:\\repo',
      runCaptured,
      runInteractive,
      sleep: async () => {},
    })

    const run = await client.dispatchAndWait(
      {
        ref: 'feature/ref',
        mode: 'manual-on',
        ...session,
      },
      { pollIntervalMs: 0 },
    )

    expect(run.conclusion).toBe('success')
    expect(capturedCalls[0]).toContain('manual_test_mode=manual-on')
    expect(capturedCalls[0]).toContain(
      'manual_test_session_id=session-123',
    )
    expect(runInteractive).toHaveBeenCalledWith(
      'gh',
      expect.arrayContaining(['watch', '101', '--exit-status']),
      expect.any(Object),
    )
  })

  it('times out explicitly when no exact session run appears', async () => {
    let currentTime = 0
    const client = createGitHubPagesClient({
      repository: 'plain-relay/kaimono-baton',
      repositoryRoot: 'C:\\repo',
      runCaptured: async () =>
        capturedJson({ workflow_runs: [workflowRun({ head_sha: 'b' })] }),
      runInteractive: async () => 0,
      now: () => currentTime,
      sleep: async (milliseconds) => {
        currentTime += milliseconds || 1
      },
    })

    await expect(
      client.waitForRun(session, {
        timeoutMs: 3,
        pollIntervalMs: 1,
      }),
    ).rejects.toMatchObject({
      code: 'RUN_DETECTION_TIMEOUT',
    })
  })

  it.each([
    ['failure', 'PAGES_RUN_FAILURE'],
    ['cancelled', 'PAGES_RUN_CANCELLED'],
    ['timed_out', 'PAGES_RUN_TIMED_OUT'],
  ])('rejects a %s workflow conclusion', async (conclusion, code) => {
    const client = createGitHubPagesClient({
      repository: 'plain-relay/kaimono-baton',
      repositoryRoot: 'C:\\repo',
      runCaptured: async () =>
        capturedJson({ status: 'completed', conclusion }),
      runInteractive: async () => 1,
    })

    await expect(client.watchRun(123)).rejects.toMatchObject({ code })
  })

  it('does not treat a queued or in-progress run as success', async () => {
    for (const status of ['queued', 'in_progress']) {
      const client = createGitHubPagesClient({
        repository: 'plain-relay/kaimono-baton',
        repositoryRoot: 'C:\\repo',
        runCaptured: async () =>
          capturedJson({ status, conclusion: null }),
        runInteractive: async () => 0,
      })

      await expect(client.watchRun(123)).rejects.toMatchObject({
        code: 'PAGES_RUN_FAILED',
      })
    }
  })
})

describe('deployment manifest validation', () => {
  const expected = {
    commitSha: 'a'.repeat(40),
    mode: 'manual-on',
    sessionId: 'session-123',
    importEnabled: true,
    diagnosticsEnabled: true,
  }

  function manifest(overrides = {}) {
    return {
      schemaVersion: 1,
      commitSha: expected.commitSha,
      manualTestMode: expected.mode,
      manualTestSessionId: expected.sessionId,
      handwritingImportEnabled: true,
      diagnosticsEnabled: true,
      productPhotosEnabled: false,
      liveRequestsEnabled: false,
      manualValidationEnabled: false,
      endpointConfigured: true,
      turnstileSiteKeyConfigured: true,
      builtAt: '2026-07-28T00:00:00.000Z',
      expiresAt: '2026-07-28T00:45:00.000Z',
      ...overrides,
    }
  }

  it('accepts the exact ON manifest', () => {
    expect(validateDeploymentManifest(manifest(), expected)).toEqual(
      manifest(),
    )
  })

  it('rejects an expired or overlong manual-test manifest', () => {
    expect(() =>
      validateDeploymentManifest(manifest(), {
        ...expected,
        now: Date.parse('2026-07-28T00:45:00.000Z'),
      }),
    ).toThrow(GitHubPagesError)
    expect(() =>
      validateDeploymentManifest(
        manifest({
          expiresAt: '2026-07-28T02:00:00.000Z',
        }),
        expected,
      ),
    ).toThrow(GitHubPagesError)
  })

  it.each([
    ['old session', { manualTestSessionId: 'old-session' }],
    ['different SHA', { commitSha: 'b'.repeat(40) }],
    ['missing endpoint', { endpointConfigured: false }],
    ['missing site key', { turnstileSiteKeyConfigured: false }],
    ['wrong mode', { manualTestMode: 'manual-off' }],
    ['photo feature enabled', { productPhotosEnabled: true }],
    ['live request feature enabled', { liveRequestsEnabled: true }],
    ['manual validation enabled', { manualValidationEnabled: true }],
    ['unsafe feature state type', { manualValidationEnabled: 'false' }],
    ['unexpected property', { endpoint: 'https://should-not-leak/' }],
  ])('rejects %s', (_label, override) => {
    expect(() =>
      validateDeploymentManifest(manifest(override), expected),
    ).toThrow(GitHubPagesError)
  })

  it('accepts an exact OFF manifest with no expiration', () => {
    const offExpected = {
      ...expected,
      mode: 'manual-off',
      sessionId: 'session-123-off',
      importEnabled: false,
      diagnosticsEnabled: false,
    }
    expect(() =>
      validateDeploymentManifest(
        manifest({
          manualTestMode: 'manual-off',
          manualTestSessionId: 'session-123-off',
          handwritingImportEnabled: false,
          diagnosticsEnabled: false,
          expiresAt: null,
        }),
        offExpected,
      ),
    ).not.toThrow()
  })

  it('reports invalid JSON without exposing its body', async () => {
    const client = createGitHubPagesClient({
      repository: 'plain-relay/kaimono-baton',
      repositoryRoot: 'C:\\repo',
      runCaptured: async () => capturedJson({}),
      runInteractive: async () => 0,
      fetchImpl: async () => ({
        status: 200,
        json: async () => {
          throw new Error('secret body')
        },
      }),
    })

    await expect(client.fetchManifest('session-123')).rejects.toEqual(
      expect.objectContaining({
        code: 'MANIFEST_INVALID_JSON',
        message: 'Deployment manifest is not valid JSON.',
      }),
    )
  })
})
