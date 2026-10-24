# 無料の商品写真：初回公開の判定と最終操作

更新：2026-10-24。対象は無料の固定依頼v3/v4の商品写真だけ。
**現在は公開前。本文を作成しただけでは公開条件達成・merge・Production配置とは扱わない。**

本人は写真の公開と、無料写真向け公開条件の見直しを明示承認した。
有料βの運用記録が「まだない」ことも記録済み。販売・継続率・7日演習を実施済みにするのではなく、
[PAID_BETA_READINESS.md §15](operations/PAID_BETA_READINESS.md#15-無料の商品写真だけの初回公開判定)の狭い無料写真判定を適用する。
§15を含む変更は新しいexact base/headで独立レビューする。実装Codexの自己merge・ready化・Production実行の権限は変更しない。

## 確認済みの事実

| 項目 | 証拠・結果 |
| --- | --- |
| 元の不具合 | workerd起動時の文字列re-export拒否、共有providerの無応答を再現して修正。過去全障害の原因とは断定しない |
| 0枚 | 自動/browserでv3共有・購入成功。実機0枚は未確認 |
| 1枚 | Android Chromeで添付・共有・直接URL表示・拡大・かご操作成功（本人報告） |
| 2枚 | Android ChromeでLINE Keepメモへ共有→LINEから開く→表示・拡大・かご操作成功（本人報告） |
| 3枚 | Android Chromeで添付・共有・直接URL表示成功。枚数別の拡大/購入は未確認 |
| 自動・runtime | 0〜3枚、4枚拒否、圧縮/向き/EXIF除去、MIME/容量/不正JPEG、Origin/認証、再送/timeout、失敗縮退、14日expiry/実Alarm削除、既存URL/購入/進捗の回帰成功 |
| 削除の回復 | unitで7回失敗後の再予約/回復、削除と再予約の両write拒否後の期限切れGET回復。実workerd/SQLiteで7回失敗注入→実Alarm再予約→削除、期限切れ行のみの回復SQL成功。実quota枯渇試験ではない |
| 実staging | 別Worker/別SQLite namespace、実Siteverify必須経路を通る実機成功、外側Basic認証、最大48時間期限、自動build停止 |
| 証拠の限界 | 実機のHTTP status・token/provider本文は採取していない。localのSiteverifyとOS shareはfixture。実機の成功と混同しない |
| 本番読み取り | PHOTO_OBJECTS→PhotoObject / SHARED_REQUEST_OBJECTS→SharedRequestObject、ともに既存SQLite。Free plan、Logs/Traces OFF |
| 本番現在値 | PHOTO_API_ENABLED=false、SHARED_REQUEST_API_ENABLED=true、MANUAL_VALIDATION_ENABLED=false、DIAGNOSTIC_MODE=false、compatibility date2026-07-26 |
| 本番コード | Active版449ffd3f。Git repositoryは未接続。修正版の配置と対応するcommitは未確認 |

最新のexact head、CI run、独立レビュー、code identityの照合は[Draft PR #26](https://github.com/plain-relay/kaimono-baton/pull/26)本文を正本とする。
headが動けば完全差分を再レビューする。写真の添付/圧縮/共有と通常POST/GETが同一であることをGit差分で照合し、
以前の実機成功は「同じ写真共有処理の実機結果」として参照する。About説明は別にbrowser確認し、削除失敗の再予約は新runtime検証を行う。
新headを実機でdeploy済みとは記載しない。

## 公開前に残る照合

- [ ] 新headの必須CI・完全差分の独立レビューが成功。
- [ ] 公開用Site Key/Worker Secretが同じwidget、hostname `plain-relay.github.io`、action `product_photo_upload`、Origin `https://plain-relay.github.io`を照合。Secret値はチャットに出さない。
- [ ] 本番の既存両class/SQLiteとコードのみのversion upload経路を確認。stage configやexampleで上書きしない。生成設定のmigration配列が空でも履歴を推測しない。remoteがlifecycle変更を要求したら停止する。
- [ ] 料金・無料枠残量と停止閾値を人間が確認。以下の監視/停止案を公開前の記録に採用または修正。
- [ ] 利用者に示す写真の保存・共有・privacy説明を人間が確認。下記の説明案は法的公開済みと扱わない。
- [ ] 削除失敗後の再予約・復旧後削除のruntime証拠と、再予約も失敗した場合の人間復旧手順を確認。Free quotaを実際に枯渇させた試験とは報告しない。
- [ ] 人間が新exact rangeを確認してmergeを判断し、別承認した本番配置を実行。

## 濫用・無料枠・停止の記録案

独立した写真Rate Limitは未実装。現状の対策は、サーバー側のTurnstile/action/hostname/Origin、
1商品1枚・最大3枚、JPEG/MIME/サイズ上限、14日削除、Free quotaの強制停止。
厳密な世界共通の受付上限やquota枯渇防止を提供するものではない。
無料枠は本番のv5やstagingと共有するため、枯渇時は写真や他の補助機能が停止し得る。写真なし固定依頼を維持する。
アプリの写真停止だけでは写真GETや既存14日Alarmの消費がすべてゼロになるとは約束しない。

公開前に人間が採用する監視案：

- 担当：repository管理者。初回公開直後と24時間以内、以後初週は日次にCloudflareの集計使用量だけを確認。
- 停止閾値：共有枠のWorkers/DO requests・SQL rows read/write・保存量のいずれかがFree上限の50%に達した場合、異常な増加、または確認できない場合は新規写真受付を止める。
- 料金：Freeを維持。有料upgrade、新サービス追加、予算超過を写真公開の承認に含めない。
- 再開：原因・枠・必要な独立Rate Limitを確認し、修正があればCI/独立review/staging後に人間が判断。
- 次回確認日：公開後24時間以内。公開日が決まった時点で実日付を記録する。

これは人間の実測記録ではない。採用/実行/集計結果は別に記録し、確認前はチェックを埋めない。

## 未確認の端末と延期する確認

iPhone Safariは端末が手元にない。実カメラの縦横/HEIC、別の物理端末、LINE内WebViewと外部Chromeの区別、
実機の通信断/共有cancel、実機0枚v3、3枚でのLINE経由は未確認。
Androidの本人報告やdesktop Chrome390pxでこれらを代替したとは報告しない。
担当はrepository管理者、次回確認は初回公開後7日以内に結果または端末調達予定を記録する。
確認できるまでiPhone/全カメラ/全LINE経路を検証済みとして案内しない。
7日不在演習は有料β/有料公開の基準を維持し、今回の無料写真公開では実施済みとしない。

## 利用者向け説明（人間の確認・公開が必要）

写真ON時のAbout画面にも以下の要点を追加した。これはsource上の説明案で、未merge/未deploy。
人間が確認して公開するまで法的な説明を公開済みとは扱わない。

商品写真は任意・無料です。写真なしでも通常の依頼を共有できます。
1商品1枚、1依頼最大3枚。写真は初回アップロードから14日間閲覧でき、14日後の自動削除を予定します。
障害やFree quota制限により削除が遅れる場合があります。期限後に新しく画像を取得できるよう期限を延長することはありません。
受信者が端末へ保存した画像や表示済みの画面を、アプリが端末から消去することはできません。
元画像のEXIF/位置情報は引き継ぎませんが、画像内の顔・住所・伝票等は消去できません。写り込みを避けてください。
共有URLを知る人は、転送された場合もログインなしで写真を閲覧できます。
Cloudflareのバックアップ/基盤ログの扱いはアプリの14日削除とは別です。人間が公開説明との整合を確認します。
Turnstileは不正利用防止のためCloudflareでIPやbrowser情報を処理します。
写真の取得失敗・期限切れ・無料枠停止時も、商品本文と購入操作を利用できます。
未検証端末や通信環境では、写真を外して通常依頼を使ってください。

## スマホでの最終操作（前段が成立してから）

1. GitHubでPR #26の最新head・CI・独立レビュー・未確認範囲を確認し、人間がReady for reviewとSquash mergeを操作。
   mergeだけではPagesへ自動公開されない。merge後のmain commitを記録する。
2. 本番Workerの写真flag=falseのまま、既存classだけの新コードversionを人間が準備する。
   `worker/wrangler.photo-release.toml`は本番Worker名・既存2class・keep_vars・同compatibility dateのみを定義し、migrations/exportsは含めない。
   公式Wranglerの `versions upload` で既存classのコードのみを更新し、lifecycle変更やActive化を同時に行わない。
   本番のGit接続がない現在の構成では、スマホでCloudflare→本番Worker→Settings→Builds→Connectを開く。
   repositoryはplain-relay/kaimono-baton、branchはmain、rootはrepo root。
   Build commandは `npm ci && npm run build`、Deploy commandは
   `npx wrangler versions upload --config worker/wrangler.photo-release.toml --keep-vars --strict`。
   人間が接続・実行し、成功したbuildのGit commitが承認対象mainと一致することを確認する。
   成功後にDisable buildsをONへ保存する。自動再uploadを止めたうえで、Deploymentsからその新versionだけを人間が100%へ配置する。
   既存2つのclass/bindingとnamespace ID、SQLite、SHARED_REQUEST_API_ENABLED=trueを前後で照合する。
   versions uploadのdry-runは成功済みだが、lifecycle宣言なしの一般warningが出る。これを消すために例のmigrations/exportsを追加しない。
   remoteでclass新設やlifecycle変更が必要とのerrorが出たら停止し、wrangler deployや設定上書きへ切り替えない。
   versionの準備もProduction外部操作であり人間が実行する。CLIが必要な場合も、上記と同じcommandを承認対象のclean mainから人間が実行する。
3. Cloudflare→本番Worker→Settings→Variables and SecretsでPHOTO_API_ENABLED=trueを人間が保存/deploy。
4. GitHub→Settings→Secrets and variables→Actions→Variables：VITE_PRODUCT_PHOTOS_ENABLED=true。
   VITE_HANDWRITING_IMPORT_ENDPOINTは本番Worker root HTTPS、VITE_TURNSTILE_SITE_KEYは公開widgetのSite Key。
   Secret KeyをVITE変数へ入れず、VITE_MANUAL_VALIDATION_ENABLED=falseと既存v5設定を維持。
5. GitHub→Actions→Stable Free Core Production→Run workflow：main、manual_test_mode=repository、session ID空欄。
   manual-onを選ばない。人間が実行し、manifest commit/写真ON/接続設定を確認。
6. 通常URLで0枚v3/1〜3枚v4、共有・表示・拡大・購入と使用量を確認。

## 停止・rollback

削除回復：AlarmのdeleteAllが失敗した場合は1時間後へ再予約する。setAlarmも失敗した場合は例外を返しCloudflareの有限retryに任せるため、長い全write拒否では自動回復を保証しない。
人間は写真受付を停止し、Free quota/基盤の回復後に対象PhotoObjectの期限切れデータを削除・確認する。
共有URLを管理している本人は期限後にそのURLを再表示すると既存GET経路でも削除を再試行できる。URL/token/写真をAIへ渡さない。
この操作は自動retryの代替として全対象の復旧が保証された証拠ではない。対象を確認できない場合は受付停止を維持し、人間による削除復旧を別途実施・記録する。
既存class/namespace全体の削除で復旧しない。実quota枯渇を起こす試験は行わず、失敗注入と実SQLite/Alarmの回復試験を分けて記録する。

Cloudflare [Data Studio](https://developers.cloudflare.com/durable-objects/observability/data-studio/)での人間の回復手順：

1. 対象は本番のPhotoObject namespaceだけ。SharedRequestObject、別環境、namespace全体の削除を選ばない。
2. Data Studioを開き、対象object IDまたはunique nameを人間が指定する。ID/共有URLをAIへ貼らない。
   対象一覧を確定できない場合は再開せず、管理者が対象の照合を先に行う。スマホUIだけで一覧取得できるとは約束しない。
3. Queryで `SELECT COUNT(*) AS expired_count FROM photo WHERE expires_at <= unixepoch() * 1000` を実行する。
   JPEG、token、本文をSELECTしない。tableが存在しない空objectは削除対象にしない。
4. 期限切れ行がある対象だけ、別承認した人間が `DELETE FROM photo WHERE expires_at <= unixepoch() * 1000` を実行。
   同じCOUNTが0になり、期限前の行を削除していないことを確認する。SQLは実SQLiteの合成fixtureで検証する。
5. 全対象・失敗件数・再開判断だけを人間の運用記録へ残す。Data Studioのqueryはaudit logと利用量を発生させる。
   この手順は本番で実施済みではなく、バックアップの即時消去も意味しない。

人間が本番PHOTO_API_ENABLED=falseとVITE_PRODUCT_PHOTOS_ENABLED=falseを保存し、current mainから同workflowのrepository modeを再実行。
既存URL本文、写真なしv3、購入/進捗/家庭マスター復旧を確認する。
DO class/namespace/migration/保存データを削除せず14日Alarmを維持。起動障害のある旧bundleへ単純rollbackしない。
stagingだけの即時停止はPHOTO_STAGING_ENABLED=false、自動build停止を維持。
stagingの現在の期限は2026-10-25 09:30日本時間。期限切れは保存写真の即時削除ではない。
