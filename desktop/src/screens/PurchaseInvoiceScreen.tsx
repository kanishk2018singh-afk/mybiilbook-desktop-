import { useEffect, useMemo, useState } from 'react'
import { BillingInternetNotice } from '../components/BillingInternetNotice'
import { DesktopSidebar, type DesktopPage } from '../components/DesktopSidebar'
import { useAuth } from '../context/AuthContext'
import { useBusiness } from '../context/BusinessContext'
import { BILLING_CONNECTION_MESSAGE, useSyncStatus } from '../context/SyncStatusContext'
import {
  calculateSalesInvoiceTotals,
  normalizeStateCode,
  resolveTaxJurisdiction,
  stateCodeFromGstin,
} from '../lib/salesInvoiceTotals'
import { searchableProductText } from '../lib/productUtils'
import { purchasePriceChanged } from '../lib/purchaseInvoiceUtils'
import { subscribeToParties } from '../repositories/partiesRepository'
import { subscribeToProducts } from '../repositories/productsRepository'
import { createConfirmedPurchaseInvoice } from '../repositories/purchaseInvoicesRepository'
import type { Party } from '../types/party'
import type { Product } from '../types/product'
import type { PaymentMode } from '../types/salesInvoice'
import type { CreatedPurchaseInvoice, PurchaseInvoiceLine } from '../types/purchaseInvoice'

interface PurchaseInvoiceScreenProps {
  onNavigate: (page: DesktopPage) => void
  onOpenInvoice: (invoiceId: string) => void
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
  return error instanceof Error ? error.message : 'The purchase invoice could not be confirmed. Please try again.'
}

function partyStateCode(party: Party | null): string {
  if (!party) return ''
  return normalizeStateCode(party.stateCode) || stateCodeFromGstin(party.gstin) || normalizeStateCode(party.state)
}

function businessStateCode(business: { stateCode?: string; gstin?: string; state?: string }): string {
  return normalizeStateCode(business.stateCode) || stateCodeFromGstin(business.gstin) || normalizeStateCode(business.state)
}

function createLine(product: Product): PurchaseInvoiceLine {
  return {
    id: localLineId(),
    productId: product.id,
    name: product.name,
    code: product.code,
    hsn: product.hsn,
    unit: product.unit || 'PCS',
    qty: 1,
    rate: product.purchasePrice,
    discountPercent: 0,
    gstPercent: product.gstPercent,
  }
}

function paymentStatusLabel(status: CreatedPurchaseInvoice['paymentStatus']): string {
  if (status === 'PAID') return 'Paid'
  if (status === 'PARTIAL') return 'Partial'
  return 'Unpaid'
}

export function PurchaseInvoiceScreen({ onNavigate, onOpenInvoice }: PurchaseInvoiceScreenProps) {
  const { user, signOut } = useAuth()
  const { isOnline } = useSyncStatus()
  const { selectedBusiness, selectedBusinessId, clearBusinessSelection } = useBusiness()
  const [parties, setParties] = useState<Party[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [partiesLoading, setPartiesLoading] = useState(true)
  const [productsLoading, setProductsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedParty, setSelectedParty] = useState<Party | null>(null)
  const [lines, setLines] = useState<PurchaseInvoiceLine[]>([])
  const [purchaseDate, setPurchaseDate] = useState(todayInIndia)
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState('')
  const [billDiscountInput, setBillDiscountInput] = useState('')
  const [paidAmountInput, setPaidAmountInput] = useState('')
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('CASH')
  const [partyPickerOpen, setPartyPickerOpen] = useState(false)
  const [productPickerOpen, setProductPickerOpen] = useState(false)
  const [partySearch, setPartySearch] = useState('')
  const [productSearch, setProductSearch] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedInvoice, setSavedInvoice] = useState<CreatedPurchaseInvoice | null>(null)
  const [priceUpdateDialogOpen, setPriceUpdateDialogOpen] = useState(false)

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
        setLoadError(error.message || 'Suppliers could not be loaded.')
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

  const supplierParties = useMemo(
    () => parties.filter((party) => party.isActive && (party.type === 'SUPPLIER' || party.type === 'BOTH')),
    [parties],
  )
  const filteredParties = useMemo(() => {
    const term = partySearch.trim().toLocaleLowerCase()
    if (!term) return supplierParties.slice(0, 80)
    return supplierParties.filter((party) => [party.name, party.phone, party.gstin, party.city].join(' ').toLocaleLowerCase().includes(term)).slice(0, 80)
  }, [supplierParties, partySearch])
  const filteredProducts = useMemo(() => {
    const term = productSearch.trim().toLocaleLowerCase()
    const sorted = [...products].sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }))
    return term ? sorted.filter((product) => searchableProductText(product).includes(term)).slice(0, 100) : sorted.slice(0, 100)
  }, [productSearch, products])
  const purchasePriceChanges = useMemo(() => {
    const byId = new Map(products.map((product) => [product.id, product]))
    return lines.flatMap((line) => {
      const product = byId.get(line.productId)
      return product && purchasePriceChanged(product.purchasePrice, line.rate)
        ? [{ id: product.id, name: line.name, currentPrice: product.purchasePrice, newPrice: line.rate }]
        : []
    })
  }, [lines, products])

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
    setSelectedParty(null)
    setLines([])
    setPurchaseDate(todayInIndia())
    setSupplierInvoiceNumber('')
    setBillDiscountInput('')
    setPaidAmountInput('')
    setPaymentMode('CASH')
    setPartySearch('')
    setProductSearch('')
    setPartyPickerOpen(false)
    setProductPickerOpen(false)
    setSaveError(null)
    setSavedInvoice(null)
    setPriceUpdateDialogOpen(false)
  }

  const save = async (updateProductPurchasePrices: boolean) => {
    if (savedInvoice) {
      resetInvoice()
      return
    }
    if (!isOnline) {
      setPriceUpdateDialogOpen(false)
      setSaveError(BILLING_CONNECTION_MESSAGE)
      return
    }
    if (!selectedParty) {
      setSaveError('Select a supplier before confirming the purchase invoice.')
      return
    }
    if (!supplierInvoiceNumber.trim()) {
      setSaveError("Enter the supplier's invoice number from their bill.")
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

    setPriceUpdateDialogOpen(false)
    setIsSaving(true)
    setSaveError(null)
    try {
      const saved = await createConfirmedPurchaseInvoice(user.uid, selectedBusinessId, {
        purchaseDate,
        supplierInvoiceNumber,
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
        updateProductPurchasePrices,
      })
      setSavedInvoice(saved)
    } catch (error) {
      setSaveError(displayError(error))
    } finally {
      setIsSaving(false)
    }
  }

  const beginSave = () => {
    if (savedInvoice) {
      resetInvoice()
      return
    }
    if (!isOnline) {
      setSaveError(BILLING_CONNECTION_MESSAGE)
      return
    }
    if (!selectedParty) {
      setSaveError('Select a supplier before confirming the purchase invoice.')
      return
    }
    if (!supplierInvoiceNumber.trim()) {
      setSaveError("Enter the supplier's invoice number from their bill.")
      return
    }
    if (parsedBillDiscount === null || parsedPaidAmount === null || parsedPaidAmount > totals.grandTotal + 0.005) {
      // Let the detailed validation in save() keep a single source of truth for the message.
      void save(false)
      return
    }
    if (purchasePriceChanges.length) {
      setPriceUpdateDialogOpen(true)
      return
    }
    void save(false)
  }

  return (
    <main className="desktop-layout">
      <DesktopSidebar activePage="purchaseInvoices" onNavigate={onNavigate} />
      <section className="dashboard-content purchase-invoice-content">
        <header className="dashboard-header">
          <div>
            <p className="breadcrumb">SHOWROOM / PURCHASES</p>
            <h1>Create purchase invoice</h1>
            <p>{selectedBusiness.name} · Confirming this purchase reserves a number and increases stock atomically.</p>
          </div>
          <div className="header-actions">
            <button className="outline-button" type="button" onClick={clearBusinessSelection}>Switch business</button>
            <button className="user-button" type="button" onClick={() => void signOut()} title="Sign out">{(user.displayName ?? user.email ?? 'U').slice(0, 1).toUpperCase()}</button>
          </div>
        </header>

        <BillingInternetNotice />
        {loadError ? <div className="settings-error" role="alert">{loadError}</div> : null}
        {isLoading ? <div className="settings-loading">Loading suppliers and catalog…</div> : null}

        {!isLoading && !loadError ? (
          <div className="purchase-invoice-workspace">
            <div className="purchase-invoice-main">
              <section className="invoice-card invoice-party-card">
                <div className="invoice-card-heading">
                  <div><span className="invoice-step">01</span><h2>Supplier &amp; purchase bill</h2></div>
                  <div className="invoice-header-fields">
                    <label className="invoice-date-field"><span>Purchase date</span><input type="date" value={purchaseDate} onChange={(event) => { setPurchaseDate(event.target.value || todayInIndia()); setSavedInvoice(null) }} /></label>
                    <label className="invoice-date-field supplier-invoice-field"><span>Supplier invoice no. <b>*</b></span><input value={supplierInvoiceNumber} maxLength={100} placeholder="e.g. SUP-4821" onChange={(event) => { setSupplierInvoiceNumber(event.target.value); setSavedInvoice(null); setSaveError(null) }} /></label>
                  </div>
                </div>

                <div className="selector-anchor">
                  <button className={`invoice-selector-button ${selectedParty ? 'selected' : ''}`} type="button" onClick={() => setPartyPickerOpen((open) => !open)} aria-expanded={partyPickerOpen}>
                    <span className="selector-icon" aria-hidden="true">◎</span>
                    <span className="selector-copy">
                      <strong>{selectedParty?.name || 'Select supplier'}</strong>
                      <small>{selectedParty ? [selectedParty.phone, selectedParty.city || selectedParty.state, selectedParty.type === 'BOTH' ? 'Customer & supplier' : 'Supplier'].filter(Boolean).join(' · ') : 'Search active Supplier and Both parties'}</small>
                    </span>
                    <span className="selector-chevron" aria-hidden="true">⌄</span>
                  </button>
                  {partyPickerOpen ? (
                    <div className="invoice-selector-menu" role="dialog" aria-label="Select a supplier">
                      <label className="invoice-picker-search"><span aria-hidden="true">⌕</span><input autoFocus value={partySearch} onChange={(event) => setPartySearch(event.target.value)} placeholder="Search name, phone, GSTIN, city…" /></label>
                      <div className="invoice-picker-list" role="listbox">
                        {filteredParties.length ? filteredParties.map((party) => (
                          <button className="invoice-picker-option" type="button" key={party.id} role="option" aria-selected={selectedParty?.id === party.id} onClick={() => chooseParty(party)}>
                            <span className="picker-avatar" aria-hidden="true">{party.name.slice(0, 1).toUpperCase()}</span>
                            <span><strong>{party.name}</strong><small>{[party.phone, party.gstin, party.city || party.state].filter(Boolean).join(' · ') || 'Supplier'}</small></span>
                            {party.type === 'BOTH' ? <em>Both</em> : null}
                          </button>
                        )) : <p className="invoice-picker-empty">No active suppliers match this search.</p>}
                      </div>
                    </div>
                  ) : null}
                </div>

                {selectedParty ? (
                  <div className="party-autofill-grid" aria-label="Supplier information copied to invoice">
                    <div><span>Phone</span><strong>{selectedParty.phone || '—'}</strong></div>
                    <div><span>GSTIN</span><strong>{selectedParty.gstin || '—'}</strong></div>
                    <div className="party-autofill-address"><span>Billing address</span><strong>{[selectedParty.address, selectedParty.city, selectedParty.state, selectedParty.pincode].filter(Boolean).join(', ') || '—'}</strong></div>
                  </div>
                ) : <p className="invoice-inline-help">Choose a supplier to copy the party name, phone, GSTIN, and billing address into this purchase snapshot.</p>}
              </section>

              <section className="invoice-card invoice-items-card">
                <div className="invoice-card-heading">
                  <div><span className="invoice-step">02</span><h2>Line items</h2><p>Search the live catalog. Purchase rate, quantity, and discount remain editable on the supplier bill.</p></div>
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
                            <em>Cost {money(product.purchasePrice)}</em>
                          </button>
                        )) : <p className="invoice-picker-empty">No products match this search.</p>}
                      </div>
                    </div>
                  ) : null}
                </div>

                {lines.length ? (
                  <div className="invoice-lines-wrap">
                    <table className="invoice-lines-table">
                      <thead><tr><th>Product snapshot</th><th>Qty</th><th>Purchase rate</th><th>Disc. %</th><th>Taxable</th><th>{jurisdiction.isInterState ? 'IGST' : 'CGST + SGST'}</th><th>Total</th><th aria-label="Remove" /></tr></thead>
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
                <div className="invoice-card-heading"><div><span className="invoice-step">03</span><h2>Discount &amp; payment</h2><p>Paid Now is optional; a remaining amount becomes the supplier payable.</p></div></div>
                <div className="invoice-payment-fields">
                  <label className="form-field"><span>Bill discount</span><div className="currency-input"><span>₹</span><input value={billDiscountInput} type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" onChange={(event) => { setBillDiscountInput(event.target.value); setSavedInvoice(null); setSaveError(null) }} /></div></label>
                  <label className="form-field"><span>Paid Now</span><div className="currency-input"><span>₹</span><input value={paidAmountInput} type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" onChange={(event) => { setPaidAmountInput(event.target.value); setSavedInvoice(null); setSaveError(null) }} /></div></label>
                  <label className="form-field"><span>Payment mode</span><select value={paymentMode} onChange={(event) => { setPaymentMode(event.target.value as PaymentMode); setSavedInvoice(null) }}>{PAYMENT_MODES.map((mode) => <option value={mode.value} key={mode.value}>{mode.label}</option>)}</select></label>
                  <div className="payment-status-preview"><span>Payment status</span><strong className={`payment-status ${totals.paymentStatus.toLowerCase()}`}>{paymentStatusLabel(totals.paymentStatus)}</strong><small>{money(totals.balanceAmount)} payable</small></div>
                </div>
              </section>
            </div>

            <aside className="purchase-invoice-summary-column">
              <section className="invoice-summary-card">
                <div className="invoice-summary-heading"><span>LIVE PURCHASE SUMMARY</span><strong>{jurisdiction.isInterState ? 'Interstate · IGST' : 'Same state · CGST + SGST'}</strong></div>
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
                  <div className="balance-row"><dt>Supplier payable</dt><dd>{money(totals.balanceAmount)}</dd></div>
                </dl>
                <div className="invoice-save-actions">
                  <button className="primary-action-button invoice-confirm-button" type="button" disabled={isSaving || (!savedInvoice && !isOnline) || lines.length === 0 || Boolean(loadError)} onClick={beginSave}>{isSaving ? 'Confirming atomically…' : savedInvoice ? 'Create another purchase' : 'Confirm purchase & increase stock'}</button>
                  {!savedInvoice ? <button className="outline-button compact-action" type="button" disabled={isSaving} onClick={resetInvoice}>Clear purchase</button> : null}
                </div>
              </section>

              <section className="invoice-atomic-note">
                <span aria-hidden="true">⌘</span>
                <div><strong>One atomic transaction</strong><p>Number reservation, stock increase, invoice + item snapshots, stock ledger rows, and an optional payment/link all commit together. A crash or stock race cannot leave a partial purchase.</p></div>
              </section>

              {saveError ? <div className="settings-error invoice-save-message" role="alert">{saveError}</div> : null}
              {savedInvoice ? <div className="invoice-saved-message" role="status"><strong>{savedInvoice.number} confirmed</strong><span>{money(savedInvoice.grandTotal)} · {paymentStatusLabel(savedInvoice.paymentStatus)} · payable {money(savedInvoice.balanceAmount)}</span><button className="table-action-button" type="button" onClick={() => onOpenInvoice(savedInvoice.id)}>View invoice</button></div> : null}
            </aside>
          </div>
        ) : null}
      </section>

      {priceUpdateDialogOpen ? (
        <div className="modal-backdrop" role="presentation">
          <section className="confirm-dialog purchase-price-dialog" role="dialog" aria-modal="true" aria-labelledby="purchase-price-dialog-title">
            <div className="dialog-icon purchase" aria-hidden="true">₹</div>
            <h2 id="purchase-price-dialog-title">Update product’s purchase price to new rate?</h2>
            <p>The selected purchase rate differs from the current catalog cost. Choose whether this confirmed purchase should update the product master purchase price.</p>
            <ul className="purchase-price-change-list">
              {purchasePriceChanges.map((change) => <li key={change.id}><span>{change.name}</span><strong>{money(change.currentPrice)} → {money(change.newPrice)}</strong></li>)}
            </ul>
            <div className="dialog-actions purchase-price-actions">
              <button className="outline-button" type="button" onClick={() => setPriceUpdateDialogOpen(false)} disabled={isSaving}>Back</button>
              <button className="outline-button" type="button" onClick={() => void save(false)} disabled={isSaving || !isOnline}>Keep current prices</button>
              <button className="primary-action-button" type="button" onClick={() => void save(true)} disabled={isSaving || !isOnline}>{isSaving ? 'Confirming…' : 'Update prices & confirm'}</button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  )
}
