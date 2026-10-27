# アプリ実装の検証記録

検証日は2026-10-26〜27 UTC。Ownerチャット依頼・Issueなし。Draft PR #29の仕様に従う。
Base: `8fd690496b5d99b67985cb724f489ca40a54d782`。
Branch: `feat/native-android-ios-20261026`。exact head / PR / CI / artifactは最終PR本文に記録する。

これは**実装済み範囲と未検証範囲の記録**。署名・配布・実機受入・審査完了の主張ではない。

追加のcloud macOS/Android CIは [CLOUD_SIMULATOR_CI.md](CLOUD_SIMULATOR_CI.md) 参照。
以下は初回Linux/TCG検証の記録。追加runで変わるiOS build/SimulatorとAndroid再検証の結果は
最終PR本文・各exact-source Actions summaryで区別し、実機未検証を維持する。

## 環境

Linux x86_64、Node 22.23.4 / npm 10.9.9、JDK 21、Android SDK 36。
Mac/Xcodeなし。USB接続Android/iPhone/iPadなし。利用者データなし、repo fixture/合成データのみ。
Androidエミュレーターの結果は実機と区別する。Ownerも利用できるMacがないと回答。
Android 16/API36のsoftware起動ではboot完了に至らなかったが、Android 11/API30は351秒でboot完了。
WebView 83.0.4103.120 / ranchu / x86_64 / 480×800 / TCG（ハードウェア仮想化なし）。
System UIのANRが発生し、通常のUI Automator操作は不安定だったため、実WebViewを操作する
合成エミュレーター専用の計測テストを使用した。実機の操作性/a11y/IMEを証明するものではない。

## 自動検証

最終実行結果・件数はPR本文と `artifacts/mobile-verification.txt` に記録する。

| 項目 | 判定根拠 |
| --- | --- |
| npm ci | 既存のlocked versionを変えずCapacitor関連を追加。Node/npmを既存CIに合わせて再検証 |
| npm test | 既存URL/storage/IME/共有fixtureを温存。native host/path/query/hash/size、v1-v4/recovery/v5 validator、取消/失敗、再開のtestを追加 |
| Worker tests / typecheck / bundle | 既存verify-pr.ymlの全手順を実施対象。Worker runtime/Origin/設定は未変更 |
| photo runtime/staging runtime | 既存local workerd/SQLiteと認証boundary check。外部staging deployではない |
| coverage / Web build | 既存thresholdを維持。nativeとWebの出力を分離 |
| native build / sync | TypeScript、同梱assets、強制OFF/CSP/公開baseのtest。両OSへ同期 |
| Android debug APK | app build / AndroidTest build成功。最終clean headの実ファイル・SHA256・source commitはPR本文参照 |
| iOS | asset sync・plist/XML/SPM path静的確認のみ。Xcode compile/Simulator/iPhoneは未実施 |

新規runtime codeは共通parserの移動、薄いadapter、native専用UI、強制OFF getterとその利用箇所。
既存codec・fixture・localStorage key/shapeは維持。native再開用keyのみ追加。
JSON取込は既存preview/置き換え確認。nativeの共有後もbackup保存を自動認定しない。

## Web / Android / iOS 機能表

| 機能 | Web互換の根拠 | Android | iOS |
| --- | --- | --- | --- |
| 固定依頼・数量・条件・売場順 | 既存tests/codecを維持 | Android11計測で同梱起動/作成PASS、実機受入待ち | 同じReact同梱、ビルド・端末未検証 |
| 公開URL・LINE 2,200文字 | 既存share/budget tests | Android11 OS chooser / 取消・公開base・予算PASS | 同じadapter、OS未検証 |
| 既存v1-v4読み込み | golden fixtures | 実WebView v3 paste PASS、v1-v4 golden tests PASS | 同じ実装、OS未検証 |
| 購入進捗・draft・catalog | 既存storage tests | Android11 process終了後の進捗再開PASS | 同じ実装、OS永続化未検証 |
| catalog復旧URL/JSON | 既存validator/preview | paste / Document Picker / private-cache share | 同じ実装、Picker/share未検証 |
| offline固定コア | サーバー不要の既存ロジック | network loads遮断の実WebViewで固定コアPASS | assets同梱、起動未検証 |
| 写真/v5/手書き | 既存Web flagsを変更しない | 強制OFF | 強制OFF |
| App/Universal Links | 公開HTTPS URLはWebへ | association未設定、paste代替 | entitlement未設定、paste代替 |
| OSからの直接共有受信 | 該当なし | ACTION_SEND未実装 | Share Extension未実装 |

## Android実WebViewの計測（実機と区別）

`BundledCoreTest` を明示的なsyntheticDevice flag + emulator hardware guardで実行する。
Wi-Fi/mobile OFFだけでは仮想有線が残るため、テスト用WebViewでnetwork loadsをblockし、
network available=falseにしてreloadした。同梱assetのinterceptor、実native bridge/pluginは維持する。
web contents debuggingはOFFのまま。JSON入力のFileはテストが注入し、OS Picker操作とは区別する。

| Case | 確認内容 | 結果 |
| --- | --- | --- |
| createOpenAndPersistFixedRequestOffline | 同梱起動、native API、offline、作成/確認、v3 URLのpaste/decoder、購入進捗保存 | PASS |
| resumeAfterProcessRestartOffline | force-stop後、新process/WebViewから固定依頼と購入進捗を再開 | PASS |
| nativeShareUsesPublicUrlAndCancellationPreservesDraft | 公開HTTPS/LINE hint/2,200文字、実OS chooser、取消後のdraft保持とcopy無し | PASS |
| catalogJsonExportUsesPrivateCacheAndRequiresConfirmation | JSON preview/復旧/編集、private cache、FileProvider chooser、取消後未backup | PASS（最終artifactも再確認） |

最終clean artifactでの結果とソース対応はPR本文/`artifacts/android-runtime/results.json`へ記録する。
OS Picker、外部保存先での実保存、LINE受信、回転/IME/a11y、実機・iOSは別gate。
JSON caseの初回は、既存backupを復旧するとbacked-upになる現行仕様を未backupと誤って仮定した。
仕様は変えず、復旧後の編集で未backupにしてから取消を検証するよう試験条件を修正した。

## High security checklist

- [x] Web/native outgoing baseを区別。localhost/capacitor/fileをLINEへ渡さない境界test。
- [x] URLの許可host/path/HTTPS、credentials、限定query、hash/入力上限と既存decodeのtest。
- [x] 管理secretを再開keyに保存せず、URLやpayloadの独自log/telemetryなし。
- [x] bridgeを外部ページへ公開するallowNavigationなし、remote server URLなし。
- [x] native CSPで外部script/frame/API遮断。Worker/Turnstile/CORSを緩和しない。
- [x] OS Share失敗/取消でclipboardへfallbackしない。共有表示と実配送完了を区別。
- [x] backupはユーザーの保存確認。FileProviderはprivate cache内export専用directoryのみ。
- [x] camera/photo/storage権限追加なし。release鍵/Team/Secretsなし。Android automatic backup OFF。
- [x] npm lock / Gradle checksum / local資産とsource metadata。debug artifactのみ。
- [ ] 両OS実機と受信側Web/LINEで全シナリオ、権限拒否、offline、IME、回転、a11yを確認。
- [ ] Xcode build・Privacy Report・SPM解決をMacで確認。
- [ ] exact base/head完全差分の新規read-only Codexレビュー（最終PRで状態記録）。
- [ ] Highの実機/staging証拠・残余riskをOwnerが明示受容。mergeとProductionは別gate。

## 未完了・残余risk（P0–P3）

実装差分のcode findingは独立レビューで別途記録する。以下は既知の受入・公開gate。

| 重要度 | 未完了 | 担当 / gate |
| --- | --- | --- |
| P0 | 既知のcode findingなし。新headの独立レビューは最終PR参照 | exact-range review |
| P1 | iOS Xcode buildと両OS実機受入証拠がない。公開可能/完成とは判定しない | OwnerのMac/端末、release前必須 |
| P2 | association未設定、OS直接共有受信未実装 | HTTPS Web fallback/paste代替は実装。必要なら別task・ドメイン権限確認 |
| P2 | OS Picker/Share/再起動保存/更新/reinstall/backup、IME/回転/文字拡大/a11yの実機差異 | OS別checklistをOwner実施 |
| P2 | High残余riskとstaging相当証拠の人間受容・独立review | merge前gate。今回の依頼を承認の代替にしない |
| P2 | 本番app ID、署名、権利証跡、privacy/permission、販売主体、ストアmetadata、審査4.2 | Owner。別承認なしに提出/配布しない |
| P3 | アイコンのOS mask/見え方、cache exportの保存先表示 | 実機UX確認 |

これらを人間の明示受容なしにwaiveしない。外部ドメイン設定、Worker optional機能のnative有効化、
署名/ストア/有料CIは本PRで追加しない。追加費用や審査合格を推測しない。

## 復旧と操作境界

未mergeではDraft PRを閉じる。既存Web・Workerは変わらず公開継続。
アプリ削除時はユーザー自身が先に復旧リンク/JSONを保存する。native提供停止や配布撤回は
人間判断で行い、既存Webの固定依頼や期限付き写真削除へ影響を与えない。

未merge・未Ready化・未公開・未ストア提出。Production workflow、外部設定、Secrets、
private ops、利用者データの取得/移行/削除は未操作。JSONの試験は合成データだけ。
