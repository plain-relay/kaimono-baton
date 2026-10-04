# Shopping UX phase 2: requester updates and checkout

## Contract and base

- Active task: the user requested the second installment of the previously
  proposed plan, after phase 1 was published. Phase 2 is requester additions and
  changes through the existing Live Request, before household memory or shopper add.
- Base: `main`, `f1330b437e327a3afdf51cc26007b5b776e292ed` (freshly fetched).
- Branch: `feat/live-request-phase2`, isolated checkout `kaimono-baton-phase2`.
- Risk: Medium; purchase confirmation and frontend synchronization behavior.

## Acceptance criteria

1. Existing requester additions appear on the same purchaser list without losing
   cart progress, consultations, issues, ordering or cancellation history.
2. Every unacknowledged update remains actionable even with a filtered list and
   prevents shopping completion. A changed cart item requires confirmation of the
   current quantity and condition; a generic bulk acknowledgement cannot bypass it.
3. A target item update or cancellation invalidates an open confirmation dialog.
   An unrelated update does not discard checks for an unchanged item.
4. Entering checkout and finishing a live list check the latest revision, sharing
   an in-flight check and rejecting double clicks. New updates prevent completion.
5. A failed/expired check retains the last good list and local progress. Finishing
   without current server confirmation requires an explicit, clearly labelled
   choice, and never bypasses known outstanding changes or unresolved items.
6. Acknowledging one item cannot clear another item or a newer revision, survives
   reload, and remains conservative when cache persistence fails.

## Scope and invariants

Change Live Request sync hook, purchaser shopping/checkout and confirmation UI,
focused tests and the existing verification documents. Reuse the existing API,
ETag, pendingChanges and local purchase states. Do not add a new state machine,
capability, server purchase state, chat, catalog schema, dependency or workflow.
Published routes, Worker contracts, localStorage keys/shapes, fixed requests,
feature flags, retention and requester edit permissions stay unchanged.
Use synthetic tests only; no private operations, real links, photos, tokens,
Secrets or user data. No Production/Cloudflare/flag changes are part of this task.

## Validation, review and release

Focused synchronization/checkout regressions plus current required checks:
`npm ci`, `npm test`, `npm run test:worker`, `npm run check:worker-bundle`,
`npm run test:coverage`, `npm run build`, and `git diff --check`.
Use a fresh read-only Codex reviewer against the complete exact base/head diff,
record CI and remaining physical two-device checks in a Draft PR.
Local browser verification with a disposable synthetic API covered a cart item
change, remaining-only filtering, quantity/condition reconfirmation, blocked
checkout and explicit offline completion. The preview harness is not shipped.
Public Live Request remains disabled. Actual availability additionally requires
separate Worker binding/migration/configuration verification, two-device staging
and release authorization; frontend tests alone do not establish this.

## Rollback

Revert the application change through a reviewed revert. No schema, migration,
Worker or external rollback is required. Older builds can read all stored state,
but lack the strengthened checkout guards; do not enable public Live Request on
the basis of the old checkout behavior.
