# 商品検索・購入済み表示・定型相談の実装計画

- Task: 2026-10-24の利用者依頼（Issue番号なし）。3機能の実装、検証、Draft PRまで。
- 最新取得済みbase: `5b554f889232234f3a80867153055900f1809ae8`。
- Branch: `feat/search-compact-consultation`。開始時working tree clean。
- 申告された旧base `ea2582f6f4f14bedf98b9591ce281fbfff8aa654` 以降は写真PR #26のみ。
  #26はmainへmerge済みのため基盤として保持。未merge #25からは取り込まない。
- Risk: Medium（frontendのuser flow・表示・相談文生成）。privacy/API/保存契約の変更なし。

## 変更予定と受入条件

1. `CreateRequestPage`、検索UI/検索utilityとテスト、selection CSS。
   visibleな家庭用effective catalogのみをローカル部分一致検索。数量・条件・写真は
   既存ProductSelectionSections/useCreateRequestDraftを共用。IME入力を加工せず検索比較時だけ
   空白/大小/幅を正規化。0件から既存自由追加へ上限制御付きprefill。
   検索解除/切替でも選択内容、共有確認導線、URL budgetを維持。
2. `ShoppingItemCard`、テスト、shopping CSS。
   既存isCartStatus/hasConditionと未解決相談・変更noticeで表示適格性を判定。
   verified/条件確認不要inCartだけ初期コンパクト。明示的な詳細toggleで条件/写真/操作へ。
   状態遷移・並び順・購入確認・5秒Undo・filter・checkout集計は変更しない。
   キーボードと折畳みに伴うfocus、320〜430pxを確認。
3. `ConsultationDialog`、`shoppingMessages`とテスト、必要なCSS。
   4定型を既存note-only相談（other + note）へ生成し保存形式を増やさない。
   商品/数量/条件は既存message builderで構成。既存自由文は確認なしに置換しない。
   選択だけで送信/購入状態変更しない。queue/share/cancel/edit/resolvedを保持。

## 不変条件・非対象

v1〜v4 URL/端末保存/Worker API/商品masterは変更しない。v5の状態と未確認変更を保持。
写真ON/OFF・手書きOFF・optional機能の独立停止とStable Free Coreを維持。
依存追加、lockfile、Worker、workflow、Production、Cloudflare、Secret/Variable/migrationは変更しない。
公開sourceと自作合成fixtureだけを使い、private ops・利用者内容・Secret・実共有URLは取得しない。

## 検証・レビュー

- 各機能の単体/コンポーネントテストと、検索→数量/条件→共有準備→購入確認→
  コンパクト→定型相談/共有cancel→解決→checkout/結果のflow検証。
- URL互換、写真/v5 ON/OFF、相談保存、Undo、IMEの既存回帰を含む全suite。
- `npm ci`、`npm test`、`npm run test:worker`、`npm run check:worker-bundle`、
  `npm run test:coverage`、`npm run build`、`git diff --check`。既存PR CIの追加runtime checksも確認。
- 合成入力のみのローカルブラウザ検証。実LINE送信/スマホOS IMEは未検証として分離。
- 可能なら機能別3commit。1 Draft PR。CI成功後、fresh read-only Codexでexact base/head完全差分レビュー。
  base/head変更時は完全再レビュー。Ready化/merge/Productionは実行しない。

## リスクとrollback

検索で選択を失う、旧inCart/未解決相談/変更を隠す、相談文重複/自由文消失、
折畳みfocus消失を重点検証。失敗時は今回のfrontend差分をrevertするPRを用意する。
保存形式・API・migrationを変えないためdata rollback不要。今回の承認は公開承認に流用しない。
