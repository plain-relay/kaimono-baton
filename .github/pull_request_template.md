## Issue and exact range

- Issue: #
- Base branch: `main`
- Exact base SHA: ``
- Exact head SHA: ``
- Risk: <!-- Low / Medium / High -->

## Purpose

<!-- What this changes and why. Keep the scope to the linked Issue. -->

## Changed files

<!-- List every changed file and its purpose. -->

## Invariants and scope

- [ ] Stable Free Core remains independent of AI, photos, v5, handwriting analysis,
      and optional/paid services.
- [ ] Fixed requests, URL sharing, product names, quantities, conditions, store order,
      purchase progress, the device-local household catalog, and catalog
      export/recovery are preserved.
- [ ] Photos, updateable request v5, and handwriting analysis remain independently
      stoppable auxiliary features.
- [ ] Application source and Worker runtime are unchanged, or their authorized changes
      and compatibility evidence are described below.
- [ ] Dependency, lockfile, workflow, deployment, and external-setting changes are
      absent, or explicitly described below.

Runtime/compatibility notes:

## Validation

| Check | Result |
| --- | --- |
| `npm ci` |  |
| `npm test` |  |
| `npm run test:worker` |  |
| `npm run check:worker-bundle` |  |
| `npm run test:coverage` |  |
| `npm run build` |  |
| `git diff --check` |  |

- CI workflow/run:
- CI result:
- Not run / not applicable checks and reason:

## Risk and rollback

- Classification rationale:
- Failure modes:
- Rollback:
- Non-waivable Paid Beta / Public Release conditions affected:

## AI and operational boundaries

- [ ] No Production deploy or Production workflow start, approval, or rerun was
      performed.
- [ ] No Cloudflare, DNS, GitHub Environment, Secret, Variable, billing, migration,
      customer communication, user-data, legal-publication, or Production stop/restart
      operation was performed.
- [ ] Any private operational repository, private Issues/PRs/Runbooks, Secrets, and user data were
      not browsed, searched, fetched, or read.
- [ ] No prohibited data or Secret-like value is present in this diff or PR body.
- [ ] Any AI operational input used the
      [canonical "AI-safe export" definition](../docs/operations/AI_AGENT_POLICY.md#ai-safe-export)
      at `docs/operations/AI_AGENT_POLICY.md#ai-safe-export` and inherited all of its
      conditions; no shorter description, checklist, Issue, runbook, queue, or
      artifact omitted or relaxed them. It used a defined allowlist schema and
      deterministic schema/prohibited-field validation; anonymization alone was not
      used as a safety condition.

## Independent review

- Required reviewer: <!-- separate ChatGPT chat / separate Codex session -->
- Reason:
- Review exact base SHA: ``
- Review exact head SHA: ``
- Status: pending
- Findings: <!-- P0 / P1 / P2 / P3 -->

- [ ] The implementation session is not being treated as the final independent
      reviewer.
- [ ] I understand that any base or head change invalidates this final review and
      requires a complete review of the new exact range.

## Merge and Production approval

- [ ] This PR remains Draft until its required checks and independent review are
      complete.
- [ ] This implementation/review session will not merge this PR.
- [ ] Auto-merge is disabled and this PR has not entered a merge queue.
- [ ] The task prompt and PR creation are not being treated as merge approval.
- [ ] Merge requires a later explicit human approval of this repository, PR, base,
      and exact head SHA under `docs/operations/AI_MERGE_APPROVAL.md`.
- [ ] Merge approval is not Production approval.

<!-- If a GitHub-connected operator AI is later used, it must re-fetch base/head,
Draft, mergeable, CI, review, and finding state immediately before merge, reject a
moved head with expected_head_sha or equivalent, and use Squash unless another method
was explicitly approved. -->
