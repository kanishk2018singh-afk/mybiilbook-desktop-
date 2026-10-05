import { useEffect, useMemo, useRef, useState } from 'react'
import { BillingInternetNotice } from '../components/BillingInternetNotice'
import { DesktopSidebar, type DesktopPage } from '../components/DesktopSidebar'
import { useAuth } from '../context/AuthContext'
import { BILLING_CONNECTION_MESSAGE, useSyncStatus } from '../context/SyncStatusContext'
import { useBusiness } from '../context/BusinessContext'
import {
  calculateSalesInvoiceTotals,
  normalizeStateCode,
  resolveTaxJurisdiction,
  stateCodeFromGstin,
} from '../lib/salesInvoiceTotals'
import { searchableProductText } from '../lib/productUtils'
import { subscribeToParties } from '../repositories/partiesRepository'
import { subscribeToProducts } from '../repositories/productsRepository'
import { createConfirmedSalesInvoice } from '../repositories/salesInvoicesRepository'
import type { Party } from '../types/party'
import type { Product } from '../types/product'
import type { CreatedSalesInvoice, PaymentMode, SalesInvoiceLine } from '../types/salesInvoice'
import type { QuotationConversionDraft } from '../types/quotation'

interface SalesInvoiceScreenProps {
  onNavigate: (page: DesktopPage) => void
  onOpenInvoice: (invoiceId: string) => void
  quotationConversion?: QuotationConversionDraft | null
  onQuotationConverted?: () => void
  onCancelQuotationConversion?: () => void
}

const PAYMENT_MODES: Array<{ value: PaymentMode; label: string }> = [
  { value: 'CASH', label: 'Cash' },
  { value: 'UPI', label: 'UPI' },
  { value: 'CARD', label: 'Card' },
  { value: 'BANK', label: 'Bank transfer' },
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'OTHER', label: 'Other' },
]

function money(value: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value)
}

function todayInIndia(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

function localLineId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `line-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function numberInput(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return 0
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function displayError(error: unknown): string {
  return error instanceof Error ? error.message : 'The sales invoice could not be confirmed. Please try again.'
}

function partyStateCode(party: Party | null): string {
  if (!party) return ''
  return normalizeStateCode(party.stateCode) || stateCodeFromGstin(party.gstin) || normalizeStateCode(party.state)
}

function businessStateCode(business: { stateCode?: string; gstin?: string; state?: string }): string {
  return normalizeStateCode(business.stateCode) || stateCodeFromGstin(business.gstin) || normalizeStateCode(business.state)
}

function createLine(product: Product): SalesInvoiceLine {
  return {
    id: localLineId(),
    productId: product.id,
    name: product.name,
    code: product.code,
    hsn: product.hsn,
    unit: product.unit || 'PCS',
    qty: 1,
    rate: product.mrp,
    discountPercent: product.discountPercent,
    gstPercent: product.gstPercent,
  }
}

function paymentStatusLabel(status: CreatedSalesInvoice['paymentStatus']): string {
  if (status === 'PAID') return 'Paid'
  if (status === 'PARTIAL') return 'Partial'
  return 'Unpaid'
}

export function SalesInvoiceScreen({
  onNavigate,
  onOpenInvoice,
  quotationConversion = null,
  onQuotationConverted,
  onCancelQuotationConversion,
}: SalesInvoiceScreenProps) {
  const { user, signOut } = useAuth()
  const { isOnline } = useSyncStatus()
  const { selectedBusiness, selectedBusinessId, clearBusinessSelection } = useBusiness()
  const [parties, setParties] = useState<Party[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [partiesLoading, setPartiesLoading] = useState(true)
  const [productsLoading, setProductsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedParty, setSelectedParty] = useState<Party | null>(null)
  const [lines, setLines] = useState<SalesInvoiceLine[]>([])
  const [invoiceDate, setInvoiceDate] = useState(todayInIndia)
  const [billDiscountInput, setBillDiscountInput] = useState('')
  const [paidAmountInput, setPaidAmountInput] = useState('')
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('CASH')
  const [partyPickerOpen, setPartyPickerOpen] = useState(false)
  const [productPickerOpen, setProductPickerOpen] = useState(false)
  const [partySearch, setPartySearch] = useState('')
  const [productSearch, setProductSearch] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedInvoice, setSavedInvoice] = useState<CreatedSalesInvoice | null>(null)
  const appliedQuotationConversionId = useRef<string | null>(null)

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
        setLoadError(error.message || 'Customers could not be loaded.')
        setPartiesLoading(false)
      },
    )
  }, [selectedBusinessId, user?.uid])

  useEffect(() => {
    if (!user || !selectedBusinessId) return
    setProductsLoading(true)
    setLoadError(null)
    return subscribeToProducts(
      user.uid,
      selectedBusinessId,
      (nextProducts) => {
        setProducts(nextProducts)
        setProductsLoading(false)
      },
      (error) => {
        setLoadError(error.message || 'Products could not be loaded.')
        setProductsLoading(false)
      },
    )
  }, [selectedBusinessId, user?.uid])

  useEffect(() => {
    if (!quotationConversion) {
      appliedQuotationConversionId.current = null
      return
    }
    if (appliedQuotationConversionId.current === quotationConversion.quotationId || partiesLoading) return

    const quotationParty = parties.find((party) => party.id === quotationConversion.partyId) ?? null
    if (!quotationParty) {
      setSaveError(`The customer from ${quotationConversion.quotationNumber} is no longer available. Select a customer before confirming this converted invoice.`)
      appliedQuotationConversionId.current = quotationConversion.quotationId
      return
    }

    setSelectedParty(quotationParty)
    setLines(quotationConversion.lines.map((line) => ({ ...line, id: localLineId() })))
    setInvoiceDate(todayInIndia())
    setBillDiscountInput(quotationConversion.billDiscount ? String(quotationConversion.billDiscount) : '')
    setPaidAmountInput('')
    setPaymentMode('CASH')
    setPartyPickerOpen(false)
    setProductPickerOpen(false)
    setPartySearch('')
    setProductSearch('')
    setSaveError(null)
    setSavedInvoice(null)
    appliedQuotationConversionId.current = quotationConversion.quotationId
  }, [parties, partiesLoading, quotationConversion])

  const customerParties = useMemo(
    () => parties.filter((party) => party.isActive && (party.type === 'CUSTOMER' || party.type === 'BOTH')),
    [parties],
  )
  const filteredParties = useMemo(() => {
    const term = partySearch.trim().toLocaleLowerCase()
    if (!term) return customerParties.slice(0, 80)
    return customerParties.filter((party) => [party.name, party.phone, party.gstin, party.city].join(' ').toLocaleLowerCase().includes(term)).slice(0, 80)
  }, [customerParties, partySearch])
  const filteredProducts = useMemo(() => {
    const term = productSearch.trim().toLocaleLowerCase()
    const sorted = [...products].sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }))
    return term ? sorted.filter((product) => searchableProductText(product).includes(term)).slice(0, 100) : sorted.slice(0, 100)
  }, [productSearch, products])

  const parsedBillDiscount = numberInput(billDiscountInput)
  const parsedPaidAmount = numberInput(paidAmountInput)
  const activeBusinessStateCode = selectedBusiness ? businessStateCode(selectedBusiness) : ''
  const activePartyStateCode = partyStateCode(selectedParty)
  const jurisdiction = useMemo(
    () => resolveTaxJurisdiction(activeBusinessStateCode, activePartyStateCode),
    [activeBusinessStateCode, activePartyStateCode],
  )
  const totals = useMemo(
    () => calculateSalesInvoiceTotals(lines, parsedBillDiscount ?? 0, parsedPaidAmount ?? 0, jurisdiction.isInterState),
    [jurisdiction.isInterState, lines, parsedBillDiscount, parsedPaidAmount],
  )

  if (!user || !selectedBusiness || !selectedBusinessId) return null

  const isLoading = partiesLoading || productsLoading

  const chooseParty = (party: Party) => {
    setSelectedParty(party)
    setPartyPickerOpen(false)
    setPartySearch('')
    setSaveError(null)
    setSavedInvoice(null)
  }

  const addProduct = (product: Product) => {
    setLines((current) => {
      const existing = current.find((line) => line.productId === product.id)
      if (existing) {
        return current.map((line) => line.id === existing.id ? { ...line, qty: Math.round((line.qty + 1) * 1000) / 1000 } : line)
      }
      return [...current, createLine(product)]
    })
    setProductPickerOpen(false)
    setProductSearch('')
    setSaveError(null)
    setSavedInvoice(null)
  }

  const updateLine = (lineId: string, field: 'qty' | 'rate' | 'discountPercent', value: string) => {
    const parsed = value.trim() === '' ? 0 : Number(value)
    if (!Number.isFinite(parsed)) return
    setLines((current) => current.map((line) => line.id === lineId ? { ...line, [field]: parsed } : line))
    setSaveError(null)
    setSavedInvoice(null)
  }

  const removeLine = (lineId: string) => {
    setLines((current) => current.filter((line) => line.id !== lineId))
    setSaveError(null)
    setSavedInvoice(null)
  }

  const resetInvoice = () => {
    if (quotationConversion) onCancelQuotationConversion?.()
    setSelectedParty(null)
    setLines([])
    setInvoiceDate(todayInIndia())
    setBillDiscountInput('')
    setPaidAmountInput('')
    setPaymentMode('CASH')
    setPartySearch('')
    setProductSearch('')
    setPartyPickerOpen(false)
    setProductPickerOpen(false)
    setSaveError(null)
    setSavedInvoice(null)
  }

  const save = async () => {
    if (savedInvoice) {
      resetInvoice()
      return
    }
    if (!isOnline) {
      setSaveError(BILLING_CONNECTION_MESSAGE)
      return
    }
    if (!selectedParty) {
      setSaveError('Select a customer before confirming the sales invoice.')
      return
    }
    if (quotationConversion && selectedParty.id !== quotationConversion.partyId) {
      setSaveError(`The customer on ${quotationConversion.quotationNumber} is no longer available. This conversion must retain the original customer.`)
      return
    }
    if (parsedBillDiscount === null) {
      setSaveError('Enter a valid non-negative bill discount.')
      return
    }
    if (parsedPaidAmount === null) {
      setSaveError('Enter a valid non-negative Paid Now amount.')
      return
    }
    if (parsedPaidAmount > totals.grandTotal + 0.005) {
      setSaveError('Paid Now cannot be more than the grand total.')
      return
    }

    setIsSaving(true)
    setSaveError(null)
    try {
      const saved = await createConfirmedSalesInvoice(user.uid, selectedBusinessId, {
        invoiceDate,
        partyId: selectedParty.id,
        partyName: selectedParty.name,
        partyPhone: selectedParty.phone,
        partyGstin: selectedParty.gstin,
        partyAddress: selectedParty.address,
        partyState: selectedParty.state,
        partyStateCode: activePartyStateCode,
        businessState: selectedBusiness.state ?? '',
        businessStateCode: activeBusinessStateCode,
        lines,
        billDiscount: parsedBillDiscount,
        paidAmount: parsedPaidAmount,
        paymentMode,
        ...(quotationConversion ? {
          sourceQuotation: {
            quotationId: quotationConversion.quotationId,
            quotationNumber: quotationConversion.quotationNumber,
          },
        } : {}),
      })
      setSavedInvoice(saved)
      if (quotationConversion) onQuotationConverted?.()
    } catch (error) {
      setSaveError(displayError(error))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <main className="desktop-layout">
      <DesktopSidebar activePage="salesInvoices" onNavigate={onNavigate} />
      <section className="dashboard-content sales-invoice-content">
        <header className="dashboard-header">
          <div>
            <p className="breadcrumb">SHOWROOM / SALES{quotationConversion ? ' / QUOTATION CONVERSION' : ''}</p>
            <h1>{quotationConversion ? 'Convert quotation to sales invoice' : 'Create sales invoice'}</h1>
            <p>{selectedBusiness.name} · Confirming this invoice reserves a number and updates stock atomically.</p>
          </div>
          <div className="header-actions">
            <button className="outline-button" type="button" onClick={clearBusinessSelection}>Switch business</button>
            <button className="user-button" type="button" onClick={() => void signOut()} title="Sign out">{(user.displayName ?? user.email ?? 'U').slice(0, 1).toUpperCase()}</button>
          </div>
        </header>

        <BillingInternetNotice />
        {loadError ? <div className="settings-error" role="alert">{loadError}</div> : null}
        {quotationConversion ? <div className="quotation-conversion-banner" role="status"><strong>Converting {quotationConversion.quotationNumber}</strong><span>Its immutable customer and item snapshots were copied into this Sales Invoice draft. Confirming the sale will atomically post stock and mark the quotation Converted.</span></div> : null}
        {isLoading ? <div className="settings-loading">Loading customers and catalog…</div> : null}

        {!isLoading && !loadError ? (
          <div className="sales-invoice-workspace">
            <div className="sales-invoice-main">
              <section className="invoice-card invoice-party-card">
                <div className="invoice-card-heading">
                  <div><span className="invoice-step">01</span><h2>Customer &amp; invoice</h2></div>
                  <label className="invoice-date-field"><span>Invoice date</span><input type="date" value={invoiceDate} onChange={(event) => { setInvoiceDate(event.target.value || todayInIndia()); setSavedInvoice(null) }} /></label>
                </div>

                <div className="selector-anchor">
                  <button className={`invoice-selector-button ${selectedParty ? 'selected' : ''}`} type="button" onClick={() => setPartyPickerOpen((open) => !open)} aria-expanded={partyPickerOpen}>
                    <span className="selector-icon" aria-hidden="true">◎</span>
                    <span className="selector-copy">
                      <strong>{selectedParty?.name || 'Select customer'}</strong>
                      <small>{selectedParty ? [selectedParty.phone, selectedParty.city || selectedParty.state, selectedParty.type === 'BOTH' ? 'Customer & supplier' : 'Customer'].filter(Boolean).join(' · ') : 'Search active Customer and Both parties'}</small>
                    </span>
                    <span className="selector-chevron" aria-hidden="true">⌄</span>
                  </button>
                  {partyPickerOpen ? (
                    <div className="invoice-selector-menu" role="dialog" aria-label="Select a customer">
                      <label className="invoice-picker-search"><span aria-hidden="true">⌕</span><input autoFocus value={partySearch} onChange={(event) => setPartySearch(event.target.value)} placeholder="Search name, phone, GSTIN, city…" /></label>
                      <div className="invoice-picker-list" role="listbox">
                        {filteredParties.length ? filteredParties.map((party) => (
                          <button className="invoice-picker-option" type="button" key={party.id} role="option" aria-selected={selectedParty?.id === party.id} onClick={() => chooseParty(party)}>
                            <span className="picker-avatar" aria-hidden="true">{party.name.slice(0, 1).toUpperCase()}</span>
                            <span><strong>{party.name}</strong><small>{[party.phone, party.gstin, party.city || party.state].filter(Boolean).join(' · ') || 'Customer'}</small></span>
                            {party.type === 'BOTH' ? <em>Both</em> : null}
                          </button>
                        )) : <p className="invoice-picker-empty">No active customers match this search.</p>}
                      </div>
                    </div>
                  ) : null}
                </div>

                {selectedParty ? (
                  <div className="party-autofill-grid" aria-label="Customer information copied to invoice">
                    <div><span>Phone</span><strong>{selectedParty.phone || '—'}</strong></div>
                    <div><span>GSTIN</span><strong>{selectedParty.gstin || '—'}</strong></div>
                    <div className="party-autofill-address"><span>Billing address</span><strong>{[selectedParty.address, selectedParty.city, selectedParty.state, selectedParty.pincode].filter(Boolean).join(', ') || '—'}</strong></div>
                  </div>
                ) : <p className="invoice-inline-help">Choose a customer to copy the party name, phone, GSTIN, and billing address into this invoice snapshot.</p>}
              </section>

              <section className="invoice-card invoice-items-card">
                <div className="invoice-card-heading">
                  <div><span className="invoice-step">02</span><h2>Line items</h2><p>Search the live catalog. Rate, quantity, and discount remain editable on the invoice.</p></div>
                  <button className="primary-action-button compact-action" type="button" onClick={() => setProductPickerOpen((open) => !open)}>＋ Add product</button>
                </div>

                <div className="selector-anchor product-selector-anchor">
                  {productPickerOpen ? (
                    <div className="invoice-selector-menu product-picker-menu" role="dialog" aria-label="Add a product">
                      <label className="invoice-picker-search"><span aria-hidden="true">⌕</span><input autoFocus value={productSearch} onChange={(event) => setProductSearch(event.target.value)} placeholder="Search name, code, barcode, HSN…" /></label>
                      <div className="invoice-picker-list" role="listbox">
                        {filteredProducts.length ? filteredProducts.map((product) => (
                          <button className="invoice-picker-option product-picker-option" type="button" key={product.id} role="option" onClick={() => addProduct(product)}>
                            <span className="picker-avatar product" aria-hidden="true">▤</span>
                            <span><strong>{product.name}</strong><small>{[product.code, product.hsn ? `HSN ${product.hsn}` : '', `${product.stockQty} ${product.unit || 'PCS'} in stock`].filter(Boolean).join(' · ')}</small></span>
                            <em>{money(product.mrp)}</em>
                          </button>
                        )) : <p className="invoice-picker-empty">No products match this search.</p>}
                      </div>
                    </div>
                  ) : null}
                </div>

                {lines.length ? (
                  <div className="invoice-lines-wrap">
                    <table className="invoice-lines-table">
                      <thead><tr><th>Product snapshot</th><th>Qty</th><th>Rate</th><th>Disc. %</th><th>Taxable</th><th>{jurisdiction.isInterState ? 'IGST' : 'CGST + SGST'}</th><th>Total</th><th aria-label="Remove" /></tr></thead>
                      <tbody>
                        {lines.map((line, index) => {
                          const lineTotal = totals.lineTotals[index]
                          return (
                            <tr key={line.id}>
                              <td><div className="invoice-line-product"><strong>{line.name}</strong><small>{[line.code, line.hsn ? `HSN ${line.hsn}` : '', line.unit, `GST ${line.gstPercent}%`].filter(Boolean).join(' · ')}</small></div></td>
                              <td><input aria-label={`Quantity for ${line.name}`} type="number" min="0.001" step="0.001" value={line.qty} onChange={(event) => updateLine(line.id, 'qty', event.target.value)} /></td>
                              <td><input aria-label={`Rate for ${line.name}`} type="number" min="0" step="0.01" value={line.rate} onChange={(event) => updateLine(line.id, 'rate', event.target.value)} /></td>
                              <td><input aria-label={`Discount percent for ${line.name}`} type="number" min="0" max="100" step="0.01" value={line.discountPercent} onChange={(event) => updateLine(line.id, 'discountPercent', event.target.value)} /></td>
                              <td><div className="invoice-money-cell"><strong>{money(lineTotal?.taxableAmount ?? 0)}</strong><small>Disc. {money(lineTotal?.discountAmount ?? 0)}</small></div></td>
                              <td><div className="invoice-money-cell"><strong>{jurisdiction.isInterState ? money(lineTotal?.igstAmount ?? 0) : `${money(lineTotal?.cgstAmount ?? 0)} + ${money(lineTotal?.sgstAmount ?? 0)}`}</strong><small>{jurisdiction.isInterState ? 'IGST' : 'CGST / SGST'}</small></div></td>
                              <td><strong className="invoice-line-total">{money(lineTotal?.lineTotal ?? 0)}</strong></td>
                              <td><button className="remove-line-button" type="button" onClick={() => removeLine(line.id)} aria-label={`Remove ${line.name}`}>×</button></td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="invoice-empty-lines"><span aria-hidden="true">▤</span><h3>No products added</h3><p>Select products from the catalog to build this invoice.</p><button className="outline-button compact-action" type="button" onClick={() => setProductPickerOpen(true)}>Browse products</button></div>
                )}
              </section>

              <section className="invoice-card invoice-payment-card">
                <div className="invoice-card-heading"><div><span className="invoice-step">03</span><h2>Discount &amp; payment</h2><p>Paid Now is optional; a remaining amount becomes the customer balance.</p></div></div>
                <div className="invoice-payment-fields">
                  <label className="form-field"><span>Bill discount</span><div className="currency-input"><span>₹</span><input value={billDiscountInput} type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" onChange={(event) => { setBillDiscountInput(event.target.value); setSavedInvoice(null); setSaveError(null) }} /></div></label>
                  <label className="form-field"><span>Paid Now</span><div className="currency-input"><span>₹</span><input value={paidAmountInput} type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" onChange={(event) => { setPaidAmountInput(event.target.value); setSavedInvoice(null); setSaveError(null) }} /></div></label>
                  <label className="form-field"><span>Payment mode</span><select value={paymentMode} onChange={(event) => { setPaymentMode(event.target.value as PaymentMode); setSavedInvoice(null) }}>{PAYMENT_MODES.map((mode) => <option value={mode.value} key={mode.value}>{mode.label}</option>)}</select></label>
                  <div className="payment-status-preview"><span>Payment status</span><strong className={`payment-status ${totals.paymentStatus.toLowerCase()}`}>{paymentStatusLabel(totals.paymentStatus)}</strong><small>{money(totals.balanceAmount)} balance</small></div>
                </div>
              </section>
            </div>

            <aside className="sales-invoice-summary-column">
              <section className="invoice-summary-card">
                <div className="invoice-summary-heading"><span>LIVE BILL SUMMARY</span><strong>{jurisdiction.isInterState ? 'Interstate · IGST' : 'Same state · CGST + SGST'}</strong></div>
                {!jurisdiction.isResolved && selectedParty ? <p className="tax-jurisdiction-warning">GST state codes are missing or invalid. The preview uses same-state CGST/SGST until both codes can be compared.</p> : null}
                <dl className="invoice-summary-list">
                  <div><dt>Subtotal</dt><dd>{money(totals.subtotal)}</dd></div>
                  <div><dt>Line discount</dt><dd>−{money(totals.lineDiscountAmount)}</dd></div>
                  <div><dt>Taxable amount</dt><dd>{money(totals.taxableBeforeBillDiscount)}</dd></div>
                  <div><dt>Bill discount</dt><dd>−{money(totals.billDiscount)}</dd></div>
                  <div className="summary-taxable"><dt>Net taxable</dt><dd>{money(totals.taxableAmount)}</dd></div>
                  {jurisdiction.isInterState ? <div><dt>IGST</dt><dd>{money(totals.igstAmount)}</dd></div> : <><div><dt>CGST</dt><dd>{money(totals.cgstAmount)}</dd></div><div><dt>SGST</dt><dd>{money(totals.sgstAmount)}</dd></div></>}
                  <div><dt>Round off</dt><dd>{totals.roundOff >= 0 ? '+' : '−'}{money(Math.abs(totals.roundOff))}</dd></div>
                  <div className="grand-total-row"><dt>Grand total</dt><dd>{money(totals.grandTotal)}</dd></div>
                  <div className="balance-row"><dt>Balance amount</dt><dd>{money(totals.balanceAmount)}</dd></div>
                </dl>
                <div className="invoice-save-actions">
                  <button className="primary-action-button invoice-confirm-button" type="button" disabled={isSaving || (!savedInvoice && !isOnline) || lines.length === 0 || Boolean(loadError) || Boolean(quotationConversion && selectedParty?.id !== quotationConversion.partyId)} onClick={() => void save()}>{isSaving ? 'Confirming atomically…' : savedInvoice ? 'Create another invoice' : quotationConversion ? 'Confirm conversion & update stock' : 'Confirm sale & update stock'}</button>
                  {!savedInvoice ? <button className="outline-button compact-action" type="button" disabled={isSaving} onClick={resetInvoice}>{quotationConversion ? 'Cancel conversion' : 'Clear invoice'}</button> : null}
                </div>
              </section>

              <section className="invoice-atomic-note">
                <span aria-hidden="true">⌘</span>
                <div><strong>One atomic transaction</strong><p>Number reservation, stock verification/decrement, invoice + item snapshots, stock ledger rows, and an optional payment/link all commit together. A crash or stock race cannot leave a partial sale.</p></div>
              </section>

              {saveError ? <div className="settings-error invoice-save-message" role="alert">{saveError}</div> : null}
              {savedInvoice ? <div className="invoice-saved-message" role="status"><strong>{savedInvoice.number} confirmed</strong><span>{money(savedInvoice.grandTotal)} · {paymentStatusLabel(savedInvoice.paymentStatus)} · balance {money(savedInvoice.balanceAmount)}</span><button className="table-action-button" type="button" onClick={() => onOpenInvoice(savedInvoice.id)}>View invoice</button></div> : null}
            </aside>
          </div>
        ) : null}
      </section>
    </main>
  )
}
