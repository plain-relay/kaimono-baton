# Execution Plan Template

このtemplateをIssue単位でcopyし、実装前に未確定欄を埋める。`TBD`のまま実装を開始
してよいのは、実装中の調査でしか確定できず、権限・scope・riskを広げない項目だけとする。

## 1. Task identity

- Repository: `plain-relay/kaimono-baton`
- Issue / task:
- Goal:
- Acceptance criteria:
- Explicit non-scope:
- Requested base branch:
- Requested exact base SHA:
- Fetched `origin/main` SHA:
- Working tree clean: yes / no
- Dedicated branch:

Base SHAが一致しない場合:

- Intervening commits:
- Relevant diff:
- Why the task is or is not safe to rebase:
- Decision: continue from current main / stop for direction

## 2. Sources of truth read

- [ ] current Issue body and relevant comments
- [ ] root `AGENTS.md`
- [ ] `docs/CODEX_WORKFLOW.md`
- [ ] `docs/PROJECT_MAP.md`
- [ ] relevant operations/product documents
- [ ] current source and tests
- [ ] current `.github/workflows/`
- [ ] current `package.json` scripts

Historical material used, if any, and why it was not copied directly:

## 3. Scope and files

Planned files:

| File | Change purpose | Runtime/external impact |
| --- | --- | --- |
|  |  | none / describe |

Explicitly unchanged:

- [ ] application source
- [ ] application tests
- [ ] Worker source/runtime
- [ ] dependency and lockfile
- [ ] GitHub Actions
- [ ] deployment configuration
- [ ] Production and external settings

Uncheck only when the active Issue explicitly includes the area and update the plan.

## 4. Invariants

Explain how the change preserves each relevant Stable Free Core capability:

- fixed requests
- URL sharing
- product names
- quantities
- conditions
- store order
- purchase progress
- device-local household catalog
- household-catalog export and recovery

Auxiliary isolation:

- [ ] photos can be stopped independently
- [ ] updateable request v5 can be stopped independently
- [ ] handwriting analysis can be stopped independently
- [ ] optional/paid/AI failure does not block the Stable Free Core

Compatibility constraints relevant to this task:

## 5. AI data boundary

- [ ] No private operational repository will be browsed, searched, fetched, or read
- [ ] no private Issue, PR, Runbook, private repository search result, Secret, or
      user data is required
- [ ] no photo, shopping content, complete shared URL, capability token, request or
      response body, raw support text, or raw provider error is provided to AI
- [ ] any operational payload is produced from a defined allowlist schema and passes
      deterministic schema/prohibited-field validation
- [ ] anonymization or pseudonymization is not used as the sole safety condition

Required data, provenance, and validator (if an AI-safe export is used):

## 6. Risk

- Classification: Low / Medium / High
- Highest applicable rule from `AGENTS.md`:
- Issue-imposed minimum risk:
- User/runtime/external-state impact:
- Non-waivable Paid Beta or Public Release conditions affected:
- Residual risk:

Required conditions:

- [ ] written plan and rollback
- [ ] dedicated branch
- [ ] focused checks
- [ ] all applicable local standard checks
- [ ] full required CI
- [ ] exact base/head independent review
- [ ] deterministic security checklist (High only)
- [ ] staging evidence (High only)
- [ ] explicit human residual-risk acceptance (when required)

## 7. Implementation steps

1. <!-- step -->
2. <!-- step -->
3. <!-- step -->

Stop conditions:

- scope expansion or new authority required
- base mismatch that cannot be safely reconciled
- unrelated working-tree changes that cannot be isolated
- need to access private ops, Secrets, or user data
- need to perform Production/external actions
- failed required check that cannot be explained and fixed in scope

## 8. Validation

Focused checks:

| Command/check | Why | Expected result |
| --- | --- | --- |
|  |  |  |

Standard checks (mark `N/A` only with a reason):

- [ ] `npm ci`
- [ ] `npm test`
- [ ] `npm run test:worker`
- [ ] `npm run check:worker-bundle`
- [ ] `npm run test:coverage`
- [ ] `npm run build`
- [ ] `git diff --check`

Static diff checks:

- [ ] only planned files changed
- [ ] no unexpected source/Worker/dependency/lockfile/workflow change
- [ ] no Secret-like value or prohibited data in the diff
- [ ] no contradictory merge/Production rule
- [ ] no broken documentation reference

## 9. Rollback

- Code/document rollback:
- External rollback: not applicable / human-only plan
- Data migration rollback: not applicable / human-only plan
- Stable Free Core effect during rollback:

Do not use destructive Git operations to perform rollback without explicit authorization.

## 10. Draft PR record

- PR number:
- Base branch:
- Exact base SHA:
- Exact head SHA:
- Commit(s):
- Changed files:
- CI run number and result:
- Draft: yes
- Auto-merge: disabled
- Merge queue: not entered
- Production/external setting changed: no / describe blocker
- Private ops/Secret/user data accessed: no

## 11. Independent review contract

- Required method: separate ChatGPT chat / separate Codex session
- Why this method is sufficient:
- Reviewer is fresh and read-only: yes
- Exact base SHA:
- Exact head SHA:
- Complete diff reviewed: yes
- Commands/tests independently checked:
- P0:
- P1:
- P2:
- P3:
- Disposition:

If base or head changes, clear this section and perform a complete new review.

## 12. Merge and Production handoff

- Human merge approval received for this exact repository/PR/base/head: no
- Approved merge method: Squash unless explicitly changed
- Operator-AI canonical gate checked: not yet
- Merge performed by this implementation/review session: no
- Production approval: separate and not granted
- Production/external operation performed by AI: no

The implementation session stops after Draft PR, validation, and review preparation.
It must not interpret this template, the Issue, or the implementation prompt as merge
or Production approval.
