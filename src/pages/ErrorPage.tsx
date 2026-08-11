type ErrorPageProps = {
  title: string
  description: string
  onBackHome: () => void
}

export function ErrorPage({ title, description, onBackHome }: ErrorPageProps) {
  return (
    <main className="page narrow-page">
      <section className="info-card error-card">
        <h1>{title}</h1>
        <p>{description}</p>
        <button type="button" className="primary-button" onClick={onBackHome}>
          ホームへ戻る
        </button>
      </section>
    </main>
  )
}
