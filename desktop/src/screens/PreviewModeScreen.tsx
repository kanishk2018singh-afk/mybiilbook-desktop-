import { useState } from 'react'
import { DesktopSidebar, type DesktopPage } from '../components/DesktopSidebar'

const previewMetrics = [
  { label: 'Today’s sales', value: '₹ 48,240', detail: 'Example preview value' },
  { label: 'Purchase bills', value: '12', detail: 'Example preview value' },
  { label: 'Low-stock items', value: '8', detail: 'Example preview value' },
  { label: 'Receivables', value: '₹ 1,26,500', detail: 'Example preview value' },
]

const pageCopy: Partial<Record<DesktopPage, { title: string; description: string }>> = {
  companies: {
    title: 'Companies',
    description: 'Your brand master and default-company management will appear here after authentication is re-enabled.',
  },
  categories: {
    title: 'Categories',
    description: 'Your category tree and subcategory controls will appear here after authentication is re-enabled.',
  },
  products: {
    title: 'Products',
    description: 'Your product catalog, opening stock, and stock history will appear here after authentication is re-enabled.',
  },
  parties: {
    title: 'Parties',
    description: 'Customer and supplier balances will appear here after authentication is re-enabled.',
  },
  salesInvoices: {
    title: 'Sales invoices',
    description: 'The live sales register, filters, details, PDF export, and cancellation workflow will appear here after authentication is re-enabled.',
  },
  purchaseInvoices: {
    title: 'Purchase invoices',
    description: 'The live purchase register, filters, details, PDF export, and cancellation workflow will appear here after authentication is re-enabled.',
  },
  payments: {
    title: 'Payments',
    description: 'The payment register and its date, party, direction, and mode filters will appear here after authentication is re-enabled.',
  },
  recordPayment: {
    title: 'Record payment',
    description: 'The independent payment form and multi-invoice allocation workflow will appear here after authentication is re-enabled.',
  },
  documentSettings: {
    title: 'Document settings',
    description: 'Shared document numbering will appear here after authentication is re-enabled.',
  },
}

export function PreviewModeScreen() {
  const [page, setPage] = useState<DesktopPage>('overview')
  const pageDetails = pageCopy[page]

  return (
    <main className="desktop-layout preview-mode-layout">
      <DesktopSidebar activePage={page} onNavigate={setPage} />

      <section className="dashboard-content preview-mode-content">
        <header className="dashboard-header">
          <div>
            <p className="breadcrumb">SHOWROOM / LOCAL PREVIEW</p>
            <h1>MyBillBook Desktop</h1>
            <p>Authentication is temporarily hidden for this local UI preview.</p>
          </div>
          <span className="preview-mode-badge">Preview only</span>
        </header>

        <section className="preview-mode-notice" role="status">
          <span aria-hidden="true">◌</span>
          <div>
            <strong>Live Firebase data is protected.</strong>
            <p>
              No Firestore data is read or written in Preview Mode. Google authentication can be re-enabled later by setting
              {' '}<code>VITE_DESKTOP_PREVIEW_MODE=false</code> in <code>desktop/.env</code>.
            </p>
          </div>
        </section>

        {page === 'overview' ? (
          <>
            <section className="welcome-panel preview-welcome-panel">
              <div>
                <span className="status-chip"><span className="live-dot preview-dot" /> Local preview active</span>
                <h2>Your showroom, at a glance.</h2>
                <p>
                  The desktop workspace is available to review without signing in. Values below are illustrative and are not
                  connected to your business records.
                </p>
              </div>
              <div className="scope-card">
                <span>Data mode</span>
                <code>LOCAL_UI_PREVIEW_ONLY</code>
              </div>
            </section>

            <section className="preview-metric-grid" aria-label="Preview dashboard metrics">
              {previewMetrics.map((metric) => (
                <article className="preview-metric-card" key={metric.label}>
                  <p>{metric.label}</p>
                  <strong>{metric.value}</strong>
                  <span>{metric.detail}</span>
                </article>
              ))}
            </section>

            <section className="preview-feature-grid" aria-label="Available desktop features">
              <article>
                <span>↗</span>
                <h2>Sales workflow</h2>
                <p>Atomic invoice posting, stock-out, payment links, register filters, and GST PDF export.</p>
              </article>
              <article>
                <span>↙</span>
                <h2>Purchase workflow</h2>
                <p>Supplier bills, stock-in, optional cost updates, and linked outgoing payments.</p>
              </article>
              <article>
                <span>◎</span>
                <h2>Party balances</h2>
                <p>Customer and supplier masters with live, calculated receivable and payable balances.</p>
              </article>
            </section>
          </>
        ) : (
          <section className="preview-page-card">
            <span className="preview-page-icon" aria-hidden="true">◌</span>
            <p className="breadcrumb">PREVIEW / {page.toUpperCase()}</p>
            <h2>{pageDetails?.title ?? 'Preview'}</h2>
            <p>{pageDetails?.description}</p>
            <small>Preview Mode keeps this screen read-only and disconnected from Firestore.</small>
          </section>
        )}
      </section>
    </main>
  )
}
