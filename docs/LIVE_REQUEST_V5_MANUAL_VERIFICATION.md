# 更新可能依頼v5 実機確認

この手順は、SQLite-backed Durable Objectsのbindingとmigration、Worker deploy、Turnstile、Pagesのfeature flag公開について個別承認を得た後にだけ実施します。この文書だけでは本番deploy、migration、Repository Variables変更、課金変更を許可しません。通常公開は`SHARED_REQUEST_API_ENABLED=false`、`VITE_LIVE_REQUESTS_ENABLED=false`のままです。

## 準備

1. v1〜v4固定fixture、Worker synthetic test、build、bundle、production dependency auditが成功していることを確認する。
2. Cloudflare Dashboardで現在のFree usageと公式のDurable Objects Pricing/Limitsを確認する。有料planへ自動変更しない。
3. OriginとTurnstile hostnameが承認済みPages hostnameだけであることを確認する。
4. 写真を試す場合も1依頼最大3枚とし、個人情報や機密情報を含まない試験画像を用意する。
5. 購入者リンクと管理リンクを別々の安全なメモへ保存する。管理リンクをLINEの購入者トークへ送らない。

## 共通シナリオ

1. 既定の「変更しない通常依頼」で写真なしを共有し、v3 URLになることを確認する。
2. 写真付き固定依頼を共有し、写真が1枚以上のときだけv4、写真を外すとv3になることを確認する。
3. 「あとから追加・変更できる依頼」を明示選択し、購入者用`#/r/`リンクと依頼者用`#/manage/`リンクが分離されることを確認する。
4. 購入者リンクにedit secretや`/manage/`が含まれないことを確認する。
5. 管理画面で商品追加、数量変更、条件変更を行い、購入画面の「更新を確認」で追加マークと変更前後が表示されることを確認する。
6. 購入画面で商品をかごへ入れた後に管理画面から取消し、「かごに入れた後に取り消されました」と履歴表示され、購入進捗が巻き戻らないことを確認する。
7. 購入画面をhiddenにした間は定期通信が止まり、visible復帰とfocusで即時確認されることをNetwork panelで確認する。
8. Worker取得を一時的に失敗させ、最後の正常snapshotと端末内購入操作を継続できることを確認する。表示中の商品を空にしてはならない。
9. 写真取得だけを失敗させ、v5の商品更新と購入操作が継続することを確認する。
10. 手書き機能をOFFのまま、またはGeminiを呼ばない状態で、v5作成・取得・更新が独立して動くことを確認する。

## iPhone 11 / iOS 17以上 / Safari

- 320px相当の狭い表示でも横スクロールがなく、共有方式、管理操作、取消履歴が読める。
- Web Share画面へ渡るのは購入者リンクだけで、Safariへ戻った後に管理リンクを別途コピーできる。
- 画面ロック、Safariのbackground、復帰後のfocusで購入進捗を失わず更新確認できる。
- 写真を試す場合は縦横の各1枚、1〜3枚、共有キャンセルを確認する。HEIC/HEIFの追加変換は初期scope外である。

## Android Chrome

- 320px、360px、390pxで横スクロールがない。
- 45秒poll、tab hidden時停止、visible/focus時確認、手動更新が重複操作にならない。
- 戻る／進む、再読み込み、通信切断後も最後のsnapshotと購入進捗が残る。
- 写真API停止時もテキスト同期を継続する。

## LINE内ブラウザ

- LINEへ送った本文に購入者リンクだけが含まれ、管理リンクが含まれない。
- LINE内ブラウザと外部ブラウザは別storageになり得ることを前提に、それぞれの進捗をサーバーへ同期しない。
- LINE内ブラウザで共有・clipboardが制限されても、商品表示、更新確認、購入進捗操作が利用できる。
- 外部ブラウザへ移動した場合、別端末状態を誤って引き継いだと表示しない。

## 期限・競合・復旧

- 作成から14日で期限切れになり、更新しても期限が延びない。
- 2つの管理画面から同じrevisionを更新し、後着が412になって最新内容を再取得する。入力中の値は残す。
- 期限切れ後も端末に正常snapshotがあれば、読み取りと購入進捗操作を継続できる。
- Free上限または障害時は、まず`VITE_LIVE_REQUESTS_ENABLED=false`のOFF版Pagesへ戻し、次に承認済み手順で`SHARED_REQUEST_API_ENABLED=false`をdeployする。v1〜v4を停止しない。
- migrationを削除したりnamespaceを消したりせず、bindingと保存データの扱いはCloudflare公式手順を確認して別承認を得る。

## 記録

端末、OS、ブラウザ、試験時刻、v3/v4/v5、revision、HTTP status、合否だけを記録します。request token、edit secret、写真内容、商品名、Turnstile token、Secret、API key、request/response bodyは記録しません。
