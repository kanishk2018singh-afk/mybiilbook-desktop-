import { useEffect, useMemo, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { BillingInternetNotice } from '../components/BillingInternetNotice'
import { DesktopSidebar, type DesktopPage } from '../components/DesktopSidebar'
import { useAuth } from '../context/AuthContext'
import { useBusiness } from '../context/BusinessContext'
import { useSyncStatus } from '../context/SyncStatusContext'
import {
  buildSalesTrend,
  calculateDashboardMetrics,
  calculateGstSummary,
  defaultGstDateRange,
  lowStockProducts,
  topSellingProducts,
} from '../lib/dashboardUtils'
import { getBusinessPath } from '../lib/firestorePaths'
import { subscribeToDashboardData } from '../repositories/dashboardRepository'
import type { DashboardData, DateRange, GstTaxTotals } from '../types/dashboard'

function money(value: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value)
}

function compactMoney(value: number): string {
  return new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

function dashboardError(error: unknown): string {
  return error instanceof Error ? error.message : 'The dashboard data could not be loaded.'
}

function TaxBreakdown({ totals, tone }: { totals: GstTaxTotals; tone: 'sales' | 'purchases' }) {
  return (
    <article className={`gst-tax-card ${tone}`}>
      <div className="gst-tax-card-heading">
        <div><span>{tone === 'sales' ? 'OUTPUT TAX · SALES' : 'INPUT TAX · PURCHASES'}</span><strong>{money(totals.totalTax)}</strong></div>
        <small>{tone === 'sales' ? 'Collected on confirmed sales' : 'Shown on confirmed purchases'}</small>
      </div>
      <dl>
        <div><dt>CGST</dt><dd>{money(totals.cgstAmount)}</dd></div>
        <div><dt>SGST</dt><dd>{money(totals.sgstAmount)}</dd></div>
        <div><dt>IGST</dt><dd>{money(totals.igstAmount)}</dd></div>
      </dl>
    </article>
  )
}

export function DashboardShell({ onNavigate }: { onNavigate: (page: DesktopPage) => void }) {
  const { user, signOut } = useAuth()
  const { isOnline } = useSyncStatus()
  const { selectedBusiness, selectedBusinessId, clearBusinessSelection } = useBusiness()
  const [data, setData] = useState<DashboardData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [gstRange, setGstRange] = useState<DateRange>(() => defaultGstDateRange())

  useEffect(() => {
    if (!user || !selectedBusinessId) return
    setData(null)
    setIsLoading(true)
    setLoadError(null)
    setGstRange(defaultGstDateRange())
    return subscribeToDashboardData(
      user.uid,
      selectedBusinessId,
      (nextData) => {
        setData(nextData)
        setIsLoading(false)
      },
      (error) => {
        setLoadError(dashboardError(error))
        setIsLoading(false)
      },
    )
  }, [selectedBusinessId, user?.uid])

  const metrics = useMemo(() => data ? calculateDashboardMetrics(data) : null, [data])
  const trend = useMemo(() => data ? buildSalesTrend(data.salesInvoices) : [], [data])
  const topProducts = useMemo(() => data ? topSellingProducts(data) : [], [data])
  const lowStock = useMemo(() => data ? lowStockProducts(data.products) : [], [data])
  const gstSummary = useMemo(() => data ? calculateGstSummary(data, gstRange) : null, [data, gstRange])
  const hasTrendData = trend.some((point) => point.sales > 0)

  if (!user || !selectedBusiness || !selectedBusinessId) return null

  // Kept visible for audit/support copy: every live aggregate is scoped to this exact showroom.
  const salesInvoicesPath = getBusinessPath(user.uid, selectedBusinessId, 'salesInvoices')
  const updateGstRange = <K extends keyof DateRange>(key: K, value: DateRange[K]) => {
    setGstRange((current) => ({ ...current, [key]: value }))
  }

  return (
    <main className="desktop-layout">
      <DesktopSidebar activePage="overview" onNavigate={onNavigate} />

      <section className="dashboard-content home-dashboard-content">
        <header className="dashboard-header">
          <div>
            <p className="breadcrumb">SHOWROOM / HOME DASHBOARD</p>
            <h1>{selectedBusiness.name}</h1>
            <p>{selectedBusiness.address ?? 'Live sales, cash, inventory, party balance, and GST overview.'}</p>
          </div>
          <div className="header-actions">
            <button className="outline-button" type="button" onClick={clearBusinessSelection}>Switch business</button>
            <button className="user-button" type="button" onClick={() => void signOut()} title="Sign out">
              {(user.displayName ?? user.email ?? 'U').slice(0, 1).toUpperCase()}
            </button>
          </div>
        </header>

        <BillingInternetNotice />

        <section className="dashboard-live-banner">
          <span className="status-chip"><span className="live-dot" /> Live business aggregates</span>
          <p>Confirmed invoices, payment records, products, and immutable sales-item snapshots update this dashboard in real time.</p>
          <code>{salesInvoicesPath}</code>
        </section>

        {loadError ? <div className="settings-error" role="alert">{loadError}</div> : null}
        {isLoading ? <div className="settings-loading dashboard-loading">Loading live showroom dashboard…</div> : null}

        {!isLoading && !loadError && data && metrics && gstSummary ? (
          <>
            <section className="home-metrics-grid" aria-label="Business summary">
              <button className="home-metric-card sales-today" type="button" onClick={() => onNavigate('salesInvoices')}>
                <span className="home-metric-icon" aria-hidden="true">↗</span>
                <p>Today&apos;s sales</p>
                <strong>{money(metrics.todaySales)}</strong>
                <small>Confirmed invoices today · Open sales register →</small>
              </button>
              <button className="home-metric-card sales-month" type="button" onClick={() => onNavigate('salesInvoices')}>
                <span className="home-metric-icon" aria-hidden="true">◔</span>
                <p>This month&apos;s sales</p>
                <strong>{money(metrics.monthSales)}</strong>
                <small>Confirmed sales from the first of this month</small>
              </button>
              <button className="home-metric-card purchases-today" type="button" onClick={() => onNavigate('purchaseInvoices')}>
                <span className="home-metric-icon" aria-hidden="true">↙</span>
                <p>Today&apos;s purchases</p>
                <strong>{money(metrics.todayPurchases)}</strong>
                <small>Confirmed supplier bills today · Open purchases →</small>
              </button>
              <button className="home-metric-card cash-hand" type="button" onClick={() => onNavigate('payments')}>
                <span className="home-metric-icon" aria-hidden="true">₹</span>
                <p>Cash in hand estimate</p>
                <strong className={metrics.cashInHand < 0 ? 'negative' : ''}>{money(metrics.cashInHand)}</strong>
                <small>Cash payments IN minus OUT · Open payment register →</small>
              </button>
            </section>

            <section className="home-balance-grid" aria-label="Receivable and payable summary">
              <button className="home-balance-card receivables" type="button" onClick={() => onNavigate('salesInvoices')}>
                <div><span>Receivables</span><strong>{money(metrics.receivables)}</strong></div>
                <p>Unpaid + partial confirmed sales invoice balances</p>
              </button>
              <button className="home-balance-card payables" type="button" onClick={() => onNavigate('purchaseInvoices')}>
                <div><span>Payables</span><strong>{money(metrics.payables)}</strong></div>
                <p>Unpaid + partial confirmed purchase invoice balances</p>
              </button>
            </section>

            <section className="home-analysis-grid">
              <section className="home-panel sales-trend-panel" aria-labelledby="sales-trend-title">
                <div className="home-panel-heading">
                  <div><p className="panel-kicker">SALES PERFORMANCE</p><h2 id="sales-trend-title">Sales trend</h2><p>Confirmed sales over the last 30 calendar days.</p></div>
                  <span className="home-panel-badge">30 days</span>
                </div>
                {hasTrendData ? (
                  <div className="sales-trend-chart">
                    <ResponsiveContainer width="100%" height={270}>
                      <LineChart data={trend} margin={{ top: 10, right: 8, left: -8, bottom: 0 }}>
                        <CartesianGrid stroke="#e7eef2" strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="label" tick={{ fill: '#78909d', fontSize: 10 }} tickLine={false} axisLine={false} interval={4} />
                        <YAxis tickFormatter={compactMoney} tick={{ fill: '#78909d', fontSize: 10 }} tickLine={false} axisLine={false} width={54} />
                        <Tooltip formatter={(value) => money(Number(value))} labelFormatter={(_, payload) => payload?.[0]?.payload?.date ?? ''} />
                        <Line type="monotone" dataKey="sales" name="Sales" stroke="#17816a" strokeWidth={3} dot={false} activeDot={{ r: 5, fill: '#17816a', stroke: '#fff', strokeWidth: 2 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ) : <div className="home-panel-empty"><span>↗</span><strong>No confirmed sales in the last 30 days</strong><p>Confirm a Sales Invoice to begin plotting your daily trend.</p><button className="outline-button compact-action" type="button" disabled={!isOnline} onClick={() => onNavigate('salesInvoice')}>Create sales invoice</button></div>}
              </section>

              <section className="home-panel top-products-panel" aria-labelledby="top-products-title">
                <div className="home-panel-heading">
                  <div><p className="panel-kicker">SALES VOLUME</p><h2 id="top-products-title">Top 5 selling products</h2><p>All-time quantity from confirmed Sales Invoice item snapshots.</p></div>
                  <button className="row-action-button" type="button" onClick={() => onNavigate('salesInvoices')}>Sales register</button>
                </div>
                {topProducts.length ? <ol className="top-products-list">{topProducts.map((product, index) => <li key={product.productId}><span>{index + 1}</span><div><strong>{product.name}</strong><small>{product.invoiceLineCount} invoice {product.invoiceLineCount === 1 ? 'line' : 'lines'}</small></div><b>{product.quantitySold} <small>{product.unit}</small></b></li>)}</ol> : <div className="home-panel-empty compact"><span>▤</span><strong>No product sales yet</strong><p>Confirmed sales items will be ranked here.</p></div>}
              </section>
            </section>

            <section className="home-bottom-grid">
              <section className="home-panel low-stock-panel" aria-labelledby="low-stock-title">
                <div className="home-panel-heading">
                  <div><p className="panel-kicker">INVENTORY WATCH</p><h2 id="low-stock-title">Low stock alerts</h2><p>{lowStock.length ? `${lowStock.length} product${lowStock.length === 1 ? '' : 's'} at or below its alert quantity.` : 'Every product is currently above its configured alert quantity.'}</p></div>
                  <button className="row-action-button" type="button" onClick={() => onNavigate('products')}>View products</button>
                </div>
                {lowStock.length ? <ul className="low-stock-list">{lowStock.slice(0, 5).map((product) => <li key={product.id}><div><strong>{product.name}</strong><small>Alert at {product.lowStockAlert} {product.unit}</small></div><b className={product.stockQty <= 0 ? 'critical' : ''}>{product.stockQty} <small>{product.unit}</small></b></li>)}</ul> : <div className="home-panel-empty compact"><span>✓</span><strong>Stock looks healthy</strong><p>Products that reach their low-stock alert appear here.</p></div>}
                {lowStock.length > 5 ? <button className="outline-button compact-action low-stock-all-button" type="button" onClick={() => onNavigate('products')}>View all {lowStock.length} alerts</button> : null}
              </section>

              <section className="home-panel gst-summary-panel" aria-labelledby="gst-summary-title">
                <div className="home-panel-heading gst-heading">
                  <div><p className="panel-kicker">GST SUMMARY</p><h2 id="gst-summary-title">Return preparation</h2><p>Confirmed invoice tax amounts, separately shown for sales and purchases.</p></div>
                  <span className="home-panel-badge">Live</span>
                </div>
                <div className="gst-date-filters" aria-label="GST date range">
                  <label><span>From</span><input type="date" value={gstRange.dateFrom} onChange={(event) => updateGstRange('dateFrom', event.target.value)} /></label>
                  <label><span>To</span><input type="date" min={gstRange.dateFrom || undefined} value={gstRange.dateTo} onChange={(event) => updateGstRange('dateTo', event.target.value)} /></label>
                  <button className="outline-button compact-action" type="button" onClick={() => setGstRange(defaultGstDateRange())}>This month</button>
                </div>
                <div className="gst-tax-grid"><TaxBreakdown totals={gstSummary.sales} tone="sales" /><TaxBreakdown totals={gstSummary.purchases} tone="purchases" /></div>
                <p className="gst-summary-note">Use the Sales output-tax and Purchase input-tax figures with your accounting records when preparing GST returns. Cancelled invoices are excluded.</p>
              </section>
            </section>
          </>
        ) : null}
      </section>
    </main>
  )
}
