# Macを所有せずに行うnative CI検証

Ownerの2026-10-27の明示依頼で追加。Draft PR #30と既存Capacitor8.5.3 / SwiftPM構成を維持。
実行結果・exact source SHA・run URLはPR本文に記録し、構成の追加だけで成功と記載しない。

## 実行と結果

`.github/workflows/verify-native.yml` はmain向けPR（Draft含む）の更新で起動する。
PRのexact headをcheckoutし、Node22.23.4でnpm ci / npm run sync:nativeを実行。
公開repository内の同一repo branchのみを対象にする。fork/privateはjob対象外で、検証済みとは扱わない。
既存verify-pr.ymlは変更せず、Web/Worker/coverage/各local dry-runも別workflowで再実行する。

- iOS: 標準 `macos-15`、Xcode26.3をDEVELOPER_DIRで明示。default Xcode16.4を使わない。
  SDK/Swift版、SwiftPMの解決version/revisionを記録。App-CI shared schemeで
  `CODE_SIGNING_ALLOWED=NO` / `-sdk iphonesimulator` / `build-for-testing`。
  新規iPhone16 Simulatorを作成し、`test-without-building` でXCUITestを実施する。
- Android: 標準ubuntu-latest、JDK21、SDK36でappとAndroidTestをbuild。
  API30の新規emulatorで既存BundledCoreTestの4ケースを順に再実行。実bridge/pluginを使い、
  WebViewのnetwork loads遮断も維持する。第三者emulator actionはcommit SHAへ固定。
- いずれも一時的な合成端末のみ。OS Picker/LINE受信/IME/a11y/実機の証拠には代替しない。

iOSの3ケースは、同梱WKWebViewとnative受付、既存v3 fixtureの4項目・購入進捗、
terminate/relaunch後の再開、作成draftの保存、実UIActivityViewControllerのCloseによる取消と
draft保持を対象にする。application本体へtest専用hookを追加せず、XCTestだけで画面操作する。
Simulator限定compileと明示synthetic flagで実機上の実行を拒否。skipをPASSと数えない。

## 成果物とデータ境界

Actionsのrun画面のArtifactsから取得できる（保持3日）。

- `ios-simulator-<source SHA>`: `summary.json`、`App-simulator.tar.gz`。
  Simulator専用App.appで、iPhone用IPA/署名済み配布物ではない。source SHA / clean metadata / checksumを照合。
- `android-debug-<source SHA>`: `summary.json`、debug APK。
- source、tool版、固定case名/status、build可否、checksumだけを決定論的に生成する。
  iOS summaryは未知field/値を拒否するvalidatorを通過後に出力。parserの欠落/skip/失敗試験も実施。
- 生のUI test log / xcresult / screenshot / Simulator data containerはuploadしない。
  UI操作traceには合成URLが含まれるため、CI stdoutへも出さない。失敗時も固定stage/statusだけを報告。
  compile/resolve失敗は限定したcompiler診断だけ出力する。実共有URL・利用者dataは一切使わない。

Macで同じUI検証を再現するときは、Node22.23.4とXcode26.3を準備し、clean checkoutから
`npm ci` → `npm run sync:native` → `SOURCE_SHA=<exact HEAD> python3 scripts/ios-simulator-ci.py`。
通常のSimulator build手順はIOS_BUILD_AND_TEST.md。cloud runの成功もiPhone/iPad実機検証とは呼ばない。

## 費用と操作境界

repositoryは公開設定であることを開始時にAPI確認。
[GitHub公式料金規約](https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions)
ではpublic repository + standard GitHub-hosted runnerのActions利用は無料。
larger runner / self-hosted runner / 有料macOSサービスは使わない。artifact保持は3日、timeoutと
concurrency cancelを設定。private化した場合はこのworkflowのjobを起動せず、課金枠へ自動移行しない。
billing/予算/Secrets/Environment設定変更は行わない。

Runner/Xcode根拠:
[runner labels](https://github.com/actions/runner-images/blob/main/README.md)、
[macos-15 ARM image](https://github.com/actions/runner-images/blob/main/images/macos/macos-15-arm64-Readme.md)。
runner imageは更新されるため、実測版はrunのsummaryを正とする。imageにXcode26.3がなければ失敗させる。

Apple account/Team/証明書/署名key/Secrets/App Store Connectは不要・未使用。
merge/Ready/Production/store操作なし。失敗修正後は新headの全PR差分をfresh read-only Codexで
再レビューする。High残余riskの受容、実機受入、本番ID/署名/privacy/権利/storeは引き続き別の人間gate。
rollbackはCI追加のrevertかDraft PRを閉じること。既存Web/WorkerのProductionへ影響しない。

## 初回クラウド実行からの修正

初回でiOS compileとdraft/relaunchは成功したが、購入済みカードは詳細を折り畳む既存仕様のため、
UI testが非表示のreset buttonを探して失敗した。表示される購入済みsummaryを確認する形へ修正。
OS shareのClose controlは言語・表示先も確認する。取消後のアプリの明示notice/draft保持は必須のまま。
結果とsource対応は最終PRに記録し、この変更だけで成功とは呼ばない。

Android初回の再開ケースは失敗し、診断追加後の同じアプリコードでは4件通過したため、
最初の失敗段階は特定できていない。試験の保存前提を強め、JSの保存状態を確認し、WebViewの
非同期commit用6秒を置いてから通常のprocess再起動を試す。即時force-kill/crashの永続化は証明しない。
失敗履歴を隠さず、最終artifactの全ケースを再実行する。
