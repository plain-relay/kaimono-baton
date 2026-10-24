# 商品検索・購入済み表示・定型相談の検証

対象: `docs/SHOPPING_EASE_PLAN.md` の3機能。公開環境への操作はない。

## 利用者の操作

- 依頼作成で商品名を入力し、結果の既存＋/−・条件・写真を操作する。検索を消すとカテゴリ一覧へ戻る。
  検索語は保存しない。数量・条件は既存draftに保持。家庭用名称と追加商品を検索し、hidden商品は通常結果に含めない。
  0件なら「この商品名で自由追加」で既存フォームへ移り、30文字/URL budgetなどの既存制限を適用する。
- verified、または条件確認不要のinCartは元の位置で購入済み1行表示。
  詳細buttonから条件・写真・質問・未購入へ戻す操作を開く。購入確認、5秒Undo、filter、checkout集計は従来どおり。
  pending/notBuying/相談未解決/旧inCartの未確認条件/v5未確認変更はコンパクト化しない。
- 「質問・買わない」の4定型で編集可能なnote-only下書きを作る。
  既存の `other + note` とmessage builderを共用し、新しい保存形式は作らない。
  入力済みnoteの置換には明示確認。選択だけでは送信/購入状態変更しない。
  商品・数量・条件と全文は「共有する相談文を確認」でも確認できる。
  既存の状況付き相談でもnoteに質問があるときは末尾の別質問を付けない。

## 自動検証

既存の全suiteに加えて検索比較、数量/条件保持、家庭用/hidden、IMEイベント列、
自由追加prefill/上限/フォーカス、写真保持、コンパクト適格性、表示遷移/focus/Undo、
v5未確認変更、4定型/置換確認/編集/cancel/保存復元/質問重複の回帰を追加。

- `npm ci`: 成功。Windows sandbox内の初回取得はnpmの終了処理失敗。
  固定lockfileのまま許可された環境で再実行して成功。既存依存のaudit警告15件（moderate5/high10）は本変更で更新しない。
- `npm test` / `npm run test:coverage`: 全suite成功。最終件数/coverageとCI/exact SHAはDraft PR本文に記録。
- `npm run test:worker`: 199 pass。
- `npm run check:worker-bundle` / `npm run build` / `git diff --check`: 成功。
- 既存PR CIの追加checksもローカル成功:
  `photo-runtime-check.mjs` 22ケース、`photo-staging-runtime-check.mjs` 1/2/3枚POST/GETとasset認証、
  本番version/stagingのbundle dry-run（upload/deployなし）。
- 公開URL v1〜v4、写真ON/OFF、v5 ON/OFF、相談/Undo/IMEの既存suiteを含む。
  Worker/codec/storage/商品master/依存/lockfile/workflowは変更していない。

## ブラウザ確認（2026-10-24、ローカルIAB）

専用localhost origin、架空の依頼内容だけを使用。写真/v5/手書き/manual-validationをOFFで起動。
通常画面で検索→牛乳2本/条件入力→ヨーグルト1個選択→共有確認を実施。
通常のOS共有画面を開く操作まで行い、外部へのLINE送信は行っていない。

続きはローカル専用の共有fixtureで、実際のCreateRequestPage/ShoppingListPageを使用。
fixtureは共有内容生成成功とAbortErrorを返すだけで、LINE/外部APIへ送信しない。
fixtureの一時ファイルはignore済み `.wrangler/ease-ui/` のみ、アプリbundle/PRには含めない。

確認したE2E:

1. 商品検索、数量2、条件入力、別検索でも選択件数維持。
2. 固定v3共有文とURL生成、同じ生成内容で購入画面を表示。
3. 数量と条件を各checkboxで確認するまで購入確定できない。
4. 購入済みをコンパクト表示、Enterで詳細展開、未購入へ戻す→5秒以内Undoで復元。
5. 未購入の別商品で定型相談、追記、別定型を選んでも確認なしでは追記を消さない。
6. queue→bulk共有cancelで内容保持→再試行、個別共有も確認。
7. 相談共有だけでnotBuyingにならない。購入後でも未解決相談は展開表示を維持。
8. 相談解決→コンパクト、会計前チェック→終了→結果共有文生成（購入2/買えない0）。
9. 320/390/430pxの相談dialog・コンパクト/checkoutで横overflowなし。
10. キーボードで展開、購入/reset後のvisible controlへのfocus復帰を確認。

画像: 作業workspaceの `shopping-ease-evidence-20261024/compact-checkout.png`（合成入力、URL/写真なし）。
実スマホ、OSの日本語IME、スクリーンリーダーの読み上げ、実LINE送信は未確認。
IMEは合成composition/inputイベントの自動テスト、アクセシビリティはARIA/hidden/focus/keyboardを確認した範囲。
写真/v5 ONの変更回帰はcomponent/unitとworkerdで確認し、今回新たな本番E2Eはしていない。

## 実機の短い追加確認と公開

Draft PRを維持し、exact base/headの独立read-only CodexレビューとCI結果はPR本文に記録する。
今回の依頼はReady化/merge/Production承認ではない。
公開判断時に人間がAndroid Chrome/iPhone Safariで検索のIME入力→数量/条件→共有、
購入済み詳細/reset/Undo、定型の追記/cancel/再編集/LINE送信を確認できる。
写真ONなら検索前後でpreviewと共有写真を、v5 ONなら未確認変更が縮小されないことも確認する。
実機未確認を成功扱いにしない。iPhoneがない場合はその範囲を残す。

Rollbackは今回のfrontend差分をrevertするPR。保存形式/API/migrationの変更なし、data rollback不要。
本番・Cloudflare・Secret・Variables・migrationへの操作は今回一切行わない。
