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
import { StockAdjustmentScreen } from './screens/StockAdjustmentScreen'
import { StockLedgerScreen } from './screens/StockLedgerScreen'
import { PartiesScreen } from './screens/PartiesScreen'
import { PartyDetailScreen } from './screens/PartyDetailScreen'
import { SalesInvoiceScreen } from './screens/SalesInvoiceScreen'
import { PurchaseInvoiceScreen } from './screens/PurchaseInvoiceScreen'
import { InvoiceListScreen } from './screens/InvoiceListScreen'
import { InvoiceDetailScreen } from './screens/InvoiceDetailScreen'
import { QuotationScreen } from './screens/QuotationScreen'
import { QuotationListScreen } from './screens/QuotationListScreen'
import { QuotationDetailScreen } from './screens/QuotationDetailScreen'
import { ReturnNoteScreen } from './screens/ReturnNoteScreen'
import { PaymentsListScreen } from './screens/PaymentsListScreen'
import { RecordPaymentScreen } from './screens/RecordPaymentScreen'
import { ExpensesScreen } from './screens/ExpensesScreen'
import { ExpenseCategoriesScreen } from './screens/ExpenseCategoriesScreen'
import type { InvoiceKind } from './types/invoice'
import type { QuotationConversionDraft, QuotationDetail } from './types/quotation'
import { quotationToSalesInvoiceDraft } from './repositories/quotationsRepository'
import { EmptyBusinessesScreen } from './screens/EmptyBusinessesScreen'
import { FirebaseSetupScreen } from './screens/FirebaseSetupScreen'
import { LoadingScreen } from './screens/LoadingScreen'
import { SignInScreen } from './screens/SignInScreen'
import { PreviewModeScreen } from './screens/PreviewModeScreen'

type AppRoute = DesktopPage | 'partyDetail' | 'invoiceDetail' | 'quotationDetail'

export default function App() {
  const { user, status } = useAuth()
  const { businesses, selectedBusinessId, status: businessStatus } = useBusiness()
  const [page, setPage] = useState<AppRoute>('overview')
  const [selectedPartyId, setSelectedPartyId] = useState<string | null>(null)
  const [selectedInvoice, setSelectedInvoice] = useState<{ kind: InvoiceKind; id: string } | null>(null)
  const [selectedQuotationId, setSelectedQuotationId] = useState<string | null>(null)
  const [quotationConversion, setQuotationConversion] = useState<QuotationConversionDraft | null>(null)
  const [returnNoteSource, setReturnNoteSource] = useState<{ kind: InvoiceKind; invoiceId: string } | null>(null)

  // A setting belongs to a business. Never carry a page from one showroom into another.
  useEffect(() => {
    setPage('overview')
    setSelectedPartyId(null)
    setSelectedInvoice(null)
    setSelectedQuotationId(null)
    setQuotationConversion(null)
    setReturnNoteSource(null)
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

  const navigate = (target: DesktopPage) => {
    if (target !== 'salesInvoice') setQuotationConversion(null)
    if (target !== 'creditNote' && target !== 'debitNote') setReturnNoteSource(null)
    setPage(target)
  }
  const openInvoice = (kind: InvoiceKind, id: string) => {
    setSelectedInvoice({ kind, id })
    setPage('invoiceDetail')
  }

  if (page === 'companies') return <CompaniesScreen onNavigate={navigate} />
  if (page === 'categories') return <CategoriesScreen onNavigate={navigate} />
  if (page === 'products') return <ProductsScreen onNavigate={navigate} />
  if (page === 'stockAdjustment') return <StockAdjustmentScreen onNavigate={navigate} />
  if (page === 'stockLedger') return <StockLedgerScreen onNavigate={navigate} />
  if (page === 'salesInvoices') return <InvoiceListScreen kind="SALE" onNavigate={navigate} onOpenInvoice={openInvoice} />
  if (page === 'purchaseInvoices') return <InvoiceListScreen kind="PURCHASE" onNavigate={navigate} onOpenInvoice={openInvoice} />
  if (page === 'quotation') return <QuotationScreen onNavigate={navigate} onOpenQuotation={(id) => { setSelectedQuotationId(id); setPage('quotationDetail') }} />
  if (page === 'quotations') return <QuotationListScreen onNavigate={navigate} onOpenQuotation={(id) => { setSelectedQuotationId(id); setPage('quotationDetail') }} />
  if (page === 'creditNote') return <ReturnNoteScreen noteKind="CREDIT" initialSourceInvoiceId={returnNoteSource?.kind === 'SALE' ? returnNoteSource.invoiceId : null} onNavigate={navigate} onOpenInvoice={openInvoice} />
  if (page === 'debitNote') return <ReturnNoteScreen noteKind="DEBIT" initialSourceInvoiceId={returnNoteSource?.kind === 'PURCHASE' ? returnNoteSource.invoiceId : null} onNavigate={navigate} onOpenInvoice={openInvoice} />
  if (page === 'salesInvoice') return <SalesInvoiceScreen
    onNavigate={navigate}
    onOpenInvoice={(id) => openInvoice('SALE', id)}
    quotationConversion={quotationConversion}
    onQuotationConverted={() => setQuotationConversion(null)}
    onCancelQuotationConversion={() => setQuotationConversion(null)}
  />
  if (page === 'purchaseInvoice') return <PurchaseInvoiceScreen onNavigate={navigate} onOpenInvoice={(id) => openInvoice('PURCHASE', id)} />
  if (page === 'parties') {
    return <PartiesScreen onNavigate={navigate} onOpenParty={(partyId) => { setSelectedPartyId(partyId); setPage('partyDetail') }} />
  }
  if (page === 'partyDetail' && selectedPartyId) {
    return <PartyDetailScreen partyId={selectedPartyId} onNavigate={navigate} onBack={() => setPage('parties')} />
  }
  if (page === 'quotationDetail' && selectedQuotationId) {
    return <QuotationDetailScreen
      quotationId={selectedQuotationId}
      onNavigate={navigate}
      onBack={() => { setSelectedQuotationId(null); setPage('quotations') }}
      onConvertToSalesInvoice={(quotation: QuotationDetail) => {
        setQuotationConversion(quotationToSalesInvoiceDraft(quotation))
        setPage('salesInvoice')
      }}
      onOpenInvoice={(invoiceId) => openInvoice('SALE', invoiceId)}
    />
  }
  if (page === 'invoiceDetail' && selectedInvoice) {
    return <InvoiceDetailScreen
      kind={selectedInvoice.kind}
      invoiceId={selectedInvoice.id}
      onNavigate={navigate}
      onBack={() => { setSelectedInvoice(null); setPage(selectedInvoice.kind === 'SALE' ? 'salesInvoices' : 'purchaseInvoices') }}
      onCreateReturnNote={(kind, invoiceId) => {
        setReturnNoteSource({ kind, invoiceId })
        setPage(kind === 'SALE' ? 'creditNote' : 'debitNote')
      }}
    />
  }
  if (page === 'payments') return <PaymentsListScreen onNavigate={navigate} />
  if (page === 'recordPayment') return <RecordPaymentScreen onNavigate={navigate} />
  if (page === 'expenses') return <ExpensesScreen onNavigate={navigate} />
  if (page === 'expenseCategories') return <ExpenseCategoriesScreen onNavigate={navigate} />
  if (page === 'documentSettings') return <DocumentSettingsScreen onNavigate={navigate} />

  return <DashboardShell onNavigate={navigate} />
}
