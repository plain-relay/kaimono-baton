# 商品参考写真 手動実機試験

この手順は、コード・synthetic test・Cloudflare設定のレビューが完了し、別途本番検証の承認を得た後にだけ使用します。通常公開の`VITE_PRODUCT_PHOTOS_ENABLED`とWorkerの`PHOTO_API_ENABLED`は、承認前は`false`のままです。実画像、Worker deploy、migration、flag変更をこの文書の追加だけで許可するものではありません。

## 試験前チェック

- [ ] Worker名、deployment、SQLite migration対象が明確
- [ ] Originが`https://plain-relay.github.io`だけ
- [ ] Turnstile hostnameが`plain-relay.github.io`だけ
- [ ] 手書き機能、Gemini設定から写真APIが分離されている
- [ ] 写真用Turnstile actionが`product_photo_upload`
- [ ] 既存v1〜v3 fixtureと購入回帰が成功
- [ ] 写真なし依頼がv3のままである
- [ ] 検証終了後のOFF復元担当と手順が明確

個人情報、住所、伝票、顔、位置情報を含まない専用fixture画像を使用します。写真token、Turnstile token、画像内容、商品名、Secretをログへコピーしません。

## 共通判定

各端末で、1枚、2枚、3枚、縦写真、横写真、500KiB付近の処理済み写真を確認します。

- 商品を選択し、詳細領域から撮影または写真選択できる。
- 1商品1枚、依頼全体3枚で追加が止まる。
- 圧縮中は確認画面へ進めず、二重処理されない。
- プレビューに向きと全体が正しく表示され、元ファイル名は表示されない。
- 数量0では新規添付できず、既存写真は「共有対象外」となり、数量を戻すと再利用できる。
- 確認画面に写真サムネイルが表示される。
- upload完了前にOS共有画面が開かない。
- upload失敗時に写真が残り、「再試行」と「写真を外してv3で共有」を選べる。
- 共有キャンセル後も入力と写真が保持される。
- 購入画面は写真を待たず商品本文を表示する。
- 写真の期限切れ、取得失敗、API停止でも購入状態、相談、Undo、会計前確認、結果共有を操作できる。
- v1、v2、v3 URLが従来どおり開く。
- Geminiまたは手書き機能が停止中でも写真付き固定依頼が影響を受けない。

## iPhone 11 / iOS 17以上 / Safari

1. Safariで検証URLを開く。
2. 12MP相当JPEGを「写真を撮る」と「写真を選ぶ」の両方から1枚ずつ確認する。
3. 縦向き撮影と横向き撮影の向きを確認する。
4. HEIC/HEIFはブラウザがデコードできる場合だけJPEGへ再エンコードされることを確認する。非対応時は明示エラーとなり外部送信されないことを確認する。
5. 共有シートをキャンセルし、写真とdraftが残ることを確認する。

Codex環境から実端末Safariの成功は確認できません。端末名、OS version、Safari version、画像形式、枚数、結果だけを非機密の試験記録へ残します。

## Android Chrome

1. 通常のChromeで検証URLを開く。
2. カメラ撮影と端末写真選択が別々に利用できることを確認する。
3. 12MP相当の縦・横JPEGを各1回処理する。
4. 320px、360px、390px相当の幅で横スクロールがないことを確認する。
5. 通信を切断してupload失敗を発生させ、商品入力と写真が失われないことを確認する。

## LINE内ブラウザ

1. 専用の検証リンクをLINEの自分宛てまたは閉じた試験先へ送る。
2. LINE内ブラウザでカメラと写真選択の両導線を確認する。
3. 外部ブラウザ指定付き共有URLが既存どおり開くことを確認する。
4. OS共有が利用できない場合のclipboard fallbackが既存挙動を維持することを確認する。
5. LINE内ブラウザと外部ブラウザで購入進捗が共有されるとはみなさない。

## 終了とrollback

1. `VITE_PRODUCT_PHOTOS_ENABLED=false`のPagesを再deployする。
2. Workerの`PHOTO_API_ENABLED=false`を確認する。
3. 写真UIが通常公開から消え、写真なしv3依頼を作成できることを確認する。
4. Worker、Pages、Repository Variables、Secrets、Origin、Turnstile hostnameを読み取りで再確認する。
5. 保存済み写真を手動で破壊せず、作成時から14日のAlarm削除を維持する。

Free上限や障害時は、まず両feature flagをOFFにして新規uploadを止めます。課金プラン変更、migrationの巻き戻し、namespace削除は行わず、Cloudflare公式仕様を再確認して別途承認を得ます。
