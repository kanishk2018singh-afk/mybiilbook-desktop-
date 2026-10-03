import { BrandMark } from '../components/BrandMark'
import { useAuth } from '../context/AuthContext'

export function EmptyBusinessesScreen() {
  const { signOut } = useAuth()

  return (
    <main className="auth-layout">
      <section className="auth-card empty-card">
        <BrandMark />
        <div className="empty-icon" aria-hidden="true">⌂</div>
        <h1>No businesses found</h1>
        <p className="lead">
          This Google account has no documents under <code>users/{'{uid}'}/businesses</code> yet.
        </p>
        <button className="secondary-button" type="button" onClick={() => void signOut()}>Use another account</button>
      </section>
    </main>
  )
}
