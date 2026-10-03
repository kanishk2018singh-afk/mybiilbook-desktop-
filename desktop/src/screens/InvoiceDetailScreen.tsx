import { useEffect, useState } from 'react'
import { DesktopSidebar, type DesktopPage } from '../components/DesktopSidebar'
import { useAuth } from '../context/AuthContext'
import { useBusiness } from '../context/BusinessContext'
import { exportInvoicePdf } from '../lib/invoicePdf'
import { invoiceKindLabel, invoicePartyLabel, paymentStatusLabel } from '../lib/invoiceUtils'
import { cancelConfirmedInvoice, subscribeToInvoiceDetail } from '../repositories/invoicesRepository'
import type { InvoiceDetail, InvoiceKind } from '../types/invoice'

interface InvoiceDetailScreenProps {
  kind: InvoiceKind
  invoiceId: string
  onNavigate: (page: DesktopPage) => void
  onBack: () => void
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

function listPage(kind: InvoiceKind): DesktopPage {
  return kind === 'SALE' ? 'salesInvoices' : 'purchaseInvoices'
}

function statusLabel(status: InvoiceDetail['status']): string {
  if (status === 'CANCELLED') return 'Cancelled'
  if (status === 'DRAFT') return 'Draft'
  return 'Confirmed'
}

function displayError(error: unknown): string {
  return error instanceof Error ? error.message : 'The invoice could not be cancelled. Please try again.'
}

function itemTaxableAmount(item: InvoiceDetail['items'][number]): number {
  return item.taxableAfterBillDiscount === 0 && item.taxableAmount !== 0 && item.billDiscountAmount === 0
    ? item.taxableAmount
    : item.taxableAfterBillDiscount
}

export function InvoiceDetailScreen({ kind, invoiceId, onNavigate, onBack }: InvoiceDetailScreenProps) {
  const { user, signOut } = useAuth()
  const { selectedBusiness, selectedBusinessId, clearBusinessSelection } = useBusiness()
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false)
  const [cancellationReason, setCancellationReason] = useState('')
  const [cancelError, setCancelError] = useState<string | null>(null)
  const [isCancelling, setIsCancelling] = useState(false)
  const [pdfError, setPdfError] = useState<string | null>(null)

  useEffect(() => {
    if (!user || !selectedBusinessId) return
    setInvoice(null)
    setIsLoading(true)
    setLoadError(null)
    setPdfError(null)
    return subscribeToInvoiceDetail(
      user.uid,
      selectedBusinessId,
      kind,
      invoiceId,
      (nextInvoice) => {
        setInvoice(nextInvoice)
        setIsLoading(false)
      },
      (error) => {
        setLoadError(error.message || 'Invoice details could not be loaded.')
        setIsLoading(false)
      },
    )
  }, [invoiceId, kind, selectedBusinessId, user?.uid])

  if (!user || !selectedBusiness || !selectedBusinessId) return null

  const openCancelDialog = () => {
    setCancellationReason('')
    setCancelError(null)
    setCancelDialogOpen(true)
  }
  const printInvoice = async () => {
    if (!invoice) return
    setPdfError(null)
    try {
      await exportInvoicePdf(invoice, selectedBusiness)
    } catch (error) {
      setPdfError(error instanceof Error ? error.message : 'The PDF could not be generated. Please try again.')
    }
  }
  const cancelInvoice = async () => {
    if (!invoice) return
    setIsCancelling(true)
    setCancelError(null)
    try {
      await cancelConfirmedInvoice(user.uid, selectedBusinessId, kind, invoice.id, cancellationReason)
      setCancelDialogOpen(false)
    } catch (error) {
      setCancelError(displayError(error))
    } finally {
      setIsCancelling(false)
    }
  }

  const title = `${invoiceKindLabel(kind)} invoice`
  const partyLabel = invoicePartyLabel(kind)

  if (!isLoading && !loadError && !invoice) {
    return (
      <main className="desktop-layout">
        <DesktopSidebar activePage={listPage(kind)} onNavigate={onNavigate} />
        <section className="dashboard-content"><section className="empty-master-state"><div className="empty-icon" aria-hidden="true">?</div><h2>Invoice not found</h2><p>This invoice may have been deleted in another client.</p><button className="primary-action-button" type="button" onClick={onBack}>Back to {invoiceKindLabel(kind).toLowerCase()} invoices</button></section></section>
      </main>
    )
  }

  return (
    <main className="desktop-layout">
      <DesktopSidebar activePage={listPage(kind)} onNavigate={onNavigate} />
      <section className="dashboard-content invoice-detail-content">
        <header className="dashboard-header">
          <div>
            <button className="back-link-button" type="button" onClick={onBack}>← All {invoiceKindLabel(kind).toLowerCase()} invoices</button>
            <p className="breadcrumb">SHOWROOM / {kind === 'SALE' ? 'SALES' : 'PURCHASES'} / INVOICE</p>
            <h1>{invoice ? invoice.invoiceNumber : `Loading ${title.toLowerCase()}…`}</h1>
            <p>{invoice ? `${invoice.partyName} · ${dateLabel(invoice.date)}` : 'Loading immutable invoice snapshots and linked payments…'}</p>
          </div>
          <div className="header-actions">
            {invoice ? <button className="outline-button" type="button" onClick={() => void printInvoice()}>Print Invoice (PDF)</button> : null}
            <button className="outline-button" type="button" onClick={clearBusinessSelection}>Switch business</button>
            <button className="user-button" type="button" onClick={() => void signOut()} title="Sign out">{(user.displayName ?? user.email ?? 'U').slice(0, 1).toUpperCase()}</button>
          </div>
        </header>

        {loadError ? <div className="settings-error" role="alert">{loadError}</div> : null}
        {pdfError ? <div className="settings-error" role="alert">{pdfError}</div> : null}
        {isLoading ? <div className="settings-loading">Loading {title.toLowerCase()}…</div> : null}

        {!isLoading && !loadError && invoice ? (
          <div className="invoice-detail-workspace">
            <div className="invoice-detail-main">
              <section className="invoice-detail-hero">
                <div>
                  <span className={`invoice-status-pill ${invoice.status.toLowerCase()}`}>{statusLabel(invoice.status)}</span>
                  <h2>{invoice.invoiceNumber}</h2>
                  <p>{kind === 'SALE' ? 'Tax invoice issued to' : 'Purchase bill received from'} <strong>{invoice.partyName}</strong></p>
                </div>
                <dl>
                  <div><dt>{kind === 'SALE' ? 'Invoice date' : 'Purchase date'}</dt><dd>{dateLabel(invoice.date)}</dd></div>
                  {kind === 'PURCHASE' ? <div><dt>Supplier bill no.</dt><dd>{invoice.supplierInvoiceNumber || '—'}</dd></div> : null}
                  <div><dt>Payment status</dt><dd><span className={`payment-status ${invoice.paymentStatus.toLowerCase()}`}>{paymentStatusLabel(invoice.paymentStatus)}</span></dd></div>
                  <div><dt>Grand total</dt><dd>{money(invoice.grandTotal)}</dd></div>
                </dl>
              </section>

              {invoice.status === 'CANCELLED' ? <section className="invoice-cancelled-banner"><strong>Cancelled on {dateLabel(invoice.cancelledAt)}</strong><span>{invoice.cancellationReason ? `Reason: ${invoice.cancellationReason}` : 'No cancellation reason recorded.'}</span></section> : null}

              <section className="invoice-detail-card">
                <div className="invoice-detail-card-heading"><div><span className="invoice-step">01</span><h2>{partyLabel} snapshot</h2></div></div>
                <div className="invoice-party-detail-grid">
                  <div><span>Name</span><strong>{invoice.partyName}</strong></div>
                  <div><span>Phone</span><strong>{invoice.partyPhone || '—'}</strong></div>
                  <div><span>GSTIN</span><strong>{invoice.partyGstin || '—'}</strong></div>
                  <div><span>State</span><strong>{[invoice.partyState, invoice.partyStateCode].filter(Boolean).join(' · ') || '—'}</strong></div>
                  <div className="wide"><span>Billing address</span><strong>{invoice.partyAddress || '—'}</strong></div>
                </div>
              </section>

              <section className="invoice-detail-card">
                <div className="invoice-detail-card-heading"><div><span className="invoice-step">02</span><h2>Immutable item breakdown</h2><p>These snapshots are the posted quantities, rates, discounts, and GST values used for stock and accounting.</p></div></div>
                {invoice.items.length ? <div className="invoice-lines-wrap"><table className="invoice-detail-items-table"><thead><tr><th>Product</th><th>HSN</th><th>Qty</th><th>Rate</th><th>Disc.</th><th>Taxable</th><th>{invoice.taxType === 'IGST' ? 'IGST' : 'CGST + SGST'}</th><th>Total</th></tr></thead><tbody>{invoice.items.map((item) => <tr key={item.id}><td><strong>{item.name}</strong><small>{[item.code, item.unit, `GST ${item.gstPercent}%`].filter(Boolean).join(' · ')}</small></td><td>{item.hsn || '—'}</td><td>{item.qty} {item.unit}</td><td>{money(item.rate)}</td><td>{money(item.discountAmount)}</td><td>{money(itemTaxableAmount(item))}</td><td>{invoice.taxType === 'IGST' ? money(item.igstAmount) : `${money(item.cgstAmount)} + ${money(item.sgstAmount)}`}</td><td><strong>{money(item.lineTotal)}</strong></td></tr>)}</tbody></table></div> : <p className="invoice-detail-empty">No immutable item snapshots were found for this invoice.</p>}
              </section>

              <section className="invoice-detail-card">
                <div className="invoice-detail-card-heading"><div><span className="invoice-step">03</span><h2>Payment history</h2><p>Entries are read from the invoice-payment link ledger. If cancelled, paid amounts remain in the cash/bank ledger as unallocated advances.</p></div></div>
                {invoice.paymentLinks.length ? <div className="payment-history-list">{invoice.paymentLinks.map((payment) => <article key={payment.id}><span className={`payment-history-direction ${payment.direction.toLowerCase()}`}>{payment.direction === 'IN' ? 'Money received' : 'Money paid'}</span><div><strong>{money(payment.amount)}</strong><small>{[dateLabel(payment.paymentDate), payment.paymentMode || 'Payment mode not recorded'].join(' · ')}</small></div><span className={`payment-link-status ${payment.status.toLowerCase()}`}>{payment.status === 'UNLINKED_ON_CANCELLATION' ? 'Released as advance' : payment.status.replaceAll('_', ' ')}</span></article>)}</div> : <p className="invoice-detail-empty">No payments are linked to this invoice.</p>}
              </section>
            </div>

            <aside className="invoice-detail-summary-column">
              <section className="invoice-summary-card">
                <div className="invoice-summary-heading"><span>POSTED TOTALS</span><strong>{invoice.taxType === 'IGST' ? 'Interstate · IGST' : 'Same state · CGST + SGST'}</strong></div>
                <dl className="invoice-summary-list">
                  <div><dt>Subtotal</dt><dd>{money(invoice.subtotal)}</dd></div>
                  <div><dt>Line discount</dt><dd>−{money(invoice.lineDiscountAmount)}</dd></div>
                  <div><dt>Bill discount</dt><dd>−{money(invoice.billDiscount)}</dd></div>
                  <div className="summary-taxable"><dt>Net taxable</dt><dd>{money(invoice.taxableAmount)}</dd></div>
                  {invoice.taxType === 'IGST' ? <div><dt>IGST</dt><dd>{money(invoice.igstAmount)}</dd></div> : <><div><dt>CGST</dt><dd>{money(invoice.cgstAmount)}</dd></div><div><dt>SGST</dt><dd>{money(invoice.sgstAmount)}</dd></div></>}
                  <div><dt>Round off</dt><dd>{invoice.roundOff >= 0 ? '+' : '−'}{money(Math.abs(invoice.roundOff))}</dd></div>
                  <div className="grand-total-row"><dt>Grand total</dt><dd>{money(invoice.grandTotal)}</dd></div>
                  <div className="balance-row"><dt>{kind === 'SALE' ? 'Customer balance' : 'Supplier payable'}</dt><dd>{money(invoice.balanceAmount)}</dd></div>
                </dl>
              </section>

              <section className="invoice-integrity-note">
                <span aria-hidden="true">⌘</span>
                <div><strong>{invoice.status === 'DRAFT' ? 'Draft-only editing' : 'Posted invoices are immutable'}</strong><p>{invoice.status === 'DRAFT' ? 'Only a DRAFT may be edited before it posts stock, GST totals, and payments.' : 'CONFIRMED invoices cannot be edited because changing posted lines would break stock and accounting integrity. Cancel the invoice to post the exact reverse stock adjustment, then issue a replacement.'}</p></div>
              </section>

              {invoice.status === 'CONFIRMED' ? <button className="danger-action-button" type="button" onClick={openCancelDialog}>Cancel invoice &amp; reverse stock</button> : null}
              {invoice.status === 'CANCELLED' ? <div className="invoice-detail-locked">This invoice is cancelled and remains read-only for audit history.</div> : null}
            </aside>
          </div>
        ) : null}
      </section>

      {cancelDialogOpen && invoice ? (
        <div className="modal-backdrop" role="presentation">
          <section className="confirm-dialog invoice-cancel-dialog" role="dialog" aria-modal="true" aria-labelledby="cancel-invoice-title">
            <div className="dialog-icon danger" aria-hidden="true">!</div>
            <h2 id="cancel-invoice-title">Cancel {invoice.invoiceNumber}?</h2>
            <p>{kind === 'SALE' ? 'This posts an ADJUSTMENT_IN for every item and restores the sold quantities.' : 'This posts an ADJUSTMENT_OUT for every item and removes the received quantities. Cancellation will stop if stock is no longer available.'}</p>
            <label className="form-field"><span>Cancellation reason <small>(optional)</small></span><textarea value={cancellationReason} maxLength={250} placeholder={kind === 'SALE' ? 'e.g. Customer invoice was entered twice' : 'e.g. Supplier bill was entered twice'} onChange={(event) => setCancellationReason(event.target.value)} /></label>
            <p className="cancel-payment-note">Linked payments are retained in the audit trail and released as unallocated party advances; cash/bank history is never deleted.</p>
            {cancelError ? <p className="form-error" role="alert">{cancelError}</p> : null}
            <div className="dialog-actions"><button className="outline-button" type="button" disabled={isCancelling} onClick={() => setCancelDialogOpen(false)}>Keep invoice</button><button className="danger-action-button" type="button" disabled={isCancelling} onClick={() => void cancelInvoice()}>{isCancelling ? 'Cancelling atomically…' : 'Cancel & reverse stock'}</button></div>
          </section>
        </div>
      ) : null}
    </main>
  )
}
