import { useSyncStatus } from '../context/SyncStatusContext'
import { BrandMark } from './BrandMark'

export type DesktopPage = 'overview' | 'companies' | 'categories' | 'products' | 'stockAdjustment' | 'stockLedger' | 'parties' | 'quotations' | 'quotation' | 'salesInvoices' | 'purchaseInvoices' | 'salesInvoice' | 'purchaseInvoice' | 'creditNote' | 'debitNote' | 'payments' | 'recordPayment' | 'expenses' | 'expenseCategories' | 'documentSettings'

interface DesktopSidebarProps {
  activePage: DesktopPage
  onNavigate: (page: DesktopPage) => void
}

const navigation: Array<{ page: DesktopPage; icon: string; label: string }> = [
  { page: 'overview', icon: '▦', label: 'Overview' },
  { page: 'companies', icon: '◈', label: 'Companies' },
  { page: 'categories', icon: '⌘', label: 'Categories' },
  { page: 'products', icon: '▤', label: 'Products' },
  { page: 'stockAdjustment', icon: '±', label: 'Stock adjustment' },
  { page: 'stockLedger', icon: '≡', label: 'Stock ledger' },
  { page: 'parties', icon: '◎', label: 'Parties' },
  { page: 'quotations', icon: '◌', label: 'Quotations' },
  { page: 'salesInvoices', icon: '↗', label: 'Sales invoices' },
  { page: 'creditNote', icon: '↩', label: 'Credit notes' },
  { page: 'purchaseInvoices', icon: '↙', label: 'Purchase invoices' },
  { page: 'debitNote', icon: '↪', label: 'Debit notes' },
  { page: 'payments', icon: '₹', label: 'Payments' },
  { page: 'expenses', icon: '◒', label: 'Expenses' },
  { page: 'documentSettings', icon: '⚙', label: 'Settings' },
]

const STOCK_ACTION_PAGES = new Set<DesktopPage>(['stockAdjustment', 'creditNote', 'debitNote'])

export function DesktopSidebar({ activePage, onNavigate }: DesktopSidebarProps) {
  const { connectionState, isOnline, pendingChanges } = useSyncStatus()
  const syncCopy = pendingChanges > 0
    ? `${pendingChanges} changes pending sync`
    : connectionState === 'online'
      ? 'Firestore live connection ready'
      : connectionState === 'checking'
        ? 'Checking Firestore connection…'
        : 'Firestore offline — billing paused'

  return (
    <aside className="sidebar">
      <BrandMark />
      <nav aria-label="Desktop navigation">
        {navigation.map((item) => {
          const isBlockedStockAction = !isOnline && STOCK_ACTION_PAGES.has(item.page)
          return (
            <button
              className={`nav-item ${activePage === item.page ? 'active' : ''}`}
              type="button"
              key={item.page}
              disabled={isBlockedStockAction}
              title={isBlockedStockAction ? 'Billing requires internet connection to prevent stock conflicts. Please reconnect.' : undefined}
              onClick={() => onNavigate(item.page)}
            >
              <span>{item.icon}</span> {item.label}
            </button>
          )
        })}
        <button className="nav-item" type="button" disabled><span>▤</span> Reports</button>
      </nav>
      <div className="sidebar-foot">
        <span className="live-dot" /> {syncCopy}
      </div>
    </aside>
  )
}
