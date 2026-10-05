import { BrandMark } from './BrandMark'

export type DesktopPage = 'overview' | 'companies' | 'categories' | 'products' | 'parties' | 'quotations' | 'quotation' | 'salesInvoices' | 'purchaseInvoices' | 'salesInvoice' | 'purchaseInvoice' | 'payments' | 'recordPayment' | 'documentSettings'

interface DesktopSidebarProps {
  activePage: DesktopPage
  onNavigate: (page: DesktopPage) => void
}

const navigation: Array<{ page: DesktopPage; icon: string; label: string }> = [
  { page: 'overview', icon: '▦', label: 'Overview' },
  { page: 'companies', icon: '◈', label: 'Companies' },
  { page: 'categories', icon: '⌘', label: 'Categories' },
  { page: 'products', icon: '▤', label: 'Products' },
  { page: 'parties', icon: '◎', label: 'Parties' },
  { page: 'quotations', icon: '◌', label: 'Quotations' },
  { page: 'salesInvoices', icon: '↗', label: 'Sales invoices' },
  { page: 'purchaseInvoices', icon: '↙', label: 'Purchase invoices' },
  { page: 'payments', icon: '₹', label: 'Payments' },
  { page: 'documentSettings', icon: '⚙', label: 'Settings' },
]

export function DesktopSidebar({ activePage, onNavigate }: DesktopSidebarProps) {
  return (
    <aside className="sidebar">
      <BrandMark />
      <nav aria-label="Desktop navigation">
        {navigation.map((item) => (
          <button
            className={`nav-item ${activePage === item.page ? 'active' : ''}`}
            type="button"
            key={item.page}
            onClick={() => onNavigate(item.page)}
          >
            <span>{item.icon}</span> {item.label}
          </button>
        ))}
        <button className="nav-item" type="button" disabled><span>□</span> Inventory</button>
        <button className="nav-item" type="button" disabled><span>▤</span> Reports</button>
      </nav>
      <div className="sidebar-foot">
        <span className="live-dot" /> Firestore live connection ready
      </div>
    </aside>
  )
}
