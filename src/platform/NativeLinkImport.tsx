import { loadFixedRequest, rememberFixedRequest } from './fixedRequestResume'
import { useEffect, useState } from 'react'
import { INVALID_LINK_NOTICE, MAX_INCOMING_LINK_CHARS, parseIncomingLink } from './incomingLink'

export function NativeLinkImport() {
  const [input, setInput] = useState('')
  const [notice, setNotice] = useState('')
  useEffect(() => {
    const showFailure = () => setNotice(INVALID_LINK_NOTICE)
    window.addEventListener('native-link-error', showFailure)
    return () => window.removeEventListener('native-link-error', showFailure)
  }, [])
  const open = () => {
    const hash = parseIncomingLink(input)
    if (!hash) { setNotice(INVALID_LINK_NOTICE); return }
    setInput('')
    setNotice('リンクを開きました。商品リストの復旧は内容を確認してから確定してください。')
    rememberFixedRequest(hash)
    window.location.hash = hash
  }
  return (
    <aside className="native-link-import" aria-label="アプリでリンクを開く">
      <details>
        <summary>リンクを貼り付けて開く</summary>
        <form onSubmit={event => { event.preventDefault(); open() }}>
          <label htmlFor="native-link-input">共有URL・商品リスト復旧リンク</label>
          <textarea id="native-link-input" value={input} maxLength={MAX_INCOMING_LINK_CHARS}
            rows={3} autoCapitalize="none" autoCorrect="off" spellCheck={false}
            onChange={event => setInput(event.target.value)} />
          <button className="secondary-button" type="submit">アプリで開く</button>
          <p>ブラウザのデータは自動で移りません。商品リストは復旧リンクかJSONで取り込み、購入進捗はアプリ内で保存されます。</p>
        </form>
      </details>
      {loadFixedRequest() && <button type="button" className="ghost-button"
        onClick={() => { const hash = loadFixedRequest(); if (hash) window.location.hash = hash }}>
        前回の買い物を再開
      </button>}
      {notice && <p role="status" aria-live="polite">{notice}</p>}
    </aside>
  )
}
