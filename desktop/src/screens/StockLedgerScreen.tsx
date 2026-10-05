import { useEffect, useMemo, useState } from 'react'
import { BillingInternetNotice } from '../components/BillingInternetNotice'
import { DesktopSidebar, type DesktopPage } from '../components/DesktopSidebar'
import { useAuth } from '../context/AuthContext'
import { useBusiness } from '../context/BusinessContext'
import { useSyncStatus } from '../context/SyncStatusContext'
import { buildStockLedger, roundStock, stockDirection, stockTransactionTypeLabel, summarizeStockLedger } from '../lib/stockLedgerUtils'
import { subscribeToProducts } from '../repositories/productsRepository'
import { subscribeToStockTransactions } from '../repositories/stockRepository'
import type { Product } from '../types/product'
import type { StockTransaction } from '../types/stock'

interface StockLedgerScreenProps {
  onNavigate: (page: DesktopPage) => void
}

function quantity(value: number): string {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(value)
}

function dateTimeLabel(value: string): string {
  if (!value) return 'Timestamp pending'
  const parsed = new Date(value)
  return Number.isNaN(parsed.valueOf())
    ? value
    : new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(parsed)
}

function transactionCopy(entry: StockTransaction): string {
  return entry.referenceNumber || entry.referenceType || 'Manual / legacy entry'
}

export function StockLedgerScreen({ onNavigate }: StockLedgerScreenProps) {
  const { user, signOut } = useAuth()
  const { isOnline } = useSyncStatus()
  const { selectedBusiness, selectedBusinessId, clearBusinessSelection } = useBusiness()
  const [products, setProducts] = useState<Product[]>([])
  const [productsLoading, setProductsLoading] = useState(true)
  const [productId, setProductId] = useState('')
  const [transactions, setTransactions] = useState<StockTransaction[]>([])
  const [transactionsLoading, setTransactionsLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

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
    setTransactions([])
    if (!user || !selectedBusinessId || !productId) {
      setTransactionsLoading(false)
      return
    }
    setTransactionsLoading(true)
    return subscribeToStockTransactions(
      user.uid,
      selectedBusinessId,
      productId,
      (nextTransactions) => {
        setTransactions(nextTransactions)
        setTransactionsLoading(false)
      },
      (error) => {
        setLoadError(error.message || 'Stock ledger entries could not be loaded.')
        setTransactionsLoading(false)
      },
    )
  }, [productId, selectedBusinessId, user?.uid])

  const selectedProduct = useMemo(() => products.find((product) => product.id === productId) ?? null, [productId, products])
  const ledger = useMemo(() => buildStockLedger(transactions), [transactions])
  const totals = useMemo(() => summarizeStockLedger(ledger), [ledger])
  const reconciliationDifference = selectedProduct ? roundStock(selectedProduct.stockQty - totals.calculatedCurrentStock) : 0
  const isReconciled = Math.abs(reconciliationDifference) <= 0.000001

  if (!user || !selectedBusiness || !selectedBusinessId) return null

  const selectProduct = (nextProductId: string) => {
    setProductId(nextProductId)
    setLoadError(null)
  }

  return (
    <main className="desktop-layout">
      <DesktopSidebar activePage="stockLedger" onNavigate={onNavigate} />
      <section className="dashboard-content stock-ledger-content">
        <header className="dashboard-header">
          <div>
            <button className="back-link-button" type="button" onClick={() => onNavigate('products')}>← Products</button>
            <p className="breadcrumb">SHOWROOM / INVENTORY / LEDGER</p>
            <h1>Stock ledger</h1>
            <p>Review every stock movement in chronological passbook order and reconcile it to the current product stock.</p>
          </div>
          <div className="header-actions">
            <button className="primary-action-button" type="button" disabled={!isOnline} onClick={() => onNavigate('stockAdjustment')}>± Stock adjustment</button>
            <button className="outline-button" type="button" onClick={clearBusinessSelection}>Switch business</button>
            <button className="user-button" type="button" onClick={() => void signOut()} title="Sign out">{(user.displayName ?? user.email ?? 'U').slice(0, 1).toUpperCase()}</button>
          </div>
        </header>

        <BillingInternetNotice />

        <section className="stock-ledger-selector-card">
          <div><span className="panel-kicker">PRODUCT PASSBOOK</span><h2>Select a product</h2><p>The report includes Opening, Purchase, Sale, returns, adjustments, Damage, and any migrated movements.</p></div>
          <label className="form-field"><span>Product</span><select value={productId} disabled={productsLoading} onChange={(event) => selectProduct(event.target.value)}><option value="">{productsLoading ? 'Loading products…' : 'Select product'}</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}{product.code ? ` · ${product.code}` : ''} · current {quantity(product.stockQty)} {product.unit || 'PCS'}</option>)}</select></label>
        </section>

        {loadError ? <div className="settings-error" role="alert">{loadError}</div> : null}
        {productsLoading || transactionsLoading ? <div className="settings-loading">{productsLoading ? 'Loading products…' : 'Loading stock movements…'}</div> : null}

        {selectedProduct && !transactionsLoading ? <>
          <section className="stock-ledger-hero">
            <div><span className="stock-ledger-product-unit">{selectedProduct.unit || 'PCS'}</span><h2>{selectedProduct.name}</h2><p>{[selectedProduct.code, selectedProduct.hsn ? `HSN ${selectedProduct.hsn}` : '', selectedProduct.companyName].filter(Boolean).join(' · ') || 'Product inventory passbook'}</p></div>
            <div className="stock-ledger-balance-pair"><article><span>Current product stock</span><strong>{quantity(selectedProduct.stockQty)}</strong></article><article className={isReconciled ? 'reconciled' : 'mismatch'}><span>Calculated ledger balance</span><strong>{quantity(totals.calculatedCurrentStock)}</strong><small>{isReconciled ? 'Reconciled' : `${reconciliationDifference > 0 ? '+' : '−'}${quantity(Math.abs(reconciliationDifference))} difference`}</small></article></div>
          </section>

          <section className="stock-ledger-formula-card" aria-label="Stock balance formula">
            <div className="stock-formula-heading"><strong>Stock balance formula</strong><span>Opening + Purchase + Sales Return − Sales − Purchase Return ± Adjustment − Damage</span></div>
            <div className="stock-formula-grid"><article><span>Opening</span><strong>+{quantity(totals.opening)}</strong></article><article><span>Purchase</span><strong>+{quantity(totals.purchase)}</strong></article><article><span>Sales return</span><strong>+{quantity(totals.saleReturn)}</strong></article><article><span>Sales</span><strong>−{quantity(totals.sale)}</strong></article><article><span>Purchase return</span><strong>−{quantity(totals.purchaseReturn)}</strong></article><article><span>Adjustment in</span><strong>+{quantity(totals.adjustmentIn)}</strong></article><article><span>Adjustment out</span><strong>−{quantity(totals.adjustmentOut)}</strong></article><article><span>Damage</span><strong>−{quantity(totals.damage)}</strong></article>{totals.otherDelta ? <article><span>Other / legacy</span><strong className={totals.otherDelta >= 0 ? 'positive' : 'negative'}>{totals.otherDelta >= 0 ? '+' : '−'}{quantity(Math.abs(totals.otherDelta))}</strong></article> : null}<article className="stock-formula-result"><span>Calculated stock</span><strong>{quantity(totals.calculatedCurrentStock)} {selectedProduct.unit || 'PCS'}</strong></article></div>
          </section>

          <section className="stock-ledger-table-card">
            <div className="stock-ledger-table-heading"><div><h2>Chronological movements</h2><p>{ledger.length ? `${ledger.length} movement${ledger.length === 1 ? '' : 's'} · oldest first` : 'No movements posted for this product yet.'}</p></div><div className="stock-ledger-total-badges"><span>In {quantity(totals.totalIn)}</span><span>Out {quantity(totals.totalOut)}</span></div></div>
            {ledger.length ? <div className="invoice-lines-wrap"><table className="stock-ledger-table"><thead><tr><th>Date &amp; time</th><th>Movement</th><th>Reference / reason</th><th>Note</th><th>In</th><th>Out</th><th>Running balance</th></tr></thead><tbody>{ledger.map((entry) => {
              const direction = stockDirection(entry.type, entry.quantityDelta)
              return <tr key={entry.id}><td><time dateTime={entry.createdAt || undefined}>{dateTimeLabel(entry.createdAt)}</time></td><td><span className={`stock-transaction-pill ${entry.type.toLowerCase()} ${direction.toLowerCase()}`}>{stockTransactionTypeLabel(entry.type)}</span></td><td><div className="stock-ledger-reference"><strong>{transactionCopy(entry)}</strong><small>{entry.reason || entry.referenceId || 'No reason recorded'}</small></div></td><td className="stock-ledger-note">{entry.note || '—'}</td><td className="stock-in-cell">{entry.quantityIn ? `+${quantity(entry.quantityIn)}` : '—'}</td><td className="stock-out-cell">{entry.quantityOut ? `−${quantity(entry.quantityOut)}` : '—'}</td><td><strong>{quantity(entry.runningBalanceQty)} {selectedProduct.unit || 'PCS'}</strong>{entry.balanceAfter !== null && Math.abs(entry.balanceAfter - entry.runningBalanceQty) > 0.000001 ? <small className="stock-balance-audit">posted {quantity(entry.balanceAfter)}</small> : null}</td></tr>
            })}</tbody></table></div> : <div className="stock-ledger-empty"><span aria-hidden="true">▤</span><h2>No stock transactions found</h2><p>Create an opening-stock product, post a purchase/sale, or record an adjustment to begin this passbook.</p><button className="primary-action-button compact-action" type="button" disabled={!isOnline} onClick={() => onNavigate('stockAdjustment')}>Record stock adjustment</button></div>}
          </section>

          {!isReconciled ? <section className="stock-ledger-reconciliation-warning"><strong>Ledger reconciliation notice</strong><p>The calculated movement total differs from the current product stock by {quantity(Math.abs(reconciliationDifference))} {selectedProduct.unit || 'PCS'}. Review legacy/missing entries before using the ledger as the audit baseline; do not edit the product stock directly.</p></section> : null}
        </> : null}

        {!selectedProduct && !productsLoading ? <section className="stock-ledger-empty stock-ledger-select-empty"><span aria-hidden="true">▤</span><h2>Select a product to open its passbook</h2><p>Every inventory movement for the product will be displayed oldest first with a calculated running balance.</p></section> : null}
      </section>
    </main>
  )
}
