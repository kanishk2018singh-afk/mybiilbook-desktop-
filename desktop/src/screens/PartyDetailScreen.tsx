import { useEffect, useMemo, useState } from 'react'
import { DesktopSidebar, type DesktopPage } from '../components/DesktopSidebar'
import { useAuth } from '../context/AuthContext'
import { useBusiness } from '../context/BusinessContext'
import { calculatePartyBalance } from '../lib/partyBalance'
import { subscribeToParty, subscribeToPartyActivity } from '../repositories/partiesRepository'
import type { Party, PartyActivity } from '../types/party'

interface PartyDetailScreenProps {
  partyId: string
  onNavigate: (page: DesktopPage) => void
  onBack: () => void
}

const EMPTY_ACTIVITY: PartyActivity = { salesInvoices: [], purchaseInvoices: [], creditNotes: [], debitNotes: [], payments: [] }

function money(value: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value)
}

function signedMoney(value: number): string {
  return `${value >= 0 ? '+' : '−'}${money(Math.abs(value))}`
}

function dateLabel(value: string): string {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.valueOf()) ? value : new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(parsed)
}

function activityTimestamp(value: string): number {
  const timestamp = new Date(value).valueOf()
  return Number.isNaN(timestamp) ? 0 : timestamp
}

interface LedgerEntry {
  id: string
  date: string
  label: string
  detail: string
  signedAmount: number
  kind: 'sale' | 'purchase' | 'credit-note' | 'debit-note' | 'payment-in' | 'payment-out'
  isAllocated?: boolean
}

function toLedgerEntries(activity: PartyActivity): LedgerEntry[] {
  const sales: LedgerEntry[] = activity.salesInvoices.map((invoice) => ({
    id: `sale-${invoice.id}`,
    date: invoice.date,
    label: invoice.number,
    detail: 'Sales invoice balance',
    signedAmount: invoice.status === 'CANCELLED' ? 0 : invoice.balanceAmount,
    kind: 'sale',
  }))
  const purchases: LedgerEntry[] = activity.purchaseInvoices.map((invoice) => ({
    id: `purchase-${invoice.id}`,
    date: invoice.date,
    label: invoice.number,
    detail: 'Purchase invoice balance',
    signedAmount: invoice.status === 'CANCELLED' ? 0 : -invoice.balanceAmount,
    kind: 'purchase',
  }))
  const creditNotes: LedgerEntry[] = activity.creditNotes.map((note) => ({
    id: `credit-note-${note.id}`,
    date: note.date,
    label: note.number,
    detail: note.settlementMethod === 'APPLY_TO_INVOICE' ? `Credit note applied to ${note.sourceInvoiceNumber || 'source invoice'}` : `Credit note from ${note.sourceInvoiceNumber || 'source invoice'}`,
    signedAmount: note.status === 'CANCELLED' ? 0 : -note.partyBalanceEffectAmount,
    kind: 'credit-note',
  }))
  const debitNotes: LedgerEntry[] = activity.debitNotes.map((note) => ({
    id: `debit-note-${note.id}`,
    date: note.date,
    label: note.number,
    detail: note.settlementMethod === 'APPLY_TO_INVOICE' ? `Debit note applied to ${note.sourceInvoiceNumber || 'source invoice'}` : `Debit note from ${note.sourceInvoiceNumber || 'source invoice'}`,
    signedAmount: note.status === 'CANCELLED' ? 0 : note.partyBalanceEffectAmount,
    kind: 'debit-note',
  }))
  const payments: LedgerEntry[] = activity.payments.map((payment) => {
    const onAccountAmount = typeof payment.unallocatedAmount === 'number'
      ? Math.max(0, payment.unallocatedAmount)
      : payment.invoiceId ? 0 : payment.amount
    const allocatedAmount = typeof payment.allocatedAmount === 'number'
      ? Math.max(0, payment.allocatedAmount)
      : Math.max(0, payment.amount - onAccountAmount)
    const paymentDetail = [
      payment.note || payment.mode || 'Payment entry',
      allocatedAmount > 0.005 ? `${money(allocatedAmount)} allocated to invoice${payment.allocationCount && payment.allocationCount > 1 ? 's' : ''}` : '',
      onAccountAmount > 0.005 ? `${money(onAccountAmount)} on account` : '',
    ].filter(Boolean).join(' · ')

    return {
      id: `payment-${payment.id}`,
      date: payment.date,
      label: `${payment.direction === 'IN' ? 'Money received' : 'Money paid'} · ${money(payment.amount)}`,
      detail: paymentDetail,
      // Linked amounts are already represented by invoice balances. The ledger
      // total only displays the payment portion that remains on account.
      signedAmount: payment.direction === 'IN' ? -onAccountAmount : onAccountAmount,
      kind: payment.direction === 'IN' ? 'payment-in' : 'payment-out',
      isAllocated: allocatedAmount > 0.005 && onAccountAmount <= 0.005,
    }
  })
  return [...sales, ...purchases, ...creditNotes, ...debitNotes, ...payments].sort((left, right) => activityTimestamp(right.date) - activityTimestamp(left.date))
}

export function PartyDetailScreen({ partyId, onNavigate, onBack }: PartyDetailScreenProps) {
  const { user, signOut } = useAuth()
  const { selectedBusiness, selectedBusinessId, clearBusinessSelection } = useBusiness()
  const [party, setParty] = useState<Party | null>(null)
  const [activity, setActivity] = useState<PartyActivity>(EMPTY_ACTIVITY)
  const [partyLoading, setPartyLoading] = useState(true)
  const [activityLoading, setActivityLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!user || !selectedBusinessId) return
    setPartyLoading(true)
    setActivityLoading(true)
    setParty(null)
    setActivity(EMPTY_ACTIVITY)
    setError(null)
    const unsubscribeParty = subscribeToParty(
      user.uid,
      selectedBusinessId,
      partyId,
      (nextParty) => {
        setParty(nextParty)
        setPartyLoading(false)
      },
      (listenerError) => {
        setError(listenerError.message || 'Party could not be loaded.')
        setPartyLoading(false)
      },
    )
    const unsubscribeActivity = subscribeToPartyActivity(
      user.uid,
      selectedBusinessId,
      partyId,
      (nextActivity) => {
        setActivity(nextActivity)
        setActivityLoading(false)
      },
      (listenerError) => {
        setError(listenerError.message || 'Party activity could not be loaded.')
        setActivityLoading(false)
      },
    )
    return () => {
      unsubscribeParty()
      unsubscribeActivity()
    }
  }, [partyId, selectedBusinessId, user?.uid])

  const balance = useMemo(() => (party ? calculatePartyBalance(party, activity) : null), [activity, party])
  const ledgerEntries = useMemo(() => toLedgerEntries(activity), [activity])

  if (!user || !selectedBusiness || !selectedBusinessId) return null

  const loading = partyLoading || activityLoading
  if (!loading && !party && !error) {
    return (
      <main className="desktop-layout">
        <DesktopSidebar activePage="parties" onNavigate={onNavigate} />
        <section className="dashboard-content"><section className="empty-master-state"><div className="empty-icon" aria-hidden="true">?</div><h2>Party not found</h2><p>This party may have been deleted in another client.</p><button className="primary-action-button" type="button" onClick={onBack}>Back to parties</button></section></section>
      </main>
    )
  }

  return (
    <main className="desktop-layout">
      <DesktopSidebar activePage="parties" onNavigate={onNavigate} />
      <section className="dashboard-content party-detail-content">
        <header className="dashboard-header">
          <div>
            <button className="back-link-button" type="button" onClick={onBack}>← All parties</button>
            <p className="breadcrumb">SHOWROOM / PARTY LEDGER</p>
            <h1>{party?.name ?? 'Loading party…'}</h1>
            <p>{party ? [party.phone, party.email, party.city || party.state].filter(Boolean).join(' · ') || 'Party account details' : 'Loading account details…'}</p>
          </div>
          <div className="header-actions">
            <button className="outline-button" type="button" onClick={clearBusinessSelection}>Switch business</button>
            <button className="user-button" type="button" onClick={() => void signOut()} title="Sign out">{(user.displayName ?? user.email ?? 'U').slice(0, 1).toUpperCase()}</button>
          </div>
        </header>

        {error ? <div className="settings-error" role="alert">{error}</div> : null}
        {loading ? <div className="settings-loading">Loading party ledger and current balance…</div> : null}
        {!loading && error ? <section className="empty-master-state"><div className="empty-icon" aria-hidden="true">!</div><h2>Ledger unavailable</h2><p>The complete party balance cannot be calculated until all party activity can be read.</p><button className="outline-button" type="button" onClick={onBack}>Back to parties</button></section> : null}
        {!loading && !error && party && balance ? (
          <>
            <section className={`party-balance-hero ${balance.position.toLowerCase()}`}>
              <div>
                <span className="status-chip"><span className="live-dot" /> Live calculated balance</span>
                <p className="party-balance-label">{balance.position === 'SETTLED' ? 'Account settled' : balance.position === 'RECEIVABLE' ? 'Receivable from party' : 'Payable to party'}</p>
                <h2>{money(balance.amount)}</h2>
                <p>{balance.position === 'SETTLED' ? 'There is no outstanding balance.' : balance.position === 'RECEIVABLE' ? 'The party currently owes this amount to the showroom.' : 'The showroom currently owes this amount to the party.'}</p>
              </div>
              <div className="party-contact-card">
                <span>Party profile</span>
                <strong>{party.type === 'BOTH' ? 'Customer & supplier' : party.type.charAt(0) + party.type.slice(1).toLowerCase()}</strong>
                <small>{party.gstin ? `GSTIN ${party.gstin}` : party.address || 'No address recorded'}</small>
                <small>Credit limit {money(party.creditLimit)} · {party.creditDays} days</small>
              </div>
            </section>

            <section className="balance-breakdown-grid" aria-label="Balance calculation">
              <article><span>Opening balance</span><strong className={balance.openingSigned >= 0 ? 'positive' : 'negative'}>{signedMoney(balance.openingSigned)}</strong><small>{party.openingBalanceType.toLowerCase()}</small></article>
              <article><span>Sales invoice balances</span><strong className="positive">+{money(balance.salesInvoiceBalance)}</strong><small>Outstanding customer invoices</small></article>
              <article><span>Purchase invoice balances</span><strong className="negative">−{money(balance.purchaseInvoiceBalance)}</strong><small>Outstanding supplier invoices</small></article>
              <article><span>Credit notes</span><strong className="negative">−{money(balance.creditNoteBalance)}</strong><small>Customer credits not applied to an invoice</small></article>
              <article><span>Debit notes</span><strong className="positive">+{money(balance.debitNoteBalance)}</strong><small>Supplier debits not applied to an invoice</small></article>
              <article><span>On-account money received</span><strong className="negative">−{money(balance.unallocatedMoneyIn)}</strong><small>Reduces receivable</small></article>
              <article><span>On-account money paid</span><strong className="positive">+{money(balance.unallocatedMoneyOut)}</strong><small>Reduces payable</small></article>
            </section>

            <section className="balance-logic-note">
              <strong>How this balance is calculated</strong>
              <p>
                Positive amounts are receivables; negative amounts are payables. The calculation starts with the signed opening balance, adds remaining sales invoice <code>balanceAmount</code>, subtracts remaining purchase invoice <code>balanceAmount</code>, subtracts on-account credit notes, adds on-account debit notes, subtracts unallocated money received, and adds unallocated money paid. Notes applied directly to an invoice are already reflected in that invoice’s balance. Payments linked to an invoice are excluded because the invoice’s remaining balance already reflects them.
              </p>
            </section>

            <section className="party-ledger-card">
              <div className="tree-card-header"><span>Invoice and payment activity</span><small>{ledgerEntries.length} live entries</small></div>
              {ledgerEntries.length ? (
                <div className="party-ledger-list">
                  {ledgerEntries.map((entry) => (
                    <div className="party-ledger-row" key={entry.id}>
                      <span className={`ledger-entry-icon ${entry.kind}`} aria-hidden="true">{entry.kind === 'sale' ? '↗' : entry.kind === 'purchase' ? '↙' : entry.kind === 'credit-note' ? '↩' : entry.kind === 'debit-note' ? '↪' : entry.kind === 'payment-in' ? '↓' : '↑'}</span>
                      <div className="ledger-entry-copy"><strong>{entry.label}</strong><small>{dateLabel(entry.date)} · {entry.detail}{entry.isAllocated ? ' · already reflected in invoice balance' : ''}</small></div>
                      <span className={`ledger-entry-amount ${entry.signedAmount >= 0 ? 'positive' : 'negative'}`}>{signedMoney(entry.signedAmount)}</span>
                    </div>
                  ))}
                </div>
              ) : <div className="ledger-empty">No sales, purchases, return notes, or payment entries are linked to this party yet.</div>}
            </section>
          </>
        ) : null}
      </section>
    </main>
  )
}
