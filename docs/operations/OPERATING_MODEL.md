# Plain Relay運用モデル

Status: approved direction

## 目的

本サービスは、家庭内の買い物依頼を安全に共有し、普段買い物を担当しない家族が一人で買い物を完了できる状態を支援する。

運用上の目標はAIによる無人経営ではない。通常時は決定論的な自動化で維持し、異常時は安全に縮退し、Codexが調査・修正Draft PR作成まで担当する。人間は本番・金銭・個人情報・秘密情報・法務に関する判断と明示承認を担う。PRのmerge操作だけは、全安全条件を満たす別のGitHub接続済み操作役AIへ委任でき、それ以外の状態変更は人間が実行する「例外駆動型の小規模Studio運用」とする。

## 不変条件

- 固定依頼、URL共有、商品名、数量、条件、売場順、購入進捗、端末内家庭マスタ、家庭マスタの書き出しと復旧はAI、写真、v5、手書き解析、有料機能へ依存しない。
- 写真、更新可能依頼v5、手書き解析は停止可能な補助機能であり、個別に停止しても無料コアを利用できる。
- OpenAI、Google、Cloudflareの一部機能が停止しても、固定依頼の閲覧と端末内購入進捗を可能な限り継続する。
- 公開リポジトリへ利用者情報、秘密情報、capability URL、実写真、実依頼本文を保存しない。
- AIへCloudflare、決済、Secrets、Productionデータの直接権限を与えない。
- Codex実装・レビューセッションは、自分が作成、変更、または必須レビューしたPRをmergeしない。
- 別のGitHub接続済み操作役AIは、権限を持つ人間が対象repository、PR、base、exact head SHAを明示承認し、`AI_MERGE_APPROVAL.md`の全条件を満たす場合だけmergeを代行できる。
- merge承認はProduction承認ではない。Production変更、外部設定、Secret、返金、データ操作、顧客連絡、法務対応はAIへ委任せず、権限を持つ人間が実行する。
- 障害時に自動化するのは修正ではなく、安全停止、縮退、証拠収集である。

## 4層構成

### 1. サービス実行層

対象:

- GitHub Pagesフロント
- Cloudflare Worker
- SQLite-backed Durable Objects
- ブラウザのlocalStorage / sessionStorage

責務:

- 利用者向け機能を提供する。
- 入力上限、保存期間、権限、feature flagを実行時に強制する。
- 写真・更新・AI解析が失敗しても、テキスト依頼や最後の正常snapshotを維持する。
- 利用者入力を運用AIへの命令として扱わない。

### 2. 決定論的運用層

対象:

- GitHub Actions
- CI
- Dependabot / CodeQL / Secret scanning
- synthetic health check
- Cloudflare上限とkill switch

責務:

- テスト、型検査、ビルド、脆弱性検査を自動実行する。
- 個人情報を含まないprobeで可用性を確認する。
- エラー率、利用量、費用上限を監視する。
- 異常時は新規の補助機能操作を止め、無料コアへ縮退させる。

### 3. AI保守層

当面の費用方針はChatGPT Plusのみとする。Claude API、Claude Pro、ChatGPT Proを前提にしない。

Codexの責務:

- IssueとCI結果の整理
- [AI_AGENT_POLICY.mdの「AI-safe export」](AI_AGENT_POLICY.md#ai-safe-export)をcanonical definitionとし、その全条件を継承し、短縮記述、checklist、Issue、runbook、queueまたはartifactによる省略・緩和を認めないAI-safe障害サマリーの分析
- 再現テストの追加
- 修正実装
- Draft PR作成
- 文書更新
- 別コンテキストでの読み取り専用レビュー
- merge、Production反映、顧客返信等の手順案・文案の作成

Codexに許可しないこと:

- 自分が作成、変更、または必須レビューしたpull requestのmerge
- auto-merge、merge queue投入、branch protection・required checks・review gateの迂回
- Production deploy、Production workflowの起動・承認・再実行
- Cloudflare、GitHub Environment、DNS等の外部設定変更
- Secretの閲覧・変更
- 決済、返金、解約
- 利用者データの閲覧・削除
- 顧客、参加者、報告者への送信
- セキュリティ事故の公表・通知

Codexへprivate運用リポジトリ全体の読み取り権限を与えない。AIへ入力できるのは、[AI_AGENT_POLICY.mdの「AI-safe export」](AI_AGENT_POLICY.md#ai-safe-export)をcanonical definitionとし、その全条件を継承するAI-safe exportだけである。短縮記述、checklist、Issue、runbook、queueまたはartifactによって条件を省略・緩和しない。人間はexport作成を開始できるが、version管理されたallowlist schemaに基づく決定論的producerが生成し、未知field拒否、型・値範囲、全禁止fieldの不存在を決定論的validatorが確認した後のpayloadだけをAIへ入力できる。人間の目視確認、匿名化、仮名化、実名除去だけではAI-safeとみなさない。

GitHub接続を持つ操作役AIは、実装・必須レビューとは別contextで、権限を持つ人間のexact PR/headに対する明示承認後だけmergeを代行できる。merge直前にbase、head、Draft、mergeable、必須CI、独立レビュー、findingを再取得し、`expected_head_sha`等でhead移動を拒否する。base、head、差分、CI、レビュー結果が変われば承認と必要なレビューを失効させる。auto-merge、merge queue、gate迂回は使用しない。指定がなければSquashとし、merge後にmain側SHAを報告する。詳細は[`AI_MERGE_APPROVAL.md`](AI_MERGE_APPROVAL.md)を正本とする。

### 4. 人間統治層

人間が担う判断と実行責任:

- exact repository / PR / base / headに対するmergeの明示承認
- mergeを自分で実行するか、全条件を満たす操作役AIへ単発で委任する判断
- Production反映、停止、再開、rollback
- Cloudflare / GitHub / DNS / 決済の設定変更
- Secretの追加、失効、ローテーション
- Durable Object migration
- 返金、解約、課金判断
- 個人情報を含む問い合わせ対応と送信
- セキュリティ事故の評価、公表、通知
- データ削除・復旧
- 規約、プライバシーポリシー、特商法表示の確定・公開
- サービス継続・停止判断

人間はAIの提案を利用できる。canonical policyに従う承認済みPRのmerge以外の最終操作をAIへ委任しない。

## 提供チャネル

単一コードベースを維持し、機能の提供対象を分離する。

### Stable Free Core

現在利用者へ提供中の無料コア。最新`main`ではなく、Productionへdeploy済みの特定releaseまたはcommitを指す。

- 固定依頼
- URL共有
- 商品名、数量、条件
- 売場順
- 購入進捗
- 端末内家庭マスタ
- 家庭マスタの書き出し・復旧

### Family Lab

開発者本人の家庭だけで試す実験機能。

- 実験中であることを明示する。
- 通常公開へ自動昇格しない。
- 失敗時はStable Free Coreへ戻せる。

### Closed Alpha

招待された外部世帯だけが利用する検証機能。

- 世帯単位の招待、期限、機能scope、失効を持つ。
- 開発者用manual validationとは別契約にする。
- 参加説明と同意を必要とする。
- 収集データを最小化する。

### Paid Beta

Closed Alphaの完了証拠と支払い意思が確認された後の、人数・期間を限定した有料検証。

- 最初は単一商品、単一価格、一回払いとする。
- 課金基盤の自動化より先に、運用と価値を検証する。
- 無料コアを人質にしない。
- 一般公開とは別段階であり、Paid Betaの成功だけで自動的に一般公開しない。

### Public Release / General Availability

Paid Beta後に、有料機能または補助機能を通常の公開導線へ提供する段階。

開始には、事前に固定した利用実績、信頼性、費用、サポート負荷、法務、緊急停止、7日不在耐性の基準をすべて満たす必要がある。一般公開後も個人で維持できない場合は開始しない。

Stable Free Coreの継続と、有料・補助機能のPublic Releaseを同一の判断として扱わない。

## 機能ライフサイクル

各機能は次のいずれかに分類する。

- `personal-experiment`: 家庭内でのみ試す。
- `product-candidate`: 他家庭にも再現する可能性がある。
- `alpha-approved`: 外部αへ出すための安全・説明・計測条件を満たす。
- `paid-beta-approved`: 有料βの非免除条件と外部検証ゲートを満たす。
- `public-stable`: Public Release基準を満たし、一般利用で維持する責任と実運用能力が確認されている。
- `retired`: 利用価値、保守性、安全性の理由で停止する。

家庭内で役立ったこと、支払いが一件発生したこと、運用者が責任を受け入れたことだけを理由に`paid-beta-approved`または`public-stable`へ昇格させない。

## 通常運用の目標

有料β開始時点で次を満たす。

- 日次の手動確認を不要にする。
- 週次の人間作業を原則30〜60分以内に収める。
- サポートをメールまたはフォームへ限定し、即時対応を約束しない。
- 依存更新と低優先度Issueを週次でまとめて処理する。
- Productionリリースは必要時だけ人間が実行する。
- 運用者が7日不在でも無料コアが継続し、費用が暴走せず、補助機能が安全に停止または縮退する。

## 非公開運用領域

公開repositoryはコード、一般設計、公開可能なRunbookだけを正本とする。

private operational repositoryは、次の運用記録を匿名コードと最小要約で管理する運用者向け領域である。

- incident
- support
- participant
- billing / refund
- security
- weekly operations report

氏名、メールアドレス、実写真、共有URL、capability token、Secretはprivate Issueにも原則記録しない。必要な情報は専用の安全な保管先に置く。

AIはprivate repositoryまたはprivate Issueを直接読まない。AIへ渡せるのは、[AI_AGENT_POLICY.mdの「AI-safe export」](AI_AGENT_POLICY.md#ai-safe-export)をcanonical definitionとし、その全条件を継承するAI-safe exportだけである。短縮記述、checklist、Issue、runbook、queueまたはartifactによって条件を省略・緩和しない。version管理されたallowlist schemaに基づく決定論的producerが生成し、未知field拒否、型・値範囲、全禁止fieldの不存在を決定論的validatorが確認した後のpayloadだけを使用する。人間の目視判定、匿名化、仮名化、実名除去だけでAI-safeに昇格させない。

## 費用方針

- AI toolingの契約情報を公開repositoryへ記録しない。
- AI tooling費用をサービスの実行経路へ組み込まない。
- 異種モデルレビューを有料βの必須条件にしない。
- 高リスク変更は、別コンテキストのCodexレビュー、CI、決定論的チェックリスト、staging、人間によるexact merge承認、canonical policyに従うmerge、人間によるProduction操作で補う。

## 変更管理

本モデルを変更する場合は、以下を確認する。

- 家庭用無料コアの継続性
- 公開リポジトリの安全性
- 小規模Studio運用の作業時間
- 7日不在耐性
- 課金前の証拠
- rollback可能性
