import { BrandMark } from '../components/BrandMark'

export function FirebaseSetupScreen() {
  return (
    <main className="auth-layout">
      <section className="auth-card setup-card">
        <BrandMark />
        <div className="eyebrow">CONFIGURATION REQUIRED</div>
        <h1>Connect the Firebase project.</h1>
        <p className="lead">
          Copy <code>.env.example</code> to <code>.env</code>, then paste the Web app configuration from the same Firebase project used by your Android app.
        </p>
        <ol>
          <li>Firebase Console → Project settings → Your apps → Web app</li>
          <li>Copy the Web SDK config into <code>desktop/.env</code></li>
          <li>Enable Google in Authentication → Sign-in method</li>
          <li>Add <code>localhost</code> and <code>127.0.0.1</code> to Authorized domains</li>
        </ol>
      </section>
    </main>
  )
}
