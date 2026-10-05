import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { AuthProvider } from './context/AuthContext'
import { BusinessProvider } from './context/BusinessContext'
import { SyncStatusProvider } from './context/SyncStatusContext'
import { SyncStatusBanner } from './components/SyncStatusBanner'
import { firestorePersistenceReady } from './lib/firebase'
import './index.css'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Could not find the React root element.')
}

// Persistence must settle before any provider can create a Firestore listener.
// Its guarded fallback still resolves, so an unavailable IndexedDB implementation
// never prevents the desktop app from starting.
void firestorePersistenceReady.then(() => {
  createRoot(rootElement).render(
    <StrictMode>
      <AuthProvider>
        <BusinessProvider>
          <SyncStatusProvider>
            <App />
            <SyncStatusBanner />
          </SyncStatusProvider>
        </BusinessProvider>
      </AuthProvider>
    </StrictMode>,
  )
})
