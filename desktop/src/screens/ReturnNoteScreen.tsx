import { useEffect, useMemo, useRef, useState } from 'react'
import { BillingInternetNotice } from '../components/BillingInternetNotice'
import { DesktopSidebar, type DesktopPage } from '../components/DesktopSidebar'
import { useAuth } from '../context/AuthContext'
import { useBusiness } from '../context/BusinessContext'
import { BILLING_CONNECTION_MESSAGE, useSyncStatus } from '../context/SyncStatusContext'
import { calculateReturnNoteTotals, roundQuantity } from '../lib/returnNoteUtils'
import { subscribeToInvoiceDetail, subscribeToInvoices } from '../repositories/invoicesRepository'
import { createConfirmedReturnNote, subscribeToReturnedItemBalances } from '../repositories/returnNotesRepository'
import type { InvoiceDetail, InvoiceKind, InvoiceListItem } from '../types/invoice'
import { PAYMENT_MODES, type PaymentMode } from '../types/payment'
import type { CreatedReturnNote, ReturnedItemBalance, ReturnNoteKind, ReturnSettlementMethod } from '../types/returnNote'
import { sourceInvoiceKindForReturnNote } from '../types/returnNote'

interface ReturnNoteScreenProps {
  noteKind: ReturnNoteKind
  initialSourceInvoiceId?: string | null
  onNavigate: (page: DesktopPage) => void
  onOpenInvoice: (kind: InvoiceKind, invoiceId: string) => void
}

const QUANTITY_EPSILON = 0.000001

function todayInIndia(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

function money(value: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value)
}

function dateLabel(value: string): string {
  if (!value) return '—'
  const dateOnly = value.match(/^\d{4}-\d{2}-\d{2}/)?.[0]
  const parsed = new Date(dateOnly ? `${dateOnly}T12:00:00` : value)
  return Number.isNaN(parsed.valueOf()) ? value : new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(parsed)
}

function noteLabel(kind: ReturnNoteKind): string {
  return kind === 'CREDIT' ? 'Credit note' : 'Debit note'
}

function sourceLabel(kind: ReturnNoteKind): string {
  return kind === 'CREDIT' ? 'Sales invoice' : 'Purchase invoice'
}

function pageForNote(kind: ReturnNoteKind): DesktopPage {
  return kind === 'CREDIT' ? 'creditNote' : 'debitNote'
}

function parseQuantity(raw: string | undefined): number {
  if (!raw?.trim()) return 0
  const value = Number(raw)
  return Number.isFinite(value) ? value : Number.NaN
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The return note could not be saved. Please try again.'
}

export function ReturnNoteScreen({ noteKind, initialSourceInvoiceId = null, onNavigate, onOpenInvoice }: ReturnNoteScreenProps) {
  const { user, signOut } = useAuth()
  const { isOnline } = useSyncStatus()
  const { selectedBusiness, selectedBusinessId, clearBusinessSelection } = useBusiness()
  const sourceKind = sourceInvoiceKindForReturnNote(noteKind)
  const [invoices, setInvoices] = useState<InvoiceListItem[]>([])
  const [invoicesLoading, setInvoicesLoading] = useState(true)
  const [invoicesError, setInvoicesError] = useState<string | null>(null)
  const [sourceInvoiceId, setSourceInvoiceId] = useState('')
  const [sourceInvoice, setSourceInvoice] = useState<InvoiceDetail | null>(null)
  const [sourceLoading, setSourceLoading] = useState(false)
  const [sourceError, setSourceError] = useState<string | null>(null)
  const [returnedBalances, setReturnedBalances] = useState<ReturnedItemBalance[]>([])
  const [returnQtyInputs, setReturnQtyInputs] = useState<Record<string, string>>({})
  const [noteDate, setNoteDate] = useState(todayInIndia)
  const [settlementMethod, setSettlementMethod] = useState<ReturnSettlementMethod>('APPLY_TO_INVOICE')
  const [refundPaymentMode, setRefundPaymentMode] = useState<PaymentMode>('CASH')
  const [refundReference, setRefundReference] = useState('')
  const [note, setNote] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [savedNote, setSavedNote] = useState<CreatedReturnNote | null>(null)
  const appliedInitialSource = useRef<string | null>(null)

  useEffect(() => {
    if (!user || !selectedBusinessId) return
    setInvoicesLoading(true)
    setInvoicesError(null)
    return subscribeToInvoices(
      user.uid,
      selectedBusinessId,
      sourceKind,
      (nextInvoices) => {
        setInvoices(nextInvoices)
        setInvoicesLoading(false)
      },
      (error) => {
        setInvoicesError(error.message || `${sourceLabel(noteKind)}s could not be loaded.`)
        setInvoicesLoading(false)
      },
    )
  }, [noteKind, selectedBusinessId, sourceKind, user?.uid])

  useEffect(() => {
    if (!initialSourceInvoiceId || appliedInitialSource.current === initialSourceInvoiceId) return
    appliedInitialSource.current = initialSourceInvoiceId
    setSourceInvoiceId(initialSourceInvoiceId)
  }, [initialSourceInvoiceId])

  useEffect(() => {
    setSourceInvoice(null)
    setReturnedBalances([])
    setReturnQtyInputs({})
    setFormError(null)
    setSavedNote(null)
    if (!user || !selectedBusinessId || !sourceInvoiceId) {
      setSourceLoading(false)
      setSourceError(null)
      return
    }
    setSourceLoading(true)
    setSourceError(null)
    return subscribeToInvoiceDetail(
      user.uid,
      selectedBusinessId,
      sourceKind,
      sourceInvoiceId,
      (nextInvoice) => {
        setSourceInvoice(nextInvoice)
        setSourceLoading(false)
      },
      (error) => {
        setSourceError(error.message || 'The source invoice could not be loaded.')
        setSourceLoading(false)
      },
    )
  }, [sourceInvoiceId, sourceKind, selectedBusinessId, user?.uid])

  useEffect(() => {
    if (!user || !selectedBusinessId || !sourceInvoiceId) return
    return subscribeToReturnedItemBalances(
      user.uid,
      selectedBusinessId,
      sourceKind,
      sourceInvoiceId,
      setReturnedBalances,
      (error) => setSourceError(error.message || 'Returned quantities could not be loaded.'),
    )
  }, [sourceInvoiceId, sourceKind, selectedBusinessId, user?.uid])

  const selectableInvoices = useMemo(
    () => invoices.filter((invoice) => invoice.status === 'CONFIRMED'),
    [invoices],
  )
  const returnedByItemId = useMemo(
    () => new Map(returnedBalances.map((balance) => [balance.sourceInvoiceItemId, balance.returnedQty])),
    [returnedBalances],
  )
  const requestedLines = useMemo(() => (
    sourceInvoice?.items.flatMap((item) => {
      const qty = parseQuantity(returnQtyInputs[item.id])
      return Number.isFinite(qty) && qty > 0 ? [{ sourceInvoiceItemId: item.id, qty }] : []
    }) ?? []
  ), [returnQtyInputs, sourceInvoice?.items])
  const totals = useMemo(
    () => calculateReturnNoteTotals(sourceInvoice?.items ?? [], requestedLines),
    [requestedLines, sourceInvoice?.items],
  )
  const returnLineByItemId = useMemo(
    () => new Map(totals.lineTotals.map((line) => [line.sourceInvoiceItemId, line])),
    [totals.lineTotals],
  )
  const invalidQuantityItem = useMemo(() => sourceInvoice?.items.find((item) => {
    const entered = parseQuantity(returnQtyInputs[item.id])
    const alreadyReturned = returnedByItemId.get(item.id) ?? 0
    const available = Math.max(0, roundQuantity(item.qty - alreadyReturned))
    return !Number.isFinite(entered) || entered < 0 || entered > available + QUANTITY_EPSILON
  }) ?? null, [returnQtyInputs, returnedByItemId, sourceInvoice?.items])
  const settlementExceedsBalance = Boolean(
    sourceInvoice
    && settlementMethod === 'APPLY_TO_INVOICE'
    && totals.grandTotal > sourceInvoice.balanceAmount + 0.005,
  )

  if (!user || !selectedBusiness || !selectedBusinessId) return null

  const setSource = (invoiceId: string) => {
    setSourceInvoiceId(invoiceId)
    setSettlementMethod('APPLY_TO_INVOICE')
  }

  const setReturnQty = (itemId: string, value: string) => {
    setReturnQtyInputs((current) => ({ ...current, [itemId]: value }))
    setFormError(null)
    setSavedNote(null)
  }

  const chooseSettlement = (method: ReturnSettlementMethod) => {
    setSettlementMethod(method)
    setFormError(null)
    setSavedNote(null)
  }

  const save = async () => {
    if (!isOnline) {
      setFormError(BILLING_CONNECTION_MESSAGE)
      return
    }
    if (!sourceInvoice) {
      setFormError(`Select a confirmed ${sourceLabel(noteKind).toLowerCase()} first.`)
      return
    }
    if (sourceInvoice.status !== 'CONFIRMED') {
      setFormError('Only a confirmed invoice can receive a return note.')
      return
    }
    if (invalidQuantityItem) {
      setFormError(`Check the return quantity for ${invalidQuantityItem.name}; it cannot be more than the original available quantity.`)
      return
    }
    if (!requestedLines.length) {
      setFormError('Enter a return quantity for at least one item.')
      return
    }
    if (settlementExceedsBalance) {
      setFormError(`The note total is more than the outstanding ${money(sourceInvoice.balanceAmount)}. Choose a refund payment or leave the amount on account.`)
      return
    }

    setIsSaving(true)
    setFormError(null)
    try {
      const created = await createConfirmedReturnNote(user.uid, selectedBusinessId, {
        kind: noteKind,
        sourceInvoiceId: sourceInvoice.id,
        noteDate,
        lines: requestedLines,
        settlementMethod,
        refundPaymentMode: settlementMethod === 'REFUND_PAYMENT' ? refundPaymentMode : undefined,
        refundReference,
        note,
      })
      setSavedNote(created)
      setReturnQtyInputs({})
      setRefundReference('')
      setNote('')
    } catch (error) {
      setFormError(errorMessage(error))
    } finally {
      setIsSaving(false)
    }
  }

  const resetForm = () => {
    setSourceInvoiceId('')
    setSourceInvoice(null)
    setReturnedBalances([])
    setReturnQtyInputs({})
    setSettlementMethod('APPLY_TO_INVOICE')
    setRefundPaymentMode('CASH')
    setRefundReference('')
    setNote('')
    setNoteDate(todayInIndia())
    setFormError(null)
    setSavedNote(null)
  }

  const sourcePartyLabel = noteKind === 'CREDIT' ? 'Customer' : 'Supplier'
  const pluralInvoice = `${sourceLabel(noteKind).toLowerCase()}s`

  return (
    <main className="desktop-layout">
      <DesktopSidebar activePage={pageForNote(noteKind)} onNavigate={onNavigate} />
      <section className="dashboard-content return-note-content">
        <header className="dashboard-header">
          <div>
            <button className="back-link-button" type="button" onClick={() => onNavigate(noteKind === 'CREDIT' ? 'salesInvoices' : 'purchaseInvoices')}>← {noteKind === 'CREDIT' ? 'Sales invoices' : 'Purchase invoices'}</button>
            <p className="breadcrumb">SHOWROOM / {noteKind === 'CREDIT' ? 'SALES' : 'PURCHASES'} / {noteLabel(noteKind).toUpperCase()}</p>
            <h1>Create {noteLabel(noteKind).toLowerCase()}</h1>
            <p>{noteKind === 'CREDIT' ? 'Select sold items returned by the customer. Confirming restores inventory with SALE_RETURN entries.' : 'Select purchased items returned to the supplier. Confirming removes inventory with PURCHASE_RETURN entries.'}</p>
          </div>
          <div className="header-actions">
            <button className="outline-button" type="button" onClick={clearBusinessSelection}>Switch business</button>
            <button className="user-button" type="button" onClick={() => void signOut()} title="Sign out">{(user.displayName ?? user.email ?? 'U').slice(0, 1).toUpperCase()}</button>
          </div>
        </header>

        <BillingInternetNotice />
        {invoicesError || sourceError ? <div className="settings-error" role="alert">{invoicesError || sourceError}</div> : null}
        {savedNote ? <section className="return-note-success" role="status"><div><strong>{savedNote.number} posted</strong><span>{money(savedNote.grandTotal)} {savedNote.appliedToInvoiceAmount ? `was applied to the source invoice balance.` : savedNote.refundAmount ? `was recorded as a refund payment.` : 'remains as a party credit/debit.'}</span></div><button className="table-action-button" type="button" onClick={() => onOpenInvoice(sourceKind, savedNote.sourceInvoiceId)}>View source invoice</button><button className="outline-button compact-action" type="button" onClick={resetForm}>Create another</button></section> : null}

        <section className="return-note-source-card">
          <div className="return-note-card-heading"><div><span className="invoice-step">01</span><h2>Select the original {sourceLabel(noteKind).toLowerCase()}</h2><p>Only confirmed documents are eligible. Original item snapshots are used as the return pricing and GST source.</p></div></div>
          <div className="return-note-source-grid">
            <label className="form-field"><span>{sourceLabel(noteKind)} <b>*</b></span><select value={sourceInvoiceId} disabled={invoicesLoading} onChange={(event) => setSource(event.target.value)}><option value="">{invoicesLoading ? `Loading ${pluralInvoice}…` : `Select confirmed ${sourceLabel(noteKind).toLowerCase()}`}</option>{selectableInvoices.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.number} · {invoice.partyName} · {money(invoice.grandTotal)} · balance {money(invoice.balanceAmount)}</option>)}</select>{!invoicesLoading && !selectableInvoices.length ? <small className="field-helper">No confirmed {pluralInvoice} are available for a return note.</small> : null}</label>
            <label className="form-field"><span>{noteLabel(noteKind)} date <b>*</b></span><input type="date" value={noteDate} onChange={(event) => { setNoteDate(event.target.value || todayInIndia()); setSavedNote(null) }} /></label>
          </div>
          {sourceLoading ? <div className="settings-loading">Loading immutable source items…</div> : null}
          {sourceInvoice ? <div className="return-source-summary"><article><span>{sourcePartyLabel}</span><strong>{sourceInvoice.partyName}</strong><small>{[sourceInvoice.partyPhone, sourceInvoice.partyGstin].filter(Boolean).join(' · ') || 'Snapshot on source invoice'}</small></article><article><span>Original invoice</span><strong>{sourceInvoice.invoiceNumber}</strong><small>{dateLabel(sourceInvoice.date)} · {sourceInvoice.items.length} item snapshot{sourceInvoice.items.length === 1 ? '' : 's'}</small></article><article><span>Current outstanding balance</span><strong>{money(sourceInvoice.balanceAmount)}</strong><small>{sourceInvoice.paymentStatus.toLowerCase()} payment status</small></article></div> : null}
        </section>

        {sourceInvoice ? <>
          <section className="return-note-items-card">
            <div className="return-note-card-heading"><div><span className="invoice-step">02</span><h2>Choose returned items and quantities</h2><p>Previous return quantities are locked in the audit trail. Only the remaining original quantity can be returned.</p></div><span className="return-note-item-count">{requestedLines.length} selected</span></div>
            {sourceInvoice.items.length ? <div className="invoice-lines-wrap"><table className="return-note-items-table"><thead><tr><th>Posted item snapshot</th><th>Original</th><th>Already returned</th><th>Available</th><th>Return qty</th><th>Taxable</th><th>{sourceInvoice.taxType === 'IGST' ? 'IGST' : 'GST'}</th><th>Return total</th></tr></thead><tbody>{sourceInvoice.items.map((item) => {
              const alreadyReturned = returnedByItemId.get(item.id) ?? 0
              const available = Math.max(0, roundQuantity(item.qty - alreadyReturned))
              const line = returnLineByItemId.get(item.id)
              const entered = returnQtyInputs[item.id] ?? ''
              const isInvalid = entered !== '' && (!Number.isFinite(parseQuantity(entered)) || parseQuantity(entered) < 0 || parseQuantity(entered) > available + QUANTITY_EPSILON)
              return <tr key={item.id} className={isInvalid ? 'return-note-invalid-row' : ''}><td><div className="invoice-line-product"><strong>{item.name}</strong><small>{[item.code, item.hsn ? `HSN ${item.hsn}` : '', item.unit, `Rate ${money(item.rate)}`, `GST ${item.gstPercent}%`].filter(Boolean).join(' · ')}</small></div></td><td>{item.qty} {item.unit}</td><td>{roundQuantity(alreadyReturned)} {item.unit}</td><td><strong>{available} {item.unit}</strong></td><td><label className="return-qty-input"><span className="sr-only">Return quantity for {item.name}</span><input type="number" min="0" max={available} step="0.001" inputMode="decimal" disabled={available <= QUANTITY_EPSILON || isSaving} value={entered} placeholder="0" onChange={(event) => setReturnQty(item.id, event.target.value)} /></label>{isInvalid ? <small className="return-qty-error">Maximum {available}</small> : null}</td><td>{line ? money(line.taxableAfterBillDiscount) : '—'}</td><td>{line ? sourceInvoice.taxType === 'IGST' ? money(line.igstAmount) : `${money(line.cgstAmount)} + ${money(line.sgstAmount)}` : '—'}</td><td><strong>{line ? money(line.lineTotal) : '—'}</strong></td></tr>
            })}</tbody></table></div> : <p className="invoice-detail-empty">The selected invoice has no immutable item snapshots, so a return note cannot be posted safely.</p>}
          </section>

          <div className="return-note-bottom-grid">
            <section className="return-note-settlement-card">
              <div className="return-note-card-heading"><div><span className="invoice-step">03</span><h2>Settle the return</h2><p>Choose how the {noteLabel(noteKind).toLowerCase()} should affect the source invoice and party ledger.</p></div></div>
              <div className="return-settlement-options" role="radiogroup" aria-label="Return settlement method">
                <button className={settlementMethod === 'APPLY_TO_INVOICE' ? 'selected' : ''} type="button" role="radio" aria-checked={settlementMethod === 'APPLY_TO_INVOICE'} disabled={isSaving} onClick={() => chooseSettlement('APPLY_TO_INVOICE')}><strong>Apply to source invoice</strong><span>{noteKind === 'CREDIT' ? 'Reduce the customer’s outstanding invoice balance.' : 'Reduce the supplier payable on the source invoice.'}</span></button>
                <button className={settlementMethod === 'REFUND_PAYMENT' ? 'selected' : ''} type="button" role="radio" aria-checked={settlementMethod === 'REFUND_PAYMENT'} disabled={isSaving} onClick={() => chooseSettlement('REFUND_PAYMENT')}><strong>{noteKind === 'CREDIT' ? 'Pay customer refund' : 'Record supplier refund'}</strong><span>{noteKind === 'CREDIT' ? 'Create an OUT payment to the customer.' : 'Create an IN payment from the supplier.'}</span></button>
                <button className={settlementMethod === 'ON_ACCOUNT' ? 'selected' : ''} type="button" role="radio" aria-checked={settlementMethod === 'ON_ACCOUNT'} disabled={isSaving} onClick={() => chooseSettlement('ON_ACCOUNT')}><strong>Leave on account</strong><span>{noteKind === 'CREDIT' ? 'Keep this as a customer credit / payable.' : 'Keep this as a supplier debit / receivable.'}</span></button>
              </div>
              {settlementExceedsBalance ? <p className="form-error">The return total exceeds this invoice’s current balance of {money(sourceInvoice.balanceAmount)}. Apply only an amount within the balance, or select refund / on account.</p> : null}
              {settlementMethod === 'REFUND_PAYMENT' ? <div className="return-refund-fields"><label className="form-field"><span>{noteKind === 'CREDIT' ? 'Refund' : 'Receipt'} mode <b>*</b></span><select value={refundPaymentMode} onChange={(event) => setRefundPaymentMode(event.target.value as PaymentMode)}>{PAYMENT_MODES.map((mode) => <option key={mode} value={mode}>{mode}</option>)}</select></label><label className="form-field"><span>Reference number</span><input value={refundReference} maxLength={120} placeholder="UPI, UTR, cheque, or receipt reference" onChange={(event) => setRefundReference(event.target.value)} /></label></div> : null}
              <label className="form-field return-note-comment"><span>Reason / internal note</span><textarea value={note} maxLength={1000} placeholder={noteKind === 'CREDIT' ? 'e.g. Customer returned damaged items' : 'e.g. Goods returned to supplier for quality issue'} onChange={(event) => { setNote(event.target.value); setSavedNote(null) }} /></label>
            </section>

            <aside className="invoice-summary-card return-note-summary">
              <div className="invoice-summary-heading"><span>{noteLabel(noteKind).toUpperCase()} TOTALS</span><strong>{sourceInvoice.taxType === 'IGST' ? 'IGST' : 'CGST + SGST'}</strong></div>
              <dl className="invoice-summary-list"><div><dt>Returned quantity</dt><dd>{totals.totalQty}</dd></div><div><dt>Gross amount</dt><dd>{money(totals.subtotal)}</dd></div><div><dt>Line discount</dt><dd>−{money(totals.lineDiscountAmount)}</dd></div><div><dt>Bill discount share</dt><dd>−{money(totals.billDiscount)}</dd></div><div className="summary-taxable"><dt>Taxable amount</dt><dd>{money(totals.taxableAmount)}</dd></div>{sourceInvoice.taxType === 'IGST' ? <div><dt>IGST</dt><dd>{money(totals.igstAmount)}</dd></div> : <><div><dt>CGST</dt><dd>{money(totals.cgstAmount)}</dd></div><div><dt>SGST</dt><dd>{money(totals.sgstAmount)}</dd></div></>}<div><dt>Round off</dt><dd>{totals.roundOff >= 0 ? '+' : '−'}{money(Math.abs(totals.roundOff))}</dd></div><div className="grand-total-row"><dt>Grand total</dt><dd>{money(totals.grandTotal)}</dd></div></dl>
              <div className="return-note-integrity-copy"><strong>{noteKind === 'CREDIT' ? 'Stock will increase' : 'Stock will decrease'}</strong><span>{noteKind === 'CREDIT' ? 'Each line posts a SALE_RETURN stock transaction.' : 'Each line posts a PURCHASE_RETURN stock transaction after stock validation.'}</span></div>
              <button className="primary-action-button return-note-save-button" type="button" disabled={isSaving || !isOnline || !requestedLines.length || Boolean(invalidQuantityItem) || settlementExceedsBalance || !sourceInvoice.items.length} onClick={() => void save()}>{isSaving ? 'Saving transaction…' : `Save ${noteLabel(noteKind)}`}</button>
              <button className="outline-button compact-action return-note-reset" type="button" disabled={isSaving} onClick={resetForm}>Clear return</button>
              {formError ? <p className="form-error" role="alert">{formError}</p> : null}
            </aside>
          </div>
        </> : null}

        {!sourceInvoice && !sourceLoading && !sourceInvoiceId && !invoicesLoading ? <section className="return-note-empty-state"><span aria-hidden="true">↩</span><h2>Select a confirmed {sourceLabel(noteKind).toLowerCase()}</h2><p>Its posted item snapshots will determine the return quantity limits, taxable values, GST, and total.</p></section> : null}
      </section>
    </main>
  )
}
