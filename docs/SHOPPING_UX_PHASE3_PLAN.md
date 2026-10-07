# Shopping UX phase 3: household default conditions

## Contract

The user requested the third installment: edit household usual conditions, copy
them into new requests, and include them in export/recovery. Base:
`8268a06c7985ec4970c90d0c2b94eef014a673a3`, freshly fetched main. Branch:
`feat/household-conditions-phase3`, isolated checkout `kaimono-baton-phase3`.
Risk: High under AGENTS.md because this includes a local catalog version upgrade.
No server migration, user-data access or Production operation is authorized.

## Acceptance and design

1. Base overrides and household products support optional `defaultMemo`, bounded
   by the existing 30 user-character condition limit. Undefined inherits a base
   condition; empty string explicitly clears it. Never concatenate conditions.
2. Effective products resolve this to existing `memo`. Existing draft helpers
   copy it only for missing draft entries or explicit next-list creation. Saved
   drafts (including empty conditions), current inputs and shared snapshots stay
   unchanged. Temporary conditions never automatically become household defaults.
3. The existing product editor exposes “いつもの条件”, explains when it applies,
   uses the IME-aware input, and preserves defaults during hide/restore operations.
4. New storage and recovery use catalog V2. Strictly accept legacy V1 without
   allowing the new field under version 1. Load V1 non-destructively into memory
   when neither V2 generation exists; only an explicit edit/recovery writes V2.
   Keep both V1 keys intact. Once V2 exists, do not merge stale V1-tab edits.
5. Current/previous V2 generations, failed writes, and backup fingerprints account
   for conditions. V1 recovery links/JSON remain readable. V2 export preview
   counts condition settings; oversized links retain the existing JSON fallback.
6. The Live management add form initializes the selected catalog product's
   condition, allows an explicit empty edit, and never changes existing items.

## Invariants and security checks

Fixed/live request codecs, IDs, shopping states, Worker/API/capabilities, flags,
retention, dependencies and workflows are unchanged. Only synthetic fixtures.
Validate unknown/dangerous keys, versions and length before persistence/recovery;
render text through React; no extra logging, network storage or automatic learning.
New keys isolate older builds. Rollback leaves V2 data intact but older builds see
the retained V1 catalog and cannot restore V2 backups. Explain this limitation.

## Checks, review and release

Focused catalog/storage/recovery/draft/live-form tests, then npm ci, npm test,
npm run test:worker, npm run check:worker-bundle, npm run test:coverage,
npm run build and git diff --check. Local browser validation on an isolated origin
with synthetic conditions is staging evidence; real data is never read. A fresh
read-only reviewer checks the complete exact base/head. Record CI in a Draft PR.
Merge, Production release and residual-risk acceptance are separate decisions.

## Rollback

Revert the source changes through a reviewed revert. Do not delete or overwrite
V1/V2 catalog storage. V1 data is retained unchanged; V2 defaults return when the
new build is restored. Keep a V2 JSON export before rollback if used operationally.

## Implementation verification

The complete change is confined to catalog types, validation/storage/fingerprint/
recovery, the catalog editor/list and recovery confirmation, Live add-form default
initialization, related tests, and this plan. No Worker, codec, dependency, flag or
workflow changes. Draft initialization reuses existing helpers without changing
their source. Backup receipts keep their existing key/shape and use V2 fingerprints.

Synthetic browser verification used a separate localhost origin (port 5183):
Chrome saved N1 for yogurt, a fresh request inherited it, a temporary request edit
survived reload, and the catalog retained N1. The in-app browser independently
saved N1, previewed a synthetic V2 recovery link with one condition, restored it,
showed the backup receipt, and inherited it into a fresh request. Screenshot:
`../phase3-validation/restored-usual-condition.png` in the host workspace, outside
Git. Native sharing and next-list confirmation could not be completed through the
browser-control tool (focus-emulation timeout); no sharing destination was chosen.
The user cannot operate the PC now, so those manual checks remain explicit release
follow-ups. Automated tests cover next-list confirmation, persisted empty/temporary
drafts, fixed snapshot propagation, recovery round trips, and shared snapshot stability.

Security checklist: unknown/dangerous keys and version mismatches rejected; V1
cannot contain the V2 field; Unicode 30-character bound enforced; condition text
rendered as text; V1 current/previous left untouched; no legacy fallback after V2
exists or V2 read errors; failed reads cannot cause rollback deletion; conditions
participate in revision/fingerprint/preview; no server or permission change.

Residual release considerations: V2 backups require a V2-capable build. Old tabs
can still edit their retained V1 copy, but those edits are not automatically merged.
Old backup receipts become unbacked after the fingerprint format changes. Normal
multi-tab editing still uses the existing last-writer-wins catalog behavior.
