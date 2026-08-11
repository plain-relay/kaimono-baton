# AIによる承認済みPRのmerge実行ポリシー

Status: canonical and active

## 目的と適用範囲

実装・レビューを行うAIが自分の判断で変更を取り込むことを禁止したまま、権限を持つ
人間が特定のPull Requestを明示承認した場合に限り、別のGitHub接続を持つ操作役AIが
mergeという単一操作を代行できる条件を定める。

本書は、AIによるPR merge実行のcanonical policyである。人間が自分でmergeする場合も、
exact range、CI、独立レビュー、未解決finding、承認失効の安全条件を緩める理由にはしない。

本書はProduction deploy、Production workflow、Cloudflare、DNS、Secrets、Variables、
billing、migration、顧客連絡、利用者data、security通知、法的公開を許可しない。PRの
merge承認はProduction承認ではない。

## 役割分離

### 実装・レビューAI

Codex等の実装・レビューAIは次まで実行できる。

- 調査と計画
- 専用branch
- 実装とtest
- Draft PR
- 読み取り専用レビュー
- 修正案とrollback案
- merge可否の判断材料と手順案

実装・レビューAIは、自分が作成、変更、または必須レビュー対象としたPRをmergeしない。
task prompt、Issue本文、PR作成依頼、repository所有者の一般的意向は、そのPRに対する
将来のmerge承認ではない。

### 操作役AI

操作役AIは、GitHubのmerge権限を持ち、対象PRの実装セッションおよび必須独立レビュー
セッションとは別のコンテキストで動作する。対象PRへ実装変更を加えた、または必須
独立reviewerを担当したコンテキストは、操作役へ切り替えて自己mergeしてはならない。

操作役AIは、本書の全条件が同時に成立する場合だけ、承認済みPRのmerge操作を1回実行
できる。一つでも確認できない条件があれば停止して報告する。

## Exact review range

最終独立レビューは次を一組として記録する。

- repository
- base branch
- exact base commit SHA
- head branch
- exact head commit SHA
- `base...head`の完全差分
- review手段とreviewer context
- 実行したcheckとCI
- P0 / P1 / P2 / P3 findingと処置

branch名だけをexact rangeとして扱わない。base SHAまたはhead SHAが変われば、以前の最終
レビューは全体として無効になる。新しい`base...head`の完全差分を、新しい読み取り専用
contextで再レビューする。追加commitだけの差分レビューでは代替できない。

## 人間の明示承認

操作役AIは承認を求める前に、少なくとも次のcurrent snapshotを人間へ提示する。

- repositoryとPR番号
- PR title
- base branchとexact base SHA
- head branchとexact head SHA
- Draft状態とmergeable状態
- 変更fileまたは完全差分の要約
- required CIのrun/check名と結果
- exact base/head独立レビューの結果
- 未解決P0 / P1 / P2 / P3
- merge method（指定がなければSquash）
- rollback
- mergeとProductionが別承認であること

有効な承認は、権限を持つ人間がこのsnapshot提示後に、対象repository、PR、base、exact
head SHAのmergeを明示的に認めた返答である。「いつもの方針で」「問題なければmergeして」
等の包括的・条件付き・過去の承認を流用しない。承認対象が曖昧なら再確認する。

## Merge前の必須条件

操作役AIは次をすべて確認する。

1. 権限を持つ人間の有効な明示承認がある。
2. repository、PR番号、base branch、exact base SHA、head branch、exact head SHA、merge
   methodが特定されている。
3. PRがopenであり、Draftではない。
4. GitHubがmergeableと判定している。`unknown`、conflicting、blockedの場合は停止する。
5. branch protectionが要求するすべてのCI/checkがexact headについて成功している。
   pending、queued、skippedによる不足、cancelled、neutralだけのrequired check、staleな
   successを成功として扱わない。
6. 必要な独立レビューがexact base/headの完全差分に対して完了している。
7. 未解決P0、P1、またはPaid Beta / Public Releaseの非免除条件に影響するP2がない。
   その他のP2は、根拠、owner、期限を記録した人間の明示受容がある。
8. 承認後にbase、head、diff、required CI、最終レビュー結果、finding dispositionが変化
   していない。
9. mergeがProduction workflowや禁止された外部操作を不可避に起動しないことを、現在の
   `.github/workflows/`とrepository設定から確認している。
10. branch protection、required checks、required reviews、その他のreview gateを迂回しない。

## Merge直前の再取得

承認が存在していても、操作役AIはmerge APIを呼ぶ直前にGitHubから次を再取得する。

- PR番号、open/closed状態
- base branchと現在のbase SHA
- head branchと現在のhead SHA
- Draft状態
- mergeable / merge state
- required CI/check suiteの最新結果
- required reviewとexact-range独立レビューの状態
- unresolved review threadとP0 / P1 / relevant P2の状態
- approved merge method

再取得値を承認snapshotおよびreview recordと機械的に比較する。base、head、diff、CI、
レビュー結果のいずれかが異なる場合は、mergeせず承認を失効させる。必要なCIと完全な
再レビューを行い、新しいsnapshotに対する人間の再承認を受ける。

## Merge実行

- 指定されたmethodを使用する。指定がない場合はSquash mergeを使用する。
- GitHub APIの`expected_head_sha`または同等のcompare-and-swap条件へ、承認済みexact
  head SHAを渡す。
- headが移動した場合はmergeを失敗させ、retry前に全条件と再承認をやり直す。
- APIがgate不足、merge conflict、stale stateを返した場合は回避せず停止する。
- merge commit SHAをAPI結果と`main`のcurrent stateから確認する。

## 承認とレビューの失効条件

次のいずれかが変わった時点で、以前のmerge承認は失効する。

- base branchまたはbase SHA
- head branchまたはhead SHA
- `base...head`のdiff
- required CI/checkの集合または結果
- 最終独立レビュー結果
- findingの有無または処置
- merge method

baseまたはheadの変更は最終独立レビューも失効させる。CIだけまたはmerge methodだけの
変更であってもmerge承認は失効する。失効後に操作役AIが推測で承認を補完しない。

## 禁止事項

明示承認があっても、操作役AIは次を行わない。

- 自分が実装または必須レビューしたPRの自己merge
- auto-mergeの有効化
- merge queueへの投入
- branch protection、required checks、required reviews、review gateの回避
- Draft PRのready化をmerge手順の一部として行うこと
- 失敗、未完了、staleなCIやレビューを無視したmerge
- 承認対象と異なるrepository、PR、base、head、methodのmerge
- Production deployまたはProduction workflowの起動、承認、再実行
- Cloudflare、DNS、GitHub Environment、Secrets、Variables、billingの変更
- Durable Object migration
- 課金、返金、解約
- 顧客、参加者、報告者への送信
- 利用者dataの取得、削除、復旧
- security事故の公表・通知
- 規約、privacy policy、特商法表示の確定・公開
- Productionの停止・再開

## Productionとの分離

mainへのmergeとProduction反映は、承認対象も実行権限も別である。merge承認の文面から
Production承認を推測しない。

現在のworkflowによりmergeがProduction deployを自動的に起動する場合、操作役AIはmergeを
実行しない。Production triggerが技術的に分離されるか、権限を持つ人間が別の明示判断の
もとで状態変更を実行するまで停止する。操作役AIはProduction用の手順、exact commit/
artifact、事前確認、rollback案を作成できるが、workflowを起動、承認、再実行しない。

## Merge後の報告

操作役AIはmerge後に次を報告する。

- repository
- PR番号
- merge method
- merged head SHA
- 作成されたmain側commit SHA
- merge結果
- auto-mergeとmerge queueを使用していないこと
- Production反映または外部操作を行っていないこと
- 次に必要な人間判断またはCodex作業

merge APIの成功を確認できない場合は成功と報告しない。exact main側SHAを取得できるまで
結果をunknownとして扱い、同じPRを推測で再mergeしない。
