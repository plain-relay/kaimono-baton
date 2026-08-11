# 手書き商品取り込みWorker

このWorkerは、GitHub Pages上のReactアプリから、前処理済み画像、現在表示可能な商品候補、毎回新しく取得したTurnstileトークンを受け取ります。公式`@google/genai` SDKのInteractions APIで`gemini-3.5-flash-lite`を1回だけ呼び出し、商品名の読み取りと候補照合を同じ構造化出力で行います。

```text
React/Vite
  └─ 画像（最大2MB）+ 商品候補 + Turnstileトークン
       └─ Cloudflare Worker
            ├─ Origin、画像、候補JSON、Turnstileを検証
            ├─ Gemini 3.5 Flash-Lite
            │    ├─ Interactions API
            │    ├─ thinking_level: minimal
            │    └─ JSON Schema構造化出力
            └─ 商品IDとstatusを再検証
                 └─ { "version": 1, "items": [...] }
```

画像、商品候補、モデル出力はアプリやWorkerへ保存しません。本番コードはこれらやSecretをログへ出しません。フロントは利用者が確認した通常商品と自由追加商品だけを既存draftへ反映するため、画像、読み取った生の内容、取り込み元を示す情報は共有URLに入りません。

## Workerルートと機能境界

Workerの公開Endpointは変更せず、次の互換ルートを持ちます。

| Method | Path | 状態 |
| --- | --- | --- |
| `POST` | `/` | 既存の手書き解析ルート |
| `POST` | `/v1/handwriting/analyze` | 同じ手書き解析handlerを呼ぶ明示ルート |
| `POST` | `/v1/photos/batch` | 最大3枚のJPEGを保存する非公開写真ルート |
| `GET` | `/v1/photos/:token` | capability tokenで写真を取得する非公開ルート |
| `POST` | `/v1/requests` | 更新可能依頼を作成する非公開ルート |
| `GET` | `/v1/requests/:requestToken` | revision/ETag付き依頼snapshotを取得する非公開ルート |
| `PATCH` | `/v1/requests/:requestToken` | `If-Match`とedit secretで依頼を更新する非公開ルート |
| `OPTIONS` | `/*` | 許可Originだけに応答するCORS preflight |

写真APIはコードとSQLite-backed Durable Object設定例だけを追加しており、本番へは未deployです。`PHOTO_API_ENABLED`と`SHARED_REQUEST_API_ENABLED`は未設定または`true`以外ならOFFです。設定判定はサービスごとに分離され、`GEMINI_API_KEY`が必要なのは手書き解析だけです。写真・更新可能依頼のコードはGeminiや`@google/genai`へ依存させません。写真の詳細は[`../docs/PRODUCT_PHOTO_ARCHITECTURE.md`](../docs/PRODUCT_PHOTO_ARCHITECTURE.md)を参照してください。

更新可能依頼v5のWorker API、`SharedRequestObject`、capability、固定14日期限、ETag、依頼者管理・購入者同期UI、Cloudflare手動設定とrollbackは[`../docs/LIVE_REQUEST_V5_ARCHITECTURE.md`](../docs/LIVE_REQUEST_V5_ARCHITECTURE.md)を参照してください。iPhone 11、Android Chrome、LINE内ブラウザの確認手順は[`../docs/LIVE_REQUEST_V5_MANUAL_VERIFICATION.md`](../docs/LIVE_REQUEST_V5_MANUAL_VERIFICATION.md)です。本番binding・migration・deploy・flag ONは別途明示承認があるまで行いません。

フロントの`VITE_PRODUCT_PHOTOS_ENABLED`と`VITE_LIVE_REQUESTS_ENABLED`も同様に、明示的な`true`だけを有効とします。現在の通常公開では両方OFFで、導線は表示されません。

通常flagをOFFのまま実機確認する期限付きゲートは[`../docs/PHOTO_V5_LIMITED_VALIDATION.md`](../docs/PHOTO_V5_LIMITED_VALIDATION.md)で定義します。`MANUAL_VALIDATION_ENABLED`は未設定または`true`以外ならOFFです。有効時、写真batch書き込みはFormDataの`validationSessionToken`、v5作成・更新は専用session headerを使い、どちらも既存Turnstile検証を要求します。写真batchでは移行期間中だけ旧session headerも受理し、FormDataとheaderの両方がある場合は完全一致を要求します。session tokenやhashの実値をこのREADME、GitHub、ログへ記録しません。

## 固定したGemini設定

- Model: `gemini-3.5-flash-lite`
- API: Interactions API
- SDK: `@google/genai`（互換性を確認したバージョンを`package.json`で固定）
- Thinking level: `minimal`
- Output: JSON Schemaに従う`application/json`
- 1画像、1interaction、履歴保存なし
- temperature、top_p、top_kは未設定
- 検索、URL context、file search、code execution、function calling、Computer Useは未設定

モデルIDはコード上で固定し、環境変数では変更できません。画像内および商品名・別名内の文字列を信頼できないデータとして扱い、そこに命令、URL、プロンプトが書かれていても従わないようsystem instructionで明示します。詳細は[Interactions API](https://ai.google.dev/gemini-api/docs/interactions-overview)、[structured outputs](https://ai.google.dev/gemini-api/docs/structured-output)、[モデル情報](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite)で現在仕様を確認してください。

## クラウド状態を先に確認する

既存リソースを推測せず、まず読み取りだけで確認します。

```bash
npx wrangler whoami
```

認証済みで、対象の`worker/wrangler.toml`が存在する場合だけ、既存WorkerとSecret名を確認します。

```bash
npx wrangler deployments list --config worker/wrangler.toml
npx wrangler secret list --config worker/wrangler.toml
```

未認証、対象アカウント不明、既存Worker不明の場合はデプロイしません。このリポジトリのコマンドだけでCloudflareアカウント、Turnstile Widget、Google AI Studio APIキー、請求先、有料プランは作成されません。

## Google AI Studio APIキー

1. 運用者自身が[Google AI StudioのAPI key画面](https://aistudio.google.com/app/apikey)を開く。
2. 利用するGoogleアカウントとプロジェクトを確認する。
3. Gemini API用のAPI key（Auth key）を作成または既存キーから選ぶ。
4. キーをブラウザ、`.env`、GitHub、ログへ置かず、Worker Secret `GEMINI_API_KEY`へだけ登録する。

本構成は請求先登録不要の無料枠を前提とし、請求先を登録しません。無料枠で利用できるモデル、レート制限、利用条件は変更される可能性があるため、固定数値をこの文書へ埋め込みません。[現在の料金ページ](https://ai.google.dev/gemini-api/docs/pricing)とGoogle AI StudioのUsage画面で、デプロイ前と運用中に現在値を確認してください。

無料枠では、送信した入力と生成された出力がGoogleのサービス改善に使用され、人による確認の対象となる場合があります。個人情報や機密情報を送らない運用にしてください。現在の条件は[Gemini API Additional Terms](https://ai.google.dev/gemini-api/terms)を確認してください。

## Cloudflare Turnstile

Cloudflare Dashboardで既存Widgetを再利用できるか確認します。新規Widgetが必要な場合は、運用者が明示的に作成します。

- Widget mode: Managed
- 許可hostname: `plain-relay.github.io`
- Site Key: 公開値としてフロントへ設定
- Secret Key: Worker Secretへ設定

フロントは明示レンダリングと`execution: "execute"`を使い、用途ごとに`handwriting_import`、`product_photo_upload`、`shared_request_create`、`shared_request_update`を固定します。WorkerはSiteverifyの`success`、要求されたaction、Origin由来hostnameを照合します。トークンは毎リクエスト新規取得し、成功、失敗、キャンセル後にWidgetをリセットします。

## Worker設定

例をコピーします。`worker/wrangler.toml`と`worker/.dev.vars`はgit管理対象外です。

```bash
cp worker/wrangler.toml.example worker/wrangler.toml
cp worker/.dev.vars.example worker/.dev.vars
```

PowerShell:

```powershell
Copy-Item worker/wrangler.toml.example worker/wrangler.toml
Copy-Item worker/.dev.vars.example worker/.dev.vars
```

本番SecretはWranglerの対話入力で登録します。実値をコマンド履歴へ直接書かないでください。

```bash
npx wrangler secret put GEMINI_API_KEY --config worker/wrangler.toml
npx wrangler secret put TURNSTILE_SECRET_KEY --config worker/wrangler.toml
```

通常変数は次だけです。

```toml
[vars]
ALLOWED_ORIGINS = "https://plain-relay.github.io"
DIAGNOSTIC_MODE = "false"
PHOTO_API_ENABLED = "false"
SHARED_REQUEST_API_ENABLED = "false"
MANUAL_VALIDATION_ENABLED = "false"
MANUAL_VALIDATION_EXPIRES_AT = ""
```

写真保存の設定例には`PHOTO_OBJECTS` bindingとSQLite migrationも含まれます。上記の手順でgit管理外の`worker/wrangler.toml`へコピーまたは反映してから、`npx wrangler deploy --dry-run --config worker/wrangler.toml`でbundleだけを確認します。`wrangler.toml.example`を本番設定として直接使いません。migrationの本番適用は運用者の明示承認後に限ります。

Originは完全一致でカンマ区切り指定します。パスや末尾スラッシュは含めません。CORSはブラウザ制御であり認証ではないため、許可Originに加えてTurnstileを毎回検証します。

`DIAGNOSTIC_MODE`は通常`false`のままにします。手動検証時だけ`true`へデプロイすると、requestId、処理stage、所要時間、安全なstatus・件数を1行JSONで出力します。画像、商品名、alias、商品ID、モデル出力、Turnstileトークン、APIキー、Secret、本文は出力しません。開始・停止スクリプトと判定手順は[`../docs/HANDWRITING_MANUAL_VERIFICATION.md`](../docs/HANDWRITING_MANUAL_VERIFICATION.md)を参照してください。

## ローカル開発

```bash
npm ci
npm run test:worker
npm run typecheck:worker
npm run check:worker-bundle
npm run worker:dev
```

ルートの`.env.example`を`.env.local`へ、`worker/.dev.vars.example`を`worker/.dev.vars`へコピーします。ローカルWorker URL、ローカル用Turnstile Site Keyを設定し、明示的に確認するときだけ`VITE_HANDWRITING_IMPORT_ENABLED=true`とします。`GEMINI_API_KEY`と`TURNSTILE_SECRET_KEY`を`VITE_`変数へ入れないでください。

## 本番デプロイ

Cloudflare認証、対象アカウント、既存Workerまたは作成対象、Turnstile、2つのSecretがすべて明確な場合だけ実施します。

```bash
npm test
npm run test:coverage
npm run build
npm run check:worker-bundle
npm run worker:deploy
```

デプロイ後、公開値だけをGitHub Repository Variablesへ設定します。

```text
VITE_HANDWRITING_IMPORT_ENABLED=true
VITE_HANDWRITING_DIAGNOSTICS_ENABLED=false
VITE_HANDWRITING_IMPORT_ENDPOINT=https://your-worker.example.workers.dev/
VITE_TURNSTILE_SITE_KEY=公開Site Key
```

SecretはGitHub Repository VariablesやActions Secretsへコピーする必要はありません。Worker Secretにだけ保持します。

## 無料枠上限と障害時

Gemini APIが429を返した場合、Workerは外部の本文を隠して`ANALYSIS_LIMIT`だけを返します。フロントは、時間をおいて再試行するか通常の商品選択を使うよう案内します。現在の利用量はGoogle AI StudioのUsage画面、Workerの呼び出し状況はCloudflare Dashboardで確認してください。必要なら、現在のCloudflare契約内で利用できるRate Limitingや利用量通知を検討し、有料機能への変更前に運用者の承認を得てください。

最短の無効化手順は、Repository Variable `VITE_HANDWRITING_IMPORT_ENABLED=false`へ変更してPagesを再デプロイすることです。エンドポイントまたはSite Keyを未設定にしてもUIは安全に非表示になります。解析障害時も通常の商品選択、依頼共有、買い物画面は動作します。

## 入力・出力検証

- POST、`multipart/form-data`、1画像だけを許可
- JPEG/PNG/WebPを宣言MIMEとマジックバイトの双方で確認
- 画像は最大2MB
- 商品候補はJSON配列、最大200件、重複IDなし
- 商品ID、商品名、別名、別名数、JSONバイト数を制限
- 予期しないプロパティと危険なオブジェクトキーを拒否
- 数量、条件、選択状態、履歴、カテゴリ、アイコン、共有URLを送信しない
- 許可Originを完全一致で確認
- Turnstileを毎回検証し、actionとhostnameも確認
- 外部処理を約15秒で中断
- GeminiのJSONをWorkerで再解析し、version、件数、status、商品IDを検証
- 不正なmatchedはunknownへ降格
- ambiguousの候補外IDを除き、候補がなくなればunknownへ降格
- 同一matched商品と明白な重複表記を除去
- 外部APIの生レスポンス、生エラー、内部URL、Secretを返さない
- `Cache-Control: no-store`

フロントでも同じ商品ID集合とstatus整合を再検証します。利用者が「選択した商品を追加」を押すまでdraftは変更せず、追加時は既存の数量・条件・URL予算・上限処理を通る一括トランザクションです。
