---
tracker:
  kind: github
  provider:
    repo: plain-relay/kaimono-baton
    token: "$GITHUB_TOKEN"
  required_labels:
    - codex-ready
  active_states:
    - open
  terminal_states:
    - closed
polling:
  interval_ms: 30000
workspace:
  root: ~/code/kaimono-baton-symphony-workspaces
hooks:
  after_create: |
    git clone --depth 1 https://github.com/plain-relay/kaimono-baton.git .
agent:
  max_concurrent_agents: 1
  max_turns: 4
codex:
  command: codex --config 'model="gpt-5.6-terra"' --config model_reasoning_effort=high app-server
  approval_policy: never
  thread_sandbox: workspace-write
  turn_sandbox_policy:
    type: workspaceWrite
    networkAccess: true
  read_timeout_ms: 5000
  stall_timeout_ms: 300000
observability:
  dashboard_enabled: false
---

You are implementing GitHub Issue `{{ issue.identifier }}` for Kaimono Baton.

Issue context:
- Identifier: {{ issue.identifier }}
- Title: {{ issue.title }}
- URL: {{ issue.url }}
- Labels: {{ issue.labels }}

{% if issue.description %}
Description:
{{ issue.description }}
{% endif %}

This is an unattended pilot run. Work only in the provided workspace and only on the active Issue.

Mandatory repository contract:
1. Read `AGENTS.md` first and follow it exactly.
2. Read the active Issue and its acceptance criteria.
3. Read `docs/CODEX_WORKFLOW.md`, `docs/PROJECT_MAP.md`, `docs/operations/AI_AGENT_POLICY.md`, and `docs/operations/AI_MERGE_APPROVAL.md` before editing.
4. Treat the current `origin/main` as authoritative. Fetch it and record the exact base SHA before changes.
5. Do not access private operational repositories, Secrets, private ops data, or user data.

Execution rules:
- Create one dedicated branch for this Issue from current `origin/main`. Use `codex/gh-{{ issue.id }}-<short-slug>` when a fresh branch is required.
- Before editing, search for an existing open PR or reusable in-progress branch for this Issue. Do not create duplicate PRs.
- Keep changes strictly inside the Issue scope. If the requested work requires expanding scope or a prohibited external operation, stop and report the blocker on the Issue.
- Never push directly to `main` and never force-push `main`.
- Never merge, enable auto-merge, mark a Draft PR ready, deploy Production, run a Production workflow, change GitHub Secrets/Variables/Environments, change Cloudflare/DNS/billing, or perform user-data operations.
- Do not add dependencies, workflows, or external services unless the Issue explicitly authorizes them.

Validation:
- Use only commands that exist in the current repository.
- Unless the Issue narrows validation for a justified reason, run:
  - `npm ci`
  - `npm test`
  - `npm run test:worker`
  - `npm run check:worker-bundle`
  - `npm run test:coverage`
  - `npm run build`
  - `git diff --check`
- Record any check that cannot run as not-run with the reason; never report it as passed.

Handoff:
1. Commit only scoped files.
2. Push the Issue branch using the repository's existing Git authentication.
3. Open or update exactly one Draft PR targeting `main` and satisfy `.github/pull_request_template.md`.
4. Include exact base/head SHAs, changed files, checks/results, risk classification, rollback, external-state impact, data-boundary confirmation, and required independent-review method.
5. Verify the Draft PR exists and the intended branch is pushed.
6. Use Symphony's `github_api` tool to remove the `codex-ready` label from this Issue. This removal is mandatory successful-handoff cleanup and prevents automatic redispatch while the Issue remains open.
7. Do not merge the PR. Leave the Issue open for CI, independent review, human merge approval, and any explicitly approved rework outside this run.

Blocked handoff:
- If blocked by missing authentication, unavailable tools, an unsafe request, a scope conflict, or another true external blocker, do not weaken these rules.
- Record a concise blocker on the Issue using `github_api`.
- Remove `codex-ready` from the Issue using `github_api` before stopping so the same blocked task is not automatically redispatched.
- A human may re-add `codex-ready` only after the blocker is resolved and implementation is explicitly approved again.
