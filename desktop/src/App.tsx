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
import { PartiesScreen } from './screens/PartiesScreen'
import { PartyDetailScreen } from './screens/PartyDetailScreen'
import { SalesInvoiceScreen } from './screens/SalesInvoiceScreen'
import { EmptyBusinessesScreen } from './screens/EmptyBusinessesScreen'
import { FirebaseSetupScreen } from './screens/FirebaseSetupScreen'
import { LoadingScreen } from './screens/LoadingScreen'
import { SignInScreen } from './screens/SignInScreen'

type AppRoute = DesktopPage | 'partyDetail'

export default function App() {
  const { user, status } = useAuth()
  const { businesses, selectedBusinessId, status: businessStatus } = useBusiness()
  const [page, setPage] = useState<AppRoute>('overview')
  const [selectedPartyId, setSelectedPartyId] = useState<string | null>(null)

  // A setting belongs to a business. Never carry a page from one showroom into another.
  useEffect(() => {
    setPage('overview')
    setSelectedPartyId(null)
  }, [selectedBusinessId])

  if (!isFirebaseConfigured || status === 'configurationError') return <FirebaseSetupScreen />
  if (status === 'loading') return <LoadingScreen />
  if (!user) return <SignInScreen />

  if (businessStatus === 'idle' || businessStatus === 'loading') {
    return <LoadingScreen label="Loading your showrooms…" />
  }
  if (businessStatus === 'error') return <BusinessErrorScreen />
  if (businesses.length === 0) return <EmptyBusinessesScreen />
  if (!selectedBusinessId) return <BusinessPickerScreen />

  const navigate = (target: DesktopPage) => setPage(target)

  if (page === 'companies') return <CompaniesScreen onNavigate={navigate} />
  if (page === 'categories') return <CategoriesScreen onNavigate={navigate} />
  if (page === 'products') return <ProductsScreen onNavigate={navigate} />
  if (page === 'salesInvoice') return <SalesInvoiceScreen onNavigate={navigate} />
  if (page === 'parties') {
    return <PartiesScreen onNavigate={navigate} onOpenParty={(partyId) => { setSelectedPartyId(partyId); setPage('partyDetail') }} />
  }
  if (page === 'partyDetail' && selectedPartyId) {
    return <PartyDetailScreen partyId={selectedPartyId} onNavigate={navigate} onBack={() => setPage('parties')} />
  }
  if (page === 'documentSettings') return <DocumentSettingsScreen onNavigate={navigate} />

  return <DashboardShell onNavigate={navigate} />
}
