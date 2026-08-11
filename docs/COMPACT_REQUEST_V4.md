# 写真付き固定依頼v4 codec

Status: implemented, production disabled

v4は、既存の固定依頼v3へ最大3件の参考写真token参照だけを追加する形式です。`VITE_PRODUCT_PHOTOS_ENABLED`が明示的に`true`で、写真を1枚以上付けた依頼だけがv4になります。写真なし依頼は引き続きv3を生成します。通常公開では写真機能をOFFのまま維持します。

## 圧縮前の形式

```ts
type CompactRequestV4 = [
  4,
  requestKey: string,
  title: string,
  items: Array<V3BaseItem | V3SnapshotItem>,
  photoRefs: Array<[
    itemIndex: number,
    photoToken: string,
  ]>,
]
```

- `items`はv3と同じtupleを同じ順序で使用する。既存の商品番号表、商品ID、数量code、snapshot形式を変更しない。
- `photoRefs`は1〜3件。`itemIndex`は`items`内の位置で、同じindexを重複させない。
- 写真tokenは`p1_`と、ブラウザで生成した24 byte（192 bit）のCSPRNGをBase64URL化した32文字からなる。
- 同じtokenを複数商品へ使わない。
- `requestId`は`v4-${requestKey}`、item IDは`${requestId}-${itemIndex}`で、同じURLから同じIDを復元する。
- JSON配列はv1〜v3と同じ`lz-string`方式で圧縮し、`#/l/<圧縮データ>`へ入れる。

v4生成前にtokenを確定し、`openExternalBrowser=1`を含む最終配送URLが2,200文字以下であることを既存のURL予算処理で検査します。v1、v2、v3のencoder、decoder、固定fixture、checksumは変更しません。

## 生成と共有の順序

1. 既存の商品・数量・条件上限を検証する。
2. 全写真のブラウザ前処理が完了していることを確認する。
3. v4 URLを仮生成して2,200文字上限を確認する。
4. 写真用actionでTurnstile tokenを1回取得する。
5. 最大3枚を同じbatchで保存する。
6. 全写真の保存成功後だけv4 URLを確定し、Web Share APIを開く。

保存失敗時は写真Blobとプレビューを端末メモリ内に保持し、「再試行」または「写真を外してv3で共有」を利用者が明示的に選べます。写真を黙って外したり、保存完了前に共有画面を開いたりしません。写真を外す選択ではObject URLを解放し、同じ商品本文をv3として共有します。

## 復号の安全性

v4本体が妥当なら商品本文を先にv3 decoderで復元します。写真参照が範囲外、不正token、重複、件数超過の場合、その写真参照だけを無視します。写真参照の破損を理由に商品リスト全体を失いません。

購入画面は商品名、数量、条件、購入操作を先に表示し、写真を非同期取得します。写真は`loading`、`loaded`、`expired`、`failed`、`invalid`を独立表示し、写真API停止や保存期限切れでも、かご投入、相談、Undo、会計前確認、結果共有を継続できます。

## 非Scope

- 写真の本番公開、Worker deploy、Durable Objects migration適用
- 1商品複数枚、1依頼4枚以上
- HEIC/HEIF変換ライブラリ
- 写真の編集、長期保存、一覧検索
- Gemini、手書き解析、商品認識との連携
- 更新可能依頼v5
