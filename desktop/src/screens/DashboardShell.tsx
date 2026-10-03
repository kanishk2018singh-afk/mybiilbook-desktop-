import { DesktopSidebar, type DesktopPage } from '../components/DesktopSidebar'
import { useAuth } from '../context/AuthContext'
import { useBusiness } from '../context/BusinessContext'
import { getBusinessPath } from '../lib/firestorePaths'

const foundationModules = [
  ['Sales', 'Live invoices and collections', '↗'],
  ['Stock', 'Inventory and low-stock alerts', '□'],
  ['Parties', 'Receivables and payables', '◎'],
  ['Reports', 'Showroom performance', '▤'],
]

export function DashboardShell({ onNavigate }: { onNavigate: (page: DesktopPage) => void }) {
  const { user, signOut } = useAuth()
  const { selectedBusiness, selectedBusinessId, clearBusinessSelection } = useBusiness()

  if (!user || !selectedBusiness || !selectedBusinessId) return null

  // All upcoming repository queries are scoped to both uid and businessId.
  const salesInvoicesPath = getBusinessPath(user.uid, selectedBusinessId, 'salesInvoices')

  return (
    <main className="desktop-layout">
      <DesktopSidebar activePage="overview" onNavigate={onNavigate} />

      <section className="dashboard-content">
        <header className="dashboard-header">
          <div>
            <p className="breadcrumb">SHOWROOM / OVERVIEW</p>
            <h1>{selectedBusiness.name}</h1>
            <p>{selectedBusiness.address ?? 'Live operational view for your selected showroom'}</p>
          </div>
          <div className="header-actions">
            <button className="outline-button" type="button" onClick={clearBusinessSelection}>Switch business</button>
            <button className="user-button" type="button" onClick={() => void signOut()} title="Sign out">
              {(user.displayName ?? user.email ?? 'U').slice(0, 1).toUpperCase()}
            </button>
          </div>
        </header>

        <section className="welcome-panel">
          <div>
            <span className="status-chip"><span className="live-dot" /> Connected to Firebase</span>
            <h2>Desktop foundation is ready.</h2>
            <p>
              Google authentication and business-scoped Firestore access are active. The next module can safely subscribe to sales, stock, party and payment collections.
            </p>
          </div>
          <div className="scope-card">
            <span>Active Firestore scope</span>
            <code>{salesInvoicesPath}</code>
          </div>
        </section>

        <section className="module-grid" aria-label="Desktop modules">
          {foundationModules.map(([title, description, icon]) => (
            <article className="module-card" key={title}>
              <span className="module-icon" aria-hidden="true">{icon}</span>
              <h2>{title}</h2>
              <p>{description}</p>
              <span className="coming-soon">Read-only module</span>
            </article>
          ))}
          <button className="module-card settings-module-card" type="button" onClick={() => onNavigate('documentSettings')}>
            <span className="module-icon" aria-hidden="true">#</span>
            <h2>Document settings</h2>
            <p>Prefix, financial year, next number and digit format for every shared sequence.</p>
            <span className="coming-soon">Configure numbering →</span>
          </button>
        </section>
      </section>
    </main>
  )
}
