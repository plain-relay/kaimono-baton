# Shopping UX phase 1

## Task and range

- Repository: `plain-relay/kaimono-baton`.
- Task: implement the phase-1 UX proposal approved in the current conversation.
- No Issue number was supplied; this approved task is the acceptance contract.
- Base: `main`, `35e94f28587e8e60ad5a39fcd83748f47880c70a` (fetched and verified).
- Branch: `feat/shopping-ux-phase1` in an isolated worktree. Original checkout stays unchanged.
- Risk: Medium (frontend flows and existing draft/consultation behavior).

## Acceptance criteria

1. Shopping cards present quantity and unit together near the product name, including
   quantity one in the visible cart button. Conditions precede reference photos;
   the redundant condition badge is removed. Existing cart confirmation stays intact.
2. A separate next-list action clears quantities, one-time conditions/items/photos
   and sharing UI, and restores effective product master memos. Full clear remains
   available with explicit wording. Resume preserves saved edits, including empty memos.
   Selected products expose their condition while their editor is collapsed.
3. The item action exposes both questions and not-buying. A non-empty note can be
   shared or queued without a selected reason, using existing `other` storage.
   Free questions omit the artificial other/replacement wording. Not-buying still
   requires an explicit reason and reuses existing state transitions and Undo.
4. Share cancellation/failure preserves input; unresolved questions survive reload,
   remain visible in checkout and part of completion checks, and share success
   means a share operation only.

## Files and invariants

Change the shopping/product cards, creation bottom actions/page,
consultation dialog/hook/summary/checkout/message utilities, CSS, and focused regression tests.
Update existing interaction tests for the intentionally changed visible labels.
Use existing localStorage keys/shapes, request IDs/codecs/budgets, catalog/recovery,
share lock, IME input, dialogs, purchase states, and optional-feature defaults.
No Worker, API, dependencies, lockfile, workflows, capability URLs, retention,
schema migration, photo/live flags, production or external settings are changed.
No private ops, real shopping data/photos/links/tokens or Secrets are accessed.
All test content is synthetic or existing public source fixtures.

## Validation

- Focused creation, card, consultation, message and shopping journey tests.
- Required existing commands: `npm ci`, `npm test`, `npm run test:worker`,
  `npm run check:worker-bundle`, `npm run test:coverage`, `npm run build`,
  `git diff --check`.
- Local browser: selected condition visibility; next-list versus full-clear;
  narrow-screen shopping quantity/unit; note-only question and reason-only skip.
- Fresh read-only Codex review of the complete exact base/head range before merge.
  The implementation session is not the independent reviewer.
- Draft PR and exact-range validation record; human merge approval remains separate.

## Rollback and handoff

Rollback the application commit through a separately reviewed revert. No schema or
external rollback is needed. Fixed URLs, stored drafts/consultations and household
catalogs remain readable by the old code; old UI may display a free question as other.
Merge/deploy/ready-for-review/auto-merge and production operations are not authorized.
Stop for an unavoidable scope expansion, private data requirement, or prohibited
external operation; record unavailable checks without claiming success.

## Local verification record

- Required local checks passed, including the coverage thresholds and Worker dry-run.
- Browser checks used synthetic data at 375px width: quantity/unit grouping,
  visible conditions, note-only question enabled without a reason, not-buying
  disabled until a reason is selected, queued question reload and reason-based skip.
- Screenshots were saved outside the repository in `phase1-validation`.
- The in-app browser stalled while opening a native next-list confirmation. Browser
  confirmation/reset verification is incomplete; automated creation tests verify
  confirmation accept/cancel, fresh request ID, draft resume, full clear, preserved
  catalog, discarded temporary items/photos, and busy-operation guards.
- Physical iPhone/Android LINE sharing was not performed; existing native-share
  success/cancel/failure tests and free-question regression tests cover the contract.
- Exact head, CI and independent-review evidence belong in the Draft PR body so
  recording that evidence does not change the reviewed code range.
