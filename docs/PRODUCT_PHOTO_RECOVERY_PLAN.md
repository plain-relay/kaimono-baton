# 商品写真復旧 実行計画（2026-10-23）

- Task: ユーザーの「商品写真機能の復旧・検証・一般公開準備」。Issue番号なし。
- Base: `main` / `ea2582f6f4f14bedf98b9591ce281fbfff8aa654`（remote fetch済み）。
- Branch: `fix/product-photo-recovery-20261023`。専用clean checkoutから開始。
- Risk: Highとして扱う。写真・capability・保存期間の検証を含むため。外部変更は実行しない。
- 正本: AGENTS、CODEX_WORKFLOW、PROJECT_MAP、AI_AGENT_POLICY、AI_MERGE_APPROVAL、写真architecture/manual/limited-validation、現行source/tests/workflows、過去PR #10/#11/#12。

## 対象と不変条件

既存の写真UI、Canvas処理、Turnstile、Worker multipart、PhotoObject SQLite、v4 codecを再利用する。
商品検索・履歴・代替・相談の新機能、v5、商品マスター、手書き/Gemini、料金サービスは対象外。
v1〜v3互換、写真なしv3、写真付きv4、1商品1枚/最大3枚、14日固定expiry、購入進捗・条件・復旧を維持する。
本番flagはOFF。dependency/lockfileとProduction workflowは変更しない。

## 手順

- [x] 最新mainと規則、写真経路、過去修正を読む。既存baseline 1207 pass / 2 skip。
- [x] 無応答を再現する失敗テストを先に追加し、写真uploadの待機が終了しないことを確認する。
  対象: `src/features/productPhotos/ProductPhotoUploadProvider.test.ts`。
- [x] 原因が再現された場合のみ、同providerへ処理全体の60秒deadlineと親AbortSignal連携を追加する。
  認証待ち・POST・response bodyのすべてを同じdeadline内に収め、既存の再送回数・token resetを維持する。
- [x] `scripts/photo-runtime-check.mjs`で現行Workerをbundleし、Miniflare/workerdと本物のSQLite DOで1/2/3枚POST→GET、拒否、再送、期限・Alarmを検証する。
  Siteverify外部境界は決定論的fixtureとして明記。mock storageへ置換しない。合成JPEGのみ。
- [x] 実ブラウザから同じWorkerへ写真付き固定依頼を作成・共有・再読込・拡大・購入し、0/1/2/3枚と失敗/キャンセルを確認する。
- [x] 設定一覧・10段階の結果・非確認事項・Cloudflare公式仕様・実機最短手順・公開/停止/rollbackを復旧記録へ残す。
- [x] `npm test`、`npm run test:worker`、`npm run check:worker-bundle`、`npm run test:coverage`、`npm run build`、`git diff --check`。
- [ ] 専用branchをcommit/pushしDraft PR作成。必須CI確認。
- [ ] fresh read-only Codexでexact base/head完全差分を独立レビュー。head変更時は完全再レビュー。

## データ境界・安全チェック

追加調査による計画更新: workerd起動時に `worker/src/index.ts` の文字列定数exportを拒否するREDを確認。
定数の定義とHTTP headerは維持し、入口re-exportだけを削除、`worker/test/index.test.ts` のimportを定義元へ変更した。
同じ事故をbundle dry-runだけで見落とさないよう、`.github/workflows/verify-pr.yml` にlocal runtime検査を1step追加する。
Production workflow・実wrangler設定・依存/lockfileは変更しない。

private ops、実利用者データ、Secret、既存共有URLへアクセスしない。
合成画像と架空fixtureだけをプログラム内で扱い、画像/token/完全URL/bodyをログやPRへ出さない。
診断出力は固定case名、枚数、HTTP status、pass/failに限定する。
Origin完全一致、Turnstile action/hostname、MIME/容量/APP1拒否、異内容上書き拒否、固定expiry、削除、flag停止、無料コア縮退をテストで確認する。

## 残る人間の操作とrollback

実Cloudflareの既存namespace・migration/exports・billing・Turnstile対応を人間が確認する。
stagingの実サービス、Android/iPhone/LINE、外部実機証拠がそろうまで一般公開可とは判定しない。
merge、Production、binding/migration、Secrets/Variables、workflow dispatchは別承認・人間実行。
障害時は人間がWorkerの写真flagと限定検証をOFFにし、Pagesの写真flagをOFFで再buildする。
DO class/namespace/migration履歴/保存データは削除せず、Alarmを維持したforward deployを優先する。
コード差分はrevert可能。migration rollbackとは扱わない。
