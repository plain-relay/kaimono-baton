# 更新可能依頼 v5 Worker設計

Status: implemented behind flags, production disabled

v5は、既存v1〜v4とは別のserver-backed共有方式です。通常の固定依頼を自動移行せず、利用者が明示的に更新可能依頼を選んだ場合だけ使用します。Worker API、`SharedRequestObject`、依頼者管理画面、購入者同期画面を実装していますが、`SHARED_REQUEST_API_ENABLED=false`と`VITE_LIVE_REQUESTS_ENABLED=false`のまま、本番deploy・migration・UI公開は行いません。

## 境界と依存関係

- GitHub Pages、既存Cloudflare Worker、SQLite-backed Durable Objectsだけを使用します。
- 1依頼につき1つの`SharedRequestObject`を使用し、`PhotoObject`とは統合しません。
- Gemini、`GEMINI_API_KEY`、`@google/genai`、手書き解析、写真APIがなくてもv5 APIは動作します。
- 購入進捗は購入者端末の既存localStorageへ残し、Workerへ送信しません。
- 依頼本文、商品名、capability、edit secretをログへ出しません。一覧APIも作りません。

Cloudflareは新規Durable ObjectにSQLite storageを推奨しており、Workers FreeではSQLite-backed classだけが利用可能です。Free上限超過時は該当操作が失敗し、Free利用者へ超過課金されません。deploy前には固定値を文書へ転記せず、公式の[Pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)と[Limits](https://developers.cloudflare.com/durable-objects/platform/limits/)で現在値を再確認します。

## capability URL

```text
購入者:   #/r/<requestToken>
依頼者:   #/manage/<requestToken>/<editSecret>
```

- `requestToken`: 24 byte（192 bit）のCSPRNG、`r1_`付きBase64URL
- `editSecret`: 32 byte（256 bit）のCSPRNG、`e1_`付きBase64URL
- 購入者リンクには`editSecret`を含めません。
- Workerはedit secretのSHA-256 hashだけを保存し、平文を保存しません。
- URLを知る者が権限を持つcapability方式であり、アカウント認証付きの機密保管ではありません。

## SharedRequestObject

保存期間は作成時から固定14日です。PATCH、GET、再表示で期限を延長しません。作成時にAlarmを1回設定し、期限到達後の`alarm()`はSQLite storageの`deleteAll()`を冪等に呼びます。互換日付が2026-02-24以降なので、`deleteAll()`はSQLデータとAlarmをatomicに削除します。詳細は公式の[SQLite-backed storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)と[Alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)を参照してください。

```sql
CREATE TABLE IF NOT EXISTS shared_request (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  request_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  edit_secret_hash TEXT NOT NULL,
  updates_count INTEGER NOT NULL,
  items_json TEXT NOT NULL
)
```

`items_json`は検証済みの次のsnapshotだけを保存します。

```ts
type SharedRequestItem = {
  itemId: string
  productId: string
  productNameSnapshot: string
  categoryIdSnapshot: string
  categoryNameSnapshot: string
  quantity: number
  unit: string
  memo?: string
  iconSnapshot: string
  sortOrderSnapshot: number
  photoToken?: string
  lifecycle: 'active' | 'cancelled-by-requester'
  createdRevision: number
  updatedRevision: number
  cancelledRevision?: number
}
```

更新はDOの直列実行と単一SQL `UPDATE`でatomicに保存します。取消は物理削除せずtombstoneにし、同じ`itemId`の再利用を拒否します。同じ商品を再追加する場合は新しい`itemId`が必要です。

## API契約

| Method | Path | 契約 |
| --- | --- | --- |
| `POST` | `/v1/requests` | OriginとTurnstile action `shared_request_create`を検証し、revision 1の依頼と2種類のcapabilityを作成 |
| `GET` | `/v1/requests/:requestToken` | capability read。`ETag: "revision-N"`を返し、`If-None-Match`一致は304 |
| `PATCH` | `/v1/requests/:requestToken` | Origin、Turnstile action `shared_request_update`、edit secret hash、`If-Match`を検証して明示操作をatomic反映 |

PATCH操作は`add`、`set-quantity`、`set-memo`、`cancel`だけです。全件上書き、物理削除、購入進捗の受信、共有後の新規写真添付・差し替えは受け付けません。revision不一致は`412 REVISION_MISMATCH`、`If-Match`欠落は`428 IF_MATCH_REQUIRED`です。更新回数上限では`429 UPDATE_LIMIT`として更新機能だけを安全停止します。

作成時の写真参照はv4と同じ形式・最大3件です。写真がなくても作成でき、写真API障害でテキスト依頼APIは停止しません。写真の期限や取得失敗は依頼本文を消しません。

## 入力上限と応答

- JSON body 512KiB以下
- 最大303商品（既存v3と同じ、基準93＋家庭追加200＋自由追加10）
- activeな自由追加商品は最大10件。取消済みtombstoneはこの10件に数えず、再追加時は新しい`itemId`を使う
- 数量1〜20、条件30文字、有効商品の条件合計1,000文字
- 1 PATCH最大50操作、1依頼最大100更新
- ID、名称、単位、カテゴリ、icon、sort orderをWorkerで再検証
- 予期しないproperty、重複item ID、重複photo token、4件以上の写真を拒否
- `Cache-Control: no-store`、`X-Content-Type-Options: nosniff`
- CORSは許可Origin完全一致で、認証の代わりにはしません。
- 外部エラー本文、request body、Secret、capabilityを応答やログへ含めません。

## フロントの作成・管理・同期

依頼作成画面の既定値は「変更しない通常依頼」です。写真なしの通常依頼はv3、写真付き通常依頼はv4のままで、`VITE_LIVE_REQUESTS_ENABLED=true`かつEndpointとTurnstile Site Keyがそろった場合だけ「あとから追加・変更できる依頼」を表示します。明示選択後にだけ`POST /v1/requests`を呼び、購入者用リンクだけをWeb Share APIへ渡します。edit secretを含む管理リンクは別枠で表示し、購入者用共有文、作成画面のreturn state、last shared URL、診断JSON、ログへ混ぜません。

管理画面は`#/manage/<requestToken>/<editSecret>`です。現在のrevisionを取得し、商品追加、数量変更、条件変更、取消を明示操作としてPATCHします。競合時は最新snapshotを再取得しますが、利用者が入力中の値を捨てません。取消前には、購入者がすでに購入中または購入済みかもしれない旨を確認します。管理側は購入者の進捗を受け取らないため、購入済みとは断定しません。

購入画面は`#/r/<requestToken>`です。初回の正常snapshotとETagを`otsukai:liveRequest:v1:<requestToken>`へ保存し、次の契機で更新を確認します。

- 画面がvisibleの間だけ45秒間隔
- hiddenからvisibleへ戻った直後
- window focus
- 利用者の「更新を確認」

同じETagは304で本文を再取得しません。追加、数量・条件変更、取消の差分は利用者が確認するまで端末内に保持します。追加は「追加されました」、数量・条件は変更前後を表示し、かご投入済み・購入確認済みでは警告を強めます。取消商品はtombstone履歴として残し、`pending`、`inCart`、`verified`、相談中、`notBuying`に応じた文言を表示します。

依頼snapshotと購入進捗は別です。更新後も既存の`checkedState`、item issue、consultation、cart order、Undoを巻き戻しません。通信失敗または期限切れでも最後の正常snapshotがあれば商品と端末内進捗を表示し続けます。写真取得失敗は写真表示だけ、Gemini障害は手書き解析だけに閉じ、v5テキスト同期を止めません。

localStorageのv5 cacheには購入者用request token、検証済みsnapshot、ETag、未確認差分、保存日時だけを保存します。edit secret、管理リンク、Turnstile token、API key、画像Blob、Gemini出力は保存しません。壊れたcache、別tokenのcache、未知property、無効なitem IDやrevisionは破棄し、依頼本文と購入進捗を混同しません。

## 手動Cloudflare設定（別途承認後のみ）

1. 対象account、Worker名、既存deployment、既存migration履歴を読み取りで確認する。
2. `worker/wrangler.toml.example`の既存`PhotoObject` migrationを保持したまま、`SHARED_REQUEST_OBJECTS` bindingと`shared-request-v1`の`new_sqlite_classes`を実設定へ反映する。
3. `SHARED_REQUEST_API_ENABLED=false`でdry-run bundleを行う。
4. Free planの現在のrequest、duration、row read/write、stored data上限を公式資料とDashboardで確認する。
5. Originが`https://plain-relay.github.io`だけ、Turnstile hostnameが`plain-relay.github.io`だけであることを確認する。
6. 明示承認後にだけmigrationを伴うWorker deployを行う。Secret値は変更・表示しない。
7. synthetic API試験、競合、期限、rollbackを確認するまでWorker flagをOFFに保つ。
8. 依頼者・購入者UI、iPhone 11、Android Chrome、LINE内ブラウザを確認し、別承認後にだけフロントflagをONにする。

## rollbackとFree上限時の安全停止

最短停止は`VITE_LIVE_REQUESTS_ENABLED=false`のPages buildと、Workerの`SHARED_REQUEST_API_ENABLED=false`です。既存v1〜v4、写真取得、手書き解析は独立して継続します。migration適用後に古いWorker versionへ戻すだけではclass migrationを取り消せないため、namespaceや保存データを削除せずflagで停止し、Cloudflare公式のmigration/rollback手順を確認してから別承認を得ます。

Free上限へ達した場合は有料planへ自動変更せず、v5作成・取得・更新を有限エラーにします。購入者UIは最後の正常snapshotを保持し、取得失敗や期限切れでも購入進捗を端末内で継続します。運用者は新規作成を先に止め、OFF版Pagesをdeployし、既存固定依頼を継続できることを確認します。

## 本番deploy前チェックリスト

- [ ] `SHARED_REQUEST_API_ENABLED=false`、`VITE_LIVE_REQUESTS_ENABLED=false`
- [ ] v1〜v4 fixtureと通常依頼の回帰テスト成功
- [ ] Geminiなし、写真なし、手書きOFFでv5 synthetic test成功
- [ ] token強度、edit secret hash、Origin、Turnstile、ETag、412、tombstone、14日Alarm成功
- [ ] secret、token、商品名、依頼本文がログへ出ない
- [ ] Worker dry-runとproduction dependency audit成功
- [ ] iPhone 11、Android Chrome、LINE内ブラウザの実機試験完了
- [ ] Free Usage監視と安全停止手順を運用者が確認
- [ ] Worker migration/deployと公開flag ONの個別承認取得

実機の操作順と判定項目は[`LIVE_REQUEST_V5_MANUAL_VERIFICATION.md`](LIVE_REQUEST_V5_MANUAL_VERIFICATION.md)に分離しています。コードmergeだけをiPhone、Android、LINE内ブラウザの成功扱いにはしません。
