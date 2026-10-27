# iOS ビルドと端末確認

Git管理したXcode project: `ios/App/App.xcodeproj`。
Capacitor 8.5.3 / Swift Package Manager構成。**今回のLinux環境にはMac/Xcodeがなく、
iOS build・Simulator起動・iPhone/iPad実機検証は未実施**。
静的検査とasset syncはcompilationの代替にならない。

2026-10-27の追加依頼で、Macを所有せず標準macOS Actionsから署名不要buildとSimulator検証を
実行する構成を追加した。[cloud CI手順](CLOUD_SIMULATOR_CI.md)を参照。最新runの実測結果は
PR本文/Actions artifactのsummaryを正とし、上記の初回Linux未実施記録と区別する。

## Macでの署名不要Simulator build

[Capacitor公式](https://capacitorjs.com/docs/ios)に従い **Xcode 26.0以上 / iOS 15以上**、
Node **22.23.4** / npm 10を使う。Xcode command-line toolsとSimulator runtimeを準備する。

```sh
node --version
xcodebuild -version
npm ci
npm run sync:native
xcodebuild -resolvePackageDependencies -project ios/App/App.xcodeproj -scheme App
xcodebuild -project ios/App/App.xcodeproj -scheme App \
  -configuration Debug -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath ios/DerivedData CODE_SIGNING_ALLOWED=NO build
```

出力は `ios/DerivedData/Build/Products/Debug-iphonesimulator/App.app`。
次に `npm run ios:open` またはprojectを開き、インストールしたSimulatorを選んでRunする。
`xcrun simctl list devices available` でdevice IDを選び、boot後
`xcrun simctl install booted ios/DerivedData/Build/Products/Debug-iphonesimulator/App.app`、
`xcrun simctl launch booted dev.kaimonobaton.preview` でも起動できる。
実機用IPAではない。現在はSPMなのでPods/workspaceの生成を前提にしない。

SPMはcore exact 8.5.3とnpm lockで導入したlocal pluginを参照する。初回のMac buildで
SwiftPM依存を解決し、解決結果をレビュー・保管する。LinuxではSwiftPM解決未検証。
資産変更時は毎回 `npm run sync:native`。Webの `dist/` を手動copyしない。

## iPhone / iPad（Ownerの署名環境で実施）

1. Ownerが検証用ID `dev.kaimonobaton.preview` と本番bundle IDの扱いを確認する。
2. Xcode Signing & CapabilitiesでOwner管理のTeamを選ぶ。Team ID、証明書、秘密鍵、
   provisioning profileをrepo/PR/CI artifactに追加しない。
3. 自分の端末を選んでRunし、必要なDeveloper Mode・署名信頼設定を端末で確認する。
4. OS・端末・WebKit/Xcode版・日時・source/artifactをVALIDATIONへ記録する。
   Simulatorの成功を実機結果として記載しない。

archive・IPA・TestFlight・App Store提出は今回は作成/配布しない。Apple Developer契約、
確定bundle ID、署名、販売主体、権利、privacy/permission、審査説明・metadata、
High残余riskの受容、独立review、実機証拠をOwnerが別判断してから進む。
有料macOS CI runnerは追加していない。

## 端末受入（すべて今回未実施）

[Android手順](ANDROID_BUILD_AND_TEST.md)の共通シナリオをiOSでも独立実施する。
特に次を区別して記録する。

- 同梱offline起動 → 作成 → OS sharesheet → LINE等で合成URLを受信 → Safari/Chrome/LINE内
  ブラウザで公開HTTPS URLが開く。Web Shareの有無に依存せずCapacitor Shareを使用。
  取消ではcopyせず、送信完了判定なし。
- v1-v4 URL、復旧URL、無効URLを貼り付けて開く。v4写真OFFでも本文と進捗は継続。
  URLのWeb fallbackとアプリ手動受付を別記。Universal Links entitlement/associationは未設定。
- 購入進捗 → home → 再開 → terminate/起動 → 再開で復元。Web/PWAと保存領域は別、
  catalogだけ復旧リンク/JSONで明示import。購入進捗の自動移行なし。
- catalog書き出しsharesheet →「ファイルに保存」→ 保存先確認 → 明示「保存した」。
  JSON Document Picker → preview → 復旧。取消、権限拒否、破損、保存容量不足、offlineで
  既存データを失わないこと。cacheはユーザーbackupとは扱わない。
- 日本語IME確定前/後、keyboard重なり、iPhoneノッチ/home indicator、iPad/回転、
  Dynamic Type相当の文字拡大と可読性、VoiceOver・focus順、light/dark、icon/splash。
- アプリ更新、reinstall、OSデータ消去、iOS backup復元は別々に試す。OS backupの可否を
  アプリの自動同期保証に読み替えない。実データは使わない。

Share Extensionは未実装。メッセージからURLをコピーしてアプリへ貼り付ける。
camera/photo権限を要求しない。Filesystemのfile timestamp用C617.1を
`PrivacyInfo.xcprivacy` に記載し、Xcode resourcesへ登録している。ストア前には
Xcode Privacy Reportと実利用を人間が照合する（法的文書の確定ではない）。

Apple Guideline 4.2向けの価値は同梱offline固定依頼、進捗、端末内catalog、OS共有と復旧。
**その価値の実機検証証拠は未取得で、審査合格は未保証**。

## トラブル

- missing local package: repo rootでnpm ci→syncを先に実行する。
- Xcode/SDK非対応: 公式の上記最低版を確認し、Linux生成をbuild成功と扱わない。
- 共有/Pickerが動かない: OS拒否/取消を切り分け、既存coreが使えることを確認する。
  Worker Originを緩和したりAPI keyをアプリへ埋めたりしない。
