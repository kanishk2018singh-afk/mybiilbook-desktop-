import { useEffect, useMemo, useState } from 'react'
import { DesktopSidebar, type DesktopPage } from '../components/DesktopSidebar'
import { useAuth } from '../context/AuthContext'
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
import { createQuotation } from '../repositories/quotationsRepository'
import type { Party } from '../types/party'
import type { Product } from '../types/product'
import type { SalesInvoiceLine } from '../types/salesInvoice'
import type { CreatedQuotation, QuotationInitialStatus } from '../types/quotation'

interface QuotationScreenProps {
  onNavigate: (page: DesktopPage) => void
  onOpenQuotation: (quotationId: string) => void
}

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

function defaultValidUntil(): string {
  const date = new Date(`${todayInIndia()}T12:00:00`)
  date.setDate(date.getDate() + 30)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function localLineId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `quotation-line-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function numberInput(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return 0
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function displayError(error: unknown): string {
  return error instanceof Error ? error.message : 'The quotation could not be saved. Please try again.'
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

export function QuotationScreen({ onNavigate, onOpenQuotation }: QuotationScreenProps) {
  const { user, signOut } = useAuth()
  const { selectedBusiness, selectedBusinessId, clearBusinessSelection } = useBusiness()
  const [parties, setParties] = useState<Party[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [partiesLoading, setPartiesLoading] = useState(true)
  const [productsLoading, setProductsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedParty, setSelectedParty] = useState<Party | null>(null)
  const [lines, setLines] = useState<SalesInvoiceLine[]>([])
  const [quotationDate, setQuotationDate] = useState(todayInIndia)
  const [validUntil, setValidUntil] = useState(defaultValidUntil)
  const [billDiscountInput, setBillDiscountInput] = useState('')
  const [note, setNote] = useState('')
  const [partyPickerOpen, setPartyPickerOpen] = useState(false)
  const [productPickerOpen, setProductPickerOpen] = useState(false)
  const [partySearch, setPartySearch] = useState('')
  const [productSearch, setProductSearch] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedQuotation, setSavedQuotation] = useState<CreatedQuotation | null>(null)

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
  const activeBusinessStateCode = selectedBusiness ? businessStateCode(selectedBusiness) : ''
  const activePartyStateCode = partyStateCode(selectedParty)
  const jurisdiction = useMemo(
    () => resolveTaxJurisdiction(activeBusinessStateCode, activePartyStateCode),
    [activeBusinessStateCode, activePartyStateCode],
  )
  const totals = useMemo(
    () => calculateSalesInvoiceTotals(lines, parsedBillDiscount ?? 0, 0, jurisdiction.isInterState),
    [jurisdiction.isInterState, lines, parsedBillDiscount],
  )

  if (!user || !selectedBusiness || !selectedBusinessId) return null
  const isLoading = partiesLoading || productsLoading

  const clearSavedState = () => {
    setSaveError(null)
    setSavedQuotation(null)
  }

  const chooseParty = (party: Party) => {
    setSelectedParty(party)
    setPartyPickerOpen(false)
    setPartySearch('')
    clearSavedState()
  }

  const addProduct = (product: Product) => {
    setLines((current) => {
      const existing = current.find((line) => line.productId === product.id)
      if (existing) return current.map((line) => line.id === existing.id ? { ...line, qty: Math.round((line.qty + 1) * 1000) / 1000 } : line)
      return [...current, createLine(product)]
    })
    setProductPickerOpen(false)
    setProductSearch('')
    clearSavedState()
  }

  const updateLine = (lineId: string, field: 'qty' | 'rate' | 'discountPercent', value: string) => {
    const parsed = value.trim() === '' ? 0 : Number(value)
    if (!Number.isFinite(parsed)) return
    setLines((current) => current.map((line) => line.id === lineId ? { ...line, [field]: parsed } : line))
    clearSavedState()
  }

  const removeLine = (lineId: string) => {
    setLines((current) => current.filter((line) => line.id !== lineId))
    clearSavedState()
  }

  const resetQuotation = () => {
    setSelectedParty(null)
    setLines([])
    setQuotationDate(todayInIndia())
    setValidUntil(defaultValidUntil())
    setBillDiscountInput('')
    setNote('')
    setPartySearch('')
    setProductSearch('')
    setPartyPickerOpen(false)
    setProductPickerOpen(false)
    setSaveError(null)
    setSavedQuotation(null)
  }

  const save = async (status: QuotationInitialStatus) => {
    if (savedQuotation) {
      resetQuotation()
      return
    }
    if (!selectedParty) {
      setSaveError('Select a customer before saving the quotation.')
      return
    }
    if (parsedBillDiscount === null) {
      setSaveError('Enter a valid non-negative bill discount.')
      return
    }

    setIsSaving(true)
    setSaveError(null)
    try {
      const saved = await createQuotation(user.uid, selectedBusinessId, {
        quotationDate,
        validUntil,
        status,
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
        note,
      })
      setSavedQuotation(saved)
    } catch (error) {
      setSaveError(displayError(error))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <main className="desktop-layout">
      <DesktopSidebar activePage="quotations" onNavigate={onNavigate} />
      <section className="dashboard-content sales-invoice-content quotation-create-content">
        <header className="dashboard-header">
          <div>
            <p className="breadcrumb">SHOWROOM / QUOTATIONS</p>
            <h1>Create quotation</h1>
            <p>{selectedBusiness.name} · Quotes preserve item and GST snapshots but never change stock or payment balances.</p>
          </div>
          <div className="header-actions">
            <button className="outline-button" type="button" onClick={() => onNavigate('quotations')}>All quotations</button>
            <button className="outline-button" type="button" onClick={clearBusinessSelection}>Switch business</button>
            <button className="user-button" type="button" onClick={() => void signOut()} title="Sign out">{(user.displayName ?? user.email ?? 'U').slice(0, 1).toUpperCase()}</button>
          </div>
        </header>

        {loadError ? <div className="settings-error" role="alert">{loadError}</div> : null}
        {isLoading ? <div className="settings-loading">Loading customers and catalog…</div> : null}

        {!isLoading && !loadError ? (
          <div className="sales-invoice-workspace">
            <div className="sales-invoice-main">
              <section className="invoice-card invoice-party-card">
                <div className="invoice-card-heading">
                  <div><span className="invoice-step">01</span><h2>Customer &amp; quotation</h2></div>
                  <div className="quotation-date-fields">
                    <label className="invoice-date-field"><span>Quote date</span><input type="date" value={quotationDate} onChange={(event) => { setQuotationDate(event.target.value || todayInIndia()); clearSavedState() }} /></label>
                    <label className="invoice-date-field"><span>Valid until</span><input type="date" min={quotationDate} value={validUntil} onChange={(event) => { setValidUntil(event.target.value); clearSavedState() }} /></label>
                  </div>
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
                  <div className="party-autofill-grid" aria-label="Customer information copied to quotation">
                    <div><span>Phone</span><strong>{selectedParty.phone || '—'}</strong></div>
                    <div><span>GSTIN</span><strong>{selectedParty.gstin || '—'}</strong></div>
                    <div className="party-autofill-address"><span>Billing address</span><strong>{[selectedParty.address, selectedParty.city, selectedParty.state, selectedParty.pincode].filter(Boolean).join(', ') || '—'}</strong></div>
                  </div>
                ) : <p className="invoice-inline-help">Choose a customer to copy the party snapshot into this quotation.</p>}
              </section>

              <section className="invoice-card invoice-items-card">
                <div className="invoice-card-heading">
                  <div><span className="invoice-step">02</span><h2>Line items</h2><p>Search the live catalog. Quotation rates, quantities, and discounts remain editable.</p></div>
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
                      <tbody>{lines.map((line, index) => {
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
                      })}</tbody>
                    </table>
                  </div>
                ) : <div className="invoice-empty-lines"><span aria-hidden="true">▤</span><h3>No products added</h3><p>Select products from the catalog to build this quotation.</p><button className="outline-button compact-action" type="button" onClick={() => setProductPickerOpen(true)}>Browse products</button></div>}
              </section>

              <section className="invoice-card quotation-note-card">
                <div className="invoice-card-heading"><div><span className="invoice-step">03</span><h2>Discount &amp; note</h2><p>Quotations do not collect payment or reserve stock.</p></div></div>
                <div className="quotation-extra-fields">
                  <label className="form-field"><span>Bill discount</span><div className="currency-input"><span>₹</span><input value={billDiscountInput} type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" onChange={(event) => { setBillDiscountInput(event.target.value); clearSavedState() }} /></div></label>
                  <label className="form-field quotation-note-field"><span>Internal note</span><textarea value={note} maxLength={1000} placeholder="Optional terms, delivery note, or internal note" onChange={(event) => { setNote(event.target.value); clearSavedState() }} /></label>
                </div>
              </section>
            </div>

            <aside className="sales-invoice-summary-column">
              <section className="invoice-summary-card">
                <div className="invoice-summary-heading"><span>LIVE QUOTATION SUMMARY</span><strong>{jurisdiction.isInterState ? 'Interstate · IGST' : 'Same state · CGST + SGST'}</strong></div>
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
                </dl>
                <div className="quotation-save-actions">
                  {savedQuotation ? <button className="primary-action-button invoice-confirm-button" type="button" onClick={resetQuotation}>Create another quotation</button> : <><button className="outline-button compact-action" type="button" disabled={isSaving || lines.length === 0 || Boolean(loadError)} onClick={() => void save('DRAFT')}>{isSaving ? 'Saving…' : 'Save draft'}</button><button className="primary-action-button invoice-confirm-button" type="button" disabled={isSaving || lines.length === 0 || Boolean(loadError)} onClick={() => void save('SENT')}>{isSaving ? 'Saving…' : 'Save & mark sent'}</button></>}
                  {!savedQuotation ? <button className="text-button quotation-reset-button" type="button" disabled={isSaving} onClick={resetQuotation}>Clear quotation</button> : null}
                </div>
              </section>

              <section className="quotation-safe-note"><span aria-hidden="true">◌</span><div><strong>No stock or payment posting</strong><p>Saving a quotation only reserves its quotation number and stores immutable customer/item/tax snapshots. Inventory and party balances are unchanged until an accepted quotation is converted to a sales invoice.</p></div></section>

              {saveError ? <div className="settings-error invoice-save-message" role="alert">{saveError}</div> : null}
              {savedQuotation ? <div className="invoice-saved-message" role="status"><strong>{savedQuotation.number} {savedQuotation.status.toLowerCase()}</strong><span>{money(savedQuotation.grandTotal)} · no stock or payment posted</span><button className="table-action-button" type="button" onClick={() => onOpenQuotation(savedQuotation.id)}>View quotation</button></div> : null}
            </aside>
          </div>
        ) : null}
      </section>
    </main>
  )
}
