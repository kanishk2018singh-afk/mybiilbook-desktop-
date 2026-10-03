import { BrandMark } from '../components/BrandMark'
import { useAuth } from '../context/AuthContext'
import { useBusiness } from '../context/BusinessContext'
import { getBusinessPath } from '../lib/firestorePaths'

const foundationModules = [
  ['Sales', 'Live invoices and collections', '↗'],
  ['Stock', 'Inventory and low-stock alerts', '□'],
  ['Parties', 'Receivables and payables', '◎'],
  ['Reports', 'Showroom performance', '▤'],
]

export function DashboardShell() {
  const { user, signOut } = useAuth()
  const { selectedBusiness, selectedBusinessId, clearBusinessSelection } = useBusiness()

  if (!user || !selectedBusiness || !selectedBusinessId) return null

  // All upcoming repository queries will be scoped this way. Never omit uid or businessId.
  const salesInvoicesPath = getBusinessPath(user.uid, selectedBusinessId, 'salesInvoices')

  return (
    <main className="desktop-layout">
      <aside className="sidebar">
        <BrandMark />
        <nav aria-label="Desktop navigation">
          <button className="nav-item active" type="button"><span>▦</span> Overview</button>
          <button className="nav-item" type="button" disabled><span>↗</span> Sales</button>
          <button className="nav-item" type="button" disabled><span>□</span> Inventory</button>
          <button className="nav-item" type="button" disabled><span>◎</span> Parties</button>
          <button className="nav-item" type="button" disabled><span>▤</span> Reports</button>
        </nav>
        <div className="sidebar-foot">
          <span className="live-dot" /> Firestore live connection ready
        </div>
      </aside>

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

        <section className="module-grid" aria-label="Upcoming read-only modules">
          {foundationModules.map(([title, description, icon]) => (
            <article className="module-card" key={title}>
              <span className="module-icon" aria-hidden="true">{icon}</span>
              <h2>{title}</h2>
              <p>{description}</p>
              <span className="coming-soon">Read-only module</span>
            </article>
          ))}
        </section>
      </section>
    </main>
  )
}
