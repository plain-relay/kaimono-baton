# 写真専用の独立検証環境計画

- 対象: ユーザー依頼「商品写真機能の復旧・検証・一般公開準備」。関連 Draft PR #25。
- base: `ea2582f6f4f14bedf98b9591ce281fbfff8aa654` (`main`)、復旧済み開始点: `c1adb64360e8149bd24bb1b1f0267648122ff647`。
- branch: `test/product-photo-staging`。リスク: High（検証用認証・写真・binding・migration例）。
- 人間が作成済み: 空の `kaimono-baton-photo-staging` Worker と、そのホスト専用 Turnstile widget。

## 構成と不変条件

本番とは別名の Worker に既存 React 画面と写真 API のみを配置する。同じホストの
静的 assets も含めすべてのリクエストを検証用 Basic 認証で保護し、設定不足、
期限切れ、別ホストでは閉じる。これは検証環境の外側の保護であり、製品の購入者
ログインを追加しない。個人情報のない合成写真のみを扱う。

`PHOTO_OBJECTS` は同じ Worker の `PhotoObject`、新規 SQLite namespace にする。
`script_name`、既存 namespace ID、本番 migration のコピーを禁止する。
保持期間・削除・検証・共有処理は既存写真実装を再利用する。元の Worker entry、
公開 Pages、通常公開 flag、v5、手書き、Gemini、依存関係は変更しない。
同一アカウントの無料枠は共有されるため無影響・無料を保証しない。

## 実装順と確認

1. 設定不足・認証失敗・他 Origin/host・期限・assets 認証・API 範囲の失敗テストを先行。
2. 写真専用 Worker entry、固定 staging config、外部変更をしない build/verify script。
3. ビルドでは環境ファイルを読まず、写真だけ ON、v5・手書き・診断・既存手動検証 OFF。
4. 実 workerd・SQLite・static assets で認証→POST→GET、ブラウザで表示を検証。
   ローカル Siteverify fixture と実 Cloudflare Siteverify を明確に分ける。
5. 全必須 local checks と CI、exact base/head の完全差分を独立 read-only Codex review。
6. Draft PR とスマホ用手順を準備した後に、人間が新規 Worker だけに設定・deploy・
   migration を実施する。AI は Cloudflare 変更・deploy・migration を実行しない。

## 決定論的 security checklist

- [x] 固定 Worker 名・固定ホスト、他ホストでは assets/DO を呼ばない（unit）
- [x] 同 Worker のみの新規 SQLite binding、production reference なし（config/hash/dry-run。実環境は人間が確認）
- [x] 全 assets で Worker first、無認証・期限切れ・設定不足は拒否（unit＋実static-assets runtime）
- [x] 既定 OFF、期限は最大48時間、no-store/noindex、資格情報を下流へ転送しない（unit）
- [x] 写真以外の API 不可、Origin 固定、共有URLへ認証情報を入れない（unit/runtime/browser）
- [x] 環境ファイル・秘密値を build へ混入しない、テスト用 artifact の deploy 拒否（build/unit/verify）
- [x] 写真・token・URL・認証 header・secret・生エラーをログ出力しない（entry/script確認、Observability OFF）
- [x] 本番 flag・workflow・既存 migration・保存データは変更しない（専用entry/config、deployなし）
- [x] 実機・実 Siteverify 未確認を成功と報告しない（検証文書の未確認欄）

## rollback / 人間操作の境界

人間は新規 Worker の `PHOTO_STAGING_ENABLED` を `false` にして検証を閉じ、Git build の
自動 deploy を停止する。本番には触れない。新規 SQLite migration を取り消すための
削除や既存 class の rename/delete は行わない。写真は既存の14日 alarm で削除される。
認証期限が来ても保存写真の即時削除を意味しない。

Git連携はコード準備・独立レビュー後に人間が設定する。以降の AI push が deploy を
誘発しないよう、人間が初回 deploy 後に自動 build を停止したことを確認してから
追加 push する。merge、Production、Secrets・Variables・migration の承認は別扱い。
