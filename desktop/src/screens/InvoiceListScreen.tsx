import { useEffect, useMemo, useState } from 'react'
import { DesktopSidebar, type DesktopPage } from '../components/DesktopSidebar'
import { useAuth } from '../context/AuthContext'
import { useBusiness } from '../context/BusinessContext'
import { EMPTY_INVOICE_FILTERS, type InvoiceKind, type InvoiceListFilters, type InvoiceListItem } from '../types/invoice'
import { filterInvoices, invoiceKindLabel, invoicePartyLabel, paymentStatusLabel } from '../lib/invoiceUtils'
import { subscribeToInvoices } from '../repositories/invoicesRepository'

interface InvoiceListScreenProps {
  kind: InvoiceKind
  onNavigate: (page: DesktopPage) => void
  onOpenInvoice: (kind: InvoiceKind, invoiceId: string) => void
}

function money(value: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value)
}

function dateLabel(value: string): string {
  if (!value) return '—'
  const dateOnly = value.match(/^\d{4}-\d{2}-\d{2}/)?.[0]
  const parsed = new Date(dateOnly ? `${dateOnly}T12:00:00` : value)
  return Number.isNaN(parsed.valueOf())
    ? value
    : new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(parsed)
}

function newInvoicePage(kind: InvoiceKind): DesktopPage {
  return kind === 'SALE' ? 'salesInvoice' : 'purchaseInvoice'
}

function listPage(kind: InvoiceKind): DesktopPage {
  return kind === 'SALE' ? 'salesInvoices' : 'purchaseInvoices'
}

function statusLabel(status: InvoiceListItem['status']): string {
  if (status === 'CANCELLED') return 'Cancelled'
  if (status === 'DRAFT') return 'Draft'
  return 'Confirmed'
}

export function InvoiceListScreen({ kind, onNavigate, onOpenInvoice }: InvoiceListScreenProps) {
  const { user, signOut } = useAuth()
  const { selectedBusiness, selectedBusinessId, clearBusinessSelection } = useBusiness()
  const [invoices, setInvoices] = useState<InvoiceListItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [filters, setFilters] = useState<InvoiceListFilters>(EMPTY_INVOICE_FILTERS)

  useEffect(() => {
    if (!user || !selectedBusinessId) return
    setIsLoading(true)
    setLoadError(null)
    return subscribeToInvoices(
      user.uid,
      selectedBusinessId,
      kind,
      (nextInvoices) => {
        setInvoices(nextInvoices)
        setIsLoading(false)
      },
      (error) => {
        setLoadError(error.message || `${invoiceKindLabel(kind)} invoices could not be loaded.`)
        setIsLoading(false)
      },
    )
  }, [kind, selectedBusinessId, user?.uid])

  const visibleInvoices = useMemo(() => filterInvoices(invoices, filters), [filters, invoices])
  const parties = useMemo(() => {
    const unique = new Map<string, string>()
    invoices.forEach((invoice) => {
      if (invoice.partyId) unique.set(invoice.partyId, invoice.partyName)
    })
    return [...unique.entries()].sort((left, right) => left[1].localeCompare(right[1], undefined, { sensitivity: 'base' }))
  }, [invoices])

  if (!user || !selectedBusiness || !selectedBusinessId) return null

  const updateFilter = <K extends keyof InvoiceListFilters>(key: K, value: InvoiceListFilters[K]) => {
    setFilters((current) => ({ ...current, [key]: value }))
  }
  const title = `${invoiceKindLabel(kind)} invoices`
  const partyLabel = invoicePartyLabel(kind)

  return (
    <main className="desktop-layout">
      <DesktopSidebar activePage={listPage(kind)} onNavigate={onNavigate} />
      <section className="dashboard-content invoice-register-content">
        <header className="dashboard-header">
          <div>
            <p className="breadcrumb">SHOWROOM / {kind === 'SALE' ? 'SALES' : 'PURCHASES'} / REGISTER</p>
            <h1>{title}</h1>
            <p>Review immutable documents, filter the register, and open a complete invoice audit trail.</p>
          </div>
          <div className="header-actions">
            <button className="primary-action-button" type="button" onClick={() => onNavigate(newInvoicePage(kind))}>＋ New {kind === 'SALE' ? 'sales' : 'purchase'} invoice</button>
            <button className="outline-button" type="button" onClick={clearBusinessSelection}>Switch business</button>
            <button className="user-button" type="button" onClick={() => void signOut()} title="Sign out">{(user.displayName ?? user.email ?? 'U').slice(0, 1).toUpperCase()}</button>
          </div>
        </header>

        <section className="invoice-register-filters" aria-label={`${title} filters`}>
          <label><span>From date</span><input type="date" value={filters.dateFrom} onChange={(event) => updateFilter('dateFrom', event.target.value)} /></label>
          <label><span>To date</span><input type="date" value={filters.dateTo} min={filters.dateFrom || undefined} onChange={(event) => updateFilter('dateTo', event.target.value)} /></label>
          <label><span>{partyLabel}</span><select value={filters.partyId} onChange={(event) => updateFilter('partyId', event.target.value)}><option value="">All {partyLabel.toLowerCase()}s</option>{parties.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
          <label><span>Payment status</span><select value={filters.paymentStatus} onChange={(event) => updateFilter('paymentStatus', event.target.value as InvoiceListFilters['paymentStatus'])}><option value="">All payments</option><option value="PAID">Paid</option><option value="PARTIAL">Partial</option><option value="UNPAID">Unpaid</option></select></label>
          <label><span>Document status</span><select value={filters.status} onChange={(event) => updateFilter('status', event.target.value as InvoiceListFilters['status'])}><option value="">All statuses</option><option value="DRAFT">Draft</option><option value="CONFIRMED">Confirmed</option><option value="CANCELLED">Cancelled</option></select></label>
          <button className="outline-button compact-action invoice-filter-reset" type="button" onClick={() => setFilters(EMPTY_INVOICE_FILTERS)}>Reset filters</button>
        </section>

        {loadError ? <div className="settings-error" role="alert">{loadError}</div> : null}
        {isLoading ? <div className="settings-loading">Loading {title.toLowerCase()}…</div> : null}

        {!isLoading && !loadError ? (
          <section className="invoice-register-card">
            <div className="invoice-register-summary"><strong>{visibleInvoices.length}</strong><span>{visibleInvoices.length === 1 ? 'document matches the current filters' : 'documents match the current filters'}</span></div>
            {visibleInvoices.length ? (
              <div className="table-wrap">
                <table className="invoice-register-table">
                  <thead><tr><th>Document</th><th>Date</th><th>{partyLabel}</th><th>Grand total</th><th>Paid / balance</th><th>Payment</th><th>Status</th><th /></tr></thead>
                  <tbody>{visibleInvoices.map((invoice) => (
                    <tr key={invoice.id} className={invoice.status === 'CANCELLED' ? 'cancelled-invoice-row' : ''}>
                      <td><strong>{invoice.number}</strong>{invoice.supplierInvoiceNumber ? <small>Supplier bill: {invoice.supplierInvoiceNumber}</small> : null}</td>
                      <td>{dateLabel(invoice.date)}</td>
                      <td><strong>{invoice.partyName}</strong></td>
                      <td>{money(invoice.grandTotal)}</td>
                      <td><div className="invoice-register-money"><strong>{money(invoice.paidAmount)}</strong><small>Balance {money(invoice.balanceAmount)}</small></div></td>
                      <td><span className={`payment-status ${invoice.paymentStatus.toLowerCase()}`}>{paymentStatusLabel(invoice.paymentStatus)}</span></td>
                      <td><span className={`invoice-status-pill ${invoice.status.toLowerCase()}`}>{statusLabel(invoice.status)}</span></td>
                      <td><button className="table-action-button" type="button" onClick={() => onOpenInvoice(kind, invoice.id)}>View</button></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : (
              <div className="invoice-register-empty"><span aria-hidden="true">⌕</span><h2>No invoices found</h2><p>Try changing the date, party, payment, or status filters.</p>{invoices.length === 0 ? <button className="primary-action-button compact-action" type="button" onClick={() => onNavigate(newInvoicePage(kind))}>Create the first invoice</button> : null}</div>
            )}
          </section>
        ) : null}
      </section>
    </main>
  )
}
