import { BrandMark } from '../components/BrandMark'

export function LoadingScreen({ label = 'Opening your desktop companion…' }: { label?: string }) {
  return (
    <main className="auth-layout">
      <section className="auth-card loading-card" aria-live="polite">
        <BrandMark />
        <div className="loading-orbit" aria-hidden="true" />
        <h1>{label}</h1>
        <p>Checking your secure Firebase session.</p>
      </section>
    </main>
  )
}
