# 写真・更新可能依頼v5の限定検証ゲート

通常公開の写真機能と更新可能依頼v5をOFFにしたまま、期限付きsessionを持つ検証者だけが実機確認するための運用仕様です。このゲートは本番公開の代替ではなく、実機試験が終わるまでの一時的な経路です。

## 不変条件

- `VITE_PRODUCT_PHOTOS_ENABLED=false`
- `VITE_LIVE_REQUESTS_ENABLED=false`
- `PHOTO_API_ENABLED=false`
- `SHARED_REQUEST_API_ENABLED=false`
- 通常URLでは写真・v5の導線を表示しない
- 許可OriginとTurnstile hostnameを拡張しない
- session token、写真、商品情報、request/edit capabilityをログへ出さない

Pages側の`VITE_MANUAL_VALIDATION_ENABLED=true`は、検証URLのtokenをWorkerが確認する機能だけを有効にします。tokenがない通常URLや、Workerで拒否されたtokenでは写真・v5設定を有効にしません。

## Session契約

検証URLは次の形式です。実tokenはGitHub、CI artifact、文書、Issueへ記録しません。

```text
https://plain-relay.github.io/kaimono-baton/?manualValidationSessionId=SESSION_TOKEN#/create
```

フロントはparameterを取得するとURLから直ちに除去し、`GET /v1/manual-validation/session`へ`X-Otsukai-Validation-Session` headerで送ります。Workerのハッシュ照合、許可Origin、絶対有効期限のすべてが成功した場合だけ、tokenと期限を`sessionStorage`の`otsukai:manualValidationSession:v1`へ保存します。localStorage、History state、診断、consoleへ保存しません。

検証用v4購入者URL、v5購入者URL、v5管理URLには、別端末で同じ確認を行うためsession parameterを付けます。v5購入者URLへedit secretを含めない既存契約は維持します。

## Workerの許可範囲

`MANUAL_VALIDATION_ENABLED=true`かつsession期限内でも、書き込みには有効なsessionと既存Turnstile検証の両方が必要です。写真batch POSTはFormDataの`validationSessionToken`を使用し、v5作成・更新は既存session headerを使用します。写真batchの旧header入力は移行互換としてだけ受理し、FormDataとheaderが同時にある場合は完全一致が必要です。

- `POST /v1/photos/batch`
- `POST /v1/requests`
- `PATCH /v1/requests/:requestToken`

写真と依頼のGETは、推測困難な既存capability tokenを持つ受信者が表示できるよう、検証modeの有効期限内だけ利用できます。session期限切れ後は通常flagがOFFなので利用できません。

## 手動設定

1. 24 byte以上のCSPRNGから`mv1_` prefix付きBase64URL tokenを生成する。
2. tokenのSHA-256 hexだけをgit管理外の実`worker/wrangler.toml`へ設定する。
3. `MANUAL_VALIDATION_EXPIRES_AT`へ延長しないUTC絶対期限を設定する。
4. `MANUAL_VALIDATION_ENABLED=true`、通常2 flagは`false`でdry-runする。
5. 承認済みWorkerへdeployする。
6. Repository Variable `VITE_MANUAL_VALIDATION_ENABLED=true`だけを設定し、通常2 flagは`false`のままPagesをbuildする。
7. 通常URLが非公開のままであることを確認してから、検証URLを本人へ安全な経路で渡す。

## 終了・rollback

問題があれば、最初に`VITE_MANUAL_VALIDATION_ENABLED=false`でPagesを再deployします。次にWorkerをforward deployし、`MANUAL_VALIDATION_ENABLED=false`、通常2 flagも`false`にします。SQLite Durable Object namespace、migration履歴、保存済みObjectを削除しません。session tokenやhashをIssueへ貼り付けません。

Free上限へ達した場合も有料planへ変更せず、同じ順序で新規操作を停止します。固定v1〜v4の本文、通常v3共有、端末内購入進捗は継続できることを確認します。

実機項目は[商品写真の手動確認](PRODUCT_PHOTO_MANUAL_VERIFICATION.md)と[v5の手動確認](LIVE_REQUEST_V5_MANUAL_VERIFICATION.md)を参照してください。
