# 買いものバトン

Plain Relayがつくる、静かに役立つ小さな道具です。

家庭内のお使い依頼を、共有URLだけで渡せるスマホファーストのWebアプリです。依頼者は商品と条件を選び、「LINEで送る」からOS標準の共有画面を開いてLINEを選択します。お使いする人は共有URLをスマートフォンで開き、売り場順のリストを見ながら購入状況を記録できます。

## 技術スタック

- React
- TypeScript
- Vite
- Vitest
- `localStorage`
- `lz-string`
- GitHub Pages
- GitHub Actions
- Cloudflare Worker / Turnstile（手書き商品取り込みまたは商品参考写真を有効化した場合）
- SQLite-backed Durable Objects（商品参考写真または更新可能依頼v5を有効化した場合）
- Gemini 3.5 Flash-Lite（手書き商品取り込みを有効化した場合）

通常の固定依頼と買い物状態にはアプリサーバー、外部DB、URL短縮サービス、ログイン機能を使用せず、共有データを圧縮してURLへ自己完結させます。任意の手書き商品取り込みは画像解析時にCloudflare Workerを経由します。別途承認後に有効化する商品参考写真と更新可能依頼v5だけは、同じWorkerと別々のSQLite-backed Durable Objectへ作成時から14日間保存する設計です。現在の通常公開では写真機能とv5をOFFにしています。

通常公開では`VITE_PRODUCT_PHOTOS_ENABLED`、`VITE_LIVE_REQUESTS_ENABLED`、`VITE_HANDWRITING_IMPORT_ENABLED`、`VITE_HANDWRITING_DIAGNOSTICS_ENABLED`、`VITE_MANUAL_VALIDATION_ENABLED`をすべて`false`にします。Worker側の`MANUAL_VALIDATION_ENABLED`と`DIAGNOSTIC_MODE`も`false`を既定とし、有効化やProduction設定変更は別の明示承認を必要とします。

## 共有URL

新しく作成する依頼は、家庭用商品リストの内容を正確に渡せるv3形式です。

```text
https://plain-relay.github.io/kaimono-baton/?openExternalBrowser=1#/l/<v3圧縮データ>
```

LINEへ配送するURLでは、`#` より前に `openExternalBrowser=1` を付けます。LINEトークから購入リストをタップした時点でChromeやSafariなどの外部ブラウザを開かせ、買い物画面でもOS標準共有を利用できる可能性を高めるためです。

公開済みのv1・v2形式も引き続き開けます。

```text
https://plain-relay.github.io/kaimono-baton/#/list?data=<v1圧縮データ>
https://plain-relay.github.io/kaimono-baton/#/l/<v2圧縮データ>
```

`#/l/<encoded>` はv2・v3・v4共通で、展開後の先頭バージョンから判定します。v1・v2・v3のエンコーダー、デコーダー、固定fixture、URL形式は変更しません。いずれも復号後は既存の `ShoppingRequestPayload` にそろえて購入画面へ渡します。不正データ、空データ、未知バージョンは白画面にせずエラー画面を表示します。

### v4写真参照ペイロード（通常公開OFF）

参考写真が1枚以上ある固定依頼だけは、v3の商品tupleを変更せず、最大3件の`[itemIndex, photoToken]`を追加したv4を使用します。写真なし依頼はv3のままです。写真参照が壊れていても商品本文を復元し、写真の取得失敗や期限切れで購入進捗を止めません。詳細は[`docs/COMPACT_REQUEST_V4.md`](docs/COMPACT_REQUEST_V4.md)と[`docs/PRODUCT_PHOTO_ARCHITECTURE.md`](docs/PRODUCT_PHOTO_ARCHITECTURE.md)を参照してください。

共有後に更新できるv5は既存固定依頼とは別の、期限付きserver-backed方式です。依頼者が明示選択した場合だけ購入者用`#/r/`と依頼者用`#/manage/`を作成します。購入画面はvisible中の45秒poll、focus、手動操作でETagを確認し、通信失敗や期限切れでも最後の正常snapshotと端末内購入進捗を維持します。Worker API、SQLite-backed `SharedRequestObject`、フロントUIはいずれもflag OFFで非公開です。capability URL、revision/ETag、tombstone、固定14日期限、手動Cloudflare設定、rollback、実機試験は[`docs/LIVE_REQUEST_V5_ARCHITECTURE.md`](docs/LIVE_REQUEST_V5_ARCHITECTURE.md)と[`docs/LIVE_REQUEST_V5_MANUAL_VERIFICATION.md`](docs/LIVE_REQUEST_V5_MANUAL_VERIFICATION.md)を参照してください。

写真・v5の通常flagをOFFのまま期限付きで実機確認する運用は[`docs/PHOTO_V5_LIMITED_VALIDATION.md`](docs/PHOTO_V5_LIMITED_VALIDATION.md)に分離しています。検証sessionはWorkerでハッシュ照合し、URLから除去後はsessionStorageだけへ保持します。

### v3ペイロード

v3は短いJSON配列を `lz-string` で圧縮します。

```ts
[
  3,                    // バージョン
  requestKey,           // 短い依頼キー
  title,                // 後方互換用の内部タイトル
  items,                // 基準参照商品またはスナップショット商品の配列
]
```

未変更の基準商品は `[0, baseProductIndex, quantityCode, memo?]` の短い参照形式です。名称・単位・カテゴリのいずれかを家庭用に変更した基準商品、家庭追加商品、一回限りの自由追加商品は、`[1, productId, name, quantityCode, unit, categoryCode, memo?]` のスナップショット形式です。数量は `0-9` と `a-k` の1文字で0～20を表します。

購入側は自端末の商品リストを参照せず、v3 URL内のスナップショットを正として名称・単位・カテゴリを復元します。`requestId = v3-${requestKey}` とし、item IDは依頼内の安定した順序から生成するため、同じv3 URLは毎回同じIDになります。

依頼タイトルの入力欄は廃止しました。新しく作る依頼の内部タイトルは `おつかいリスト` に固定します。`ShoppingRequestPayload.title` とv1/v2/v3内のタイトル位置は、互換性のために残しています。過去URLに別のタイトルが含まれていても、購入画面の見出しは常に「おつかいリスト」です。

### v2互換ペイロード

v2は固定商品番号表、数量コード、条件データ、自由追加商品の短い配列を保持する公開済み形式です。新規作成には使いませんが、`requestId = v2-${requestKey}`、item ID、圧縮方式、固定fixtureを含む復号仕様を維持します。

### v2固定商品番号表

`src/data/shareProductIdsV2.ts` の `SHARE_PRODUCT_IDS_V2` は公開URLの互換性を支える固定表です。

- 公開済みの要素を並べ替えない
- 公開済みの要素を削除しない
- 公開済みの商品IDを変更しない
- 新商品は末尾へ追加する
- 画面表示用の `sortOrder` と共有用番号を分離する
- 非表示・廃止商品も古いURL復元用に残す

固定表の商品が現在の商品マスターに見つからない場合は、その商品だけを「不明な商品」として安全に表示し、依頼全体は読み込みます。固定表の範囲外にある未知の商品番号は安全に無視します。

## 家庭用商品リスト

ホームの「商品リストを編集」から `#/products` を開き、基準商品の名称・単位・カテゴリ・表示状態を家庭向けに変更できます。新しい商品も通常の商品一覧へ追加できます。商品名は30文字、単位は10文字までで、日本語IMEと書記素単位の制限を共通入力処理で守ります。空の単位は「個」に正規化し、カテゴリは既存カテゴリから選択します。

`src/data/products.ts` と `SHARE_PRODUCT_IDS_V2` は公開済みURLの互換用基準データとして変更せず、家庭用の変更は基準との差分として保存します。基準値へ戻したフィールドは差分から除き、空になったoverrideも削除します。商品をリストから外す操作は物理削除ではなく非表示です。基準商品は従来の並び順を維持し、カテゴリを移動した商品と家庭追加商品は移動先カテゴリの末尾へ安定して配置します。家庭追加商品のIDは `household:<UUID>` で、削除・非表示後も再利用しません。

依頼作成画面は基準データではなく有効商品リストを使用します。作成途中で選択済みの商品を非表示にしても数量・条件を消さず、「今回の依頼に残っている非表示商品」に表示します。数量を0にするとそのセクションから外れます。名称・カテゴリ変更では作成中の数量と条件を維持し、選択済み商品の単位変更前には表示単位が変わることを確認します。

## 商品リストの復旧

家庭用商品リストの変更はブラウザへ即時保存します。現在の内容と最後に利用者が保存確認したfingerprintが異なる間は、商品リスト編集画面とホームに「未バックアップの変更があります」と表示します。fingerprintは正規化した名称・単位・カテゴリ・表示状態・追加商品から安定生成し、`updatedAt` だけの違いでは変わりません。

「復旧リンクを保存」は次の形式を生成し、既存のWeb Share APIまたはclipboard fallbackでLINE・メモなどへ保存できます。

```text
https://plain-relay.github.io/kaimono-baton/#/catalog/restore/<圧縮データ>
```

復旧ペイロードは `version: 1`、作成日時、家庭用変更差分だけを含み、基準商品全体は含めません。Web Share APIが成功しても送信・保存完了は判定できないため、それだけではバックアップ済みにしません。共有画面から戻った後の「復旧リンクをLINEやメモへ保存しましたか？」で利用者が「保存した」を選んだ場合だけ、現在のfingerprintをバックアップ済みとして記録します。キャンセル、失敗、「まだ保存していない」では未バックアップのままです。

復旧URLは最終実長を測り、上限は2,200文字です。超過時はデータを切り捨てず、`kaimono-baton-product-list-YYYY-MM-DD.json` を書き出します。商品リスト編集画面では同じJSONを読み込めます。リンクとJSONは同じvalidator、プレビュー、置き換え処理を使用します。

復旧リンクを開いたりJSONを選んだりしただけでは保存内容を変更しません。version、schema、基準商品ID、家庭商品ID、カテゴリ、文字数、件数、展開後サイズ、ID重複、危険なオブジェクトキーを検証し、変更件数と保存日時をプレビューしてから明示的に「この商品リストに置き換える」を選びます。現在の商品リストより古い可能性がある場合は警告し、既定の安全側操作はキャンセルです。置き換え前の現在版はPrevious世代へ残し、復元したfingerprintをバックアップ済みとして記録します。初回実装ではマージと端末間自動同期は行いません。

## 入力上限

制約値は `src/constants/requestLimits.ts` に集約しています。

| 対象 | 上限 |
| --- | --- |
| 通常商品の数量 | 0～20 |
| 自由追加商品の数量 | 1～20 |
| 各商品の条件 | 30文字 |
| 選択済み通常商品と自由追加商品の条件合計 | 1,000文字 |
| 自由追加商品名 | 30文字 |
| 自由追加商品の単位 | 10文字 |
| 自由追加商品数 | 10件 |
| LINE外部ブラウザ指定を含む最終v3購入リストURL | 2,200文字 |
| 商品リスト復旧URL | 2,200文字 |

文字数は、利用可能な環境では `Intl.Segmenter`、それ以外では `Array.from` を使って利用者から見た文字単位で数えます。絵文字、サロゲートペア、結合文字を途中で切りません。

日本語IME対応欄は共通の `ImeAwareTextInput` を使い、変換中を含むローカル表示値と、制限検証済みの親stateを分離します。変換中はローカル表示だけを更新し、確定時に個別文字数、条件合計、URL予算の順で検証した結果を表示値へ同期します。Android・iOSのユーザーエージェント分岐や固定待ち時間は使いません。

ネイティブの `maxLength` はUTF-16コード単位でIMEや書記素単位の制限と一致しないため、日本語IME対象のテキスト欄では使用しません。文字数表示と `Intl.Segmenter` ベースの共通制限を正とします。

入力、貼り付け、数量ボタン、数値入力、保存値の復元、内部state更新、URL生成直前の各入口で同じ制限を適用します。条件合計には選択済みの通常商品と自由追加商品の条件だけを含めます。通常商品の選択解除や条件削除で、その分の条件予算が戻ります。

文字数上限だけでは圧縮後の長さを保証できないため、入力変更のたびに実際のv3購入リストURLを仮生成します。`openExternalBrowser=1` を付けた最終配送URLが2,200文字を超える変更はstateへ反映せず、共有直前にも再検証します。

条件合計と共有URL長のサマリーは通常時には表示しません。条件合計が800文字（80%）以上、または最終共有URLが1,760文字（80%）以上になった場合だけ注意を表示します。入力が拒否・一部切り詰めされた場合や共有URLを生成・共有できない場合は、理由をエラーとして表示します。

自由追加商品は商品名と数量を主要入力とし、条件欄は常に表示します。単位の初期値は「個」で、変更するときだけ「詳細設定」を開きます。詳細設定を閉じても入力済みの単位は保持され、単位が「個」以外の既存商品を編集するときは詳細設定を開いた状態で表示します。

## LINEへの送信

依頼作成画面の「LINEで送る」、相談、買い物結果共有は、共通のWeb Share API処理でOS標準の共有画面を開きます。利用者が共有先としてLINEを選択します。

購入状態にかかわらず各商品カードへ「相談する」を常時表示します。買えない理由と補足を入力した後、その商品だけを「LINEですぐ相談」するか、「まとめ相談に追加」できます。個別相談文には商品名、必要数量、条件、状況、補足を含めます。まとめ共有では `queued` の商品だけを一括相談文へ含め、同じ商品の再追加は重複させず内容を更新します。

WebアプリはLINEで実際に送信されたか確認できません。ネイティブ共有が完了した場合も「共有画面を開きました。LINEを選択して送信してください」と案内します。共有画面を開けた場合またはコピーできた場合は相談を `shared` として記録し、キャンセル・失敗時は `queued` と入力内容を保持します。相談は購入状態とは別に解決でき、解決しても `inCart`、`verified`、`notBuying` などの購入状態を変更しません。

Web Share APIへ渡す共有データは `title` と `text` だけです。`url` プロパティは使用しません。

```ts
navigator.share({
  title: 'おつかい依頼',
  text: shareMessage,
})
```

共有本文は次の形です。

```text
今日のおつかいをお願いします。

https://plain-relay.github.io/kaimono-baton/?openExternalBrowser=1#/l/<v3圧縮データ>
```

購入リストURLの前に空行を置き、URLを改変せず独立した最終行へ1つだけ入れます。URLの後ろには句読点や説明文を置きません。本文を `encodeURIComponent` せず、通常の文字列としてブラウザとOSへ渡します。

Web Share APIが利用できない場合、またはキャンセル以外の理由で共有開始に失敗した場合だけ、同じ本文をクリップボードへコピーします。`AbortError` による利用者キャンセルでは自動コピーしません。共有中は多重押下を防ぎます。買い物画面でWeb Share APIが利用できない場合は、現在のv1/v2/v3ハッシュを保ったまま `openExternalBrowser=1` を付ける「外部ブラウザで開く」導線も表示します。

LINE内ブラウザと外部ブラウザでは `localStorage` が共有されない場合があります。そのため、LINE内ブラウザで買い物を始めてから移動するのではなく、新しい購入リストURLを最初から外部ブラウザで開かせる設計です。過去のURLや外部ブラウザ指定が無視された環境では、画面上部の補助導線を利用できます。

次は使用しません。

- LINE Social Plugins
- `line.me/R/share`
- LINE URLスキームへの直接遷移
- LINE Messaging API
- LINEログイン
- LIFF

## 同じ依頼URLの再利用

商品ID、名称、単位、カテゴリ、並び順、数量、条件と、自由追加商品の名称・数量・単位・条件が同じなら、生成済みの同じv3 URLを再利用します。共有画面をキャンセルして同じ内容を再送した場合もURLを作り直しません。家庭用商品リストで名称・単位・カテゴリを変えた場合を含め、内容が変わった場合だけ新しい依頼キーとURLを生成します。内部タイトルは常に固定値なので、URL再生成の判定対象となる可変タイトルはありません。

## 購入状態と例外処理

商品ごとに次の状態を保存します。

| 状態 | 画面表示 | 意味 |
| --- | --- | --- |
| `pending` | 未購入 | まだ購入判断が終わっていない |
| `inCart` | かご済み | 条件なしの商品をかごへ入れた |
| `verified` | 購入時に条件確認済み | 条件を確認して商品をかごへ入れた |
| `consulting` | 旧データ互換用 | 読み込み時に `pending` と独立した相談データへ移行する |
| `notBuying` | 今回は買わない | 理由を記録し、今回の購入対象から外した |

数量1・条件なしの商品は「かごに入れる」の1タップで `inCart` になります。数量2以上または条件ありの商品は、1つの購入確認ダイアログに必要な確認項目だけを表示します。数量と条件の両方がある場合もダイアログは1回だけで、両方のチェックが終わるまで確定できません。条件あり商品は購入時の確定で `verified` になります。旧保存データに条件ありの `inCart` が残る場合も、会計前の旧ボタンではなく同じ購入確認ダイアログから確認します。

相談は購入状態と分けて、依頼単位で次の状態を保存します。

| 相談状態 | 意味 |
| --- | --- |
| `queued` | まとめ相談に追加済み、または共有をキャンセル・失敗した未解決相談 |
| `shared` | 共有画面を開いた、または相談文をコピーした未解決相談 |
| `resolved` | 回答後に解決済みとして確定した相談 |

買えない理由は「売り切れ」「商品が見つからない」「指定条件の商品がない」「商品の状態が悪い」「その他」から選択できます。会計前チェックでは、かごに入れた商品、今回は買わない商品と理由、未処理商品、未解決相談を表示します。通常の条件確認を会計前に繰り返しません。

「買い物を終了する」は、商品が1件以上あり、未購入、未解決相談、旧データの購入時条件確認待ちがすべて0件の場合だけ表示します。会計前チェック、相談、結果共有の状態遷移はv1・v2・v3で共通です。

ツールバーの常設Undoは廃止しました。永続状態が変わった直後だけ操作内容と「元に戻す」を5秒間表示し、戻せるのは最新の1操作だけです。新しい状態変更では古い通知を置き換えて5秒を数え直し、商品状態、買えない理由・補足、かご投入順をまとめて復元します。

買い物中の画面には「新しい依頼を作る」を表示しません。新規依頼の作成はホーム画面の「依頼を作る」から開始し、完了画面には従来どおり「ホームへ」だけを残します。

## このアプリについて

ホーム画面の技術説明は `#/about` の「このアプリについて」へ移動しました。依頼内容が共有URLに含まれること、買い物の進捗が操作中の端末とブラウザ内に保存されること、別端末・別ブラウザやLINE内ブラウザと外部ブラウザの間では進捗が引き継がれない場合があることを利用者向けに説明します。アカウント登録、サーバーへの進捗保存、外部DBは使用しません。

## localStorage

既存の依頼・購入キーと保存形式は変更せず、相談データと家庭用商品リストを別キーへ保存します。

- 依頼作成中のドラフト: `otsukai:createDraft`
- 最後に作成した共有URL: `otsukai:lastSharedUrl`
- 商品状態: `otsukai:checked:${requestId}`
- かご投入順: `otsukai:cartOrder:${requestId}`
- 買えない理由: `otsukai:itemIssues:${requestId}`
- 相談内容と状態: `otsukai:consultations:${requestId}`
- 家庭用商品リスト現在版: `otsukai:householdCatalog:v1`
- 家庭用商品リストPrevious版: `otsukai:householdCatalogPrevious:v1`
- 復旧データ保存確認: `otsukai:catalogBackupReceipt:v1`
- v5最後の正常snapshot・ETag・未確認差分: `otsukai:liveRequest:v1:${requestToken}`

相談データは読み込み時に正規化し、壊れた値や未知の値を安全に無視します。旧データの `checkedState[itemId] = consulting` と対応する `itemIssue` は、購入状態 `pending` と相談状態 `queued` へ移行し、理由と補足を新しい相談キーへ引き継ぎます。既存の `pending`、`inCart`、`verified`、`notBuying`、かご投入順、Undo用データは変更しません。

家庭用商品リストは正規化してから現在版をPreviousへ送り、新しい現在版を書き、再読み込みで検証してから画面stateへ反映します。現在版が破損していれば正常なPrevious版を復旧し、両方がないか破損していれば不変の基準商品リストで起動します。保存値は型アサーションせず、schema、許可キー、ID、カテゴリ、文字数、日時をvalidatorで確認します。

古い作成ドラフトに新上限を超える数量や文字列がある場合は、作成画面の読み込み時に新上限へ正規化して通知します。v1共有URLの閲覧値は新規作成上限で書き換えません。

## 手書きメモから追加

依頼作成画面の上部で、スマートフォンのカメラ撮影またはJPEG/PNG/WebP画像を選び、手書きの商品名と現在の商品リストの対応候補を確認できます。この機能は初期状態ではOFFで、`VITE_HANDWRITING_IMPORT_ENABLED=true`、`VITE_HANDWRITING_IMPORT_ENDPOINT`、Turnstile Site Keyの3つが揃ったビルドだけに表示されます。

```text
ブラウザ内で画像検証・回転反映・長辺1600px以下・2MB以下へ変換
  ↓ 画像 + 現在表示可能な商品候補 + 毎回新しいTurnstileトークン
Cloudflare Worker（Origin/画像/候補JSON/Turnstile検証）
  ↓ Interactions API、thinking_level: minimal、JSON Schema
Gemini 3.5 Flash-Lite
  ↓ 商品表記 + matched/ambiguous/unknown + 候補商品ID
Workerとブラウザで商品ID・statusを再検証
  ↓ 利用者が候補を確認
既存のdraft制限・URL予算検証を通して一括反映
```

Geminiが一意に対応させた`matched`だけを初期選択し、複数候補の`ambiguous`と候補外の`unknown`は利用者が選ぶまで反映しません。個数、単位、条件、チェック、取消線、購入済み状態は読み取らず、既存商品は数量0だけを1にします。既存数量と条件は維持します。候補外の商品を自由追加する場合は数量1、仮単位「個」、条件空となり、家庭用商品マスターへは登録しません。

画像と現在の商品候補は解析のためCloudflare Worker経由でGoogle Geminiへ一時送信されます。アプリは画像をlocalStorage、sessionStorage、IndexedDBへ保存せず、Workerも画像、商品候補、モデル出力を保存・ログ出力しません。画像、読み取った生の内容、取り込み元を示す情報はv1/v2/v3共有URLへ入りません。無料枠では送信した入力と出力がGoogleのサービス改善に使用される場合があります。失敗・キャンセル時も現在の依頼内容は変わらず、通常の商品選択を継続できます。

フロント設定例は[`.env.example`](.env.example)、Google AI Studio、Cloudflare Worker、Turnstile、Secrets、無料枠の利用条件とUsage確認、デプロイ、障害時無効化は[`worker/README.md`](worker/README.md)を参照してください。Gemini APIキーなどのSecretは`VITE_`環境変数へ入れません。

実画像を通常ブラウザで安全に切り分ける手順、段階別の判定表、テスト画像生成、診断のON/OFF復元は[`docs/HANDWRITING_MANUAL_VERIFICATION.md`](docs/HANDWRITING_MANUAL_VERIFICATION.md)にまとめています。診断は既定OFFです。手動検証buildでも、専用query、build固有のsession ID、45分の有効期限がすべて一致する場合だけ表示・保存します。

手動検証の状態変更、Pages run特定、復旧はNode CLIが担当し、PowerShellファイルは薄い互換ラッパーです。Repository Variablesの両フラグは`false`から変更せず、workflow_dispatchの対象buildだけを一時的にONにします。公開`handwriting-deployment-state.json`がsession ID、commit SHA、設定状態まで一致した後だけ`MANUAL TEST IS ENABLED`を表示します。Workerログは、その後に表示される実version ID入りの完成済み`wrangler tail`コマンドをコピーして開始してください。

```bash
npm run manual:handwriting:preflight
npm run manual:handwriting:start
npm run manual:handwriting:status
npm run manual:handwriting:stop
npm run manual:handwriting:recover
```

## ローカル開発

```bash
npm ci
npm test
npm run test:worker
npm run build
npm run dev
```

## GitHub Pages

`main` へのpushではProduction deployを開始しません。GitHub Pagesへの公開は、人間が
`.github/workflows/stable-free-core-production.yml` を`main`から明示的に
`workflow_dispatch`した場合だけ実行
します。workflowはdispatch時とdeploy直前に対象SHAがremote `main`の先端と一致することを
確認し、non-main refまたはstale SHAをfail closedします。buildは
`BASE_PATH=/kaimono-baton/`を使用し、画面遷移はハッシュルーティングです。

通常のworkflow不具合では、最後に正常deployされたStable Free Coreを維持し、manual-only、
unique workflow filename、current-main確認を残すforward-fix PRを作成します。
push-to-`main`自動deployを導入する変更は、そのmerge自体がProductionを
開始し得るため禁止します。Production影響を持つ変更は別の人間承認対象です。
