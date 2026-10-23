# Product master additions implementation plan

> Execute inline in the existing isolated worktree. Use focused regression checks and a fresh read-only Codex review before handoff.

**Goal:** Make the 17 distinct one-time product names in the user's supplied shopping-history summary selectable from the standard catalog.

**Architecture:** Add catalog data only. Preserve the 93 published v2/v3 product numbers exactly; the existing v3 snapshot branch already handles catalog products without a published number. Do not change codecs, Worker/API limits, storage, or deployment settings.

**Tech stack:** TypeScript, existing React catalog consumers, Vitest.

## Task and scope

- User task: update the master with the newly added products previously shared; the user supplied the historical summary in this conversation.
- Base: `main`, `ff301fb506659b6a63057d31ebefc778049ba639`, fetched before editing.
- Branch: `feat/master-products-20261023`.
- Existing worktree reused: `kaimono-baton-phase3`; clean before branching.
- Risk: Medium because application catalog data changes.
- No Issue was supplied; this user task is the acceptance source.
- Product names in this task are explicitly supplied and authorized for catalog addition. No original shared URLs, private operational sources, browser drafts, tokens, photos, or account data are needed.

## Data decisions

- Preserve every existing product definition and relative order. Append the 17 additions to the data array, with category-specific `sortOrder` values after existing entries.
- Keep the names ベビーチーズ / 1歳チーズ and ベビー食 / ベビーフード separate; the supplied summary does not establish identity.
- Use default quantity 1. Do not turn historical purchase counts, color/flavor preferences, or one-off notes into new global defaults.
- Preserve descriptive wording in the supplied names, including かまぼこ ピンク and 鶏もも肉（2個入り）. Use パック for the latter and 個 for the other one-time products, consistent with the supplied summary's explicit units and the existing one-time-product fallback.
- No automatic household-product deduplication, renaming, hiding, selection, or draft replacement.

## Files

| File | Purpose |
| --- | --- |
| `src/data/products.ts` | Add 17 product records in existing categories |
| `src/data/products.test.ts` | Required names, data validity, unselected initial draft, and selection/share round trip with a pre-update catalog |
| `src/utils/compactRequest.test.ts` | Keep v2 tests scoped to its published 93-product vocabulary while preserving its checksum |
| `src/pages/ProductCatalogPage.test.tsx` | Fix the valid Unicode recovery fixture to the published 93-product vocabulary; all 110 products at maximum text size exceeded the unchanged 200,000-character bound |
| This plan | Scope, checks, and rollback |

## Execution checklist

- [x] Install locked dependencies with `npm ci` and verify the clean baseline using `npm test -- src/data/products.test.ts src/utils/compactRequest.test.ts src/utils/compactRequestV3.test.ts src/utils/compactRequestV4.test.ts src/utils/catalogRecovery.test.ts src/utils/createRequestState.test.ts` (83 passed).
- [x] Add acceptance/regression tests first. Verify they fail because the requested products are absent (3 failed, existing 2 passed).
- [x] Add the 17 catalog records, with existing category IDs, stable unique IDs, and valid field lengths.
- [x] Keep `SHARE_PRODUCT_IDS_V2` and its `972434876` checksum unchanged. Scope the v2 fixtures to the published vocabulary so they still cover all 93 supported products and 1,000 condition characters.
- [x] Verify all added selections survive v3 encode/decode, including when the decoder has only the pre-update catalog. Verify the real LINE delivery URL stays within 2,200 characters.
- [x] Run the focused checks (86 passed), `npm test` (1,207 passed, 2 existing skips), `npm run test:worker` (173 passed), `npm run check:worker-bundle`, `npm run test:coverage`, `npm run build`, and `git diff --check`.
- [x] Compare the base/current existing product records and published ID table; require exact equality (93 unchanged, 110 total).
- [ ] Commit only scoped files, push the dedicated branch, and create a Draft PR. Record exact base/head, CI and independent review.

Browser validation: a fresh local origin at `127.0.0.1:5187` displayed all 17 additions in the standard catalog; each was selected through its quantity button, and the confirmation screen showed all 17 with their categories and units. No LINE send was performed. Production and existing drafts were not used. Coverage passed at 92.37% statements / 87.40% branches / 95.85% functions / 92.38% lines. The first sandbox-only test invocation failed before running tests due to Temp-file rename permissions; the same baseline passed outside that sandbox restriction.

## Compatibility and boundaries

Existing v1/v2/v3/v4 fixtures, household overrides and backups, unselected initial drafts, and fixed/live creation must remain valid. New products use existing v3 snapshots rather than adding unknown numeric references to older clients. The fixed 303-item limit remains unchanged on both clients and Worker; this task does not increase request capacity. Snapshot URLs cost more characters, so retain existing length checks.

No runtime changes beyond catalog data; no dependency, lockfile, workflow, capability, API, Durable Object, photo, legal, or external configuration changes. Do not merge or deploy in this task.

## Rollback

Before release or any saved use of the new product IDs, the task can be reverted. After release, retain all 17 product IDs and their catalog definitions and fix forward. Do not recommend a blanket catalog revert or deployment of the pre-update master: household overrides and recovery files customized for new base IDs are rejected by older masters, and a subsequent old-client save can replace settings with defaults. Never delete saved catalog generations to make an older build load.

Existing pre-update household catalogs/backups continue to load in the new build. New fixed-request snapshot links also remain readable by pre-update masters because they carry names, units, and categories; this does not imply that newer household override/backups are readable by an older master. A rollback that removes new IDs would require a separately reviewed recovery/migration design and is outside this task. No storage migration or external operation is performed here.

## Review contract

Use a fresh read-only Codex context against the exact base/head and the complete diff. Verify the user-supplied 17-name inventory, old product metadata/IDs, snapshot compatibility, tests, and diff scope. Fix P0/P1 and material P2 findings before handoff. Any source change invalidates the exact-head review.
