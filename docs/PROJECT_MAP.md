# Repository Project Map

Status: current repository map; verify against the checked-out base before each task

## Purpose

This map tells Codex where behavior, tests, operational policy, and automation live.
It is an orientation aid, not a substitute for reading the current implementation.

## Top-level ownership

| Path | Responsibility | Typical risk |
| --- | --- | --- |
| `AGENTS.md` | Repository-wide Codex contract | Medium when authority or review/merge gates change |
| `src/` | React/Vite application and browser state | Medium; High for implemented privacy/security boundaries |
| `worker/` | Cloudflare Worker, APIs, validation, Durable Object code | Medium or High |
| `scripts/` | Manual-validation and deployment-support tooling | Medium; may become High when external state is changed |
| `public/` | Static assets, PWA manifest, manual handwriting form | Low to Medium |
| `docs/` | Product, architecture, validation, and operations documents | Usually Low; governance can be explicitly Medium |
| `.github/workflows/` | PR verification and GitHub Pages deployment | Medium or High |
| `package.json` / `package-lock.json` | Commands and pinned dependency graph | Medium |
| `SECURITY.md` | Public reporting and security boundary | Low for text-only updates; runtime claims still require evidence |

No repository-specific `.agents/skills/` or `.codex/agents/` directory is currently
required. Root `AGENTS.md` is the active repository instruction surface.

## Stable Free Core

The Stable Free Core is the compatibility and availability boundary that must remain
independent from AI, server-backed optional features, and paid functionality.

| Capability | Primary implementation areas |
| --- | --- |
| Fixed request creation and URL sharing | `src/pages/CreateRequestPage.tsx`, `src/utils/encodeRequest.ts`, `src/utils/shareRequest.ts`, `src/utils/requestPayloadDecoder.ts`, `src/utils/compactRequest*.ts` |
| Product names, quantities, conditions, store order | `src/data/`, `src/constants/`, `src/utils/storeOrder.ts`, request and selected-item utilities |
| Purchase progress and sharing | `src/pages/ShoppingListPage.tsx`, `src/utils/shoppingState.ts`, `src/utils/shoppingSession.ts`, `src/utils/storage.ts`, consultation/share utilities |
| Device-local household catalog | `src/pages/ProductCatalogPage.tsx`, `src/hooks/useHouseholdCatalog.ts`, `src/utils/householdCatalog.ts`, `src/utils/catalogStorage.ts` |
| Catalog export and recovery | `src/pages/CatalogRecoveryPage.tsx`, `src/utils/catalogRecovery.ts`, `src/utils/catalogFingerprint.ts` |
| Routing and published URL entry points | `src/App.tsx`, `src/utils/requestPayloadDecoder.ts`, codec fixtures/tests |

Published v1/v2 compatibility, current v3 fixed requests, v4 photo references, and
catalog-recovery URLs have dedicated tests. Treat IDs, tuple positions, compression,
URL length, route shapes, localStorage keys, and recovery validators as compatibility
contracts.

## Stoppable auxiliary features

| Feature | Front-end | Worker/runtime | Design and validation docs |
| --- | --- | --- | --- |
| Product photos | `src/features/productPhotos/`, photo-aware page tests | `worker/src/photo*` | `docs/PRODUCT_PHOTO_ARCHITECTURE.md`, `docs/PRODUCT_PHOTO_MANUAL_VERIFICATION.md` |
| Updateable request v5 | `src/features/liveRequests/`, `LiveShoppingListPage.tsx`, `LiveRequestManagePage.tsx` | `worker/src/sharedRequest*` | `docs/LIVE_REQUEST_V5_ARCHITECTURE.md`, `docs/LIVE_REQUEST_V5_MANUAL_VERIFICATION.md` |
| Handwriting analysis | `src/features/handwriting/` | `worker/src/index.ts`, `gemini.ts`, validation and Turnstile modules | `docs/HANDWRITING_FORM_WORKFLOW.md`, `docs/HANDWRITING_MANUAL_VERIFICATION.md` |
| Limited manual validation | `src/features/manualValidation/` | `worker/src/manualValidation.ts` | `docs/PHOTO_V5_LIMITED_VALIDATION.md` |

These paths must fail closed or degrade without preventing fixed request creation,
fixed URL opening, purchase progress, or household-catalog export/recovery. Their
normal public feature flags remain separate from the Stable Free Core.

## Application structure

- `src/main.tsx` initializes React.
- `src/App.tsx` owns hash-route parsing and dispatches home, create, product catalog,
  catalog recovery, about, fixed list, live request, live management, and error pages.
- `src/pages/` composes user-visible flows.
- `src/components/` contains reusable UI and dialog/view components.
- `src/hooks/` owns persisted session, household catalog, consultation, and editing
  orchestration.
- `src/utils/` contains codecs, validators, storage normalization, request budgeting,
  recovery, sharing, and state transitions.
- `src/features/` isolates optional product-photo, live-request, handwriting, and
  manual-validation behavior.
- `src/data/` and `src/constants/` contain compatibility-sensitive product/category
  data and limits.
- Application tests are colocated as `*.test.ts` and `*.test.tsx`; broader page and
  integration tests live beside their subjects under `src/`.

## Worker structure

- `worker/src/index.ts` is the Worker entry point and route dispatcher.
- `/` and `/v1/handwriting/analyze` route to handwriting analysis.
- photo routes are implemented by `photoHandler.ts` and related validation/object
  modules.
- v5 request routes are implemented by `sharedRequestHandler.ts` and related token,
  validation, and object modules.
- `turnstile.ts`, `config.ts`, `validation.ts`, `diagnostics.ts`, and feature-specific
  validators enforce shared runtime boundaries.
- Worker tests are in `worker/test/`.
- `worker/wrangler.toml.example` is an example only. A real
  `worker/wrangler.toml`, local vars, bindings, Secrets, migrations, and deploys are
  external-state concerns and are not inferred from this repository.

## Scripts

`scripts/handwriting-manual-test.mjs` and its PowerShell wrappers orchestrate manual
validation. `scripts/handwriting-connectivity-probe.mjs` performs the corresponding
probe. `scripts/write-handwriting-deployment-state.mjs` and `scripts/lib/` support
deployment-state and GitHub Pages workflow handling. Tests for these scripts are
`*.test.mjs` beside the implementation.

Running a local unit test is not authorization to start a manual validation session,
dispatch a workflow, change repository variables, deploy a Worker, or touch external
configuration.

## GitHub Actions as currently implemented

| Workflow | Trigger | Current jobs/actions |
| --- | --- | --- |
| `.github/workflows/verify-pr.yml` | Pull requests targeting `main` | `npm ci`, `npm test`, `npm run test:worker`, `npm run check:worker-bundle`, `npm run test:coverage`, `npm run build` |
| `.github/workflows/stable-free-core-production.yml` | Manual `workflow_dispatch` only | Verify the dispatched SHA is current `main`, build and upload `dist`, reverify current `main`, then deploy to GitHub Pages |

The second row is a material current-state fact: a merge to `main` does not start the
public GitHub Pages workflow. Production deployment requires a human to dispatch the
workflow from `main`; a non-`main` ref or a dispatched SHA that is no longer current
`main` fails closed. Merge approval is not Production approval, and an operator AI
must still re-read current workflows before merge.

Do not run, approve, rerun, or modify the Production workflow merely to validate a
PR.

## Commands and CI correspondence

`package.json` defines the commands. There is no lint or formatting script.

| Check | Command | Notes |
| --- | --- | --- |
| Install | `npm ci` | Uses the committed lockfile |
| Application/repository tests | `npm test` | Vitest run |
| Explicit Worker tests | `npm run test:worker` | Required PR CI step |
| Worker type check | `npm run typecheck:worker` | Also included in `build` |
| Worker bundle | `npm run check:worker-bundle` | Wrangler dry run only; not deploy |
| Coverage | `npm run test:coverage` | Required PR CI step |
| Production build | `npm run build` | TypeScript project build, Worker type check, Vite build |
| Diff hygiene | `git diff --check` | Local repository check |

## Documentation sources of truth

- `docs/operations/OPERATING_MODEL.md`: service and human/AI operating model.
- `docs/operations/AI_AGENT_POLICY.md`: AI authority, data boundary, risk, and review
  policy.
- `docs/operations/AI_MERGE_APPROVAL.md`: canonical approved-merge execution policy.
- `docs/operations/PAID_BETA_READINESS.md`: non-waivable Paid Beta and Public Release
  gates.
- `docs/product-validation/VALIDATION_STRATEGY.md`: product validation phases and
  lifecycle.
- `SECURITY.md`: public vulnerability-reporting and security boundary.
- architecture/manual-validation documents: feature-specific behavior and operator
  procedures.
When a document claim conflicts with current source, tests, package scripts, or
workflow triggers, report the mismatch. Do not edit runtime or external configuration
under a documentation-only Issue to make the claim true.
