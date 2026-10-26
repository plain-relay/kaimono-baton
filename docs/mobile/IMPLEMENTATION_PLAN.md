# Android / iOS 実装計画

Ownerチャット依頼、Issueなし。仕様は Draft PR #29 の
`d88822e79c798216cdd631628b5da66387a8a1db:docs/mobile/CODEX_ANDROID_IOS_IMPLEMENTATION.md`。
2026-10-26 UTC に規約を指定順で確認。関連するopen Issueはなく、#4/#6/#7は対象外。

- 要求base / fetch後origin/main / 開始HEAD: `8fd690496b5d99b67985cb724f489ca40a54d782`。
- 開始時working tree: clean。
- 専用branch: `feat/native-android-ios-20261026`。
- Risk: **High**。capability URLの取り込み、native bridge、ローカルファイル共有の境界を追加するため。
- 両OSを1つのDraft PRにまとめる。同じ共通adapterと依存を使用し、未承認headをbaseにした
  stacked PRを作らず、完全差分の検証・レビューを1組に固定できるため。

## Scope / 手順

1. Capacitor公式資料と固定バージョンの配布ソースで環境要件を確認。
   同梱React/Vite資産とhash routingのPoC、設計判断を記録する。
2. `src/platform/` にWeb/native判定、canonical HTTPS URL、共有、backup JSONの
   薄いadapterを追加。既存Web時のbase/query/共有キャンセル契約を維持する。
3. native専用のリンク貼り付け動線を追加。許可ホスト・path・query・hash・サイズと既存codecで
   検証し、復旧は既存preview/確認を経る。リンクやpayloadをログ出力しない。
4. `capacitor.config.ts`, `android/`, `ios/`, npm/lockfileとnative資産同期scriptを追加。
   明確な検証用ID、OS共有、Android戻る、同梱起動、safe area、権限最小化。
5. `docs/mobile/` にPoC、再現build、実機手順、証拠・未検証・残余riskを記録。
   Android debug APKを生成する。Mac/Xcodeなしの場合iOS buildは未実施と明記する。
6. focused tests、既存全必須local checks、既存PR CIを実施。正確なbase/head全差分を
   新規read-only Codex contextで独立レビューし、findingを修正後は再レビューする。

変更予定: package.json/lock、vite.config.ts（native buildの隔離のみ）、共通URL利用箇所、
共有・backup adapter、native link UI/関連tests、native project、build scripts、mobile docs。
Worker、既存URL codec/fixture、localStorage keys/shapes、商品データ、既存Web feature flags、
Actions/Production設定は変更しない。補助機能はnativeで強制OFFにする。

## 不変条件 / data boundary

固定依頼、商品・数量・条件・売場順・進捗・端末内カタログ・JSON/復旧URLは既存実装を再利用。
WebのlocalStorageを読まず、明示importのみ。進捗の自動移行・同期を表明しない。
Web共有は従来base、native共有は公開HTTPS baseを使用。LINE 2,200文字制限を維持。
共有キャンセルは自動copyせず、送信・backup完了と判定しない。
写真/v5/手書き/手動検証機能はnativeでOFF。Worker Origin緩和、association/DNS設定なし。
private ops、Secrets、利用者データ、実共有URL、写真は取得しない。検証は既存・合成fixtureのみ。

## 決定論的security checklist / 検証

- URL: HTTPS、正確なhost/path、資格情報・port・未知query・不正hash・過大入力を拒否するtest。
- 受信payload: 既存v1-v4/recovery/v5 validatorを再利用。保存前preview/明示確認、無ログ。
- 外部遷移: WebViewのallowNavigationを拡張せず、HTTPSのみOSブラウザへ。
- bridge/files: cache内の生成JSONだけ共有、外部storage/camera権限なし、backup自動認定なし。
- build: ローカル資産のみ、remote server URLなし、native build時OFF強制、debug artifactのみ。
- 保存互換性: 既存fixture・storage/recovery tests、Web/native固有tests。
- 必須check: npm ci / npm test / npm run test:worker / npm run check:worker-bundle /
  npm run test:coverage / npm run build / git diff --check。
- verify-pr.ymlの追加dry-run 2件、photo-runtime-check / photo-staging-runtime-checkも実施する。
- native PoC/buildとstaging相当のローカル合成検証を記録し、実機/実公開stagingの未実施は
  成功扱いにしない。Highの残余risk受容、実機証拠、完全独立レビューはmerge前の人間gate。

## Rollback / 停止条件

未mergeではDraft PRを閉じる。既存Web公開・Workerへ影響なし。nativeアプリ削除前には
ユーザー自身がJSON/復旧リンクを保存する（削除によりローカルデータが消える可能性）。
merge、Ready化、auto-merge、Production、ストア提出、配布用署名、DNS/association、
Secrets/Variables変更、利用者data操作は実行しない。これらが必要なら手順のみ残す。
