import { useEffect, useState } from 'react'
import type { DesktopPage } from './components/DesktopSidebar'
import { useAuth } from './context/AuthContext'
import { useBusiness } from './context/BusinessContext'
import { isDesktopPreviewMode, isFirebaseConfigured } from './lib/firebase'
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
import { PurchaseInvoiceScreen } from './screens/PurchaseInvoiceScreen'
import { InvoiceListScreen } from './screens/InvoiceListScreen'
import { InvoiceDetailScreen } from './screens/InvoiceDetailScreen'
import type { InvoiceKind } from './types/invoice'
import { EmptyBusinessesScreen } from './screens/EmptyBusinessesScreen'
import { FirebaseSetupScreen } from './screens/FirebaseSetupScreen'
import { LoadingScreen } from './screens/LoadingScreen'
import { SignInScreen } from './screens/SignInScreen'
import { PreviewModeScreen } from './screens/PreviewModeScreen'

type AppRoute = DesktopPage | 'partyDetail' | 'invoiceDetail'

export default function App() {
  const { user, status } = useAuth()
  const { businesses, selectedBusinessId, status: businessStatus } = useBusiness()
  const [page, setPage] = useState<AppRoute>('overview')
  const [selectedPartyId, setSelectedPartyId] = useState<string | null>(null)
  const [selectedInvoice, setSelectedInvoice] = useState<{ kind: InvoiceKind; id: string } | null>(null)

  // A setting belongs to a business. Never carry a page from one showroom into another.
  useEffect(() => {
    setPage('overview')
    setSelectedPartyId(null)
    setSelectedInvoice(null)
  }, [selectedBusinessId])

  // Preview Mode is deliberately isolated from live Firebase access so the UI can
  // be reviewed while Google authentication is temporarily unavailable.
  if (isDesktopPreviewMode) return <PreviewModeScreen />

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
  const openInvoice = (kind: InvoiceKind, id: string) => {
    setSelectedInvoice({ kind, id })
    setPage('invoiceDetail')
  }

  if (page === 'companies') return <CompaniesScreen onNavigate={navigate} />
  if (page === 'categories') return <CategoriesScreen onNavigate={navigate} />
  if (page === 'products') return <ProductsScreen onNavigate={navigate} />
  if (page === 'salesInvoices') return <InvoiceListScreen kind="SALE" onNavigate={navigate} onOpenInvoice={openInvoice} />
  if (page === 'purchaseInvoices') return <InvoiceListScreen kind="PURCHASE" onNavigate={navigate} onOpenInvoice={openInvoice} />
  if (page === 'salesInvoice') return <SalesInvoiceScreen onNavigate={navigate} onOpenInvoice={(id) => openInvoice('SALE', id)} />
  if (page === 'purchaseInvoice') return <PurchaseInvoiceScreen onNavigate={navigate} onOpenInvoice={(id) => openInvoice('PURCHASE', id)} />
  if (page === 'parties') {
    return <PartiesScreen onNavigate={navigate} onOpenParty={(partyId) => { setSelectedPartyId(partyId); setPage('partyDetail') }} />
  }
  if (page === 'partyDetail' && selectedPartyId) {
    return <PartyDetailScreen partyId={selectedPartyId} onNavigate={navigate} onBack={() => setPage('parties')} />
  }
  if (page === 'invoiceDetail' && selectedInvoice) {
    return <InvoiceDetailScreen
      kind={selectedInvoice.kind}
      invoiceId={selectedInvoice.id}
      onNavigate={navigate}
      onBack={() => { setSelectedInvoice(null); setPage(selectedInvoice.kind === 'SALE' ? 'salesInvoices' : 'purchaseInvoices') }}
    />
  }
  if (page === 'documentSettings') return <DocumentSettingsScreen onNavigate={navigate} />

  return <DashboardShell onNavigate={navigate} />
}
