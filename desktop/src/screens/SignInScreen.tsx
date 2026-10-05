import { BrandMark } from '../components/BrandMark'
import { GoogleIcon } from '../components/GoogleIcon'
import { useAuth } from '../context/AuthContext'

export function SignInScreen() {
  const { signInWithGoogle, signInWithGoogleRedirect, isSigningIn, error } = useAuth()
  const popupWasBlocked = error?.startsWith('The Google sign-in window was blocked.') ?? false
  const isDesktopApp = typeof window !== 'undefined' && Boolean(window.desktop)

  return (
    <main className="auth-layout">
      <section className="auth-card">
        <BrandMark />
        <div className="eyebrow">SHOWROOM OPERATIONS</div>
        <h1>Your showroom, at a glance.</h1>
        <p className="lead">
          Sign in with the same Google account you use in the Android app to view your live business data.
        </p>

        <button className="google-button" type="button" onClick={() => void signInWithGoogle()} disabled={isSigningIn}>
          <GoogleIcon />
          <span>{isSigningIn ? 'Opening Google Sign-In…' : 'Continue with Google'}</span>
        </button>

        {error ? <p className="inline-error" role="alert">{error}</p> : null}

        {popupWasBlocked && !isDesktopApp ? (
          <div className="auth-redirect-fallback">
            <p>
              This embedded preview can block pop-up windows. Redirect sign-in opens Google in the current browser instead.
            </p>
            <button
              className="secondary-button auth-redirect-button"
              type="button"
              onClick={() => void signInWithGoogleRedirect()}
              disabled={isSigningIn}
            >
              Continue with Google using redirect
            </button>
          </div>
        ) : null}

        <p className="security-note">
          <span aria-hidden="true">⌁</span>
          This desktop companion is read-only. Billing and inventory changes continue in the Android app.
        </p>
      </section>
    </main>
  )
}
