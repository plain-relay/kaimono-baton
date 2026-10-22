# Refactoring execution record

Task: execute the refactoring plan approved in the conversation on 2026-10-22.
Base: 83db93fb50d59b0f5cbccb084cc930f1b79ad8c4 (freshly fetched main).
The existing Symphony working tree is preserved. No historical branch is reused.

## Scope and sequence

1. Request sharing: move photo upload/authentication resource lifecycle and live creation/management metadata into their features; keep share locking, fixed URL preparation, persistence and native sharing in a focused coordinator.
2. Shopping: extract purchase confirmation, checkout freshness, and result sharing, preserving latest-state reads and async generation guards.
3. Live management: separate remote state/patch orchestration and item-add form.
4. CSS: split contiguous rule groups while preserving selectors and exact cascade order.
5. Worker: separate handwriting analysis from dispatch; do not unify feature-specific CORS/ETag/error contracts.

Each stage has its own branch/commit and independent Draft PR against the same fetched main, so the existing main-targeted PR CI runs for every stage. The changes are also verified together locally. Dependencies, lockfile, workflows, URL codecs, localStorage schemas, retention and external settings are outside scope.

## Invariants and validation

Preserve the Stable Free Core, published URLs/IDs/limits, catalog default conditions and recovery, IME, browser sharing activation/cancellation, shopping transitions, five-second Undo, accessibility/focus and optional-feature defaults. Tests use only repository synthetic fixtures; private operations, Secrets and user data are not required.

Run the existing request/page/codec/storage/live tests as appropriate and all required checks: npm ci; npm test; npm run test:worker; npm run check:worker-bundle; npm run test:coverage; npm run build; git diff --check. Record baseline/final results in PRs. Keep existing coverage thresholds.

## Risk, security contracts and release gates

Conservatively High for movement of capability URL and authentication-adjacent runtime code; other application/CSS stages are Medium. Deterministic checks must preserve: feature flags and disabled behavior; no management secret persistence; validation-session data suppression; Turnstile action/hostname checks; unchanged Worker validation order, CORS, strong ETags, errors, deletion/retention; no new logging/network/storage destinations. Existing tests and complete-diff review establish these checks. Human staging/manual verification and residual-risk acceptance remain release gates; no external operation is executed by this task.

Fresh read-only Codex review is required at each exact base/head. Any change invalidates that final review. This implementation does not merge or mark PRs ready.

## Rollback

Revert the affected stage in dependency order (later stages first where necessary). No migration or new storage format is introduced. Production rollback, if required after a later human release, uses the prior verified artifact through the existing human-only release procedure.

## Recorded implementation evidence

- Baseline: 111 test files; 1,204 tests passed and two existing skips.
- All five stages together: the same 1,204 tests passed; 173 explicit Worker tests passed; Worker bundle dry-run and build passed. Coverage: statements 92.37%, branches 87.4%, functions 95.85%, lines 92.38% (all above existing thresholds). Final PR CI is recorded in each Draft PR rather than assumed from local results.
- CSS files, joined in import order with their separating newlines, reconstruct the original source exactly. The production CSS asset remains `index-BMUvjJEt.css` with identical contents. This establishes unchanged selectors, cascade and responsive/focus rules without changing the UI.
- The extracted handwriting request function body is identical to the original apart from its dependency type name. Photo/v5 handlers, validation, authorization, ETags, retention and Durable Objects are unchanged.
- Published-format, storage, recovery, IME, sharing, live-update and shopping-journey tests remain in place. No operational data was used.
- Public Issue creation was rejected by automatic approval review; this conversation task and execution document are the task record. The rejected action was not retried through another channel.
- Independent reviews, exact final head SHAs, required CI runs, and human-only staging/residual-risk gates are recorded in each Draft PR. Local/CI tests do not substitute for those manual release gates.
