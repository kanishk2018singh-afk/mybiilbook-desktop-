import { useEffect, useState } from 'react'
import { useAuth } from './context/AuthContext'
import { useBusiness } from './context/BusinessContext'
import { isFirebaseConfigured } from './lib/firebase'
import { BusinessErrorScreen } from './screens/BusinessErrorScreen'
import { BusinessPickerScreen } from './screens/BusinessPickerScreen'
import { DashboardShell } from './screens/DashboardShell'
import { DocumentSettingsScreen } from './screens/DocumentSettingsScreen'
import { EmptyBusinessesScreen } from './screens/EmptyBusinessesScreen'
import { FirebaseSetupScreen } from './screens/FirebaseSetupScreen'
import { LoadingScreen } from './screens/LoadingScreen'
import { SignInScreen } from './screens/SignInScreen'

type AppPage = 'overview' | 'documentSettings'

export default function App() {
  const { user, status } = useAuth()
  const { businesses, selectedBusinessId, status: businessStatus } = useBusiness()
  const [page, setPage] = useState<AppPage>('overview')

  // A setting belongs to a business. Never carry a page from one showroom into another.
  useEffect(() => setPage('overview'), [selectedBusinessId])

  if (!isFirebaseConfigured || status === 'configurationError') return <FirebaseSetupScreen />
  if (status === 'loading') return <LoadingScreen />
  if (!user) return <SignInScreen />

  if (businessStatus === 'idle' || businessStatus === 'loading') {
    return <LoadingScreen label="Loading your showrooms…" />
  }
  if (businessStatus === 'error') return <BusinessErrorScreen />
  if (businesses.length === 0) return <EmptyBusinessesScreen />
  if (!selectedBusinessId) return <BusinessPickerScreen />

  if (page === 'documentSettings') {
    return <DocumentSettingsScreen onBack={() => setPage('overview')} />
  }

  return <DashboardShell onOpenSettings={() => setPage('documentSettings')} />
}
