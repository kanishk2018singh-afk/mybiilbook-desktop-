import { BrandMark } from '../components/BrandMark'
import { useAuth } from '../context/AuthContext'
import { useBusiness } from '../context/BusinessContext'

export function BusinessErrorScreen() {
  const { signOut } = useAuth()
  const { error } = useBusiness()

  return (
    <main className="auth-layout">
      <section className="auth-card empty-card">
        <BrandMark />
        <div className="empty-icon error-icon" aria-hidden="true">!</div>
        <h1>Businesses could not be loaded</h1>
        <p className="lead">{error ?? 'Check your Firestore rules and network connection, then try again.'}</p>
        <button className="secondary-button" type="button" onClick={() => void signOut()}>Sign out</button>
      </section>
    </main>
  )
}
