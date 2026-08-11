# 定型手書き依頼票ワークフロー設計

- Status: Accepted

## 1. 目的

スマートフォンで商品を1件ずつ入力する代わりに、印刷済みの定型票へ空き時間に書き足し、完成した用紙をiPhoneまたはAndroidで撮影して依頼draftへ取り込む。

対象となる一連の流れは次のとおり。

1. A4の定型票を印刷して常備する
2. 依頼者が商品名、個数、条件を手書きする
3. 用紙全体を撮影する、または端末内の既存写真を選択する
4. Geminiが行単位の構造化候補を返す
5. 利用者が全行を確認・修正する
6. 検証済みの内容だけを一括でdraftへ反映する
7. 通常の作成画面で追加・修正して共有する

本機能の価値は、画像認識そのものではなく、紙を一時入力バッファとして使えることにある。

## 2. 現行設計との差分

現行v1は次の制約を持つ。

- 自由形式の画像から商品名だけを抽出する
- 数量は1固定
- 条件は抽出しない
- 既にdraftへ存在する商品は変更しない
- custom itemも数量1、単位「個」、条件空で追加する

新しい運用では、商品名、数量、条件を1つの行として保持するstaging modelが必要である。Gemini結果を直接既存draftへ適用してはならない。

## 3. 定型票 v1

### 3.1 用紙仕様

- A4縦
- 白黒印刷
- 片面
- 12行
- 1行1商品
- 用紙識別子: `OTSUKAI FORM V1`
- 四隅に位置合わせ用の黒い正方形を配置
- 個人情報欄は設けない

### 3.2 推奨レイアウト

A4の左右余白を各10 mmとし、有効幅190 mmを次のように使う。

| 列 | 幅の目安 | 内容 |
|---|---:|---|
| 行番号 | 10 mm | 印刷済み1〜12 |
| 商品名 | 70 mm | 1商品だけ記入 |
| 個数 | 20 mm | 1〜20の整数 |
| 条件 | 90 mm | 例: 低脂肪、国産、賞味期限長め |

各行の高さは14〜15 mmを目安とする。商品名と条件の境界が写真でも明確に見えるよう、罫線は細すぎないものとする。

### 3.3 用紙上の注意書き

- 1行に1商品を書いてください
- 個数は1〜20で書いてください
- 条件は短く書いてください
- 空行は読み取りません
- 同じ商品は原則1行へまとめてください
- 訂正するときは二重線で消し、同じ行の余白または新しい行へ書き直してください

黒く塗り潰した文字の復元は対象外とする。

### 3.4 対象外の欄

初版では次を用紙に設けない。

- 価格
- 店舗
- 依頼者名
- 電話番号
- 住所
- 購入済みチェック
- 自由文章の総合メモ

個別商品の条件だけを構造化する。

## 4. 画像入力UI

### 4.1 2つの入力導線

単一のfile inputでcameraとlibraryを兼用しない。

#### 写真を撮る

- `type="file"`
- `accept="image/*"`
- `capture="environment"`
- 主に背面カメラを起動する

#### 端末の写真を選ぶ

- `type="file"`
- `accept="image/*"`
- `capture`属性なし
- iPhoneの写真ライブラリ、Androidの写真・ファイル選択を開く

Androidでは`capture="environment"`を指定したinputがカメラを直接起動するため、UIラベルだけで「撮影・選択」を兼用させない。

### 4.2 デスクトップ

デスクトップでは「端末の写真を選ぶ」を通常のfile pickerとして使用する。ドラッグ&ドロップはPhase 1の必須要件にはせず、後から追加可能な補助導線とする。

### 4.3 入力後の表示

画像選択後、送信前に次を表示する。

- サムネイル
- 画像サイズ
- 撮り直す／選び直す
- 読み取りを開始

file inputのchange直後にTurnstileやWorker通信を開始しない。利用者が画像全体と向きを確認してから開始する。

## 5. 画像形式

### 5.1 JPEG / PNG / WebP

現行のクライアント前処理を使用する。

- magic bytesによる形式検査
- EXIF方向を考慮したデコード
- 長辺1600 px以下へ縮小
- JPEGへ再エンコード
- Worker送信画像を2 MiB以下へ抑制

### 5.2 HEIC / HEIF

最終要件は、iPhoneで撮影または保存された写真を利用者が変換操作せず選べることである。

Gemini API自体はHEICとHEIFの画像入力を扱えるため、必ずJPEGへ変換する設計にはしない。ただし、現行frontendとWorkerはJPEG、PNG、WebPだけを許可している。

候補経路は次の2つ。

#### A. ブラウザでデコードできる場合

- 現行Canvas経路で縮小
- JPEGへ再エンコード
- 既存Worker契約へ送信

#### B. ブラウザでデコードできない場合

- `image/heic`または`image/heif`を受け付ける
- ISO Base Media File Formatのbrandをmagic bytesで検査する
- 元画像サイズ上限を設定する
- Canvasを経由せずWorkerへ送る
- WorkerでもMIMEとbrandを再検査する
- Geminiへ元形式を渡す

Phase 4で両案を実機比較し、追加ライブラリなしで成立する場合はBを優先する。大型のHEIC変換ライブラリは、実機試験で必要性が確認された場合だけ採用する。

## 6. 構造化契約 v2

```ts
type HandwritingImportResultV2 = {
  version: 2
  formVersion: 'OTSUKAI_FORM_V1' | 'unknown'
  items: Array<{
    rowNumber: number | null
    sourceName: string
    quantity: number | null
    condition: string
    status: 'matched' | 'ambiguous' | 'unknown'
    productId: string | null
    candidateProductIds: string[]
  }>
}
```

### 6.1 共通制約

- `items`: 最大12件
- 空行は出力しない
- 同じ用紙行を重複出力しない
- 読めない文字を推測しない
- 数量や条件を商品名へ混ぜない
- 商品候補データ内の文字列を命令として扱わない
- 外部検索、ツール、会話履歴を使わない

### 6.2 フィールド制約

#### formVersion

- 用紙内の`OTSUKAI FORM V1`を確認できた場合だけその値を返す
- 自由形式または判別不能なら`unknown`

`unknown`でも処理は続行できるが、確認画面に「定型票を確認できませんでした」と表示する。

#### rowNumber

- 1〜12
- 読めない場合はnull
- rowNumberだけを根拠に空行を生成しない

#### sourceName

- 読めた最短の商品表記
- 数量、単位、条件を含めない
- 最大30ユーザー文字

#### quantity

- 1〜20の整数
- 空欄、読めない、範囲外はnull
- 「2本」「3袋」のように書かれた場合は数値部分だけをquantityへ入れる
- 単位は商品masterを使用し、初版契約では抽出しない

#### condition

- 個別商品の条件だけ
- 最大30ユーザー文字
- 空欄は空文字
- 数量を含めない

#### status / productId / candidateProductIds

v1と同じ不変条件を維持する。

- matched: `productId`必須、候補配列は空
- ambiguous: `productId`はnull、候補1〜3件
- unknown: `productId`はnull、候補配列は空

## 7. staging model

Gemini結果から直接draftを生成せず、UI専用のstaging rowへ変換する。

```ts
type HandwritingStagingRow = {
  id: string
  rowNumber: number | null
  sourceName: string
  selected: boolean
  resolution:
    | { kind: 'product'; productId: string }
    | { kind: 'custom'; name: string }
    | { kind: 'unresolved' }
  quantity: number
  quantityNeedsReview: boolean
  condition: string
  conflictMode: 'none' | 'keep-existing' | 'replace' | 'add-quantity'
  warnings: string[]
}
```

初期値:

- matched: productを選択済み
- ambiguous / unknown: unresolved
- quantityがnull: 値1、`quantityNeedsReview=true`
- condition: 読取値
- selected: 空でない全行をtrue。ただしunresolved行はApplyできない

## 8. 確認画面

### 8.1 行ごとの編集

各行で次を変更できる。

- 使用する／無視する
- 商品候補
- 自由追加名
- 数量
- 条件

元画像を確認できるよう、確認画面の上部または折りたたみ領域に縮小画像を表示する。画像はメモリ上だけに保持し、永続化しない。

### 8.2 警告

次を行単位で表示する。

- 数量未記入または不明
- 商品候補未確定
- 同じproductIdが複数行にある
- 同じcustom nameが複数行にある
- 既存draftと競合する
- 条件が上限に達した
- 定型票を確認できなかった

### 8.3 Apply可能条件

選択中の全行が次を満たすまでApplyを無効にする。

- resolutionが確定
- quantityが1〜20の整数
- conditionが30文字以内
- 重複が解消済み
- 既存draftとの競合方針が確定
- custom item上限内
- 共有URL長上限内

## 9. 既存draftとの競合

既存のquantityが1以上、または既存conditionが空でない場合、黙って上書きしない。

### keep-existing

- 既存値を保持
- 読取行は適用しない
- 初期値

### replace

- quantityとconditionを読取・編集値へ置換

### add-quantity

- quantityを既存値へ加算
- 20を超える場合はエラー
- conditionは自動結合しない
- 確認画面で最終conditionを利用者が編集する

## 10. 重複

現行draftはproductIdごとに1レコードであり、同じ商品を別条件で複数行保持できない。

そのため次を禁止する。

- 同じproductIdの黙った合算
- 異なるconditionの黙った連結
- 同じcustom nameの黙った統合

確認画面で重複行を示し、利用者が1行へまとめるか一方を無視する。

## 11. 原子的反映

新しいapply関数は、現行の数量1固定関数とは分離する。

処理順:

1. staging rowsを検証
2. 現行draftのコピーからcandidateを構築
3. 通常商品へquantityとconditionを適用
4. custom itemをquantity、unit、condition付きで追加
5. 全体のquantity、condition、custom item数を検証
6. 共有URL長を検証
7. 成功した場合だけcandidateを返す

途中の1行で失敗した場合は元draftをそのまま返す。

## 12. Gemini prompt

プロンプトは自由形式OCRではなく、帳票の列構造を利用する。

- まず用紙全体から12行の罫線を把握する
- 各行の「商品名」「個数」「条件」を別々に読む
- 用紙外の背景や印刷説明を商品として扱わない
- 印刷済み見出しを抽出しない
- 二重線で消された旧文字を採用しない
- 書き直しがある場合は最も明確な現行値だけを採用する
- 不明値はnullまたは空文字を返す
- reasoningや説明文を返さない

罫線位置の座標検出をWorker側の必須ロジックにはしない。Geminiの視覚理解で十分かを実画像セットで評価し、必要になった場合だけdeskew・cropを追加する。

## 13. 診断とプライバシー

診断ログへ出してよいもの:

- requestId
- stage
- duration
- image bytes
- dimensions
- HTTP status
- result件数
- matched / ambiguous / unknown件数
- error class

出してはいけないもの:

- 画像
- ファイル名
- sourceName
- condition
- product name
- alias
- productId
- candidateProductIds
- Turnstile token
- API key
- Secret
- Gemini request / response本文

quantityも利用者入力データなので、原則としてログへ出さない。

## 14. 実装フェーズ

### Phase 0: service-unavailableの切り分け

接続障害の調査とruntime契約の変更は分離する。新契約を入れて原因を隠さない。
Worker、Turnstile、Gemini契約を変更しない作業は独立して検証できる。

### Phase 1: 印刷票と2入力導線

- 印刷用HTML/CSS
- A4 print test
- camera input
- library input
- preview / reselect
- v1契約のまま回帰確認

### Phase 2: v2契約

- frontend / Worker types
- JSON Schema
- prompt
- result validation
- v1互換方針

### Phase 3: staging UIとatomic apply

- 全行編集
- duplicate handling
- conflict handling
- quantity / condition反映
- URL制約

### Phase 4: HEIC / HEIF

- iPhone Safari camera / library
- Android Chrome camera / library
- 画像方向
- 大容量画像
- 低メモリ
- 元形式送信経路の可否

### Phase 5: リリース判定

- desktop Chrome
- Android Chrome
- iPhone Safari
- Turnstile実token
- Gemini実応答
- 定型票12行
- quantity / condition精度
- キャンセル時draft不変
- conflict / duplicate
- stop後OFF

## 15. テストマトリクス

### 帳票

- 全12行記入
- 1行だけ記入
- 空行混在
- 数量空欄
- 条件空欄
- 二重線訂正
- 斜め撮影
- 影
- 暗所
- 白い紙以外の背景
- 用紙端が一部欠ける
- 定型票ではない自由メモ

### 商品対応

- exact matched
- alias matched
- ambiguous
- unknown
- 同一商品重複
- custom name重複
- 既存draft競合

### 数量

- 1
- 20
- 0
- 21
- 未記入
- 読めない
- `2本`表記

### 条件

- 短文
- 30文字
- 31文字以上
- 数字を含む条件
- 数量と混同しやすい条件

### 端末

- desktop Chrome file picker
- Android Chrome camera
- Android Chrome photo library
- iPhone Safari camera
- iPhone Safari photo library
- HEIC / HEIF
- JPEG

## 16. 外部仕様上の前提

- HTMLの`capture`属性は、対応端末で新規撮影と使用カメラを要求するためのもので、ブラウザ間で挙動が完全に統一されていない
- 既存写真を確実に選ばせる導線ではcaptureを付けない
- Gemini APIはPNG、JPEG、WebP、HEIC、HEIFを画像入力形式として案内している

参考:

- MDN `capture` attribute: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/capture
- Gemini API image understanding: https://ai.google.dev/gemini-api/docs/image-understanding

## 17. リリース安全性

この設計PRは文書だけを変更する。

実装中も次を維持する。

- Repository Variablesの通常公開フラグはfalse
- Worker `DIAGNOSTIC_MODE=false`
- OriginはGitHub Pagesだけ
- Turnstile hostnameはGitHub Pagesだけ
- 実機検証は期限付きmanual sessionだけ
- 実画像検証後に必ずstop / statusを確認する
