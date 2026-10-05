import { useEffect, useMemo, useState } from 'react'
import { DesktopSidebar, type DesktopPage } from '../components/DesktopSidebar'
import { useAuth } from '../context/AuthContext'
import { useBusiness } from '../context/BusinessContext'
import { invoiceKindForPaymentDirection, roundMoney, sumPaymentAllocations } from '../lib/paymentUtils'
import { subscribeToParties } from '../repositories/partiesRepository'
import { recordStandalonePayment, subscribeToPayableInvoices } from '../repositories/paymentsRepository'
import type { Party } from '../types/party'
import { PAYMENT_MODES, type PaymentDirection, type PaymentMode, type PayableInvoice } from '../types/payment'

interface RecordPaymentScreenProps {
  onNavigate: (page: DesktopPage) => void
}

interface PaymentDraft {
  partyId: string
  amount: string
  direction: PaymentDirection
  mode: PaymentMode
  paymentDate: string
  referenceNumber: string
  note: string
}

function today(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const EMPTY_DRAFT: PaymentDraft = {
  partyId: '',
  amount: '',
  direction: 'IN',
  mode: 'CASH',
  paymentDate: today(),
  referenceNumber: '',
  note: '',
}

function money(value: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value)
}

function dateLabel(value: string): string {
  if (!value) return '—'
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00`)
  return Number.isNaN(parsed.valueOf()) ? value : new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(parsed)
}

function allocationKey(invoice: PayableInvoice): string {
  return `${invoice.kind}:${invoice.id}`
}

function partyAllowsDirection(party: Party, direction: PaymentDirection): boolean {
  return direction === 'IN'
    ? party.type === 'CUSTOMER' || party.type === 'BOTH'
    : party.type === 'SUPPLIER' || party.type === 'BOTH'
}

function paymentErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The payment could not be recorded.'
}

export function RecordPaymentScreen({ onNavigate }: RecordPaymentScreenProps) {
  const { user, signOut } = useAuth()
  const { selectedBusiness, selectedBusinessId, clearBusinessSelection } = useBusiness()
  const [parties, setParties] = useState<Party[]>([])
  const [payableInvoices, setPayableInvoices] = useState<PayableInvoice[]>([])
  const [draft, setDraft] = useState<PaymentDraft>(EMPTY_DRAFT)
  const [allocationValues, setAllocationValues] = useState<Record<string, string>>({})
  const [partiesLoading, setPartiesLoading] = useState(true)
  const [invoicesLoading, setInvoicesLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (!user || !selectedBusinessId) return
    setPartiesLoading(true)
    setLoadError(null)
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

  useEffect(() => {
    if (!user || !selectedBusinessId || !draft.partyId) {
      setPayableInvoices([])
      setInvoicesLoading(false)
      return
    }
    setInvoicesLoading(true)
    setLoadError(null)
    return subscribeToPayableInvoices(
      user.uid,
      selectedBusinessId,
      draft.partyId,
      draft.direction,
      (nextInvoices) => {
        setPayableInvoices(nextInvoices)
        setInvoicesLoading(false)
      },
      (error) => {
        setLoadError(error.message || 'Outstanding invoices could not be loaded.')
        setInvoicesLoading(false)
      },
    )
  }, [draft.direction, draft.partyId, selectedBusinessId, user?.uid])

  useEffect(() => {
    // A payment direction uses a different invoice register. Never carry a
    // sales allocation into an OUT payment (or a purchase allocation into IN).
    setAllocationValues({})
    setFormError(null)
  }, [draft.direction, draft.partyId])

  useEffect(() => {
    const keys = new Set(payableInvoices.map(allocationKey))
    setAllocationValues((current) => Object.fromEntries(Object.entries(current).filter(([key]) => keys.has(key))))
  }, [payableInvoices])

  const availableParties = useMemo(
    () => parties.filter((party) => party.isActive && partyAllowsDirection(party, draft.direction)),
    [draft.direction, parties],
  )
  const selectedParty = useMemo(() => parties.find((party) => party.id === draft.partyId) ?? null, [draft.partyId, parties])
  const paymentAmount = Number(draft.amount)
  const validPaymentAmount = Number.isFinite(paymentAmount) && paymentAmount > 0 ? roundMoney(paymentAmount) : 0
  const allocations = useMemo(() => payableInvoices
    .map((invoice) => ({
      invoice,
      amount: Number(allocationValues[allocationKey(invoice)] ?? ''),
    }))
    .filter((entry) => Number.isFinite(entry.amount) && entry.amount > 0)
    .map((entry) => ({ invoice: entry.invoice, amount: roundMoney(entry.amount) })), [allocationValues, payableInvoices])
  const allocatedAmount = useMemo(() => sumPaymentAllocations(allocations), [allocations])
  const remainingAmount = roundMoney(Math.max(0, validPaymentAmount - allocatedAmount))
  const hasOverAllocation = validPaymentAmount > 0 && allocatedAmount > validPaymentAmount + 0.005
  const allocationOverInvoiceBalance = allocations.find((entry) => entry.amount > entry.invoice.balanceAmount + 0.005)
  const invoiceKind = invoiceKindForPaymentDirection(draft.direction)

  if (!user || !selectedBusiness || !selectedBusinessId) return null

  const updateDraft = <K extends keyof PaymentDraft>(field: K, value: PaymentDraft[K]) => {
    setSuccessMessage(null)
    setFormError(null)
    setDraft((current) => ({ ...current, [field]: value }))
  }

  const setDirection = (direction: PaymentDirection) => {
    setSuccessMessage(null)
    setFormError(null)
    setDraft((current) => ({ ...current, direction, partyId: '' }))
  }

  const setAllocation = (invoice: PayableInvoice, value: string) => {
    setSuccessMessage(null)
    setFormError(null)
    const key = allocationKey(invoice)
    setAllocationValues((current) => ({ ...current, [key]: value }))
  }

  const allocateRemaining = () => {
    if (!validPaymentAmount) {
      setFormError('Enter the payment amount before allocating it.')
      return
    }
    let leftToAllocate = validPaymentAmount
    const next: Record<string, string> = {}
    for (const invoice of payableInvoices) {
      const amount = Math.min(invoice.balanceAmount, leftToAllocate)
      if (amount > 0.005) next[allocationKey(invoice)] = String(roundMoney(amount))
      leftToAllocate = roundMoney(Math.max(0, leftToAllocate - amount))
      if (leftToAllocate <= 0.005) break
    }
    setAllocationValues(next)
    setFormError(null)
  }

  const save = async () => {
    if (!selectedParty) {
      setFormError('Select a party before recording a payment.')
      return
    }
    if (!validPaymentAmount) {
      setFormError('Enter a payment amount greater than zero.')
      return
    }
    if (hasOverAllocation) {
      setFormError('Allocated total cannot be more than the payment amount.')
      return
    }
    if (allocationOverInvoiceBalance) {
      setFormError(`${allocationOverInvoiceBalance.invoice.number} cannot receive more than its outstanding ${money(allocationOverInvoiceBalance.invoice.balanceAmount)}.`)
      return
    }

    setIsSaving(true)
    setFormError(null)
    setSuccessMessage(null)
    try {
      const result = await recordStandalonePayment(user.uid, selectedBusinessId, {
        partyId: selectedParty.id,
        partyName: selectedParty.name,
        amount: validPaymentAmount,
        direction: draft.direction,
        mode: draft.mode,
        paymentDate: draft.paymentDate,
        referenceNumber: draft.referenceNumber,
        note: draft.note,
        allocations: allocations.map((allocation) => ({
          invoiceId: allocation.invoice.id,
          invoiceKind: allocation.invoice.kind,
          amount: allocation.amount,
        })),
      })
      setSuccessMessage(
        result.allocationCount
          ? `Payment recorded. ${money(result.allocatedAmount)} was allocated across ${result.allocationCount} invoice${result.allocationCount === 1 ? '' : 's'}; ${money(result.unallocatedAmount)} remains on account.`
          : `Payment recorded as an on-account ${draft.direction === 'IN' ? 'receipt' : 'payment'} for ${selectedParty.name}.`,
      )
      setDraft((current) => ({ ...current, amount: '', referenceNumber: '', note: '' }))
      setAllocationValues({})
    } catch (error) {
      setFormError(paymentErrorMessage(error))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <main className="desktop-layout">
      <DesktopSidebar activePage="payments" onNavigate={onNavigate} />
      <section className="dashboard-content payment-record-content">
        <header className="dashboard-header">
          <div>
            <button className="back-link-button" type="button" onClick={() => onNavigate('payments')}>← All payments</button>
            <p className="breadcrumb">SHOWROOM / PAYMENTS / RECORD</p>
            <h1>Record payment</h1>
            <p>Record a receipt or payout independently, then distribute it across one or more outstanding invoices.</p>
          </div>
          <div className="header-actions">
            <button className="outline-button" type="button" onClick={clearBusinessSelection}>Switch business</button>
            <button className="user-button" type="button" onClick={() => void signOut()} title="Sign out">{(user.displayName ?? user.email ?? 'U').slice(0, 1).toUpperCase()}</button>
          </div>
        </header>

        {loadError ? <div className="settings-error" role="alert">{loadError}</div> : null}
        {successMessage ? <div className="payment-success-message" role="status">✓ {successMessage}</div> : null}

        <div className="payment-record-grid">
          <section className="payment-entry-card">
            <div className="payment-card-heading">
              <div><p className="panel-kicker">PAYMENT DETAILS</p><h2>Receipt or payout</h2></div>
              <span className={`payment-direction-chip ${draft.direction.toLowerCase()}`}>{draft.direction === 'IN' ? 'Money received' : 'Money paid'}</span>
            </div>

            <div className="payment-direction-selector" role="radiogroup" aria-label="Payment direction">
              <button className={draft.direction === 'IN' ? 'selected' : ''} type="button" role="radio" aria-checked={draft.direction === 'IN'} onClick={() => setDirection('IN')}>
                <span>↓</span><strong>IN</strong><small>Receive from customer</small>
              </button>
              <button className={draft.direction === 'OUT' ? 'selected' : ''} type="button" role="radio" aria-checked={draft.direction === 'OUT'} onClick={() => setDirection('OUT')}>
                <span>↑</span><strong>OUT</strong><small>Pay supplier</small>
              </button>
            </div>

            <div className="form-grid two-columns payment-form-grid">
              <label className="form-field form-field-wide">
                <span>{draft.direction === 'IN' ? 'Customer' : 'Supplier'} <b>*</b></span>
                <select value={draft.partyId} disabled={partiesLoading} onChange={(event) => updateDraft('partyId', event.target.value)}>
                  <option value="">{partiesLoading ? 'Loading parties…' : `Select ${draft.direction === 'IN' ? 'customer' : 'supplier'}`}</option>
                  {availableParties.map((party) => <option key={party.id} value={party.id}>{party.name}{party.phone ? ` · ${party.phone}` : ''}</option>)}
                </select>
                {!partiesLoading && !availableParties.length ? <small className="field-helper">Add an active {draft.direction === 'IN' ? 'customer' : 'supplier'} in Parties first.</small> : null}
              </label>
              <label className="form-field"><span>Payment date <b>*</b></span><input type="date" value={draft.paymentDate} onChange={(event) => updateDraft('paymentDate', event.target.value)} /></label>
              <label className="form-field"><span>Amount <b>*</b></span><input type="number" min="0.01" step="0.01" inputMode="decimal" value={draft.amount} placeholder="0.00" onChange={(event) => updateDraft('amount', event.target.value)} /></label>
              <label className="form-field"><span>Mode <b>*</b></span><select value={draft.mode} onChange={(event) => updateDraft('mode', event.target.value as PaymentMode)}>{PAYMENT_MODES.map((mode) => <option key={mode} value={mode}>{mode}</option>)}</select></label>
              <label className="form-field"><span>Reference number</span><input value={draft.referenceNumber} maxLength={120} placeholder={draft.mode === 'UPI' ? 'UPI / UTR reference' : 'Cheque, bank, or receipt reference'} onChange={(event) => updateDraft('referenceNumber', event.target.value)} /></label>
              <label className="form-field form-field-wide"><span>Note</span><textarea value={draft.note} maxLength={1000} placeholder="Optional internal note" onChange={(event) => updateDraft('note', event.target.value)} /></label>
            </div>
          </section>

          <aside className="payment-allocation-summary" aria-label="Payment allocation summary">
            <span>Payment amount</span><strong>{money(validPaymentAmount)}</strong>
            <dl>
              <div><dt>Allocated</dt><dd>{money(allocatedAmount)}</dd></div>
              <div><dt>On account</dt><dd>{money(remainingAmount)}</dd></div>
            </dl>
            <p>{remainingAmount > 0.005 ? 'The unallocated amount stays as an on-account advance in the party balance.' : 'The full payment is assigned to selected invoices.'}</p>
          </aside>
        </div>

        <section className="payment-allocation-card">
          <div className="payment-card-heading allocation-heading">
            <div>
              <p className="panel-kicker">OPTIONAL ALLOCATION</p>
              <h2>Allocate to invoices</h2>
              <p>{draft.partyId ? `Showing ${draft.direction === 'IN' ? 'sales' : 'purchase'} invoices that are unpaid or partially paid.` : 'Select a party to load outstanding invoices.'}</p>
            </div>
            <div className="allocation-actions">
              <button className="outline-button compact-action" type="button" onClick={() => setAllocationValues({})} disabled={!Object.keys(allocationValues).length}>Clear</button>
              <button className="outline-button compact-action" type="button" onClick={allocateRemaining} disabled={!payableInvoices.length || !validPaymentAmount}>Allocate remaining</button>
            </div>
          </div>

          {invoicesLoading ? <div className="settings-loading">Loading outstanding invoices…</div> : null}
          {!invoicesLoading && draft.partyId && !payableInvoices.length ? <div className="payment-allocation-empty">No unpaid or partial {invoiceKind === 'SALE' ? 'sales' : 'purchase'} invoices are available for this party. You can still record this as an on-account payment.</div> : null}
          {!invoicesLoading && payableInvoices.length ? (
            <div className="payment-allocation-table-wrap">
              <table className="payment-allocation-table">
                <thead><tr><th>Invoice</th><th>Date</th><th>Grand total</th><th>Previously paid</th><th>Outstanding</th><th>Allocate now</th></tr></thead>
                <tbody>{payableInvoices.map((invoice) => {
                  const key = allocationKey(invoice)
                  const value = allocationValues[key] ?? ''
                  const enteredAmount = Number(value)
                  const exceedsInvoice = Number.isFinite(enteredAmount) && enteredAmount > invoice.balanceAmount + 0.005
                  return (
                    <tr key={key} className={exceedsInvoice ? 'allocation-invalid-row' : ''}>
                      <td><strong>{invoice.number}</strong>{invoice.supplierInvoiceNumber ? <small>Supplier bill: {invoice.supplierInvoiceNumber}</small> : null}</td>
                      <td>{dateLabel(invoice.date)}</td>
                      <td>{money(invoice.grandTotal)}</td>
                      <td>{money(invoice.paidAmount)}</td>
                      <td><strong>{money(invoice.balanceAmount)}</strong><small>{invoice.paymentStatus.toLowerCase()}</small></td>
                      <td><label className="allocation-input"><span className="sr-only">Allocation for {invoice.number}</span><span>₹</span><input type="number" min="0" max={invoice.balanceAmount} step="0.01" inputMode="decimal" value={value} placeholder="0.00" onChange={(event) => setAllocation(invoice, event.target.value)} /></label>{exceedsInvoice ? <small className="allocation-error">Cannot exceed outstanding balance.</small> : null}</td>
                    </tr>
                  )
                })}</tbody>
              </table>
            </div>
          ) : null}
          {hasOverAllocation ? <p className="form-error" role="alert">Allocated total {money(allocatedAmount)} is greater than the payment amount {money(validPaymentAmount)}.</p> : null}
        </section>

        {formError ? <p className="form-error payment-form-error" role="alert">{formError}</p> : null}
        <footer className="payment-save-bar">
          <div><strong>{selectedParty ? selectedParty.name : 'No party selected'}</strong><span>{allocatedAmount > 0.005 ? `${money(allocatedAmount)} allocated across ${allocations.length} invoice${allocations.length === 1 ? '' : 's'}` : 'No invoice allocation — payment will remain on account'}</span></div>
          <div><button className="outline-button" type="button" onClick={() => onNavigate('payments')} disabled={isSaving}>Cancel</button><button className="primary-action-button" type="button" onClick={() => void save()} disabled={isSaving || Boolean(loadError)}>{isSaving ? 'Recording…' : 'Record payment'}</button></div>
        </footer>
      </section>
    </main>
  )
}
