# Codex開発・レビュー・mergeワークフロー

Status: active repository workflow

## 目的

Codexを継続的に利用しながら、計画、実装、独立レビュー、merge承認、
Production反映を同じ判断にまとめないための実行契約である。

この文書は実装・レビューの流れを定義する。AIの権限とデータ境界は
[`operations/AI_AGENT_POLICY.md`](operations/AI_AGENT_POLICY.md)、承認済みPRを
操作役AIがmergeできる全条件は
[`operations/AI_MERGE_APPROVAL.md`](operations/AI_MERGE_APPROVAL.md)を正本とする。

## 役割

| 役割 | 実行できること | 実行できないこと |
| --- | --- | --- |
| 計画 | scope、base、risk、検証、rollbackの定義 | 実装済みとみなすこと、merge承認 |
| Codex実装 | 調査、専用branch、変更、test、Draft PR、修正 | 自分のPRのmerge、Production・外部操作 |
| 独立reviewer | exact base/headの完全差分を読み取り専用で評価 | 対象変更、merge、外部操作 |
| 権限を持つ人間 | 残余risk判断、exact PR/headのmerge明示承認 | 過去または包括的承認を現在PRへ流用すること |
| 操作役AI | canonical policyの全条件成立後の単発merge | 実装・必須レビューとの兼任、無承認merge、Production操作 |
| Production運用者 | 別承認後のProduction・外部操作 | merge承認をProduction承認とみなすこと |

同じAI製品を使う場合も、実装セッション、必須独立レビュー、merge操作は
別コンテキストとする。実装または必須レビューを担当したセッションは対象PRを
mergeしない。

## 1. Intakeとpreflight

1. active Issueの現在本文、受入条件、非Scopeを読む。
2. root `AGENTS.md`と`docs/PROJECT_MAP.md`を読む。
3. `git fetch origin main`後に、要求されたbase SHAと`origin/main`を比較する。
4. working treeがcleanであることと、現在branchを記録する。
5. base不一致なら、要求baseから現在mainまでのcommitとdiffを調査する。
6. 安全に現在mainへ適用できる根拠がなければ、編集せず停止する。
7. private ops、Secrets、利用者データを取得していないことを確認する。

歴史的PRは正本ではない。閉じた未merge PRのbranch復活、merge、cherry-pick、
commitの直接流用は、明示的な許可がない限り行わない。

## 2. 計画

[`EXECUTION_PLAN_TEMPLATE.md`](EXECUTION_PLAN_TEMPLATE.md)を使用し、少なくとも次を
固定する。

- Issueと目的
- exact base SHA
- 専用branch
- in scope / out of scope
- 変更予定file
- Stable Free Coreと互換性の不変条件
- AI data boundary
- Low / Medium / Highの分類と、最も高い条件に該当する根拠
- local check、必須CI、独立レビュー手段
- rollback
- Production・外部設定・Secret操作が必要か（原則として別Issue・別承認）

Issueがriskを明示している場合は、それより低く分類しない。途中でHighに該当する
変更が必要になった場合は、現在の許可範囲を超えて実装せず計画を更新する。

## 3. 実装

1. exact baseからIssue専用branchを作る。
2. Issueの最小差分だけを実装する。
3. unrelatedなuser変更を保持し、対象fileだけをstageする。
4. application、Worker、dependency、lockfile、workflow、external stateを、Issueの
   明示scope外では変更しない。
5. 公開URL、token、localStorage、復旧、Stable Free Coreへ触れる場合は、該当する
   互換性testと設計文書を先に確認する。
6. 実装中もprivate opsを検索せず、AI-safe export以外の運用dataを入力しない。

`.agents/skills/`や`.codex/agents/`は、現在利用するCodexがその形式を実際に読み、
repository固有の再利用価値があることを確認できた場合だけ追加する。root
`AGENTS.md`と通常のMarkdownで足りる場合は追加しない。

## 4. Local validation

現在の`package.json`と`.github/workflows/`を正として、存在するcommandだけを使う。
現在のPR CIに対応する標準checkは次である。

```text
npm ci
npm test
npm run test:worker
npm run check:worker-bundle
npm run test:coverage
npm run build
git diff --check
```

`npm run build`はapplication TypeScript build、Worker type check、Vite production
buildを含む。Worker type checkだけを切り分ける場合は
`npm run typecheck:worker`を使用できる。lintまたはformat scriptは存在しない。

文書だけの変更でも、既存CIへ影響しないことを確認するため実行可能な標準checkを
実行する。環境上実行できないcheckは成功扱いにせず、command、理由、残る確認を
PRへ記録する。

検証後、次を確認する。

- `git diff --name-status <base>...HEAD`がscope内だけである。
- application source、Worker runtime、dependency、lockfile、workflowの意図しない
  変更がない。
- `git diff --check`が成功する。
- 差分にSecret、token、完全な共有URL、利用者dataらしい値がない。
- 旧merge規約やProductionとの混同が残っていない。

## 5. CommitとDraft PR

変更を独立して説明できる論理的なcommitへまとめ、branchをpushする。Draft PR本文は
`.github/pull_request_template.md`を満たし、次を実値で記録する。

- Issue番号
- base branchとexact base SHA
- exact head SHA
- 変更file一覧と目的
- 維持した不変条件
- 実行したcheckと結果
- CI run番号、URLまたは状態
- risk分類と根拠
- rollback
- Production・外部設定変更なし（該当する場合）
- private ops・Secret・利用者data未参照
- 必要な独立レビュー手段

Draft PRの作成はmerge承認ではない。auto-mergeを有効化せず、merge queueへ投入しない。

## 6. 独立レビュー

reviewerは新規の読み取り専用コンテキストで、次を取得する。

- repositoryとIssue
- exact base SHA
- exact head SHA
- `base...head`の完全差分と変更file一覧
- active acceptance criteria
- 実行済みcheckとCI
- risk、invariants、rollback

レビュー手段は`AGENTS.md`の「Review method」に従う。文書・Issue・PR本文だけのLow
risk変更は、全条件成立時に別ChatGPTチャットでよい。source、test、Worker、API、
URL codec、localStorage、PWA、dependency、lockfile、build、Actions、deployment、
runtime safety、Rate Limit、logging、monitoring、kill switch、または実コマンド確認が
必要な変更は別Codexセッションを使う。Issueがより厳しい手段を指定した場合は従う。

reviewerはP0 / P1 / P2 / P3でfindingを記録する。P0、P1、非免除条件に影響するP2を
残したままmerge-readyと判定しない。

base SHAまたはhead SHAが変われば、以前の最終レビューは無効である。修正後は
新しいexact base/headの完全差分を再レビューし、古い「差分の差分」だけで代替しない。

## 7. Merge readinessと人間の明示承認

実装セッションは、CIと独立レビュー結果、current base/head、未解決事項、推奨merge
method、rollback、Production影響を提示して停止する。実装時の依頼文、repository所有者の
一般的意向、別PRの承認、将来PRへの包括的指示をmerge承認として扱わない。

権限を持つ人間の承認は、対象repository、PR番号、base branch、exact base SHA、exact
head SHA、merge methodを特定したcurrent snapshot提示後の明示的な返答でなければならない。

## 8. 操作役AIによる承認済みmerge

操作役AIは`operations/AI_MERGE_APPROVAL.md`の全条件を一つずつ検証する。特にmerge直前に
base/head、Draft、mergeable、必須CI、独立レビュー、未解決findingを再取得し、
`expected_head_sha`等でhead移動を拒否する。

承認後にbase、head、diff、CI、レビュー結果が変われば承認は失効する。auto-merge、
merge queue、branch protection・required check・review gateの迂回は禁止する。指定が
なければSquashを使用する。

mergeがProduction workflowを不可避に起動する構成の場合、merge承認だけでは操作役AIが
mergeしてよい条件を満たさない。Productionを分離するか、権限を持つ人間が別の判断として
扱うまで、操作役AIは停止して現在のworkflow事実を報告する。

merge後はrepository、PR、method、merged head SHA、main側commit SHA、結果、Production
反映を実行していないことを報告する。

## 9. Productionと外部操作

merge承認はProduction承認ではない。AIは承認の有無にかかわらず、Production deploy・
workflow起動/承認/再実行、Cloudflare、DNS、GitHub Environment、Secrets、Variables、
billing、Durable Object migration、課金・返金・解約、顧客送信、利用者data操作、事故
通知、法的文書の確定公開、Production停止・再開を実行しない。

必要な場合、別の人間承認用にexact commit/artifact、手順、事前条件、rollback、確認項目を
作成して停止する。Production操作は権限を持つ人間が実行する。

## 現在のworkflowに関する注意

`docs/PROJECT_MAP.md`は現在のActions triggerを記録する。文書の目標状態だけを信じず、
merge検討時には`.github/workflows/`を再読する。文書だけの変更はworkflow、Pages、
Cloudflare、Productionを変更しない。
