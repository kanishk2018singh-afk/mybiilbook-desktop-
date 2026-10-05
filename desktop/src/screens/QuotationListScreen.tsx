import { useEffect, useMemo, useState } from 'react'
import { DesktopSidebar, type DesktopPage } from '../components/DesktopSidebar'
import { useAuth } from '../context/AuthContext'
import { useBusiness } from '../context/BusinessContext'
import { filterQuotations, quotationStatusLabel } from '../lib/quotationUtils'
import { subscribeToQuotations } from '../repositories/quotationsRepository'
import { EMPTY_QUOTATION_LIST_FILTERS, QUOTATION_STATUSES, type QuotationListFilters, type QuotationListItem } from '../types/quotation'

interface QuotationListScreenProps {
  onNavigate: (page: DesktopPage) => void
  onOpenQuotation: (quotationId: string) => void
}

function money(value: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value)
}

function dateLabel(value: string): string {
  if (!value) return '—'
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00`)
  return Number.isNaN(parsed.valueOf()) ? value : new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(parsed)
}

export function QuotationListScreen({ onNavigate, onOpenQuotation }: QuotationListScreenProps) {
  const { user, signOut } = useAuth()
  const { selectedBusiness, selectedBusinessId, clearBusinessSelection } = useBusiness()
  const [quotations, setQuotations] = useState<QuotationListItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [filters, setFilters] = useState<QuotationListFilters>(EMPTY_QUOTATION_LIST_FILTERS)

  useEffect(() => {
    if (!user || !selectedBusinessId) return
    setIsLoading(true)
    setLoadError(null)
    return subscribeToQuotations(
      user.uid,
      selectedBusinessId,
      (nextQuotations) => {
        setQuotations(nextQuotations)
        setIsLoading(false)
      },
      (error) => {
        setLoadError(error.message || 'Quotations could not be loaded.')
        setIsLoading(false)
      },
    )
  }, [selectedBusinessId, user?.uid])

  const visibleQuotations = useMemo(() => filterQuotations(quotations, filters), [filters, quotations])
  const parties = useMemo(() => {
    const values = new Map<string, string>()
    quotations.forEach((quotation) => {
      if (quotation.partyId) values.set(quotation.partyId, quotation.partyName)
    })
    return [...values.entries()].sort((left, right) => left[1].localeCompare(right[1], undefined, { sensitivity: 'base' }))
  }, [quotations])

  if (!user || !selectedBusiness || !selectedBusinessId) return null

  const updateFilter = <K extends keyof QuotationListFilters>(key: K, value: QuotationListFilters[K]) => {
    setFilters((current) => ({ ...current, [key]: value }))
  }

  return (
    <main className="desktop-layout">
      <DesktopSidebar activePage="quotations" onNavigate={onNavigate} />
      <section className="dashboard-content invoice-register-content quotation-list-content">
        <header className="dashboard-header">
          <div>
            <p className="breadcrumb">SHOWROOM / QUOTATIONS / REGISTER</p>
            <h1>Quotations</h1>
            <p>Track customer offers from draft through acceptance, expiry, rejection, or sales conversion.</p>
          </div>
          <div className="header-actions">
            <button className="primary-action-button" type="button" onClick={() => onNavigate('quotation')}>＋ New quotation</button>
            <button className="outline-button" type="button" onClick={clearBusinessSelection}>Switch business</button>
            <button className="user-button" type="button" onClick={() => void signOut()} title="Sign out">{(user.displayName ?? user.email ?? 'U').slice(0, 1).toUpperCase()}</button>
          </div>
        </header>

        <section className="quotation-register-filters" aria-label="Quotation filters">
          <label><span>From date</span><input type="date" value={filters.dateFrom} onChange={(event) => updateFilter('dateFrom', event.target.value)} /></label>
          <label><span>To date</span><input type="date" min={filters.dateFrom || undefined} value={filters.dateTo} onChange={(event) => updateFilter('dateTo', event.target.value)} /></label>
          <label><span>Customer</span><select value={filters.partyId} onChange={(event) => updateFilter('partyId', event.target.value)}><option value="">All customers</option>{parties.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
          <label><span>Status</span><select value={filters.status} onChange={(event) => updateFilter('status', event.target.value as QuotationListFilters['status'])}><option value="">All statuses</option>{QUOTATION_STATUSES.map((status) => <option key={status} value={status}>{quotationStatusLabel(status)}</option>)}</select></label>
          <button className="outline-button compact-action quotation-filter-reset" type="button" onClick={() => setFilters(EMPTY_QUOTATION_LIST_FILTERS)}>Reset filters</button>
        </section>

        {loadError ? <div className="settings-error" role="alert">{loadError}</div> : null}
        {isLoading ? <div className="settings-loading">Loading quotations…</div> : null}
        {!isLoading && !loadError ? (
          <section className="invoice-register-card quotation-register-card">
            <div className="invoice-register-summary"><strong>{visibleQuotations.length}</strong><span>{visibleQuotations.length === 1 ? 'quotation matches the current filters' : 'quotations match the current filters'}</span></div>
            {visibleQuotations.length ? (
              <div className="table-wrap">
                <table className="invoice-register-table quotation-register-table">
                  <thead><tr><th>Quotation</th><th>Date</th><th>Valid until</th><th>Customer</th><th>Grand total</th><th>Status</th><th>Converted invoice</th><th /></tr></thead>
                  <tbody>{visibleQuotations.map((quotation) => (
                    <tr key={quotation.id}>
                      <td><strong>{quotation.number}</strong></td>
                      <td>{dateLabel(quotation.date)}</td>
                      <td>{dateLabel(quotation.validUntil)}</td>
                      <td><strong>{quotation.partyName}</strong></td>
                      <td>{money(quotation.grandTotal)}</td>
                      <td><span className={`quotation-status-pill ${quotation.status.toLowerCase()}`}>{quotationStatusLabel(quotation.status)}</span></td>
                      <td>{quotation.salesInvoiceNumber || '—'}</td>
                      <td><button className="table-action-button" type="button" onClick={() => onOpenQuotation(quotation.id)}>View</button></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : <div className="invoice-register-empty"><span aria-hidden="true">⌕</span><h2>No quotations found</h2><p>Try changing filters, or create the first quotation for this showroom.</p>{quotations.length === 0 ? <button className="primary-action-button compact-action" type="button" onClick={() => onNavigate('quotation')}>Create first quotation</button> : null}</div>}
          </section>
        ) : null}
      </section>
    </main>
  )
}
