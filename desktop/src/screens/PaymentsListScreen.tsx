import { useEffect, useMemo, useState } from 'react'
import { DesktopSidebar, type DesktopPage } from '../components/DesktopSidebar'
import { useAuth } from '../context/AuthContext'
import { useBusiness } from '../context/BusinessContext'
import { filterPayments } from '../lib/paymentUtils'
import { subscribeToParties } from '../repositories/partiesRepository'
import { subscribeToPayments } from '../repositories/paymentsRepository'
import { EMPTY_PAYMENT_LIST_FILTERS, PAYMENT_MODES, type PaymentListFilters, type PaymentListItem } from '../types/payment'
import type { Party } from '../types/party'

interface PaymentsListScreenProps {
  onNavigate: (page: DesktopPage) => void
}

function money(value: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value)
}

function dateLabel(value: string): string {
  if (!value) return '—'
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00`)
  return Number.isNaN(parsed.valueOf()) ? value : new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(parsed)
}

function directionLabel(direction: PaymentListItem['direction']): string {
  return direction === 'IN' ? 'Money received' : 'Money paid'
}

export function PaymentsListScreen({ onNavigate }: PaymentsListScreenProps) {
  const { user, signOut } = useAuth()
  const { selectedBusiness, selectedBusinessId, clearBusinessSelection } = useBusiness()
  const [payments, setPayments] = useState<PaymentListItem[]>([])
  const [parties, setParties] = useState<Party[]>([])
  const [paymentsLoading, setPaymentsLoading] = useState(true)
  const [partiesLoading, setPartiesLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [filters, setFilters] = useState<PaymentListFilters>(EMPTY_PAYMENT_LIST_FILTERS)

  useEffect(() => {
    if (!user || !selectedBusinessId) return
    setPaymentsLoading(true)
    setLoadError(null)
    return subscribeToPayments(
      user.uid,
      selectedBusinessId,
      (nextPayments) => {
        setPayments(nextPayments)
        setPaymentsLoading(false)
      },
      (error) => {
        setLoadError(error.message || 'Payments could not be loaded.')
        setPaymentsLoading(false)
      },
    )
  }, [selectedBusinessId, user?.uid])

  useEffect(() => {
    if (!user || !selectedBusinessId) return
    setPartiesLoading(true)
    return subscribeToParties(
      user.uid,
      selectedBusinessId,
      (nextParties) => {
        setParties(nextParties)
        setPartiesLoading(false)
      },
      (error) => {
        setLoadError(error.message || 'Parties could not be loaded.')
        setPartiesLoading(false)
      },
    )
  }, [selectedBusinessId, user?.uid])

  const visiblePayments = useMemo(() => filterPayments(payments, filters), [filters, payments])
  const partyOptions = useMemo(() => {
    const values = new Map<string, string>()
    parties.forEach((party) => values.set(party.id, party.name))
    payments.forEach((payment) => {
      if (payment.partyId && !values.has(payment.partyId)) values.set(payment.partyId, payment.partyName)
    })
    return [...values.entries()].sort((left, right) => left[1].localeCompare(right[1], undefined, { sensitivity: 'base' }))
  }, [parties, payments])

  if (!user || !selectedBusiness || !selectedBusinessId) return null

  const updateFilter = <K extends keyof PaymentListFilters>(key: K, value: PaymentListFilters[K]) => {
    setFilters((current) => ({ ...current, [key]: value }))
  }
  const loading = paymentsLoading || partiesLoading

  return (
    <main className="desktop-layout">
      <DesktopSidebar activePage="payments" onNavigate={onNavigate} />
      <section className="dashboard-content payments-list-content">
        <header className="dashboard-header">
          <div>
            <p className="breadcrumb">SHOWROOM / PAYMENTS / REGISTER</p>
            <h1>Payments</h1>
            <p>Review receipts, supplier payouts, invoice allocations, and on-account advances.</p>
          </div>
          <div className="header-actions">
            <button className="primary-action-button" type="button" onClick={() => onNavigate('recordPayment')}>＋ Record payment</button>
            <button className="outline-button" type="button" onClick={clearBusinessSelection}>Switch business</button>
            <button className="user-button" type="button" onClick={() => void signOut()} title="Sign out">{(user.displayName ?? user.email ?? 'U').slice(0, 1).toUpperCase()}</button>
          </div>
        </header>

        <section className="payment-register-filters" aria-label="Payment filters">
          <label><span>From date</span><input type="date" value={filters.dateFrom} onChange={(event) => updateFilter('dateFrom', event.target.value)} /></label>
          <label><span>To date</span><input type="date" min={filters.dateFrom || undefined} value={filters.dateTo} onChange={(event) => updateFilter('dateTo', event.target.value)} /></label>
          <label><span>Party</span><select value={filters.partyId} onChange={(event) => updateFilter('partyId', event.target.value)}><option value="">All parties</option>{partyOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
          <label><span>Direction</span><select value={filters.direction} onChange={(event) => updateFilter('direction', event.target.value as PaymentListFilters['direction'])}><option value="">All directions</option><option value="IN">IN · Money received</option><option value="OUT">OUT · Money paid</option></select></label>
          <label><span>Mode</span><select value={filters.mode} onChange={(event) => updateFilter('mode', event.target.value as PaymentListFilters['mode'])}><option value="">All modes</option>{PAYMENT_MODES.map((mode) => <option key={mode} value={mode}>{mode}</option>)}</select></label>
          <button className="outline-button compact-action payment-filter-reset" type="button" onClick={() => setFilters(EMPTY_PAYMENT_LIST_FILTERS)}>Reset filters</button>
        </section>

        {loadError ? <div className="settings-error" role="alert">{loadError}</div> : null}
        {loading ? <div className="settings-loading">Loading payments…</div> : null}

        {!loading && !loadError ? (
          <section className="payment-register-card">
            <div className="invoice-register-summary"><strong>{visiblePayments.length}</strong><span>{visiblePayments.length === 1 ? 'payment matches the current filters' : 'payments match the current filters'}</span></div>
            {visiblePayments.length ? (
              <div className="payment-register-table-wrap">
                <table className="payment-register-table">
                  <thead><tr><th>Date</th><th>Party</th><th>Direction</th><th>Mode / reference</th><th>Amount</th><th>Allocation</th><th>Note</th></tr></thead>
                  <tbody>{visiblePayments.map((payment) => (
                    <tr key={payment.id}>
                      <td>{dateLabel(payment.paymentDate)}</td>
                      <td><strong>{payment.partyName}</strong></td>
                      <td><span className={`payment-direction-pill ${payment.direction.toLowerCase()}`}>{payment.direction === 'IN' ? '↓ IN' : '↑ OUT'}</span><small className="payment-direction-caption">{directionLabel(payment.direction)}</small></td>
                      <td><strong>{payment.mode}</strong>{payment.referenceNumber ? <small>{payment.referenceNumber}</small> : <small>—</small>}</td>
                      <td><strong>{money(payment.amount)}</strong></td>
                      <td><div className="payment-allocation-cell"><strong>{money(payment.allocatedAmount)}</strong><small>{payment.allocationCount ? `${payment.allocationCount} invoice${payment.allocationCount === 1 ? '' : 's'} allocated` : 'No invoice allocation'}</small>{payment.unallocatedAmount > 0.005 ? <small className="on-account-payment">On account {money(payment.unallocatedAmount)}</small> : null}</div></td>
                      <td className="payment-note-cell">{payment.note || '—'}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : (
              <div className="invoice-register-empty"><span aria-hidden="true">₹</span><h2>No payments found</h2><p>Try adjusting filters, or record the first payment for this showroom.</p>{payments.length === 0 ? <button className="primary-action-button compact-action" type="button" onClick={() => onNavigate('recordPayment')}>Record first payment</button> : null}</div>
            )}
          </section>
        ) : null}
      </section>
    </main>
  )
}
