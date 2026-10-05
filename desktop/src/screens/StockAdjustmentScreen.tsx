import { useEffect, useMemo, useState } from 'react'
import { DesktopSidebar, type DesktopPage } from '../components/DesktopSidebar'
import { useAuth } from '../context/AuthContext'
import { useBusiness } from '../context/BusinessContext'
import { createStockAdjustment } from '../repositories/stockRepository'
import { subscribeToProducts } from '../repositories/productsRepository'
import type { Product } from '../types/product'

interface StockAdjustmentScreenProps {
  onNavigate: (page: DesktopPage) => void
}

function signedNumber(value: string): number | null {
  const text = value.trim()
  if (!text) return null
  const parsed = Number(text)
  return Number.isFinite(parsed) && parsed !== 0 ? parsed : null
}

function quantity(value: number): string {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(value)
}

function adjustmentError(error: unknown): string {
  return error instanceof Error ? error.message : 'The stock adjustment could not be saved. Please try again.'
}

export function StockAdjustmentScreen({ onNavigate }: StockAdjustmentScreenProps) {
  const { user, signOut } = useAuth()
  const { selectedBusiness, selectedBusinessId, clearBusinessSelection } = useBusiness()
  const [products, setProducts] = useState<Product[]>([])
  const [productsLoading, setProductsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [productId, setProductId] = useState('')
  const [adjustmentQty, setAdjustmentQty] = useState('')
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

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

  const selectedProduct = useMemo(() => products.find((product) => product.id === productId) ?? null, [productId, products])
  const parsedQty = signedNumber(adjustmentQty)
  const isStockIn = parsedQty !== null && parsedQty > 0
  const nextStock = selectedProduct && parsedQty !== null ? selectedProduct.stockQty + parsedQty : null
  const wouldGoNegative = nextStock !== null && nextStock < -0.000001

  if (!user || !selectedBusiness || !selectedBusinessId) return null

  const updateField = (setter: (value: string) => void, value: string) => {
    setter(value)
    setFormError(null)
    setSuccessMessage(null)
  }

  const save = async () => {
    if (!selectedProduct) {
      setFormError('Select a product before saving the adjustment.')
      return
    }
    if (parsedQty === null) {
      setFormError('Enter a non-zero adjustment quantity. Use + to add or − to remove stock.')
      return
    }
    if (!reason.trim()) {
      setFormError('Enter a reason for this stock adjustment.')
      return
    }
    if (wouldGoNegative) {
      setFormError(`This adjustment would make ${selectedProduct.name} stock negative.`)
      return
    }

    setIsSaving(true)
    setFormError(null)
    setSuccessMessage(null)
    try {
      const result = await createStockAdjustment(user.uid, selectedBusinessId, {
        productId: selectedProduct.id,
        adjustmentQty: parsedQty,
        reason,
        note,
      })
      setSuccessMessage(`${result.type === 'ADJUSTMENT_IN' ? 'Stock added' : 'Stock removed'} atomically. New stock is ${quantity(result.balanceAfter)} ${selectedProduct.unit || 'PCS'}.`)
      setAdjustmentQty('')
      setReason('')
      setNote('')
    } catch (error) {
      setFormError(adjustmentError(error))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <main className="desktop-layout">
      <DesktopSidebar activePage="stockAdjustment" onNavigate={onNavigate} />
      <section className="dashboard-content stock-adjustment-content">
        <header className="dashboard-header">
          <div>
            <button className="back-link-button" type="button" onClick={() => onNavigate('products')}>← Products</button>
            <p className="breadcrumb">SHOWROOM / INVENTORY / ADJUSTMENT</p>
            <h1>Stock adjustment</h1>
            <p>Record a verified inventory correction. Stock and its ADJUSTMENT ledger entry save together in one Firestore transaction.</p>
          </div>
          <div className="header-actions">
            <button className="outline-button" type="button" onClick={() => onNavigate('stockLedger')}>View stock ledger</button>
            <button className="outline-button" type="button" onClick={clearBusinessSelection}>Switch business</button>
            <button className="user-button" type="button" onClick={() => void signOut()} title="Sign out">{(user.displayName ?? user.email ?? 'U').slice(0, 1).toUpperCase()}</button>
          </div>
        </header>

        {loadError ? <div className="settings-error" role="alert">{loadError}</div> : null}
        {successMessage ? <div className="stock-adjustment-success" role="status">✓ {successMessage}</div> : null}

        <section className="stock-adjustment-workspace">
          <section className="stock-adjustment-card">
            <div className="stock-adjustment-heading"><div><span className="invoice-step">01</span><h2>Correction details</h2><p>Use a positive quantity to add stock and a negative quantity to remove it.</p></div></div>
            <div className="form-grid two-columns stock-adjustment-form-grid">
              <label className="form-field form-field-wide">
                <span>Product <b>*</b></span>
                <select value={productId} disabled={productsLoading || isSaving} onChange={(event) => updateField(setProductId, event.target.value)}>
                  <option value="">{productsLoading ? 'Loading products…' : 'Select product'}</option>
                  {products.map((product) => <option key={product.id} value={product.id}>{product.name}{product.code ? ` · ${product.code}` : ''} · stock ${quantity(product.stockQty)} {product.unit || 'PCS'}</option>)}
                </select>
                {!productsLoading && !products.length ? <small className="field-helper">Create a product with opening stock before posting an adjustment.</small> : null}
              </label>
              <label className="form-field">
                <span>Adjustment quantity <b>*</b></span>
                <input type="number" step="0.001" inputMode="decimal" value={adjustmentQty} placeholder="e.g. +5 or -2" disabled={!selectedProduct || isSaving} onChange={(event) => updateField(setAdjustmentQty, event.target.value)} />
                <small className="field-helper">+ stock-in · − stock-out</small>
              </label>
              <label className="form-field">
                <span>Reason <b>*</b></span>
                <input list="stock-adjustment-reasons" value={reason} maxLength={250} placeholder="e.g. Physical stock count" disabled={isSaving} onChange={(event) => updateField(setReason, event.target.value)} />
                <datalist id="stock-adjustment-reasons"><option value="Physical stock count" /><option value="Damage / breakage" /><option value="Expiry / disposal" /><option value="Found during audit" /><option value="Data correction" /></datalist>
              </label>
              <label className="form-field form-field-wide">
                <span>Internal note</span>
                <textarea value={note} maxLength={1000} placeholder="Optional details, location, or count reference" disabled={isSaving} onChange={(event) => updateField(setNote, event.target.value)} />
              </label>
            </div>
            {formError ? <p className="form-error" role="alert">{formError}</p> : null}
            <div className="stock-adjustment-actions">
              <button className="outline-button" type="button" disabled={isSaving} onClick={() => { setAdjustmentQty(''); setReason(''); setNote(''); setFormError(null); setSuccessMessage(null) }}>Clear</button>
              <button className={`primary-action-button ${isStockIn ? 'stock-in-action' : 'stock-out-action'}`} type="button" disabled={isSaving || !selectedProduct || parsedQty === null || wouldGoNegative} onClick={() => void save()}>{isSaving ? 'Posting transaction…' : isStockIn ? 'Add stock & post adjustment' : 'Remove stock & post adjustment'}</button>
            </div>
          </section>

          <aside className="stock-adjustment-preview" aria-label="Adjustment preview">
            <span>LIVE PREVIEW</span>
            {selectedProduct ? <>
              <h2>{selectedProduct.name}</h2>
              <p>{selectedProduct.code || selectedProduct.hsn || 'No product code'} · {selectedProduct.unit || 'PCS'}</p>
              <dl>
                <div><dt>Current stock</dt><dd>{quantity(selectedProduct.stockQty)}</dd></div>
                <div><dt>Movement</dt><dd className={parsedQty && parsedQty < 0 ? 'negative' : 'positive'}>{parsedQty === null ? '—' : `${parsedQty > 0 ? '+' : '−'}${quantity(Math.abs(parsedQty))}`}</dd></div>
                <div className="stock-preview-result"><dt>Stock after</dt><dd>{nextStock === null ? quantity(selectedProduct.stockQty) : quantity(nextStock)}</dd></div>
              </dl>
              <div className={`stock-adjustment-type-preview ${parsedQty === null ? 'neutral' : isStockIn ? 'in' : 'out'}`}><strong>{parsedQty === null ? 'Enter quantity' : isStockIn ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT'}</strong><span>{parsedQty === null ? 'The stock direction will be chosen from the signed quantity.' : isStockIn ? 'A ledger row will add inventory.' : 'A ledger row will remove inventory after live stock validation.'}</span></div>
              {wouldGoNegative ? <p className="form-error">This would result in negative stock. Reduce the quantity or add stock instead.</p> : null}
            </> : <div className="stock-preview-empty"><span aria-hidden="true">▤</span><strong>Select a product</strong><p>Its live stock balance will be transaction-checked before posting.</p></div>}
          </aside>
        </section>
      </section>
    </main>
  )
}
