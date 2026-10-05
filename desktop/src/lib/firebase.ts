import { getApp, getApps, initializeApp, type FirebaseOptions } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { enableIndexedDbPersistence, getFirestore } from 'firebase/firestore'

/**
 * These are Web SDK identifiers, not secrets. They must still be created from a
 * Web app registered in the same Firebase project used by the Android app.
 */
const firebaseConfig: FirebaseOptions = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

const requiredConfigKeys: Array<keyof FirebaseOptions> = ['apiKey', 'authDomain', 'projectId', 'appId']

export const isFirebaseConfigured = requiredConfigKeys.every((key) => Boolean(firebaseConfig[key]))

/** A local-only, unauthenticated UI walkthrough. It never reads or writes Firestore. */
export const isDesktopPreviewMode = import.meta.env.VITE_DESKTOP_PREVIEW_MODE === 'true'

const firebaseApp = isFirebaseConfigured ? (getApps().length ? getApp() : initializeApp(firebaseConfig)) : null

export const firebaseAuth = firebaseApp ? getAuth(firebaseApp) : null
export const firestoreDb = firebaseApp ? getFirestore(firebaseApp) : null

/**
 * Electron uses the Firebase Web SDK, whose default cache is memory-only. Start
 * IndexedDB persistence before React mounts any listeners so cached reads and
 * ordinary non-transactional writes survive a temporary network outage.
 *
 * A second renderer/tab or a platform without IndexedDB may reject this setup.
 * That is deliberately non-fatal: Firestore continues with its memory cache and
 * the billing UI still refuses stale stock transactions while offline. Preview
 * Mode and unit tests are intentionally local-only and do not start persistence.
 */
const shouldEnableFirestorePersistence = Boolean(firestoreDb) && !isDesktopPreviewMode && import.meta.env.MODE !== 'test'

export const firestorePersistenceReady: Promise<void> = shouldEnableFirestorePersistence && firestoreDb
  ? Promise.resolve().then(() => enableIndexedDbPersistence(firestoreDb)).catch((error: unknown) => {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
    const detail = code === 'failed-precondition'
      ? 'another renderer is already using the Firestore persistence lock'
      : code === 'unimplemented'
        ? 'IndexedDB persistence is not supported in this renderer'
        : 'Firestore could not enable IndexedDB persistence'
    console.warn(`[Firestore] Offline persistence unavailable: ${detail}. Continuing without persistent cache.`, error)
  })
  : Promise.resolve()

export function requireFirestore() {
  if (!firestoreDb) {
    throw new Error('Firebase is not configured. Add the VITE_FIREBASE_* values to desktop/.env.')
  }
  return firestoreDb
}
