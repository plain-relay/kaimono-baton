# 買いものバトン iOS / Android アプリ化 — Codex 実装指示書

Status: implementation request / NOT IMPLEMENTED
作成日: 2026-10-27
対象: plain-relay/kaimono-baton
確認済み基準: main 8fd690496b5d99b67985cb724f489ca40a54d782
依頼元: Ownerからのチャット依頼（Issue番号未設定）

## 0. Codex への最初の指示（この文書を指定して実行）

この文書を実装仕様の入口として読み、既存Web版を維持しながら **Android用アプリとiOS用アプリの両方** を作ってください。Webサイトの単なるショートカットやPWA案内だけで完了扱いにしないでください。最終的に Android Studio で開ける android/ プロジェクトと Xcode で開ける ios/ プロジェクト、両OSの実機確認手順、再現可能なビルド手順を用意してください。

最初に root AGENTS.md → docs/CODEX_WORKFLOW.md → docs/PROJECT_MAP.md → docs/operations/AI_AGENT_POLICY.md → docs/operations/AI_MERGE_APPROVAL.md → 現行の関連コード・テスト・workflow の順に読み直してください。内容がこの文書と矛盾する場合は上位の現行リポジトリ規約を優先します。関連するactive Issueがあれば現在の受入条件を確認してください。なければ Owner依頼・IssueなしとPRに明記してください。

実装前に origin/main をfetchし、上記基準SHAから進んだ変更を調査します。古いSHAから黙って実装しないでください。専用branch、計画、検証、Draft PR、独立レビュー、Ownerによる別承認の各段階を守り、mainへの直接push・自分のPRのmerge・Ready化・Production操作・ストア提出はしないでください。

**実装対象はAndroid版とiOS版の両方ですが、現行Web公開や有料β開始を意味しません。** 完成と未検証、ビルド可と署名/配布可、Webの既存実績と各OSの実機実績を厳密に分離して報告してください。

## 1. 現状の具体的な確認事項（実装前に再検証）

- React 18 / Vite 5 / TypeScript のフロントエンドで、GitHub Pagesの公開Webアプリ。package.json・vite.config.tsが正本。
- public/manifest.webmanifest と public/icon-192.png、public/icon-512.png は既存。**PWA対応自体は新規実装ではない。**
- 公開共有URLは https://plain-relay.github.io/kaimono-baton/?openExternalBrowser=1#/l/… の形式があり、v1/v2/v3/v4、商品リスト復旧、v5管理リンクの互換性が重要。README.md と src/App.tsx、codec tests を再読。
- src/pages/CreateRequestPage.tsx が window.location.origin と pathname によって共有URLのbaseを作る。**ローカル同梱WebViewのURLをLINEへ渡す不具合が必ず起こり得るため、純粋関数と明示的なWeb/Native判定で分離する必要がある。**
- src/utils/storage.ts、src/utils/catalogStorage.ts 等は localStorage 保存。Safari/Chrome/PWAとネイティブWebViewの保存領域は別であり、**既存端末データが自動移行するとは言わない**。
- src/utils/shareText.ts、src/utils/lineDeliveryUrl.ts と src/hooks/useRequestSharing.ts が共有挙動を持つ。LINEへの配送はOS共有シート経由。送信完了検出はしない。
- 写真・更新可能依頼v5・手書き取込は補助機能。現在の公開設定と独立に、有効化にはCloudflare Worker、Turnstile、CORS/Origin、動作テスト、費用とprivacyの承認が必要。ネイティブ化しただけでONにしない。
- worker/ と現行GitHub ActionsのProduction運用は今回の作業範囲外。通常Web版の成果物・動線・性能・feature flagsを壊さない。

上記は記録時点の観察。現行mainを再読し、事実が変わっていれば根拠を付けて実装計画を更新してください。

## 2. 技術方針と判定ゲート

**第一候補はCapacitorによる共通フロントエンド + ネイティブ2プロジェクト**。WebのReactコンポーネント・codec・端末内カタログを再利用し、アプリごとに全画面起動・OS共有・リンク受付・ライフサイクル・安全領域を適合させる。原則としてVite build後の静的アセットをアプリへ同梱する。単に本番URLだけをWKWebViewで開くリモート専用ラッパーを標準解にしない。

実装前に小規模な検証（PoC）と短い設計判断記録を残し、次を確認する。

1. 同梱アセットで Android WebView / iOS WKWebView が正しく起動し、#/… のhash routingと戻る動作を再現できる。
2. 固定依頼作成・購買進捗・カタログのローカル保存/書出し/復旧が、追加サーバーなしに利用できる。
3. canonical共有URLを **実際の公開HTTPSサイトURL** から生成でき、アプリ内の localhost / capacitor scheme / file URLを絶対に共有しない。
4. アプリ内WebViewからのOS共有はWeb Share APIの有無を実機確認し、必要な場合だけ Capacitor Share等を薄いアダプターとして使える。キャンセル時に自動コピーや「送信済み」表示をしない。
5. サーバー利用を伴う補助機能について、Turnstile・Origin・CORS・ポリシー・cookie・リファラー等の互換性が未証明なら**flag OFF / 既存テキストコアの利用継続**とする。WorkerのOrigin緩和、トークン検証変更、秘密情報の組み込みで無理に通さない。

PoCでCapacitorが不適合なら、技術的な事実、最小代替案（必要ならAndroid TWA、iOS専用WebKit実装等）、追加費用・保守負担・Apple 4.2審査リスクを比較し、Owner承認なしに全体方式を変更しない。AndroidだけをTWA、iOSだけを別フレームワークにする方式は自動選択しない。

依存パッケージは必要最小限、相互に互換なバージョンを明示的に固定する。公式ドキュメントを確認し、未確認のバージョン・Gradle/SDK/Xcode条件を推測で書かない。既存のnpm ci、テスト、production buildが引き続き通ること。

## 3. 共通実装：Web/Native 境界

### 3.1 共通コードとディレクトリ

- Capacitorが適合する場合、同一React/Viteソース、Capacitor構成ファイル（実際の正式名を採用）、android/、ios/ を保守しやすい構成とする。両OSでロジックを複製しない。
- Web専用の共有URL生成、共有シート、外部リンク、受信リンクを共通インターフェースの薄いアダプターに抽出する。Webブラウザ時は**既存挙動に一切回帰を起こさない**。元のテストfixturesを温存。
- ビルド環境の切替で既存WebのVITE_* flags、BASE_PATH、端末保存キー、JSON形式、URL codecを無断変更しない。
- リリース識別子（Web資産版、Android versionCode/versionName、iOS CFBundleVersion/CFBundleShortVersionString）と再現方法を文書化する。バージョンとソースcommitの対応を報告する。
- アプリ表示名は「買いものバトン」。アイコンは既存権利を確認して利用し、両OS用の適切なサイズ/マスクを生成する。スプラッシュ、セーフエリア、キーボード/IME、端末回転/画面拡大、ダーク/ライト、アクセシビリティを検証する。
- 本番のAndroid applicationId / iOS bundle identifier / Team IDを推測で確定しない。PoCでは明確な検証用IDを使用可。ただしリリース前にOwnerへ確定を求め、確定後の変更で別アプリ扱いになることを記録。

### 3.2 リンクと共有の安全性

- src/App.tsxのparseHashRoute、固定の #/list?data=、#/l/、#/catalog/restore/、#/r/、#/manage/ の受信ルールを維持し、復号・検証の共通関数を再利用する。capability URL / 編集Secretを任意ログに含めない。
- 「LINEで送る」の本文・前置き・末尾URL・openExternalBrowser=1・文字数上限（最終配送URL2,200文字）・キャンセル挙動をWeb現行仕様から変えない。共有URLはcanonical HTTPS固定の公開Web URLから作り、Web版では従来と同じ公開ページbaseを使う。native WebViewのローカルoriginは共有不可。
- iOS Universal Links / Android App Linksは **所有権確認済みのHTTPSホスト** と /.well-known のassociationファイルが必要。現在の GitHub Pages project path（/kaimono-baton/）でサイト直下 /.well-known を管理できるかは不明。ドメイン制御を確認するまで本番用association/OS設定を完了扱いにしない。勝手にGitHub PagesルートやDNSを変更しない。
- Associationが未設定なら公開URLはWebで正常に開けることを最優先にし、アプリ内では **リンクを貼り付けて開く** またはOS共有から安全に受け取る代替動線を作る。URLをローカルスキームへ変換してLINEに配らない。
- URLの取り込み時は許可済みホスト・パス、hashルート、サイズ、形式を厳格に検査。意図せぬURLをアプリ内WebViewで開かず、既存外部ブラウザへ安全に委ねる。リダイレクトとJSブリッジの露出を最小化する。
- nativeから共有したURLを、アプリ未インストール端末・iOS Safari・Android Chrome・LINE内ブラウザで開き、既存Webとの相互運用性を証明する。

### 3.3 ローカル保存と機種変更

- Web/PWA/nativeでローカル保存のoriginと領域が異なることをAboutまたは初回説明（必要最小限）と検証文書へ記載。**自動同期・自動移行があるように表現しない。**
- 現行の家庭用商品リストJSON書き出し・読み込みと復旧URLの使い勝手をOS標準ファイルPicker / Sharesheet上で検証する。端末内カタログ、購入進捗、作成ドラフト、前世代の復旧ロジックを保持。
- バックアップはnative側でもユーザー自身の保存確認を必要とする既存契約を守る。共有シートを開いただけで保存済み表示しない。
- Webからnativeへの移行は現行の明示的な復旧リンク/JSONで可能な範囲に限定。ブラウザのlocalStorageをひそかに読み取らない。購入進捗は自動移行しない旨を説明。
- リインストール、更新、OSのアプリデータ削除、iOSバックアップ復元時の差異を実機で確認。native保存を新たなクラウド同期やログ送信へ拡張しない。

### 3.4 補助機能・秘密情報の境界

- 写真/更新可能依頼/手書き解析の現在のデフォルトOFFと停止可能性を維持。適合性未検証機能について「利用可」と表示しない。
- 追加API権限やoriginを有効化する必要があれば、Worker/Turnstileの検証手順・想定risk（High相当）・別承認対象を文書に切り出し、今回のPRで変更しない。ネイティブ環境の見た目だけで成功とみなさない。
- Secrets、Google API Key、Apple signing key、keystore、証明書、実共有URL、写真、利用者データをrepoやCIアーティファクト/スクリーンショット/ログへ含めない。トークンやrequest payloadのテレメトリ禁止。
- ネイティブプラグインを介したファイル/画像アクセスは必要最低限の権限、OSのPhoto Picker等を優先。カメラ権限は実際に必要な場合のみ。権限文言とプライバシー表示は実際の動作に一致させる。
- 不正なdeep link、意図せぬ外部ナビゲーション、権限拒否、OS共有キャンセル、復号異常、保存失敗時は誤共有・クラッシュなしに利用者へ日本語で知らせる。

## 4. Androidアプリ実装指示（成果物 A）

### Codex: Android タスク

最初の共通PoCと設計判断を済ませ、Androidアプリを作る。Capacitorを採用したなら android/ を生成し、Gradle wrapper、必要なネイティブ設定、Android向けアイコン/名称、戻るボタン、キーボード、共有シート、必要なら受信Intentと安全なURLパーサーを整える。無関係なネイティブ権限を要求しない。

**必須成果物**
1. Git管理可能なAndroid Studioプロジェクト（再生成だけに依存しない）。依存とビルド設定、対象SDKと要求Java/Android Studio/Gradleの公式互換性根拠。
2. 署名鍵・個人情報なしで作れる**debug APK**と、Play配布用AABを生成する再現手順（release鍵やPlay Console作業は未実施と明記）。CI環境で実行できるのは署名/公開を伴わないチェックだけ。
3. docs/mobile/ANDROID_BUILD_AND_TEST.md 等へ、環境準備、Web→native資産更新手順、APKのビルド/取り出し/実機導入方法、端末トラブル対処、テスト結果と既知の制約。
4. Java/Kotlin/TypeScriptの追加コードとテスト。nativeブリッジがないブラウザでもWeb共有が動くよう分離する。

**Android特有の受入テスト**
- USBまたは安全なローカル配布でdebug APKを端末へ導入し、起動→固定依頼作成→OS共有画面→LINE等の受信側表示→購入進捗→再起動で復元。
- 過去v1/v2/v3/v4のURL、復旧URLと不正URLを、Web・native両側で確認。公開URLは絶対に http://localhost / capacitor scheme にならない。
- Androidの戻るボタン/ジェスチャーで画面遷移、購入データ消失やアプリ終了時の不整合がない。文字入力/日本語IME、共有のキャンセルを確認。
- オフラインでも **端末内の既存固定依頼とカタログ** が扱える範囲を確認。ネット必須の補助機能だけ分離して停止する。
- 各権限の拒否、他アプリからの共有テキスト受信、リンクをタップしてWebにfallbackする動作を記録。App Linksはhost associationの証拠がない限り未完了扱い。
- debug APKを生成できなかったときは理由・未実施テストを明確に報告し、成功と記載しない。

## 5. iOSアプリ実装指示（成果物 B）

### Codex: iOS タスク

同じReact・共有adapterを利用して、iOS向けの独立したXcodeプロジェクト ios/ を作る。Capacitor採用時は公式が要求するiOSとXcodeの対応バージョンを調べ、必要な設定とプラグインを検証。WKWebViewのcookie/保存領域と外部遷移、safe area、キーボード、日本語IME、OS共有・ファイル取込を扱う。リモートWebサイト表示だけでアプリ完成としない。

**必須成果物**
1. Xcodeで開けるios/プロジェクト、設定、アイコン/表示名、必要なInfo.plistのusage description。署名用Team ID/証明書はOwner管理で、repoへ登録しない。
2. macOS + Xcodeが利用できるならシミュレーター向け**署名不要ビルド**と可能な実機動作の記録。TestFlight/App Store配布用archive・IPAはOwnerのApple Developer契約、署名設定と別承認なしに配布しない。
3. docs/mobile/IOS_BUILD_AND_TEST.md 等へ、Mac/Xcode準備、依存導入、Web→iOS同期、Simulator/実機起動手順、署名・TestFlightへ進む前の手動ゲート、実測結果と未検証事項。
4. iOSの共有シートとキャンセル、URL受付、Safariへのfallback、ローカル保存/復旧、ファイルPicker、適切なOS権限とプライバシー表記。

**iOS特有の受入テスト**
- 起動、固定依頼作成、LINE等へのOS共有シート、既存Web版で開けること、進捗保存/再開、Web→nativeデータの手動移行。
- iOS Safariから共有URL/復旧URLを開くケース、Universal Linksが設定できた場合のアプリ遷移、未設定時のSafari fallbackを明確に区別。
- ソフトウェアキーボード、日本語IME変換、セーフエリア、Dynamic Typeに準じた可読性、ファイル書き出し/復旧。Wi-Fi切断・共有キャンセル時に既存データを失わない。
- Apple App Review Guideline 4.2（単純なWebラッパーの最低機能不足）に対し、**オフラインで動く固定依頼・OS共有/受付・端末内カタログの具体的なアプリ価値**を検証証拠付きで説明。審査合格を保証しない。
- **Mac/Xcodeが利用できない環境ならiOSソースを作成しても「iOSビルド済み・iPhone実機検証済み」と書かない。** 未実施理由とOwnerがMacで行う確認を明記し、可能なコード静的チェックだけを実施。

## 6. 実行順序、PR分割、レビュールール

Codexはまず **両OS共通PoC・アーキテクチャ評価** を書く。その後、共通基盤+Android、iOS追加を独立レビュー可能な単位で進める。最も自然な分割は次の通り。

- PR 1: Capacitor共通adapter/構成とAndroid版、Webの互換性テスト。専用branch、**Draft**。
- PR 2: PR 1をOwnerが明示承認して統合した後のmainを基準としてiOS版。別専用branch、**Draft**。Owner統合前に未承認のPR 1 headを勝手にベースとしてチェーンしない。
- もし統合を待たず一度にレビューする方が差分を縮小・安全化できると判断したら、**両OSを1つのDraft PR** として出すことも可。ただし計画に理由を残し、レビューは両プラットフォームと共通機能の完全差分を対象にする。どちらか片方だけで完了と報告しない。

実際の実装がnative config/build/プラグイン追加を含むため、riskは少なくともMedium。共有URL・capability・privacy/security/Origin・端末データの移行・外部配布に影響する変更があればHighとして扱い、該当するセキュリティチェックと人間承認ゲートを満たす。**この指示書を追加するだけのPRは文書のみのLow risk** と区別する。

必要な既存CIを省略しない（npm ci / npm test / npm run test:worker / npm run check:worker-bundle / npm run test:coverage / npm run build / git diff --check。現在のworkflowにある追加dry-runとruntime checksも確認）。新たなAndroid/iOSのビルドはツール環境が実在する時だけ実行し、ない環境では代替の読取り/型チェックと未実施理由を記録。macOS runner追加や有料CI、署名を含むworkflow、Play Console/App Store Connect設定はOwnerの別承認なしに行わない。

Freshなread-only Codexで exact base SHA / head SHA の完全差分、既存URL fixture、Web/Native両方のstorage/共有境界、permissions、native外部リンク、ログ漏えい、build configの再現性を独立レビュー。全必須CI/レビュー後も実装者はReady化・merge・公開操作をせず停止。

## 7. 受入基準と完了時レポート

**完了**の最低定義:
- android/ と ios/ が実際に生成され、更新可能な構成でリポジトリに存在。
- 共通Web、Android、iOSの個別ビルド手順が明文化され、実行できたコマンドと未実施のコマンドが区別されている。
- 公開Web版の固定依頼、URL形式、2,200文字上限、LINE共有、データ互換、バックアップ、既存テスト/feature defaultsに退行がない。
- Androidのdebug APKを生成できたか実ファイルと手順で証明。iOSはXcodeがあるならSimulator build、ないなら未検証として明記。実機検証は実行したOS/端末/日時と証拠を列挙し、シミュレーターと混同しない。
- 写真/v5/手書き等の任意機能を安全ゲート外で有効化していない。
- App Store / Google Playの配布審査に必要な事項（販売主体、privacy、permission、developer account、署名、レビュー用説明、ストアメタデータ）は未実施/Owner判断として分離。

完了時は日本語で次を一つの報告にまとめる: 採用方式と不採用案、exact base/head、branch、Draft PR、変更ファイル、Android APK可否、iOSシミュレーター/実機build可否、Web/Android/iOSの機能表、テスト・CI・独立レビュー、P0-P3未解決事項、ストア審査リスク、追加費用、復旧/rollback、**未merge・未公開・外部設定/Secrets/利用者データ未操作** の確認。

Rollback: Draft PRを閉じる。merge後も Web本番公開/Workerとは切り離したnativeアプリの提供停止・配布撤回を人間判断で実施する。既存Webの固定依頼・カタログ・復旧URL、写真等の期限付きデータ削除処理へ影響を与えない。アプリ削除で端末内データが失われる可能性を利用者へ案内する。

## 8. 参考資料（開始時に現行版を確認）

- リポジトリ: README.md、AGENTS.md、docs/PROJECT_MAP.md、docs/CODEX_WORKFLOW.md
- Compatibility: src/App.tsx、src/pages/CreateRequestPage.tsx、src/hooks/useRequestSharing.ts、src/utils/lineDeliveryUrl.ts、src/utils/shareText.ts、src/utils/compactRequest*.ts、src/utils/catalogStorage.ts、src/utils/storage.ts
- オプション機能: src/features/productPhotos/、src/features/liveRequests/、src/features/handwriting/、worker/、docs/operations/PAID_BETA_READINESS.md
- Capacitor: https://capacitorjs.com/docs/getting-started 、 https://capacitorjs.com/docs/ios 、 https://capacitorjs.com/docs/android 、 https://capacitorjs.com/docs/guides/deep-links
- Apple App Review Guidelines 4.2: https://developer.apple.com/app-store/review/guidelines/

---

このファイルは **Codexへの実装指示** であり、Android/iOSアプリの実装・ビルド・署名・ストア公開が完了したことを意味しない。
