# Android ビルドと端末確認

Android Studioで `android/` を開く。再生成専用ではなくGradle wrapper・manifest・設定を
Git管理する。同梱資産はbuild/syncで生成しGitへ入れない。
方式と公式要件は [ARCHITECTURE_AND_POC.md](ARCHITECTURE_AND_POC.md)。
結果は [VALIDATION.md](VALIDATION.md)。本書の手順は実行済みの証明ではない。

## 環境 / 再現

- Node **22.23.4**（既存CIと一致）、npm 10、**JDK 21（javacを含む）**。
- Android Studio **Otter 2025.2.1以上**。
- SDK platform **36**、build-tools **35.0.0**（AGP 8.13既定）、platform-tools。
- min SDK 24 / target・compile SDK 36、AGP 8.13.0、wrapper Gradle 8.14.3。
- `ANDROID_HOME` をSDKに、`JAVA_HOME`をJDK 21に設定する。ローカルSDKパスをcommitしない。

```sh
node --version
java -version
javac -version
npm ci
npm run sync:native
cd android
./gradlew assembleDebug
```

Windowsでは最後を `gradlew.bat assembleDebug` とする。上の `npm run sync:native` は
native専用build後にAndroid/iOS両方の資産とplugin参照を更新する（LinuxでもiOS同期可）。
既存Webは `npm run build` → `dist/`、nativeは `dist-native/`。Web buildでnative資産を
上書きしない。更新のたびにsyncする。`npm run android:debug` でも一括実行できる。

出力: `android/app/build/outputs/apk/debug/app-debug.apk`。
debugの自動ローカル署名だけであり、release keystoreは作らず・登録せず・取得しない。
APKはGitへcommitせず、生成時のsource commit・dirty・SHA256をVALIDATION/PRへ記録する。

```sh
adb devices
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n dev.kaimonobaton.preview/.MainActivity
```

USB debuggingの許可とインストールは利用者自身が端末で確認する。サイドロードの警告は
配布経路とSHA256を確認する。インストール済みの同一IDに異なるdebug鍵を使うと更新できない。
その場合、アンインストール前にユーザー自身がcatalog backupを保存する。削除・データ消去は
進捗/catalogを失う可能性がある。release IDは未決定なのでこのIDでストアへ提出しない。

## 配布用AABの準備手順（今回は実行しない）

Ownerが本番applicationId、versionCode、権利/privacy/実機検証と残余riskを確定し、
署名鍵を安全に管理した別環境でAndroid Studioの **Generate Signed Bundle / APK →
Android App Bundle** を使う。対象は `app`、release、Owner管理の鍵を指定する。
CLIでunsigned構造を確認する場合は資産sync後 `./gradlew bundleRelease`、出力は
`app/build/outputs/bundle/release/app-release.aab`。現在のrepoにはrelease signingConfigを
含めないため、このファイルだけではPlay配布できない。鍵/パスワードをGradle/PR/logへ書かない。
Play Console、署名、登録、ストア提出・公開は今回未実施で、別の人間gate。

## 端末受入（合成データのみ、端末・OS・WebView版・日時を記録）

1. 新規install → offline起動 → 固定依頼作成。数量・条件・売場順とdraftを確認。
2. OS共有 → LINEを選択。本文・前置き・末尾HTTPS URL・`openExternalBrowser=1`、
   2,200文字以内を端末上で確認。送信完了をアプリが判定しないことを確認。
   戻る/取消ではcopyも「送信済み」も出ないこと。権限拒否/共有失敗の日本語案内も確認。
3. app未installのAndroid Chrome、iOS Safari、LINE内ブラウザでその合成リンクを開く。
   App Links未設定時はWebへfallback。実共有URLをAI/PR/logへ貼らない。
4. repoのv1/v2/v3 fixtureと合成v4を公開HTTPS形式に組み、貼り付けて開く。
   不正host/path/query/hash/過大/復号異常を拒否し、既存進捗を失わないこと。
   v4写真はOFFでもテキスト・購入操作は続く。v5/管理はOFF案内でネット呼出ししないこと。
5. 購入進捗 → Android戻る/gesture → home「前回の買い物を再開」→ force-stop/再起動 →
   再開ボタンで同じ進捗。homeの戻るはminimize。キーボード中のbackも確認。
6. catalog変更 → 復旧リンク保存 → キャンセルでは未backup、共有後も「保存した」を押すまで
   未backup。別ブラウザ/アプリのbackupを明示importし、preview後のみ置き換え。
7. 長い合成catalogでJSONへfallback → OS sharesheetのファイル保存先で内容を確認。
   Document PickerでJSON選択 → preview/復旧。取消、無効JSON、容量超過でも変更を失わないこと。
8. Wi-Fi/mobile OFFで既存固定依頼、再開、catalog編集・export/復旧。写真/v5/手書きはOFF。
9. 日本語IME未確定/確定、文字上限、キーボード重なり、画面回転、文字拡大、TalkBack、
   light/dark設定（アプリUIは既存lightデザイン）、safe area、splash/icon/maskを確認。
10. updateでデータ維持、reinstall/OSデータ消去での消失、OS backup復元の挙動を各々記録。
    利用者の実データを使わない。Android automatic backupはmanifestで無効。

直接のACTION_SEND受信は未実装。受信したメッセージのURLをコピーして貼り付ける。
App Linksのassociation、DNS、GitHub Pagesルート設定は未変更で、完了扱いにしない。

## よくある環境問題

- `JAVA_COMPILER`不足: JREではなくJDK 21を選ぶ。
- SDK/build-tools不足: 上記SDKをSDK Managerで導入しlicenseを確認する。
- proxy環境: Java/GradleにHTTP(S) proxyを渡し、組織CAを信頼storeへ正規登録する。
  TLSを無効化しない。このcloud実行ではシステムtrust storeとproxyをコマンド内だけで指定。
- 真っ白な画面/古い画面: `npm run sync:native`、`dist-native/index.html` とAPK同梱assetを確認。
  `server.url`やallowNavigation追加で公開サイトへ迂回しない。
- 保存容量不足: 日本語エラーを確認し、ユーザー自身のバックアップを優先する。
- build成功と端末正常動作は別。未実施の受入項目はVALIDATIONへ残す。
