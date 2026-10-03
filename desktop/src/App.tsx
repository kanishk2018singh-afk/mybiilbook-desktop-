import { useEffect, useState } from 'react'
import type { DesktopPage } from './components/DesktopSidebar'
import { useAuth } from './context/AuthContext'
import { useBusiness } from './context/BusinessContext'
import { isFirebaseConfigured } from './lib/firebase'
import { BusinessErrorScreen } from './screens/BusinessErrorScreen'
import { BusinessPickerScreen } from './screens/BusinessPickerScreen'
import { DashboardShell } from './screens/DashboardShell'
import { CategoriesScreen } from './screens/CategoriesScreen'
import { CompaniesScreen } from './screens/CompaniesScreen'
import { DocumentSettingsScreen } from './screens/DocumentSettingsScreen'
import { ProductsScreen } from './screens/ProductsScreen'
import { EmptyBusinessesScreen } from './screens/EmptyBusinessesScreen'
import { FirebaseSetupScreen } from './screens/FirebaseSetupScreen'
import { LoadingScreen } from './screens/LoadingScreen'
import { SignInScreen } from './screens/SignInScreen'

export default function App() {
  const { user, status } = useAuth()
  const { businesses, selectedBusinessId, status: businessStatus } = useBusiness()
  const [page, setPage] = useState<DesktopPage>('overview')

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

  if (page === 'companies') return <CompaniesScreen onNavigate={setPage} />
  if (page === 'categories') return <CategoriesScreen onNavigate={setPage} />
  if (page === 'products') return <ProductsScreen onNavigate={setPage} />
  if (page === 'documentSettings') return <DocumentSettingsScreen onNavigate={setPage} />

  return <DashboardShell onNavigate={setPage} />
}
