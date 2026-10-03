import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  browserLocalPersistence,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth'
import { firebaseAuth } from '../lib/firebase'

type AuthStatus = 'loading' | 'signedOut' | 'signedIn' | 'configurationError'

interface AuthContextValue {
  user: User | null
  status: AuthStatus
  error: string | null
  isSigningIn: boolean
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

function authErrorMessage(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
  const messages: Record<string, string> = {
    'auth/popup-closed-by-user': 'Google sign-in was cancelled.',
    'auth/popup-blocked': 'The Google sign-in window was blocked. Please try again.',
    'auth/operation-not-allowed': 'Google Sign-In is not enabled for this Firebase project.',
    'auth/unauthorized-domain': 'This desktop origin is not authorized in Firebase Authentication.',
    'auth/network-request-failed': 'Network connection failed. Check your internet connection and try again.',
  }
  if (messages[code]) return messages[code]
  return error instanceof Error ? error.message : 'Unable to sign in with Google. Please try again.'
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [status, setStatus] = useState<AuthStatus>(firebaseAuth ? 'loading' : 'configurationError')
  const [error, setError] = useState<string | null>(null)
  const [isSigningIn, setIsSigningIn] = useState(false)

  useEffect(() => {
    if (!firebaseAuth) return

    let active = true
    void setPersistence(firebaseAuth, browserLocalPersistence).catch((persistenceError: unknown) => {
      if (active) setError(`Session persistence is unavailable: ${authErrorMessage(persistenceError)}`)
    })

    const unsubscribe = onAuthStateChanged(firebaseAuth, (nextUser) => {
      if (!active) return
      setUser(nextUser)
      setStatus(nextUser ? 'signedIn' : 'signedOut')
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const signInWithGoogle = useCallback(async () => {
    if (!firebaseAuth) return

    setError(null)
    setIsSigningIn(true)
    const provider = new GoogleAuthProvider()
    provider.setCustomParameters({ prompt: 'select_account' })

    try {
      await signInWithPopup(firebaseAuth, provider)
    } catch (signInError) {
      setError(authErrorMessage(signInError))
    } finally {
      setIsSigningIn(false)
    }
  }, [])

  const signOut = useCallback(async () => {
    if (!firebaseAuth) return
    setError(null)
    await firebaseSignOut(firebaseAuth)
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ user, status, error, isSigningIn, signInWithGoogle, signOut }),
    [error, isSigningIn, signInWithGoogle, signOut, status, user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}
