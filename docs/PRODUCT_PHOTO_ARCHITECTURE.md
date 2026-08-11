# 商品参考写真アーキテクチャ

Status: accepted for implementation, production disabled

この文書は商品参考写真について、ブラウザ前処理、固定依頼v4で参照する写真API、SQLite-backed Durable Objectの保存・期限・削除を定義します。現在の通常公開ではフロント`VITE_PRODUCT_PHOTOS_ENABLED=false`、Worker`PHOTO_API_ENABLED=false`です。本番Workerへのbinding追加、migration適用、flag有効化は別途承認があるまで行いません。

## 決定

- GitHub Pages、既存Cloudflare Worker、SQLite-backed Durable Objectsだけを使う。
- R2、D1、KV、別Worker、外部画像変換サービス、アカウント認証は追加しない。
- 1商品1枚、1依頼最大3枚とする。
- 1写真につき1つの`PhotoObject`を割り当て、Object内には1写真だけ保存する。
- 写真tokenはブラウザで24 byte（192 bit）のCSPRNGから生成し、`p1_`付きBase64URLとする。
- 保存期限は初回作成時から固定14日で、再送や取得で延長しない。
- 写真とv4/v5はGemini、手書き解析、`GEMINI_API_KEY`、`@google/genai`へ依存しない。

Cloudflareは新しいDurable ObjectにSQLite storageを推奨し、Workers FreeではSQLite-backed Durable Objectsだけを利用できます。現行の上限はデプロイ前に必ず[Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits/)と[pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)で再確認します。500KiBの写真1件は、現行のSQLite BLOB/row上限内です。

## ブラウザ画像処理

`src/features/productPhotos/imageProcessing.ts`は手書き画像処理とは独立したmoduleです。1回に1枚だけを次の順序で処理します。

1. 画像MIMEと元ファイル容量を検査する。
2. `createImageBitmap(..., { imageOrientation: 'from-image' })`を優先し、利用不能時だけImage要素へfallbackする。
3. 長辺を最大1,280pxへ縮小する。
4. alphaなしCanvasを白で塗り、その上へ画像を描く。
5. JPEG品質を段階的に下げて400KiB以下を目標にする。
6. 目標に届かなければ寸法も段階的に縮小する。
7. 絶対上限500KiB以下のJPEGだけを返す。
8. ImageBitmap、Canvas、内部Object URLを必ず解放する。

Canvas再エンコードにより元ファイル名、EXIF、GPS、撮影日時は出力へ引き継ぎません。元画像をBase64化せず、localStorage、sessionStorage、ログ、解析診断へ保存しません。HEIC/HEIF用の変換ライブラリは導入しません。ブラウザがネイティブにデコードできない形式は外部送信せずエラーにします。

## API契約

### `POST /v1/photos/batch`

`multipart/form-data`のフィールドは次の4種類です。

- `validationSessionToken`: 限定検証時だけ送るsession token 1件。通常公開時は省略
- `turnstileToken`: 1回限りのtoken 1件
- `metadata`: `{ token, itemKey }`のJSON配列
- `photo`: metadataと同じ順序のJPEG 1〜3件

限定検証の写真POSTは`validationSessionToken`をFormDataで送り、ブラウザからカスタムrequest headerを付けません。移行期間中のWorkerは旧`X-Otsukai-Validation-Session` headerも受理します。両方がある場合は完全一致を要求し、不一致なら`403 VALIDATION_SESSION_INVALID`です。`GET /v1/manual-validation/session`のheader契約は変更しません。

Workerは許可Originを完全一致で確認し、Turnstile action `product_photo_upload`を1回だけ検証します。写真は1枚500KiB以下、合計1,500KiB以下です。JPEG SOI/EOI、SOF寸法、長辺1,280px以下を実データから確認し、APP1（EXIF/XMP）、MIME偽装、SVG、HTML、PNG、実行形式を拒否します。tokenとitemKeyはbatch内で重複できません。

レスポンスは保存できた`token`と`itemKey`だけです。ファイル名、商品名、写真内容は返しません。

### `GET /v1/photos/:token`

- 正常: `200 image/jpeg`
- 未保存: `404 PHOTO_NOT_FOUND`
- 期限切れ: `410 PHOTO_EXPIRED`。同時にObject内データを削除する。

JPEGレスポンスには次を設定します。

```text
Content-Type: image/jpeg
X-Content-Type-Options: nosniff
Cache-Control: private, max-age=300, must-revalidate
```

写真取得が失敗しても、v4/v5の商品本文と購入進捗は破棄しません。

## PhotoObject

`PhotoObject`はSQLite storageへ次の1行だけを保存します。

```sql
CREATE TABLE IF NOT EXISTS photo (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  jpeg BLOB NOT NULL,
  content_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
)
```

初回保存ではAlarmを`createdAt + 14日`へ設定してからINSERTします。同じtoken、同じcontent hashの再送は既存expiryを維持した冪等成功です。同じtokenへ異なるcontent hashを送ると`409 PHOTO_TOKEN_CONFLICT`になり、既存写真を上書きしません。

`alarm()`は`deleteAll()`を呼びます。既に削除済みでも成功する冪等処理です。SQLite-backed storageの`deleteAll()`はObjectのSQLデータをatomicに削除します。仕様は[SQLite-backed Durable Object Storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)を参照してください。

## 部分失敗

batch途中で失敗した場合、Workerは成功レスポンスや共有URLを確定しません。Responseを受け取れなかったクライアントの自動再送と先行attemptが並行する可能性があるため、Workerは部分保存済みObjectを即時削除しません。即時削除すると、同じtokenとcontent hashを採用して成功した再送の写真を先行attemptが後から削除できるためです。共有されなかった部分保存も、初回保存時から延長されない14日Alarmで削除されます。

## セキュリティとプライバシー

- 写真tokenはcapabilityであり、ログ、診断、エラー本文へ出さない。
- 写真、ファイル名、商品名、itemKey、request body、response bodyをWorkerログへ出さない。
- `GEMINI_API_KEY`を写真handlerが参照しない。
- CORSを認証とみなさず、uploadではOriginとTurnstileを両方検証する。
- `X-Content-Type-Options: nosniff`で画像以外としての解釈を防ぐ。
- 同一tokenへの異内容上書きを禁止する。
- DO binding、migration、flagが不足すると安全に404または503とし、手書き互換ルートは独立して動作する。

## Cloudflare手動設定（承認後だけ）

1. 対象Worker、アカウント、現在のdeployment、既存migration履歴を読み取りで確認する。
2. `worker/wrangler.toml.example`の`PHOTO_OBJECTS` bindingと`photo-v1` SQLite migrationを実設定へ取り込む。
3. `PHOTO_API_ENABLED=false`のままdry-run bundleを確認する。
4. Freeプランの現在のrequest、row read/write、stored data上限を公式Dashboardと公式文書で確認する。
5. migrationがrollback境界になることを確認し、運用者の明示承認を得る。
6. 承認後にだけWorkerをdeployする。Secret値は変更・表示しない。
7. synthetic requestと実機試験が完了するまで`PHOTO_API_ENABLED=false`を維持する。
8. フロント検証と公開承認後にだけ`VITE_PRODUCT_PHOTOS_ENABLED=true`のPages buildを行う。

Durable Object class migrationは`wrangler deploy`でのみ適用されます。dry-runは本番namespaceを作成しません。Cloudflareの現在のclass lifecycle方式は[Durable Object class exports/migrations](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)で確認します。

## 本番デプロイ前チェックリスト

- [ ] Worker名、account、既存deploymentが明確
- [ ] Originは`https://plain-relay.github.io`だけ
- [ ] Turnstile hostnameは`plain-relay.github.io`だけ
- [ ] `PHOTO_API_ENABLED=false`でmigrationを適用する計画
- [ ] `PhotoObject`がSQLite-backedとして定義されている
- [ ] 既存`POST /`と`/v1/handwriting/analyze`の回帰成功
- [ ] Gemini Secretなしの写真synthetic test成功
- [ ] 1〜3枚、500KiB境界、APP1拒否、期限切れ、部分失敗後の冪等再送と14日Alarm削除
- [ ] iPhone 11、Android Chrome、LINE内ブラウザの実機結果
- [ ] Free Usageの監視担当と安全停止判断が明確
- [ ] 写真公開flagをONにする別承認

## rollbackとFree上限到達時の安全停止

新規uploadを止める最短手順は、承認された運用操作としてWorkerの`PHOTO_API_ENABLED=false`をdeployすることです。続いてフロント`VITE_PRODUCT_PHOTOS_ENABLED=false`でPagesを再deployします。既存v1〜v3依頼、写真なしv3共有、手書き機能のOFF状態は影響を受けません。v4の写真が取得できなくても商品本文と購入進捗を継続できるUIです。v4 codecは[`COMPACT_REQUEST_V4.md`](COMPACT_REQUEST_V4.md)、実機判定は[`PRODUCT_PHOTO_MANUAL_VERIFICATION.md`](PRODUCT_PHOTO_MANUAL_VERIFICATION.md)を参照してください。

migration適用後に過去versionへ単純rollbackできるとは限りません。namespaceや保存データを削除する操作は行わず、まずflagsで停止し、Cloudflare公式のrollback/migration制約を確認してから別途承認を得ます。Alarmは既存写真を作成時から14日で削除し続けます。
