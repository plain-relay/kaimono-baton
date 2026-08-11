# 手書き商品取り込み 手動検証Runbook

このRunbookは、通常のデスクトップChrome、Android Chrome、iPhone Safariで、画像前処理、Turnstile、Worker、Gemini、確認画面のどこまで到達したかを安全に切り分けるためのものです。Codexのブラウザ自動化では実画像を選択しません。

診断情報には処理段階、寸法、バイト数、HTTP status、件数だけを含めます。画像、ファイル名、商品名、alias、商品ID、`sourceText`、Turnstileトークン、APIキー、Secret、Gemini出力は記録・共有しないでください。

## 準備

1. 通常のデスクトップChromeを使います。
2. Chrome DevToolsを開きます。
3. Networkの`Preserve log`をONにします。
4. Consoleの`Preserve log`をONにします。
5. 開始スクリプトが`MANUAL TEST IS ENABLED`を表示した後、別ターミナルでスクリプトが表示した`wrangler tail`コマンドを実行します。
6. DevTools、診断パネル、Workerログから機密内容をコピーしないでください。

開始前に次を確認します。

- ローカル`main`が最新で、作業ツリーがclean
- `gh`とWranglerが認証済み
- `worker/wrangler.toml`が存在
- Worker Secret名`GEMINI_API_KEY`と`TURNSTILE_SECRET_KEY`が存在
- Repository VariablesのEndpointとTurnstile Site Keyが存在
- `ALLOWED_ORIGINS`が`https://plain-relay.github.io`だけ
- Turnstile hostnameが`plain-relay.github.io`だけ
- 取り込み機能と診断機能がOFF
- 実行対象refがGitHub Pages環境のdeployment branch policyで許可済み

Secretの実値を表示・読み取りしないでください。

## テスト画像の作成

元画像はGitへ追加しません。次のコマンドで、gitignore対象の`.manual-test/images`にJPEG品質90の画像を作ります。JPEGまたはPNGを指定でき、EXIF方向を可能な範囲で反映します。

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\create-handwriting-test-images.ps1 `
  -InputPath "C:\path\to\handwritten-note.jpg"
```

出力先を変更する場合:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\create-handwriting-test-images.ps1 `
  -InputPath "C:\path\to\handwritten-note.png" `
  -OutputDirectory "C:\private\handwriting-test-images"
```

生成物:

- `long-edge-800.jpg`
- `long-edge-1200.jpg`
- `long-edge-1600.jpg`
- `long-edge-2400.jpg`

元画像の長辺より大きい指定では拡大しません。

## 次回の接続確認と手動検証

次回のトレース取得は、次の順序を変えずに行います。PowerShellでは`npm`ではなく`npm.cmd`を使用します。

1. 安全な現在状態を確認します。

   ```powershell
   npm.cmd run manual:handwriting:status
   ```

2. 未完了sessionがある場合だけ復旧し、もう一度statusを確認します。

   ```powershell
   npm.cmd run manual:handwriting:recover
   npm.cmd run manual:handwriting:status
   ```

3. 状態変更を伴わない接続probeを実行します。

   ```powershell
   npm.cmd run manual:handwriting:probe
   ```

4. `HANDWRITING CONNECTIVITY PROBE PASSED`が表示されることを確認します。このprobeはRepository Variableから公開Endpointだけを取得し、画像・Turnstileトークン・商品候補を含まない空のmultipart POSTを1回送ります。Workerの入力検証による`400 REQUEST_INVALID`、CORS、request ID、JSON応答を確認するだけで、session stateやlockを作成せず、Repository Variables、Pages、Worker deploymentを変更しません。Site KeyやSecretを取得・表示せず、Turnstile検証やGemini呼び出しには進みません。

5. probe成功後にだけ手動検証を開始します。start自身が事前検査をすべて行います。

リポジトリルートの最新`main`から実行します。

```powershell
npm.cmd run manual:handwriting:start
```

Windows PowerShellの互換ラッパーを使う場合:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\start-handwriting-manual-test.ps1 `
  -PreflightOnly

powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\start-handwriting-manual-test.ps1
```

Pagesの手動検証はcurrent `main`限定です。開始・停止の両方へ`-Ref main`を渡します。

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\start-handwriting-manual-test.ps1 `
  -Ref main

powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\stop-handwriting-manual-test.ps1 `
  -Ref main
```

PowerShellファイルはNode CLIを起動し、その終了コードを返すだけです。外部コマンドのstdout、stderr、終了コードの分離、JSON解析、Pages run特定、状態保存、復旧判断はNode側で行います。

開始処理は事前条件を確認し、最初の状態変更前に`.manual-test/handwriting-manual-session.json`を原子的に保存します。その後、Worker診断版をデプロイし、`stable-free-core-production.yml`を`manual-on`モードと一意のsession IDで実行します。Repository Variablesの次の値は常に`false`のままで、一時変更しません。

- `VITE_HANDWRITING_IMPORT_ENABLED`
- `VITE_HANDWRITING_DIAGNOSTICS_ENABLED`

手動検証用のON値は、そのPages buildにだけworkflow入力から渡されます。EndpointとTurnstile Site Keyは既存Repository Variablesから参照しますが、実値はログや状態ファイルへ保存しません。

Pages成功後、Node CLIは公開`handwriting-deployment-state.json`を取得し、commit SHA、mode、session ID、両フラグ、EndpointとSite Keyの設定有無を厳密に照合します。minifyされたJavaScript bundleを正規表現では検査しません。この確認が完了するまで`MANUAL TEST IS ENABLED`は表示されません。表示前に`wrangler tail`やブラウザ検証を開始しないでください。

開始成功時は、実際のsession ID入りURLが表示されます。形式は次のとおりですが、山括弧を含む例を手入力せず、CLIが表示した完成済みURLを使います。

```text
https://plain-relay.github.io/kaimono-baton/?handwritingDiagnostics=1&manualTestSessionId=実際のsession-id#/create
```

manual-on buildでも、診断パネルと手書き取り込みUIは次をすべて満たす場合だけ表示されます。

- `handwritingDiagnostics=1`がハッシュより前のquery parameterにある
- `manualTestSessionId`がそのbuildのsession IDと一致する
- buildから45分の有効期限内である

通常公開URL、異なるsession ID、期限切れURL、ハッシュ内だけのqueryでは表示されません。

開始スクリプトは、デプロイした実際のWorker version IDを埋め込んだ完成済み`wrangler tail`コマンドを表示します。`MANUAL TEST IS ENABLED`が表示された後、そのコマンド全体をコピーして別ターミナルで実行してください。`<version>`や`<表示されたWorker version>`などの山括弧付き文字列をそのまま入力しないでください。

Worker診断ログは1行JSONで、`requestId`、stage、所要時間、安全なstatus・件数だけを含みます。

現在の安全な状態だけを確認する場合:

```powershell
npm.cmd run manual:handwriting:status
```

開始処理の中断やPC再起動後に未完了stateが残った場合:

```powershell
npm.cmd run manual:handwriting:recover
```

同時起動はlockで拒否されます。`SIGINT`、`SIGTERM`、未処理例外の後は一度だけ自動復旧を試み、完了できなければstateを`recovery-required`として残します。stateやlockを手で削除せず、`status`と`recover`を使ってください。

## 800px画像1回のトレース取得

開始スクリプトが`MANUAL TEST IS ENABLED`を表示した後、次だけを行います。

1. 表示された完成済み`wrangler tail`コマンドを別PowerShellで実行します。
2. 表示された正しいsession URLを通常のデスクトップChromeで開きます。
3. DevToolsのNetworkとConsoleで`Preserve log`がONであることを確認します。
4. `long-edge-800.jpg`を1回だけ選択し、「読み取りを開始」を1回だけ実行します。
5. 診断情報から`requestId`、`failedAfterStage`、`httpStatus`、`workerErrorCode`を記録します。
6. 同じ`requestId`の安全なWorker tail行を保存します。
7. 成否にかかわらずstopを実行し、その後statusを確認します。

   ```powershell
   npm.cmd run manual:handwriting:stop
   npm.cmd run manual:handwriting:status
   ```

このトレースでは1200px、1600px、2400px、元画像を続けて試しません。同じ800px画像も反復送信しません。追加試験は、最初の1回のブラウザ診断とWorker tailを評価してから別途判断します。

1回の送信について次だけを記録します。

| 項目 | 記録 |
|---|---|
| タブが維持されたか | yes / no |
| ブラウザ診断の最終stage | `failed`等 |
| 失敗直前stage | `failedAfterStage`または未発生 |
| WorkerへのPOST | あり / なし |
| HTTP status | 数値または未到達 |
| Workerエラーコード | `workerErrorCode`または未到達 |
| Workerの最終stage | stage名または未到達 |
| 確認画面 | 到達 / 未到達 |
| 結果件数 | total / matched / ambiguous / unknown |
| 確認前のdraft | 不変 / 問題あり |
| 確認後の反映 | 成功 / 未実施 / 問題あり |
| 通常商品機能への影響 | なし / 問題あり |

商品名、読み取った内容、商品ID、画像、リクエスト本文、レスポンス本文を診断記録へ転記しないでください。

併せて確認します。

- 確認画面を開く前にdraftが変わらない
- 既存数量と条件を上書きしない
- unknownを利用者の選択後だけ自由追加できる
- キャンセルできる
- 二重実行できない
- 通常商品、自由追加、共有に回帰がない

Android ChromeとiPhone Safariの確認はこの1回のトレースには含めません。物理端末で実施していない項目は未確認とし、デスクトップ結果から成功を推定しません。

## 結果の判定表

| 観測結果 | 主な切り分け先 |
|---|---|
| `failedAfterStage=decode-started` | 元画像デコードまたはブラウザメモリ |
| `failedAfterStage=decode-completed`または`canvas-render-started` | Canvas描画またはブラウザメモリ |
| `failedAfterStage=preprocessing-completed`から`turnstile-execute-started` | Turnstileのロードまたはトークン取得 |
| `failedAfterStage=worker-request-started`かつWorkerログなし | ネットワーク、CORS、ブラウザ |
| `request-received`後、`turnstile-verified`前 | Worker入力検証またはTurnstile Siteverify |
| `gemini-request-started`後に失敗 | Gemini、無料枠、タイムアウト、SDK |
| `failedAfterStage=worker-response-received` | Worker error response、JSON読取、フロント結果検証 |
| `failedAfterStage=worker-response-validated`または`confirmation-render-started` | 確認画面描画 |
| 通常Chrome成功、Codexブラウザだけ失敗 | Codexブラウザ自動化環境の問題が有力 |

ブラウザ再読み込み後も、診断パネルの「前回セッションの最終stage」で最後の安全な記録を確認できます。失敗時は`stage=failed`に加えて「失敗直前」と`failedAfterStage`が残ります。「診断情報をコピー」は安全なメタデータだけをJSON化し、「診断情報を消去」は診断用localStorageキーだけを削除します。

## 終了

手動検証の成否にかかわらず、必ず実行します。

```powershell
npm.cmd run manual:handwriting:stop
```

Windows PowerShell互換ラッパー:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\stop-handwriting-manual-test.ps1
```

停止処理は次を行います。

1. 一意のOFF session IDで`manual-off` Pagesを実行
2. 対象runのworkflow、event、run-name、commit SHA、actorを照合
3. OFF manifestを取得し、両機能がOFFであることを確認
4. Wrangler `versions deploy`で開始前の正確なWorker versionへ100%のトラフィックを戻す
5. Repository Variablesの開始前後fingerprintが完全一致することを確認
6. stateを`complete`にし、lockを除去

最終確認:

- `VITE_HANDWRITING_IMPORT_ENABLED=false`
- `VITE_HANDWRITING_DIAGNOSTICS_ENABLED=false`
- Pages再デプロイ成功
- Workerが開始前versionで`DIAGNOSTIC_MODE=false`
- Endpoint Variable保持
- Site Key Variable保持
- Worker Secrets保持
- Origin変更なし
- Turnstile hostname変更なし

停止処理が失敗した場合は、そのまま運用を継続せず、`npm.cmd run manual:handwriting:status`で安全なメタデータだけを確認し、`npm.cmd run manual:handwriting:recover`でOFF復元を完了してください。状態ファイルには画像、商品情報、トークン、APIキー、Secretを保存しません。
