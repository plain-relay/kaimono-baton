# AGENTS.md

## Scope and authority

These instructions apply to the entire repository. There are currently no nested
`AGENTS.md` files.

Work only on the active Issue or task. A request to investigate, implement, review,
or open a pull request is not approval to merge, deploy, change external state, or
handle private operational data. When instructions conflict, stop and ask rather
than widening scope.

This repository uses the following role separation:

1. planning defines scope, invariants, risk, checks, and rollback;
2. implementation changes a dedicated branch and opens or updates a Draft PR;
3. independent review uses a fresh, read-only context against exact base/head SHAs;
4. merge approval is a separate, explicit decision by an authorized human;
5. Production release and other external changes are separately approved and
   human-executed operations.

`docs/operations/AI_MERGE_APPROVAL.md` is the canonical policy for an authorized
GitHub-connected operator AI performing an approved merge. It does not grant a
Codex implementation or review session permission to merge its own work.

## Read before changing files

Read, in order:

1. this file;
2. the active Issue and its current acceptance criteria;
3. `docs/CODEX_WORKFLOW.md`;
4. `docs/PROJECT_MAP.md`;
5. `docs/operations/AI_AGENT_POLICY.md`;
6. `docs/operations/AI_MERGE_APPROVAL.md`;
7. the relevant source, tests, workflows, and product or operations documents on
   the current base commit.

Do not revive, merge, cherry-pick, or copy an obsolete branch or closed unmerged PR
without explicit authorization. Re-evaluate any historical idea against current
`main`, current Issues, current tests, and this contract.

## Repository and branch safety

- Start from the requested base SHA. Fetch the remote before editing and confirm
  `origin/main`, local `HEAD`, and the working tree state.
- If `origin/main` differs from the requested base, investigate the intervening
  commits. Do not silently implement from the old base. Rebase only when the current
  task remains compatible and authorization permits it; otherwise stop and report.
- Use one dedicated branch per Issue or independently reviewable unit.
- Never push directly to `main` and never force-push `main`.
- Preserve unrelated user changes. Stage only files in the confirmed scope.
- Keep source, tests, dependency files, lockfiles, workflows, and external settings
  unchanged unless the active task explicitly requires them.

## Project commands

Run commands from the repository root. Use only scripts that exist in the current
`package.json` and checks required by current workflows.

- Install: `npm ci`
- Application and repository tests: `npm test`
- Worker tests: `npm run test:worker`
- Worker type check: `npm run typecheck:worker`
- Worker bundle check: `npm run check:worker-bundle`
- Coverage: `npm run test:coverage`
- Production build, including application TypeScript and Worker type checks:
  `npm run build`
- Diff validation: `git diff --check`

There is no lint or formatting script. Do not invent a command or add a dependency
solely to create one. `npm test` currently discovers tests outside `worker/test` as
well; still run `npm run test:worker` because it is an explicit required CI step.

## Product invariants

The household Stable Free Core must remain available independently of AI, photos,
live-request v5, handwriting analysis, and paid or server-backed optional features.
It consists of:

- fixed requests;
- URL sharing;
- product names;
- quantities;
- conditions;
- store order;
- purchase progress;
- the device-local household catalog;
- household-catalog export and recovery.

Photos, updateable requests (v5), and handwriting analysis are stoppable auxiliary
features. They must have isolated failure paths and must not prevent the Stable Free
Core from being created, opened, used, exported, or recovered.

Unless the active Issue explicitly authorizes a compatible change, preserve all
published URL formats, fixed IDs, payload shapes, URL budgets, localStorage keys and
stored shapes, recovery behavior, share semantics, Japanese IME limits, shopping
state transitions, accessibility behavior, and optional-feature defaults.

## AI data boundary

Never browse, search, fetch, or read any private operational repository. Do not access private
Issues, private PRs, private Runbooks, private repository search results, Secrets,
or user data as a shortcut for implementation or review.

Do not provide an AI with:

- photos or image blobs;
- product names, condition text, or free text;
- a complete shared URL;
- request tokens, photo tokens, edit secrets, or Turnstile tokens;
- API keys, Secrets, cookies, or authorization headers;
- names, email addresses, street addresses, or phone numbers;
- payment identifiers;
- raw support text;
- request or response bodies;
- raw provider errors;
- private Issues, private PRs, private Runbooks, or private repository search
  results.

AI operational input is permitted only when a deterministic producer emits a
payload matching a defined allowlist schema and a deterministic validator confirms
schema validity and the absence of every prohibited field before the payload reaches
the AI. Anonymization, pseudonymization, or removal of direct identifiers alone is
not sufficient.

## Risk classification

Classify the complete diff by its highest applicable risk. An Issue may explicitly
raise the classification. Do not lower it because the diff is small.

### Low

Only documentation, Issue/PR text, narrowly scoped non-runtime tests, or similarly
reversible changes that do not alter source behavior, dependencies, workflows,
builds, deployment, external state, or implemented safety controls.

Required: scoped rationale, applicable focused checks (or a recorded non-applicable
reason), full required CI, `git diff --check`, rollback, and independent read-only
review at exact base/head. A separate GitHub-connected ChatGPT chat may perform the
review only when every condition in "Review method" is met.

### Medium

Any user flow, application source, test-backed behavior, URL codec, localStorage,
recovery, PWA, Worker/API contract, dependency or lockfile, build, GitHub Actions,
staging, multi-module change, or repository-wide agent/review/merge governance
change that is not High.

Required: written plan and rollback, dedicated branch, focused tests, all applicable
local checks, full required CI, and a fresh read-only Codex review at exact base/head.

### High

Any runtime implementation or external-state change involving privacy, security,
authorization, capability URLs, retention, deletion, migration, billing, Secrets,
DNS, Production configuration, legal publication, or release of paid functionality.

Required: everything for Medium plus a deterministic security checklist, staging
evidence, explicit human acceptance of residual risk, and separate human approvals
for merge and every Production, migration, legal, billing, data, or external-setting
operation. AI still does not execute those external operations.

## Review method

Risk and review tool are related but separate decisions.

A fresh GitHub-connected ChatGPT chat may review only when all of these are true:

- the diff changes only documentation, Issue text, or PR text;
- it changes no source, test, dependency, lockfile, workflow, Worker, build, runtime,
  deployment, external setting, or implemented safety control;
- it can inspect the complete diff at exact base SHA and exact head SHA;
- it is read-only and accesses no private ops, Secret, or user data;
- no command or test is needed to establish actual behavior.

A fresh Codex session is required when any source or test changes; when the change
touches Worker, API, URL codecs, localStorage, PWA, dependencies, lockfiles, builds,
Actions, deployment, runtime privacy/security/authorization/retention/migration,
Rate Limits, logging, monitoring, kill switches; or when repository inspection or
commands are needed. The active Issue may require Codex review even for a docs-only
diff.

The implementer is not the final independent reviewer. Record the review's exact
base SHA, exact head SHA, complete diff, method, checks, findings, and disposition.
Any change to base or head invalidates the entire final review; review the complete
new diff, not only the latest patch. P0 and P1 findings must be fixed. A P2 affecting
a non-waivable Paid Beta or Public Release condition must be fixed. Other P2 findings
require explicit human acceptance with rationale, owner, and deadline.

## Pull requests and merge

- Codex implementation and review sessions must always open and update Draft PRs only.
  They must not mark a PR ready for review, even when a user requests it in the task
  prompt. Ready-for-review status is a separate decision and GitHub operation that
  an authorized human performs after the required checks and independent review.
- The PR body must identify the Issue, exact base/head SHAs, changed files, purpose,
  invariants, checks, CI, risk, rollback, external-state impact, data-access boundary,
  and required independent review.
- Do not enable auto-merge or enter a merge queue.
- A Codex session must not merge a PR it created, changed, or used as its required
  review target. The user's task prompt is not future merge approval.
- Human merge approval must identify the repository, PR, base, and exact head SHA
  after the current merge snapshot is presented.
- Only a separate GitHub-connected operator AI may perform an approved merge, and
  only when every condition in `docs/operations/AI_MERGE_APPROVAL.md` is satisfied.
- The operator must re-fetch base/head, Draft, mergeable, required CI, independent
  review, and finding state immediately before merge, and pass the approved exact
  head as `expected_head_sha` or an equivalent compare-and-swap guard.
- If base, head, diff, required CI, or review result changes after approval, approval
  and final review are invalid and must be repeated as required.
- Default merge method is Squash when no method is specified.

The current `.github/workflows/stable-free-core-production.yml` must be inspected
before any merge because repository workflow behavior can change. Merge approval is
never Production approval.
If merging would itself trigger a Production action that cannot be separated, an
operator AI must stop; it must not use merge approval to cause that Production action.

## Operations AI must never execute

Even with human approval, no AI may execute:

- Production deploy or Production workflow start, approval, or rerun;
- Cloudflare, DNS, GitHub Environment, Secrets, Variables, or billing changes;
- Durable Object migration;
- charges, refunds, or cancellations;
- user-data retrieval, deletion, or recovery;
- messages to customers, participants, or reporters;
- security-incident publication or notification;
- finalization or publication of terms, privacy policy, or legally required seller
  disclosures;
- Production stop or restart.

AI may prepare instructions, checklists, drafts, and rollback plans for those actions,
then must stop. Maintenance and review must remain operable with ChatGPT Plus only;
do not require Claude API, Claude Pro, ChatGPT Pro, or another paid AI service.

## Completion report

Report the exact base/head, branch and PR, changed files, local checks, CI run and
result, independent-review status, unresolved items, risk, rollback, and confirmation
that the PR was not merged and no Production, external configuration, Secret, private
ops, or user-data operation occurred.
