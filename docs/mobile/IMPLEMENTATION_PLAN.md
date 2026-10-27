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

## 継続検証（2026-10-26 UTC）

Ownerの「続けてください」により、同じbranch / Draft PR #30で未完了の検証を継続する。
Ownerは利用可能なMacがないと回答。iOSのXcode compilation / 実機は未実施のまま明示する。

- ハードウェア仮想化なしのAndroid 16起動が未完了のため、Android 11/API30の合成環境でも
  同一APKのinstall/同梱起動/offline/共有/永続化/JSONを検証する。target SDK 36は下げない。
- 同じlocked dependenciesでbaseのWeb entryをbuildし、gzip sizeを比較したところ、
  base 123,352 bytesに対して初回head 129,227 bytes。native pluginの初期読み込みを
  Webから分離し、nativeのときだけ動的importする。Web Share/clipboardの既存契約を維持。
- focused tests / 必須全check / CIを実施し、新headに対して新規read-only Codex contextで
  完全差分を再レビュー。旧headレビューを新headへ流用しない。
- 成果物のsource metadata / checksum、OS別実績、未検証項目を最終PR本文・検証記録へ更新する。

Android 11ではboot完了とAPK install / Activity起動まで到達したが、TCGの遅さでSystem UIの
ANRダイアログが発生した。UI Automatorのidle待ちによる不安定さを避けるため、既存の
androidTest依存を使う計測テストを追加し、実WebViewのDOMとnative pluginを検証する。
WebView debuggingは変更しない。明示的な `syntheticDevice=true` とemulator hardwareを
両方確認した場合だけ実行し、試験用storageだけを使用する。OS Picker / 日本語IME / 実機の
未検証を、このテストの成功で代替しない。artifact/logはboolean結果と版情報に限定する。

## クラウドmacOS検証（2026-10-27 UTC、Owner明示依頼）

開始head `5248891a50789f41111549143632ba73da7d6a14`、baseは上記mainと一致、clean。
同じ専用branch / Draft PR #30を維持する。今回の依頼により標準無料macOS Actionsの追加・
実行はscope内。全PR差分のriskは引き続きHigh。既存本番workflowは変更しない。

変更予定は専用PR workflow、署名不要のSimulator検証script、Xcode UI test target/shared
scheme、合成fixture、OS別検証文書。Capacitor 8.5.3 / SwiftPM / application sourceの契約は維持。
公開repositoryの標準 `macos-15` と明示的なXcode 26.3を使い、Node22.23.4でnpm ci/sync後、
CODE_SIGNING_ALLOWED=NOでSimulator向けbuild/testする。larger/self-hosted runnerを使わず、
private repositoryではjobを起動しない。timeout/concurrency/短期artifact保持で実行量を限定。

新規の使い捨てSimulator上だけでXCUITestを実施し、同梱home、固定依頼の受付・購入進捗、
terminate/relaunch、draft保存、実OS共有sheetの取消を試す。失敗/skip/未実施をPASSにしない。
app本体への検証用JS bridgeや起動hookは追加しない。生成画面・URL・入力を含む生のUI log /
xcresult / screenshot / Simulator data containerはuploadしない。決定論的な固定test名と結果、
tool version、source SHA、build metadata、成果物checksumだけをsummaryへ出力する。
成果物は署名不要のSimulator .app（IPA/配布用archiveではない）。Secrets/証明書/Apple account不要。

Web/Worker全必須checkとAndroid app/test buildを再実行し、変更後headの全差分をfresh
read-only Codex contextで独立レビュー。iPhone/iPad実機・LINE受信・Picker・IME/a11y等は別gate。
費用根拠: GitHub公式の公開repo + standard runner無料条件とactions/runner-imagesの
macos-15-arm64 image/Xcode一覧を確認。billing/Secrets/外部設定は変更しない。
rollbackはこのCI追加のrevertまたはDraftを閉じること。merge/Ready/Production/storeは実行しない。
