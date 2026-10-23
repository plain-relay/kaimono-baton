# 商品写真復旧・公開判定記録（2026-10-23）

**判定: ローカル統合検証済み、一般公開は保留。写真のProduction flagはOFFのまま。**
対象は固定依頼v3/v4の商品写真。v5、商品マスター、相談、手書き/Geminiの仕様は変更しない。
実行計画は[PRODUCT_PHOTO_RECOVERY_PLAN.md](PRODUCT_PHOTO_RECOVERY_PLAN.md)。
baseは `ea2582f6f4f14bedf98b9591ce281fbfff8aa654`。最終head、CI、独立レビューはDraft PR本文に記録する。

## 原因と証拠の区別

1. **UI非表示は意図された設定**。公開Pagesの `handwriting-deployment-state.json` は上記base、
   `productPhotosEnabled=false`、`manualValidationEnabled=false`。
   Repository Variable `VITE_PRODUCT_PHOTOS_ENABLED` もtrim後 `false`。
   endpoint/Site Keyは存在する（値は記録しない）。公開Workerへ画像もtokenもない写真POSTを送り404を確認。
   Workerの現在のdeployment SHA、内部binding、Secret対応は確認していない。
2. **過去の通信障害の確認済み原因**。
   [PR #10](https://github.com/plain-relay/kaimono-baton/pull/10) は写真adapterも含むブラウザnative fetchのreceiver不一致、
   [PR #11](https://github.com/plain-relay/kaimono-baton/pull/11) はWorker Siteverifyの同じreceiver不一致。
   いずれも現mainへ修正済み。[PR #12](https://github.com/plain-relay/kaimono-baton/pull/12) はv5のETag変換対策で、写真へ流用する修正はない。
3. **現在のmainで再現した起動障害**。実 `worker/src/index.ts` をbundleしてworkerdへ読み込むと、
   `Incorrect type for map entry 'HANDWRITING_REQUEST_ID_HEADER'` で起動失敗。HTTP statusは取得不能。
   入口のnamed exportに文字列定数が混在していた。定数は元の `handwritingResponse.ts` に残し、入口の再exportだけ削除。
   testは定義元をimportする。修正後は同一エントリーポイントで起動し写真POST/GETが成功。
   unit testの `cloudflare:workers` aliasとbundle dry-runだけでは検出されなかったため、workerd検査をPR CIへ追加した。
4. **現在のmainで再現した無応答時の待機継続**。ブラウザ側providerにdeadlineがなく、
   challengeロード・POST・response bodyのいずれも無応答なら共有ロックを解放できなかった。
   各段階で60秒後も未完了になるREDを確認し、全工程合計60秒のAbortControllerを追加。
   GREENでは `timeout`、token reset、timer解放を確認。既存の親signalによるキャンセルと最大1回のネットワーク再送は維持。

過去の利用時エラー全体を3/4が説明するとは断定しない。本番Workerのコード・実credential・当時の端末結果がないため、
過去の本番障害と今回のローカル再現は分ける。現物の写真や過去共有URL、生ログ、Secretは取得していない。

## 10段階のコード経路と結果

| 段階 | 経路・期待 | 実測・HTTP | 安全な分類 / 残り |
| --- | --- | --- | --- |
| 1 UI | `config.ts` → `CreateRequestPage` → attachment | OFFで非表示、ローカルONで表示。HTTP対象外 | 設定不足も非表示。公開flagOFF確認済み |
| 2 撮影/選択 | attachmentのcapture付きinputと通常input | ChromeでFile選択→preview成功 | カメラOS UI、Android/iPhone/LINEは未検証 |
| 3 圧縮/向き | `imageProcessing.ts` → bitmap/Canvas JPEG | 1600×800の合成JPEG、EXIF 1/6/8を処理。長辺1280、EXIFなし、6の色方向もassert | `unsupported-image` / `decode-failed` 等。Safari/HEICは実機待ち |
| 4 Turnstile | `useProductPhotoSharing` →既存provider→ `turnstile.ts` | Chromeで公式dummy widgetロード/実行/token取得成功。Siteverify境界はfixture | 無効success/action/hostnameは403 `AUTH_FAILED`。実Secret対応は未検証 |
| 5 POST | upload provider → `/v1/photos/batch` | native fetch経由200、503後再試行成功。無応答3段階はunitで60秒timeout | `network-failed` / `timeout` / `service-unavailable` |
| 6 Origin/CORS | `photoHandler` / `photoValidation` | 許可Originで200+一致ACAO、不許可は403、認証不一致403 | `ORIGIN_NOT_ALLOWED` / `AUTH_FAILED`。許可Originを増やしていない |
| 7 DO | namespace→ `PhotoObject.savePhoto` →実SQLite | workerdで1/2/3枚200、異内容409、同内容200。起動不具合の修正前はHTTP到達不能 | `PHOTO_TOKEN_CONFLICT` / `SERVICE_UNAVAILABLE`。本番bindingは未確認 |
| 8 共有 | `useRequestSharing` → v4 codec → shareText | 0枚v3、1/2/3枚v4、upload前にshareなし。失敗後再試行、共有キャンセル後の保持成功 | OS共有はfixture。初回upload後のuser activationは実機判定 |
| 9 閲覧 | v4 decode → `ProductPhotoViewer` → GET→Blob image | 別contextで200/JPEG実表示・拡大・購入成功。実HTTP410、削除後404を確認 | `expired` / `failed`。取得失敗でも本文/購入はunit回帰成功 |
| 10 端末 | Android Chrome / iPhone Safari / LINE | **未検証**。390px desktop Chromeは横overflowなし | 実端末・OS・LINEへの一般化はしない |

## 自動・ブラウザ検証

| Check | 結果 |
| --- | --- |
| `npm ci --offline` | lockfile通り200 packages、dependency/lockfile変更なし |
| `npm test` | 1210 pass / 2 existing skip（111 files） |
| `npm run test:worker` | 173 pass |
| `npm run check:worker-bundle` | pass、dry-runのみ。binding無しのbundle検査は実bindingを証明しない |
| `npm run test:coverage` | pass: statements 92.39%、branches 87.41%、functions 95.86%、lines 92.40% |
| `npm run build` | application/Worker TypeScript + Vite成功 |
| `git diff --check` | pass |
| `node scripts/photo-runtime-check.mjs` | workerd `1.20260722.1` / Miniflare `4.20260722.0`、実SQLite。20結果成功 |
| `node scripts/photo-browser-check.mjs` | installed desktop Chrome / Playwright、390pxで0/1/2/3枚すべて成功 |

Windows sandboxの一時ファイルrename/loopback制限による初回失敗は、権限を限定して再実行し解消した。製品コードの失敗とは区別する。
Vitest/Viteの既存deprecation warningは残る。runtime checkは既存Wrangler依存のMiniflare/esbuild/sharpを使い、追加サービス・依存はない。

| 写真 | URL | Worker POST | 別contextで表示/拡大 | 購入 |
| --- | --- | --- | --- | --- |
| 0 | v3 | なし | 写真なし | 成功 |
| 1 | v4 | 503 fixture→再試行200 | 1枚成功、共有キャンセル後も保持 | 成功 |
| 2 | v4 | 200 | 2枚成功 | 成功 |
| 3 | v4 | 200、4枚目input disabled | 3枚成功 | 成功 |

OS共有は `navigator.share` fixture、Siteverifyは外向きHTTP境界fixtureであり、Cloudflare edgeへの実deploy、実SecretでのSiteverify、LINE送信を検証した結果ではない。
期限は実14日を待たず、固定expiryをassertし、test専用subclassでexpired clock相当とAlarm短縮を注入。
実HTTP handlerの410と、本物のAlarmスケジューラから継承した `alarm()` によるSQLite削除を確認した。
そのtest用class/controlは本番entrypoint・本番bundleへ追加していない。

受入条件の残りは既存の次の回帰群で確認する。

- `photoValidation.test.ts`: 1〜3枚、4枚、500KiB境界、MIME偽装、不正JPEG、SOF/SOS、APP1、Origin、metadata重複。
- `photoHandler.test.ts` / `turnstile.test.ts`: 無効認証・action/hostname、timeout、部分保存と冪等再送、ログallowlist、設定不足・flag停止。
- `photoObject.test.ts`: 固定14日、異内容上書き拒否、期限削除、Alarmと削除失敗。
- `ProductPhotoUploadProvider.test.ts`: native receiver、再送時の新token、親AbortSignal、body/POST/challengeのdeadline。
- `CreateRequestPage.productPhotos.test.tsx`: 失敗後の明示的v3 fallback、処理中の操作抑止、数量0。
- `ShoppingListPage.productPhotos.test.tsx` / viewer tests: 期限・API失敗でも購入・相談・進捗を維持。
- published formats / compact codecs / shopping state / catalog recovery: v1〜v3互換と無料コア回帰。

## ローカル再実行

repository rootで `npm ci` 後、`node scripts/photo-runtime-check.mjs`。外部Secret、実wrangler設定、Geminiは不要。
browser checkは別terminalで次を起動する（すべてプロセス内だけの設定）。

```powershell
node scripts/photo-runtime-check.mjs --serve
```

```powershell
$env:VITE_PRODUCT_PHOTOS_ENABLED='true'
$env:VITE_HANDWRITING_IMPORT_ENDPOINT='http://127.0.0.1:8788/'
$env:VITE_TURNSTILE_SITE_KEY='1x00000000000000000000AA'
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4178 --strictPort
```

別terminalで `PHOTO_CHECK_PLAYWRIGHT_PATH` を手元にあるPlaywrightの `index.mjs` へ設定して
`node scripts/photo-browser-check.mjs`。Chromeが必要。既存の開発用Playwrightを使い、製品dependencyは追加しない。
Turnstile公式dummy widget取得にはインターネットが必要。試験後は2つのlocal serverをCtrl+Cで停止する。
出力はcase・枚数・status・pass/failのみ。画像/token/完全共有URL/bodyは出力しない。

## 必要設定と不足の見分け方

| 場所 | 設定・照合条件 | 不足時の検知 |
| --- | --- | --- |
| GitHub Repository Variables | `VITE_PRODUCT_PHOTOS_ENABLED` は公開承認までfalse | manifest `productPhotosEnabled=false`、UIなし |
| 同上 | `VITE_HANDWRITING_IMPORT_ENDPOINT` は対象Workerのroot HTTPS URL | manifest `endpointConfigured`、不正URLならconfigはdisabled。機能名がhandwritingでも写真共通の接続先 |
| 同上 | `VITE_TURNSTILE_SITE_KEY` は公開Site Key | manifest `turnstileSiteKeyConfigured`、欠落ならUIなし。Secret Keyをここへ設定しない |
| Worker variables | `PHOTO_API_ENABLED=false`（承認まで） | OFFの写真ルート404。404だけでbinding健全性は判断不可 |
| Worker variables | `ALLOWED_ORIGINS=https://plain-relay.github.io` | Originはpathなし・完全一致。誤りは403/CORS失敗 |
| Worker binding | `PHOTO_OBJECTS` → `PhotoObject`、同じ対象Worker、SQLite | enable環境で設定不足は503。binding名だけでSQLiteとは判定しない |
| Worker lifecycle | 既存namespace/backendとmigration履歴またはexports宣言を一致 | deploy差分と既存class照合。例の機械的コピーは禁止 |
| Worker secret | `TURNSTILE_SECRET_KEY` がSite Keyと同じwidget | 値は表示しない。action `product_photo_upload` とhostname `plain-relay.github.io` の一致、Siteverify成功が必要 |
| 通常公開・検証の分離 | `VITE_MANUAL_VALIDATION_ENABLED` / `MANUAL_VALIDATION_ENABLED` は通常false | session確認失敗403/期限410。photo公開flagと混同しない |

Vite値はbuild時に埋め込まれる。Repository Variablesだけ変えても既存Pages artifactには反映されない。
Production workflowの `manual-on` は手書き用で、写真検証の代用品にしない。
他機能のflagを一括で書き換えない（今回公開manifestのv5はtrue、変更していない）。

## Cloudflare公式仕様の照合（2026-10-23参照）

- [Class exports](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/):
  旧migrationとexportsは両対応だが同時使用しない。exportsへdeploy後は旧方式へ戻せない。
  本PRは方式を変更しない。既存migration方式なら履歴/tag/backendを保持し、未作成classだけを承認後に追加する。
  既にexports方式なら `PhotoObject` の `type=durable-object` / `storage=sqlite` と既存全classを照合し、例のmigrationを追加しない。
- [`worker/wrangler.toml.example`](../worker/wrangler.toml.example) は例にすぎない。
  `PhotoObject` exportは現行コードに存在し、`new_sqlite_classes` のphoto-v1も例にあるが、本番適用済みとはみなさない。
  compatibility dateは既存 `2026-07-26` を維持する。更新やnamespace再作成は今回不要。
- [Limits](https://developers.cloudflare.com/durable-objects/platform/limits/): SQLite row/BLOBは2MBまで。
  500KiB JPEGと付帯値はこの範囲。FreeはSQLiteのみ。R2/D1/KVを追加しない。
- [Pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/): DO Freeは100,000 requests/日、
  13,000 GB-s/日、5M rows read/日、100,000 rows written/日、SQL保存5GB。
  setAlarm・削除もwrite、写真GET・Alarmもrequestを使う。アカウント内で他機能と共有するので、3枚POSTを1枚分と計算しない。
  単純な最大JPEG合計だけなら5GBは約1万枚相当だが、SQLite overhead・他機能・保持中データを引く必要があり安全容量ではない。
- [Siteverify](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/): server側検証必須、tokenは5分/1回。
  再送では新tokenを取得する。[Dummy keys](https://developers.cloudflare.com/turnstile/troubleshooting/testing/) は本番Secretと組み合わせない。

## 公開前に人間が行う順序

次は実行済みとしない。`AGENTS.md` の禁止操作と `PAID_BETA_READINESS.md` §14を緩和しない。

1. **レビュー確定**: Draft PRのexact base/head、必須CI、fresh read-only Codexの結果を確認。
   未解決P0/P1/公開条件に影響するP2がないことを確認し、残余riskを人間が判断する。
   mainが動いたら新base/headで完全再レビューする。この段階ではmergeしない。
   High riskに必要な後段のstaging証拠をそろえた後に、人間が別途merge承認し、Draftのready化・mergeを判断する。
2. **Cloudflareはまず読み取り**: Workers & Pages →対象Worker→Deployments/Settings/Bindingsと
   Durable Objectsで、Worker名/最新version/PhotoObject namespace/SQLite/backend/既存全classを確認。
   使用中の安全なローカル設定とdeploy履歴でmigration tag順またはexportsを照合する。履歴不明ならdeployしない。
   Secretは値を開かず、存在と対応するwidgetだけを人間が照合。Turnstileのhostname制限も確認する。
3. **staging判断**: 同じreview済みソースを既存の隔離stagingで検証する。既存stagingがない場合は人間が別途環境を承認する。
   AIは作成・deploy・binding追加しない。実Siteverify→POST200→GET200/JPEG表示、期限/停止の結果を残す。
   本番で限定検証する場合も別の人間承認・実行とし、[限定検証手順](PHOTO_V5_LIMITED_VALIDATION.md)に従う。
   既存の限定ゲートはv5も含むため、このtaskだけでv5の設定を変更しない。現在のfalseを勝手に変えない。
4. **必要な差分だけ人間が適用**: Workerの写真flagはfalseのまま、実設定と例の差分・migration境界を確認。
   PhotoObjectが既存なら再作成しない。未作成なら承認したbinding/lifecycle差分だけを人間がdeployする。
   Secrets、Variables、migrationはそれぞれ別承認。namespace/既存migration/保存データを削除しない。
5. **実機試験**: 下記Android/iPhone/LINEシナリオを実行。非機密の端末/OS/browser/枚数/status/結果だけを記録し、
   写真・token・共有URLはPRへ貼らない。staging artifactと将来のProduction commitを対応付ける。
6. **公開判定**: §14のPaid Beta運用実績、無事故、費用/サポート時間、7日不在/rollback訓練、
   privacy/終了方針、Rate Limit/費用上限/停止をすべて人間が確認。コード試験だけで免除しない。
7. **別承認のProduction操作**: 人間がWorkerを `PHOTO_API_ENABLED=true` にして正常性を確認後、
   `VITE_PRODUCT_PHOTOS_ENABLED=true` のRepository Variableを設定し、mainの承認対象commitから
   **Stable Free Core Production** を `repository` modeで人間がdispatchする。
   workflowはmanual-onlyで、対象SHAがcurrent mainであることをbuild前/deploy前に照合する。
   flagを変える前にendpoint/Site Keyの対応を再確認し、手書き/Gemini/v5は変更しない。
8. **公開後確認**: manifestのcommit/写真ON/transport設定、通常URLのUI、1枚の撮影→共有→別端末表示→購入、
   0枚v3、使用量を人間が確認。不一致なら下記停止手順。現在この段階は未実行。

## 実機10分シナリオ（各経路）

Android Chrome、iPhone Safari、LINE内ブラウザ→外部ブラウザを別々に記録する。
架空テスト商品と個人情報のない試験画像を使う。

1. 検証環境の通常固定依頼で商品を選ぶ→条件を開く→カメラ撮影。縦/横の向きとプレビューを確認。
2. 別商品で写真選択、3枚目を追加。4商品目では追加不可。圧縮中は確認へ進めない。
3. 確認へ→LINEで送る。upload完了前に共有画面が出ないこと、成功後LINEを選べることを確認。
   OS共有が最初に拒否されるなら、画面の再タップで同じ保存済みURLを共有できるかを確認し、失敗は公開blockerにする。
4. 一度共有キャンセル→内容・写真が残る→再共有で再upload不要。LINEへの送信は人間が実行する。
5. 別端末でURLを開き、ログインなしで本文・3枚を表示→拡大→閉じる→かご操作→Undo/会計前確認/結果共有。
6. 0枚でv3。通信OFFにして写真保存失敗→再試行、または「写真を外してv3で共有」。入力は残る。
7. 購入者側で写真取得を失敗させても本文/条件/購入が使える。期限切れfixtureでは案内が表示される。

実OSのカメラ、HEIC、Safariメモリ、LINE WebView、OS share/clipboard許可・user activationは未確認。
desktop Chromeの狭幅検証をスマホ実機の代わりにしない。詳細は[既存実機手順](PRODUCT_PHOTO_MANUAL_VERIFICATION.md)。

## 残余riskと停止・rollback

- Turnstileとmultipart/枚数/容量上限はあるが、写真API内には独立したRate Limit実装がない。
  外部に適用済みの対策・利用量・請求planも未確認。一般公開向けRate Limit/費用上限の検証は公開ゲートとして残る。
  Free上限に達しても自動課金upgradeをしない。人間が実planと共有使用量を確認し停止判断の担当を決める。
- capability URLを知る人はログインなしで写真へアクセスできる。転送による閲覧を防ぐ認証ではない。
  顔/伝票/住所等を写さない案内が必要。EXIF除去は画像に写った情報を除去しない。
- アプリの14日削除と、Cloudflareのバックアップ/PITR・基盤ログの保持は別。人間が公開privacy説明との整合を確認する。
  コードのconsole allowlistだけでCloudflare側のHTTP URL/request loggingが無効とは証明できない。
  upload後60秒timeoutでも先行Workerが保存を終えている可能性があり、同token/同内容再送と固定14日削除を維持する。

障害時の人間操作（本PRでは未実行）:

1. Workerで `PHOTO_API_ENABLED=false`。`MANUAL_VALIDATION_ENABLED` もfalseでなければ、写真が限定経路で利用可能なので
   既存の検証終了手順・承認に従ってfalseへ戻す。v5も含む限定ゲートの影響を確認する。
2. `VITE_PRODUCT_PHOTOS_ENABLED=false`、必要なら限定検証も終了し、承認されたcurrent mainのPagesを人間が再build/deploy。
3. 通常URLの写真UI非表示、写真なしv3の共有/購入、既存v1〜v3とv4本文の利用、使用量低下を確認。
4. DO class/export/namespace・migration履歴を残し、同じclassを含むforward deployで停止を優先。
   本コード修正を戻す場合も既知の起動障害版へ単純rollbackしない。最終正常Worker versionとbindingの互換性を先に確認。
   migration/exportsが絡むversion rollbackはCloudflare制約確認と別承認が必要。Alarmによる14日削除は維持する。

本実装セッションはmerge、Production deploy/dispatch、Cloudflare設定、Secret/Variables変更、migration、利用者データ操作を実行しない。
