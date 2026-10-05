import { useEffect, useState } from 'react'
import { DesktopSidebar, type DesktopPage } from '../components/DesktopSidebar'
import { useAuth } from '../context/AuthContext'
import { useBusiness } from '../context/BusinessContext'
import { quotationStatusLabel } from '../lib/quotationUtils'
import { setQuotationStatus, subscribeToQuotationDetail } from '../repositories/quotationsRepository'
import type { QuotationDetail, QuotationStatus } from '../types/quotation'

interface QuotationDetailScreenProps {
  quotationId: string
  onNavigate: (page: DesktopPage) => void
  onBack: () => void
  onConvertToSalesInvoice: (quotation: QuotationDetail) => void
  onOpenInvoice: (invoiceId: string) => void
}

function money(value: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value)
}

function dateLabel(value: string): string {
  if (!value) return '—'
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00`)
  return Number.isNaN(parsed.valueOf()) ? value : new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(parsed)
}

function statusError(error: unknown): string {
  return error instanceof Error ? error.message : 'The quotation status could not be changed.'
}

export function QuotationDetailScreen({
  quotationId,
  onNavigate,
  onBack,
  onConvertToSalesInvoice,
  onOpenInvoice,
}: QuotationDetailScreenProps) {
  const { user, signOut } = useAuth()
  const { selectedBusiness, selectedBusinessId, clearBusinessSelection } = useBusiness()
  const [quotation, setQuotation] = useState<QuotationDetail | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [changingStatus, setChangingStatus] = useState<QuotationStatus | null>(null)

  useEffect(() => {
    if (!user || !selectedBusinessId) return
    setQuotation(null)
    setIsLoading(true)
    setLoadError(null)
    setActionError(null)
    return subscribeToQuotationDetail(
      user.uid,
      selectedBusinessId,
      quotationId,
      (nextQuotation) => {
        setQuotation(nextQuotation)
        setIsLoading(false)
      },
      (error) => {
        setLoadError(error.message || 'Quotation could not be loaded.')
        setIsLoading(false)
      },
    )
  }, [quotationId, selectedBusinessId, user?.uid])

  if (!user || !selectedBusiness || !selectedBusinessId) return null

  const changeStatus = async (nextStatus: Exclude<QuotationStatus, 'CONVERTED'>) => {
    if (!quotation) return
    setChangingStatus(nextStatus)
    setActionError(null)
    try {
      await setQuotationStatus(user.uid, selectedBusinessId, quotation.id, nextStatus)
    } catch (error) {
      setActionError(statusError(error))
    } finally {
      setChangingStatus(null)
    }
  }

  const statusActions = () => {
    if (!quotation || quotation.status === 'CONVERTED' || quotation.status === 'REJECTED' || quotation.status === 'EXPIRED') return null
    if (quotation.status === 'ACCEPTED') {
      return (
        <div className="quotation-detail-actions">
          <button className="primary-action-button" type="button" onClick={() => onConvertToSalesInvoice(quotation)}>Convert to Sales Invoice</button>
          <button className="outline-button compact-action" type="button" disabled={Boolean(changingStatus)} onClick={() => void changeStatus('REJECTED')}>{changingStatus === 'REJECTED' ? 'Updating…' : 'Reject'}</button>
          <button className="outline-button compact-action" type="button" disabled={Boolean(changingStatus)} onClick={() => void changeStatus('EXPIRED')}>{changingStatus === 'EXPIRED' ? 'Updating…' : 'Mark expired'}</button>
        </div>
      )
    }
    return (
      <div className="quotation-detail-actions">
        {quotation.status === 'DRAFT' ? <button className="primary-action-button" type="button" disabled={Boolean(changingStatus)} onClick={() => void changeStatus('SENT')}>{changingStatus === 'SENT' ? 'Updating…' : 'Mark sent'}</button> : null}
        <button className="primary-action-button quotation-accept-button" type="button" disabled={Boolean(changingStatus)} onClick={() => void changeStatus('ACCEPTED')}>{changingStatus === 'ACCEPTED' ? 'Updating…' : 'Mark accepted'}</button>
        <button className="outline-button compact-action" type="button" disabled={Boolean(changingStatus)} onClick={() => void changeStatus('REJECTED')}>{changingStatus === 'REJECTED' ? 'Updating…' : 'Reject'}</button>
        <button className="outline-button compact-action" type="button" disabled={Boolean(changingStatus)} onClick={() => void changeStatus('EXPIRED')}>{changingStatus === 'EXPIRED' ? 'Updating…' : 'Mark expired'}</button>
      </div>
    )
  }

  return (
    <main className="desktop-layout">
      <DesktopSidebar activePage="quotations" onNavigate={onNavigate} />
      <section className="dashboard-content quotation-detail-content">
        <header className="dashboard-header">
          <div>
            <button className="back-link-button" type="button" onClick={onBack}>← All quotations</button>
            <p className="breadcrumb">SHOWROOM / QUOTATIONS / DETAIL</p>
            <h1>{quotation?.quotationNumber ?? 'Loading quotation…'}</h1>
            <p>{quotation ? `${quotation.partyName} · Created ${dateLabel(quotation.date)}` : 'Loading immutable quotation snapshots…'}</p>
          </div>
          <div className="header-actions">
            <button className="outline-button" type="button" onClick={clearBusinessSelection}>Switch business</button>
            <button className="user-button" type="button" onClick={() => void signOut()} title="Sign out">{(user.displayName ?? user.email ?? 'U').slice(0, 1).toUpperCase()}</button>
          </div>
        </header>

        {loadError ? <div className="settings-error" role="alert">{loadError}</div> : null}
        {isLoading ? <div className="settings-loading">Loading quotation snapshots…</div> : null}
        {!isLoading && !loadError && !quotation ? <section className="empty-master-state"><div className="empty-icon" aria-hidden="true">?</div><h2>Quotation not found</h2><p>It may have been removed in another client.</p><button className="primary-action-button" type="button" onClick={onBack}>Back to quotations</button></section> : null}

        {!isLoading && !loadError && quotation ? (
          <>
            <section className="quotation-detail-hero">
              <div>
                <span className={`quotation-status-pill ${quotation.status.toLowerCase()}`}>{quotationStatusLabel(quotation.status)}</span>
                <h2>{money(quotation.grandTotal)}</h2>
                <p>{quotation.status === 'ACCEPTED' ? 'This accepted quote can be copied to a stock-safe Sales Invoice draft.' : quotation.status === 'CONVERTED' ? `Converted to Sales Invoice ${quotation.salesInvoiceNumber || '—'}.` : 'Quotation only — no stock or payment has been posted.'}</p>
              </div>
              <dl>
                <div><dt>Quote date</dt><dd>{dateLabel(quotation.date)}</dd></div>
                <div><dt>Valid until</dt><dd>{dateLabel(quotation.validUntil)}</dd></div>
                <div><dt>Items</dt><dd>{quotation.itemCount}</dd></div>
                <div><dt>Tax type</dt><dd>{quotation.taxType === 'IGST' ? 'IGST' : 'CGST + SGST'}</dd></div>
              </dl>
            </section>

            <section className="quotation-party-grid">
              <article><span>Customer</span><strong>{quotation.partyName}</strong><small>{quotation.partyPhone || 'No phone recorded'}</small></article>
              <article><span>GSTIN</span><strong>{quotation.partyGstin || '—'}</strong><small>{quotation.partyState || 'State not recorded'}</small></article>
              <article className="wide"><span>Billing address</span><strong>{quotation.partyAddress || '—'}</strong><small>{quotation.note || 'No internal note'}</small></article>
            </section>

            <section className="quotation-items-card">
              <div className="tree-card-header"><span>Immutable quotation items</span><small>{quotation.items.length} line{quotation.items.length === 1 ? '' : 's'}</small></div>
              {quotation.items.length ? (
                <div className="invoice-lines-wrap"><table className="invoice-lines-table quotation-detail-items-table"><thead><tr><th>Product snapshot</th><th>Qty</th><th>Rate</th><th>Disc. %</th><th>Taxable</th><th>GST</th><th>Total</th></tr></thead><tbody>{quotation.items.map((item) => <tr key={item.id}><td><div className="invoice-line-product"><strong>{item.name}</strong><small>{[item.code, item.hsn ? `HSN ${item.hsn}` : '', item.unit].filter(Boolean).join(' · ')}</small></div></td><td>{item.qty}</td><td>{money(item.rate)}</td><td>{item.discountPercent}%</td><td>{money(item.taxableAfterBillDiscount)}</td><td>{quotation.taxType === 'IGST' ? money(item.igstAmount) : `${money(item.cgstAmount)} + ${money(item.sgstAmount)}`}</td><td><strong>{money(item.lineTotal)}</strong></td></tr>)}</tbody></table></div>
              ) : <div className="ledger-empty">No quotation item snapshots are available.</div>}
            </section>

            <div className="quotation-detail-bottom-grid">
              <section className="invoice-summary-card quotation-detail-summary"><div className="invoice-summary-heading"><span>QUOTATION TOTALS</span><strong>{quotation.taxType === 'IGST' ? 'IGST' : 'CGST + SGST'}</strong></div><dl className="invoice-summary-list"><div><dt>Subtotal</dt><dd>{money(quotation.subtotal)}</dd></div><div><dt>Line discount</dt><dd>−{money(quotation.lineDiscountAmount)}</dd></div><div><dt>Bill discount</dt><dd>−{money(quotation.billDiscount)}</dd></div><div className="summary-taxable"><dt>Net taxable</dt><dd>{money(quotation.taxableAmount)}</dd></div>{quotation.taxType === 'IGST' ? <div><dt>IGST</dt><dd>{money(quotation.igstAmount)}</dd></div> : <><div><dt>CGST</dt><dd>{money(quotation.cgstAmount)}</dd></div><div><dt>SGST</dt><dd>{money(quotation.sgstAmount)}</dd></div></>}<div><dt>Round off</dt><dd>{quotation.roundOff >= 0 ? '+' : '−'}{money(Math.abs(quotation.roundOff))}</dd></div><div className="grand-total-row"><dt>Grand total</dt><dd>{money(quotation.grandTotal)}</dd></div></dl></section>
              <aside className="quotation-status-card"><span>Quotation workflow</span><h2>{quotationStatusLabel(quotation.status)}</h2><p>{quotation.status === 'CONVERTED' ? 'The original quote is retained as an immutable audit record.' : 'Update the customer response before conversion. Conversion is available only after acceptance.'}</p>{statusActions()}{quotation.status === 'CONVERTED' && quotation.salesInvoiceId ? <button className="table-action-button quotation-view-invoice-button" type="button" onClick={() => onOpenInvoice(quotation.salesInvoiceId)}>View resulting invoice</button> : null}{actionError ? <p className="form-error" role="alert">{actionError}</p> : null}</aside>
            </div>
          </>
        ) : null}
      </section>
    </main>
  )
}
