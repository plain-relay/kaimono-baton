# 同梱アプリの方式とPoC

2026-10-26 UTC。実装仕様は Draft PR #29 の文書（commit
`d88822e79c798216cdd631628b5da66387a8a1db`）。実行計画は
[IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)。Webの実績をnativeの実績に流用しない。

## 判断

Capacitor 8.5.3を採用。既存React/Vite資産を `dist-native/` に生成し、Android/iOSへ
同梱する。同じhash router、v1-v4 decoder、storage/recovery、IME処理を再利用する。
AndroidだけTWAにするとiOSとの二重保守になり、remote専用WebViewはofflineの固定コアを
満たせない。別フレームワークへの全面移植は互換性リスクと保守コストを増やすため採用しない。

小規模検証では公式CLIで両プロジェクトを生成し、同梱資産の同期・型チェック、既存route
fixtureとnative境界testを確認した。Android WebViewとiOS WKWebViewの実機PoCは
別の受入gateであり、生成・JSテストだけで起動検証済みとはしない。
実測の更新先は [VALIDATION.md](VALIDATION.md)。Android11の実WebViewでoffline固定コア・再開・OS共有・native JSONを計測確認。iOSはMac/Xcodeがなくruntime未証明。
Capacitorが不適合だと示す事実は現時点でないが、両OSの実機受入は完了していない。

| PoC gate | 実装と証拠 / 限界 |
| --- | --- |
| 同梱assets/hash/back | native Vite build + cap sync、共通parser test、Android back adapter。各OS起動は別記 |
| 固定コア/保存/復旧 | 既存React/codec/storageを利用、追加サーバーなし、既存tests。OS永続化は実機gate |
| canonical HTTPS | `runtime.ts`の純粋関数 + 境界test。nativeのoriginは送出しない |
| OS共有 | Capacitor Share 8.0.3。Web Share/clipboardはWebで既存のまま。nativeは取消/失敗でcopyしない |
| 補助機能 | build環境をOFFにしruntime getterも強制OFF。native専用CSPで外部API/script/frameを遮断 |

## 固定した依存と公式根拠

2026-10-26に以下を確認（推測で要件を補完しない）。npm lockは正本。

- Capacitor core / CLI / Android / iOS: **8.5.3**。
- App **8.1.2**（戻る/受信イベント）、Share **8.0.3**（OS共有）、
  Filesystem **8.1.5**（生成JSONのprivate cacheのみ）、Browser **8.0.5**（外部HTTPS）。
- [Capacitor 8更新要件](https://capacitorjs.com/docs/updating/8-0): Node 22以上、
  Xcode 26.0以上、iOS 15以上、Android Studio Otter 2025.2.1以上。
- [Android](https://capacitorjs.com/docs/android)、[iOS](https://capacitorjs.com/docs/ios)、
  [環境準備](https://capacitorjs.com/docs/getting-started/environment-setup)、
  [deep links](https://capacitorjs.com/docs/guides/deep-links)。
- 配布された8.5.3 templateの `android/variables.gradle`, `build.gradle`, wrapperは
  min SDK 24 / target・compile SDK 36 / AGP 8.13.0 / Gradle 8.14.3。
  [AGP 8.13互換表](https://developer.android.com/build/releases/past-releases/agp-8-13-0-release-notes)
  と生成物を照合。Capacitor JavaコードはJava 21を指定するため **JDK 21（javac必須）**。
- Gradle distribution checksumは公式 `.sha256` と照合しwrapperへ固定。
- iOSはCLI既定のSwift Package Manager。coreはexact 8.5.3、pluginはnpm lockのlocal path。
  FilesystemのSPM依存 `ion-ios-filesystem` は配布manifestでexact 2.0.1。
  Mac初回buildでSPM解決とXcode compilationの確認が必要。

## 境界

- 検証用IDは両OSとも `dev.kaimonobaton.preview`。本番ID/Teamは未決定。
  変更後は別アプリ・別保存領域になる可能性があり、Ownerがrelease前に確定する。
- Web baseは従来のlocation由来。native baseは公開済み
  `https://plain-relay.github.io/kaimono-baton/`。queryと本文のLINE仕様、配送2,200文字は維持。
- 受信はHTTPSの正確なhost/path、限定query、hash/サイズ、既存decoderで検査。
  2,200文字は新規配送の予算。過去URLの読み込みには既存decoderと整合した70,000文字の上限。
- 本番association/intent filter/entitlementなし。URLは従来Webへfallbackし、アプリへは
  コピーして貼り付ける。Android ACTION_SEND受信とiOS Share Extensionは未実装。
  custom schemeをLINEへ配らない。将来appUrlOpenが届いた場合も同じvalidatorを通す。
- Android戻るはWebView履歴、履歴なしの子画面ではhome、homeではminimize。
  購入進捗・catalog・draftは既存key/shape。native専用の追加key
  `kaimono-baton:native:last-fixed-route:v1` は最後に開いた固定依頼だけ保存し、再開前に再検証。
  v5管理secretと復旧リンクはこのkeyに保存しない。
- JSON入力は既存 `input type=file` / OS Document Picker。書き出しはprivate cacheの1ファイルを
  Shareへ渡す。次のexportで上書き、OSによる消去可能。遅延読取りのため共有直後には削除しない。
  cacheはbackupとは扱わず、ユーザー自身の保存先確認を必須とする。
- Android FileProviderはこの1ファイルだけ。camera/photo/外部storage権限なし。
  Android OS自動backupはOFF。iOSのOS backup復元挙動は未検証で、自動同期と表現しない。
- `loggingBehavior: none`、Android WebView debugging OFF。payload/token/URLの独自log/telemetryなし。
  nativeのCSPはWeb buildには追加しない。`server.url`・allowNavigation拡張なし。
- 既存iconは公開repoの `public/icon-512.png`（initial public release由来）をリサイズ。
  外部素材を追加しない。権利証跡はrepoで見つからず、ストア利用の権利最終確認はOwnerのgate。
  Android density/adaptive foreground、iOS不透明1024px。OS maskと見た目は実機で確認。

## リリース識別と費用

Web資産版 0.1.0、Android versionCode 1 / versionName 0.1.0、
iOS CFBundleVersion 1 / CFBundleShortVersionString 0.1.0。
`build:native` は `native-build.json` にsource commit・dirtyの有無・資産版を同梱する。
最終artifactのSHA256とsourceはVALIDATIONへ記録。dirty=trueのartifactをreleaseに使わない。
バージョン更新は両native projectとscriptを揃え、署名/ストア前に別レビューする。

Capacitorと今回のpluginにライセンス利用料はない。Mac実機/端末、Apple Developer/Play登録や
CIの費用はOwner判断。API契約や有料CIを追加せず、macOS runnerも追加しない。

Apple [App Review 4.2](https://developer.apple.com/app-store/review/guidelines/#minimum-functionality)
の審査合格は保証しない。同梱offline固定依頼、購入進捗、端末内catalog、OS共有/JSON取込が
具体的価値だが、実機証拠とレビュー説明、販売主体、privacy/権限、store metadata、
署名/Developer account/残余riskの人間受容は別gate。法的文書はここで確定・公開しない。

## Web初期読み込みの分離（継続実装）

baseと同じlock versionでWebのentryを比較し、native専用プラグインの登録処理を初期entryから
動的chunkへ分離した。`runtime.ts` はtype-only importと、document-startで注入される
`Capacitor.isNativePlatform()` の存在確認だけで判定する。User Agentやlocalhostだけで判定しない。
このAPIは固定した8.5.3のAndroid/iOS双方の `assets/native-bridge.js` でdocument-startに設定される
ことを配布ソースで確認した。通常WebではCapacitor未定義でも利用できる。

nativeの共有/JSON/ライフサイクルは利用時・起動時だけ動的importする。chunk読込に失敗した共有は
既存の `failed` に戻し、clipboardへ自動fallbackしない。nativeのsafe-area classは同期的に設定する。
通常Webのfeature flags、browser share/clipboard、BASE_PATH、既存保存形状を変更しない。
Web entry gzipはbase約123.4KB、初回head約129.2KBから約125.6KBへ減少（Python gzipの同一条件）。
これはサイズの比較であり、実機の速度測定とは区別する。
