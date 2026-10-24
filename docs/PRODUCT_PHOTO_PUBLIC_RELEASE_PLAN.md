# 無料の商品写真：公開条件の見直し計画（2026-10-24）

- Task: 商品写真復旧・通常公開準備の継続。本人が公開を承認し、無料写真向け公開条件の見直しを明示許可。
- Base: main `ea2582f6f4f14bedf98b9591ce281fbfff8aa654`。
- Branch: `test/product-photo-staging`、見直し前head `7468f1c7b3a2e914e144e63fd80146c15e35b97a`。
- 完全差分のRisk: High。今回の追加は公開判定の文書とAboutの写真説明。写真API、Secrets、料金、AIの操作権限は変更しない。
- 理由: 無料・停止可能な写真の初回公開に、有料βの販売/継続率/7日間の実績を一律要求していた。
  技術・privacy・安全停止の証拠と、有料商品の事業実績を分ける。

## 対象と不変条件

`PAID_BETA_READINESS.md`に無料の商品写真だけの初回公開判定を追加し、有料β・有料一般公開の既存基準は維持。
写真以外の補助機能、v5、有料化、AI解析、任意ファイル保存へ適用を拡張しない。
認証/Origin/Turnstile、14日削除、容量/枚数、EXIF除去、無料コアの独立性、既存URL互換、独立レビューは緩和しない。
本番と検証の分離、費用の強制上限、停止・復旧、設定漏れの閉鎖、ログ/個人情報保護を公開前に確認する。
独立Rate Limit未実装・Free quotaの共有・iPhone未検証は残余riskとして具体的に記録し、成功と偽らない。
料金のない写真だけの公開に有料βの世帯数・継続率・課金/返金実績・7日間の演習を要求しない。
AGENTSの役割分離、自己merge禁止、ready化/Production/法的公開の人間実行は変更しない。

## 成果物・検証・rollback

1. 公開判定の適用範囲を明示し、無料写真向けの非免除安全条件と延期可能な端末/運用確認を区別する。
2. `PRODUCT_PHOTO_FREE_RELEASE.md`に確認済み/未確認、設定名、スマホの人間操作、停止手順を集約。
   Aboutが写真ONでも「写真は提供対象外」と表示する矛盾を解消し、無料・14日保存・URL転送・EXIF/写り込み・未検証端末を写真ON時だけ表示する。
   Aboutの説明不足を先行テストでRED確認後に修正。写真OFFと既存v5の説明/設定は維持する。
3. 既存の復旧記録に新しい判定の参照を追加。過去の未検証/旧判定の記録は上書きで成功扱いにしない。
4. 全必須local check/CI。文書主体の変更でも必要なCIを省略しない。写真の作成/共有/APIコードは同一で、同じ実機操作の再依頼はしない。AboutのON/OFF表示はbrowserで確認する。
5. 新exact base/headの完全差分をfresh read-only Codexへ再レビュー。旧headレビューは新headを承認した証拠にしない。
6. About以外のcode identityで既存実機検証と対応付ける。Aboutを含む新artifactが旧実機結果そのものだとは記載しない。merge後のmainとWorker version/Pages artifactも人間が対応付ける。

本番flagはOFF。人間がPRと新条件を確認してmerge・別承認したProduction操作を行うまで公開しない。
rollbackは写真flagをWorker/PagesでOFF、無料コアを確認、DO/保存データ/14日Alarmを保持。
規則の見直しを戻す場合は文書のみを戻し、runtimeの起動修正を巻き戻さない。
private ops、Secret値、写真・共有URL・利用者本文を取得しない。
