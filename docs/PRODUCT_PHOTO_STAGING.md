# 写真専用 staging: スマホでの設定と検証

対象依頼: 商品写真の復旧・検証・公開準備。計画は
[PRODUCT_PHOTO_STAGING_PLAN.md](PRODUCT_PHOTO_STAGING_PLAN.md)、元の復旧根拠・本番公開手順は
[PRODUCT_PHOTO_RECOVERY.md](PRODUCT_PHOTO_RECOVERY.md)。この構成を本番にコピーしない。

## 現在の構成

- 人間が作成した空の Worker: `kaimono-baton-photo-staging`
- 検証ホスト: `https://kaimono-baton-photo-staging.plainrelay01.workers.dev/`
- このホスト専用の Managed Turnstile widget を人間が作成済み。公開 Site Key は build script に固定。
- `worker/wrangler.photo-staging.toml` が同 Worker のみへ新しい SQLite `PhotoObject` を作る。
  `PHOTO_OBJECTS` に `script_name` や本番 namespace ID は指定しない。
- React 画面と写真 API は同一ホスト。写真のみ有効、v5・手書き・Gemini・診断・既存手動検証は無効。
- 画面・JS・画像を含む全経路を検証用 Basic 認証で保護する。製品のログイン機能ではない。
  購入者役もこの外側の検証パスワードが必要。資格情報は共有URLに入れない。
- 既定で閉じる。flag・期限・秘密値・binding・assets の設定が全部そろうまで開かない。
  期限は設定時点から24時間を推奨（48時間を超える未来の値は拒否）。期限後は410。

同じアカウントのリクエスト・CPU・SQLite無料枠を共有するため、本番と**データは分離**するが
利用枠への影響はゼロではない。少数の合成画像に限定し、プラン変更・R2・D1・KVを追加しない。

## Codexが用意するもの

1. 専用 branch `test/product-photo-staging`、Draft PR、全必須CI、exact base/head 独立レビュー。
2. 環境ファイルを読まず写真だけONで作る `node scripts/photo-staging.mjs build`。
3. Worker名・branch・commit・config・assets・作業ツリーを検査する `verify`。
   deploy用buildは前後でcleanなsourceと同一HEADを要求し、未追跡fileとsrc/public等のignored入力も拒否する。
   テスト用widget/localhostのartifactはdeploy検査で拒否する。
4. 実workerd・SQLite・static-assetsの認証→POST→GETテスト、ブラウザの0〜3枚共有/閲覧テスト。

AIはCloudflareの設定、Secret、deploy、migrationを実行しない。Git接続前に準備・push・
独立レビューを完了する。接続後のpushは自動deployを起こすため、追加push前に人間が
Git build停止を確認する必要がある。

## 人間の作業1: 新しいWorkerだけに秘密値を保存する

スマホでCloudflareにログインし **Workers & Pages → kaimono-baton-photo-staging → Settings →
Variables and Secrets** を開く。画面名が違う場合は近い項目を探し、既存の
`kaimono-baton-handwriting-import` を編集しない。

| Type | 設定名 | 入れる値 |
| --- | --- | --- |
| Secret | `TURNSTILE_SECRET_KEY` | 今回作った検証widgetのSecret Key。ダミーや本番用を使わない |
| Secret | `PHOTO_STAGING_PASSWORD` | パスワード管理アプリ等で生成した32〜128文字のランダムな英数字・`_`・`-` |
| Text | `PHOTO_STAGING_ENABLED` | 最初は `false` |

保存する。値はチャット・スクリーンショット・GitHubへ貼らない。確認結果は「保存済み」だけでよい。
`PHOTO_STAGING_EXPIRES_AT` は作業3の直前に入れる。ここではまだ写真機能は開かない。
Build variablesへ秘密値を入れない。runtime用Variables and SecretsとBuild設定は別である。

## 人間の作業2: レビュー済みbranchを新しいWorkerへ初回deployする

**CodexからDraft PR・exact head・CI・独立レビュー結果を受け取ってから**行う。
本番deployの承認ではなく、新規Workerへの初回SQLite migrationを伴う検証deployの操作である。

1. `kaimono-baton-photo-staging → Settings → Build` でGit接続（Connect）を選ぶ。
   GitHub認証が必要なら対象repo `plain-relay/kaimono-baton` を選択する。
2. Git repositoryは `plain-relay/kaimono-baton`、Git branchは **`test/product-photo-staging`**。
   既定の`main`を選ばない。この新しいWorkerの画面内で呼ばれる「Production branch」は、
   この検証Workerの対象branchのことであり、既存の買い物バトンProductionではない。
3. Root directory はrepo root（空欄または `/`）。Build command は次をコピーする。

   ```sh
   npm ci && node scripts/photo-staging.mjs build
   ```

4. Deploy command は次をコピーする。既定の`npx wrangler deploy`のままにしない。

   ```sh
   node scripts/photo-staging.mjs verify && npx wrangler deploy --config worker/wrangler.photo-staging.toml --keep-vars
   ```

5. 非対象branchのPreview buildsは無効にする。既存WorkerのPreview方式を切り替えない。
   UIに自動config生成や自動PR提案が出ても採用しない。repoには専用configがある。
6. Worker名、branch、2つのcommand、対象commitが案内されたexact headと一致することを確認して、
   **人間が**Save/Deployを押す。ここで初めて新規SQLite classのmigrationが適用される。
   `PHOTO_OBJECTS`を本番へ向ける手動binding追加は不要。
7. 完了したらBuild設定のGit連携を切断/自動buildを停止し、その状態を確認する。
   ボタン名が異なる場合は変更せず、非機密の項目名だけをCodexへ伝える。
   停止確認まではCodexがこのbranchへ追加pushしない。

Git認証/API tokenはCloudflare画面内で扱う。値をチャットへ出さない。Workers Buildsが
作るtokenの権限は広い場合があるため、アカウント管理者が許容できるか確認する。
既存repo設定・Production workflow・GitHub Secretsは変更しない。

## 人間の作業3: binding確認と検証開始

1. 新規WorkerのBindingsで `PHOTO_OBJECTS → PhotoObject` と `ASSETS` を確認する。
   Durable Objectsの対象namespaceが**新規staging WorkerのPhotoObject**、SQLiteであることを確認する。
   本番Workerを参照していたら開始せず停止する。初回migration tagは `photo-staging-v1`。
   既存migrationの削除・rename・再作成はしない。
2. 新規WorkerのVariables and Secretsへ `PHOTO_STAGING_EXPIRES_AT` (Text) を追加する。
   値は確認時刻から24時間後をUTCの `YYYY-MM-DDTHH:mm:ssZ` で入れる。
   日本時間から9時間引く。古い例の日付をコピーしない。
3. `PHOTO_STAGING_ENABLED` を `true` にして人間が保存/deployする。
4. 検証URLをスマホの通常ブラウザで開く。Basic認証はユーザー名 `staging`、
   自分で保存した検証パスワードを入力する。スマホの別シークレット画面では認証が要求されることを確認。
5. ページ上部に「検証専用」表示があり、写真選択UIが見えることを確認する。
   まだHello Worldならコード未deploy、503なら設定不足/無効flag/48時間超の期限、
   401なら資格情報不一致、410なら検証期限切れ。これらのstatusと段階だけを報告する。

## 人間の作業4: 5〜10分の実機E2E

個人・住所・顔・レシート等がない、紙に描いた色丸などの**検証専用画像**を使う。
チャットへ写真・共有URL・token・生ログを送らない。Android ChromeとiPhone Safariそれぞれで行い、
利用できない端末は未検証とする。

1. 写真なしで1商品を選択→確認→共有。通常依頼として開けて購入操作できる。
2. カメラで縦写真を撮る→プレビューの向き確認→共有。アップロード完了後に共有シートが開く。
3. LINEで自分の別端末/協力者役へ送る（**人間が**行う）。相手は検証環境のBasic認証を通る必要がある。
   LINE内ブラウザがBasic認証/カメラに対応しない場合は「ブラウザで開く」でChrome/Safariでも確認し、
   LINE内経路の失敗は未解決として別記する。外側の検証認証による制約を本番仕様と取り違えない。
4. 購入者役は作成者の画面を経由せず共有URLを開く→画像表示→拡大→閉じる→かごに入れる。
5. 写真2枚・3枚でも同様。4商品目に写真が付けられないことを確認。
6. 横写真/既存写真の選択、共有キャンセルで入力保持、通信を切った時の失敗表示→通信復帰→再試行、
   写真を外して通常依頼として送ることを確認する。
7. 期限切れ/画像取得失敗でも商品名・数量・条件・購入操作が使えることは既存ローカルテスト済み。
   実機では検証flagを切ると画面全体も閉じるため、画像の14日期限テストとは区別する。

報告は下の非機密項目に限定する。

| 端末/経路 | 写真枚数 | 撮影/選択 | 向き/preview | upload/共有 | 表示/拡大 | 購入 | 失敗した段階/status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Android Chrome | 0/1/2/3 | 未確認 | 未確認 | 未確認 | 未確認 | 未確認 | — |
| iPhone Safari | 0/1/2/3 | 未確認 | 未確認 | 未確認 | 未確認 | 未確認 | — |
| LINE内→各ブラウザ | 1/3 | 未確認 | 未確認 | 未確認 | 未確認 | 未確認 | — |

## 停止・費用・残余リスク

- 人間が**staging Workerだけ**の `PHOTO_STAGING_ENABLED=false` を保存/deployすると全経路を閉じる。
  自動buildを停止する。本番のflag・コード・bindingは触らない。
- 期限でも全経路を閉じるが、保存写真は即時削除されず、アップロードから14日の既存alarmで削除する。
  migration rollbackのためにclass/namespace/データを削除しない。
- 新規WorkerにもCloudflareの「deploy」操作があるが、既存本番のreleaseではない。
  configに`keep_vars`を指定し、人間の停止flag・期限を次のbuildで上書きしない。
- stageの実widget/実Siteverify、Cloudflareの実binding・migration・無料枠、iPhone/Android/LINEは、
  人間の操作後に初めて実環境確認済みとなる。ローカルfixtureの成功を代用しない。
- HTTP Basicは少数テスター用。パスワード共有/ブラウザの資格情報保持に注意する。
  写真capability、認証、Turnstile、最大3枚・JPEG制限はあるが、アカウント全体の課金上限を保証しない。
  ObservabilityはOFF。Cloudflare側の標準アクセス情報の扱いも管理者が確認する。
- Public Releaseはstaging証跡、独立review、残余risk受容、exact PR merge承認、
  別のProduction設定/deploy承認がそろってから。今は本番写真flagをOFFに維持する。

## 根拠とローカル再実行

2026-10-24 のローカル結果（実Cloudflare deploy前）:

- `npm test`: 1238 pass、既存2 skip。`test:worker`: 197 pass。
- `test:coverage`: statements 92.43%、branches 87.50%、functions 95.80%、lines 92.42%。
- `check:worker-bundle`、`build`、専用staging bundle dry-run、`git diff --check`: 成功。
- 新規境界テスト28件を追加し、未実装の保護・buildが失敗→実装後成功することを確認。加えてブラウザが設定欠落を検出したため、
  Viteの個別環境keyの定義へ修正し、生成JSにendpoint/Site Keyが存在することもbuild内で検査する。
- 既存実workerd/SQLiteの20ケース成功。新規stageは無認証assets/API401、認証assets200、
  写真1/2/3枚POST200→同一bytes GET200、他Origin403、写真以外のAPI404。
- Chrome 390pxで0枚v3、1/2/3枚v4、プレビュー、実画像表示、拡大、購入操作が成功。
  503→再試行、共有キャンセル→再共有、4枚目拒否も成功。
  実canvas圧縮とEXIF orientation6の縦表示/EXIF除去を確認。orientation1/8は元の復旧テストで確認済み。
- widgetは公式dummy、Siteverifyは送信先HTTP fixture、共有シートは`navigator.share` fixture。
  **実widget/Secret照合・実Cloudflare・Android・iPhone・LINEの成功を意味しない**。
- 専用画面のビルドのみが写真ON。通常の`npm run build`と公開Pages設定は変更していない。
- 初回独立reviewのP2（dirty clientをbuild後に戻すと未review artifactを採用できる）を修正。
  一時Git repoでdirty/未追跡public/ignored public入力拒否、build中HEAD変更拒否を回帰確認した。

設定は2026-10-24に公式仕様と照合した。
[Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)、
[全assetsをWorker先行で保護](https://developers.cloudflare.com/workers/static-assets/binding/)、
[DO環境分離](https://developers.cloudflare.com/durable-objects/reference/environments/)、
[DO無料枠](https://developers.cloudflare.com/durable-objects/platform/pricing/)。

```sh
node scripts/photo-staging-runtime-check.mjs
# Playwrightを利用できる検証者のみ。インストール済みなら環境変数は不要。
PHOTO_CHECK_PLAYWRIGHT_PATH=/absolute/path/to/playwright/index.mjs node scripts/photo-staging-runtime-check.mjs --browser
node scripts/photo-staging.mjs build
node scripts/photo-staging.mjs verify
npx wrangler deploy --config worker/wrangler.photo-staging.toml --dry-run --outdir .wrangler/photo-staging-dry-run
```

`verify`はreview対象をcommitしたcleanな専用branchで実行する。`--test` artifactは拒否される。
最後のcommandはdry-runのみ。実deployは人間の作業2だけで行う。
