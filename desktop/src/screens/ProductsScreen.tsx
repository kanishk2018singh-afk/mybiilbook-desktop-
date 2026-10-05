import { useEffect, useMemo, useState } from 'react'
import { DesktopSidebar, type DesktopPage } from '../components/DesktopSidebar'
import { useAuth } from '../context/AuthContext'
import { useBusiness } from '../context/BusinessContext'
import { buildCategoryTree } from '../lib/categoryTree'
import { PRODUCT_UNITS, displayProductCategory, isLowStock, searchableProductText } from '../lib/productUtils'
import { subscribeToCategories } from '../repositories/categoriesRepository'
import { subscribeToCompanies } from '../repositories/companiesRepository'
import { createProductWithOpeningStock, removeProduct, subscribeToProducts, updateProduct } from '../repositories/productsRepository'
import type { Category } from '../types/category'
import type { Company } from '../types/company'
import type { Product, ProductCreateInput, ProductUpdateInput } from '../types/product'

interface ProductsScreenProps {
  onNavigate: (page: DesktopPage) => void
}

interface ProductDraft {
  companyId: string
  companyName: string
  name: string
  code: string
  barcode: string
  brand: string
  category: string
  subcategory: string
  hsn: string
  unit: string
  mrp: string
  discountPercent: string
  gstPercent: string
  purchasePrice: string
  stockQty: string
  lowStockAlert: string
  notes: string
  imageUri: string
}

function emptyProductDraft(companies: Company[]): ProductDraft {
  const defaultCompany = companies.find((company) => company.isDefault)
  return {
    companyId: defaultCompany?.id ?? '',
    companyName: defaultCompany?.name ?? '',
    name: '',
    code: '',
    barcode: '',
    brand: '',
    category: '',
    subcategory: '',
    hsn: '',
    unit: 'PCS',
    mrp: '0',
    discountPercent: '0',
    gstPercent: '0',
    purchasePrice: '0',
    stockQty: '0',
    lowStockAlert: '0',
    notes: '',
    imageUri: '',
  }
}

function draftFromProduct(product: Product): ProductDraft {
  return {
    companyId: product.companyId,
    companyName: product.companyName,
    name: product.name,
    code: product.code,
    barcode: product.barcode,
    brand: product.brand,
    category: product.category,
    subcategory: product.subcategory,
    hsn: product.hsn,
    unit: product.unit || 'PCS',
    mrp: String(product.mrp),
    discountPercent: String(product.discountPercent),
    gstPercent: String(product.gstPercent),
    purchasePrice: String(product.purchasePrice),
    stockQty: String(product.stockQty),
    lowStockAlert: String(product.lowStockAlert),
    notes: product.notes,
    imageUri: product.imageUri,
  }
}

function nonNegativeNumber(value: string): number | null {
  const text = value.trim()
  if (!text) return null
  const parsed = Number(text)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function productError(error: unknown): string {
  return error instanceof Error ? error.message : 'The product could not be saved.'
}

function money(value: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value)
}

function ProductEditor({
  product,
  products,
  companies,
  categories,
  uid,
  businessId,
  onClose,
}: {
  product: Product | null
  products: Product[]
  companies: Company[]
  categories: Category[]
  uid: string
  businessId: string
  onClose: () => void
}) {
  const [draft, setDraft] = useState<ProductDraft>(() => (product ? draftFromProduct(product) : emptyProductDraft(companies)))
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDraft(product ? draftFromProduct(product) : emptyProductDraft(companies))
    setError(null)
  }, [companies, product])

  const categoryTree = useMemo(() => buildCategoryTree(categories), [categories])
  const topLevelCategories = useMemo(() => categoryTree.map((node) => node.category), [categoryTree])
  const selectedCategoryNode = useMemo(
    () => categoryTree.find((node) => node.category.name === draft.category),
    [categoryTree, draft.category],
  )
  const subcategoryOptions = selectedCategoryNode?.children.map((node) => node.category) ?? []
  const unitOptions = useMemo(
    () => (PRODUCT_UNITS.includes(draft.unit) ? PRODUCT_UNITS : [draft.unit, ...PRODUCT_UNITS]),
    [draft.unit],
  )

  const updateDraft = <K extends keyof ProductDraft>(field: K, value: ProductDraft[K]) => {
    setError(null)
    setDraft((current) => ({ ...current, [field]: value }))
  }

  const selectCompany = (companyId: string) => {
    const company = companies.find((item) => item.id === companyId)
    setError(null)
    setDraft((current) => ({
      ...current,
      companyId,
      companyName: company?.name ?? (companyId ? current.companyName : ''),
    }))
  }

  const selectCategory = (categoryName: string) => {
    setError(null)
    setDraft((current) => ({ ...current, category: categoryName, subcategory: '' }))
  }

  const save = async () => {
    const mrp = nonNegativeNumber(draft.mrp)
    const purchasePrice = nonNegativeNumber(draft.purchasePrice)
    const discountPercent = nonNegativeNumber(draft.discountPercent)
    const gstPercent = nonNegativeNumber(draft.gstPercent)
    const lowStockAlert = nonNegativeNumber(draft.lowStockAlert)
    const stockQty = nonNegativeNumber(draft.stockQty)

    if (!draft.name.trim()) {
      setError('Product name is required.')
      return
    }
    if ([mrp, purchasePrice, discountPercent, gstPercent, lowStockAlert].some((value) => value === null)) {
      setError('Enter valid non-negative values for pricing and low-stock fields.')
      return
    }
    if (!product && stockQty === null) {
      setError('Enter a valid non-negative opening stock quantity.')
      return
    }
    if ((discountPercent ?? 0) > 100 || (gstPercent ?? 0) > 100) {
      setError('Discount and GST percentages cannot be greater than 100.')
      return
    }

    const duplicateCode = draft.code.trim() && products.some(
      (item) => item.id !== product?.id && item.code && item.code.toLocaleLowerCase() === draft.code.trim().toLocaleLowerCase(),
    )
    if (duplicateCode) {
      setError('Another product already uses this product code.')
      return
    }
    const duplicateBarcode = draft.barcode.trim() && products.some(
      (item) => item.id !== product?.id && item.barcode && item.barcode === draft.barcode.trim(),
    )
    if (duplicateBarcode) {
      setError('Another product already uses this barcode.')
      return
    }

    const selectedCompany = companies.find((item) => item.id === draft.companyId)
    const baseInput: ProductUpdateInput = {
      companyId: draft.companyId,
      companyName: selectedCompany?.name ?? draft.companyName,
      name: draft.name,
      code: draft.code,
      barcode: draft.barcode,
      brand: draft.brand,
      category: draft.category,
      subcategory: draft.subcategory,
      hsn: draft.hsn,
      unit: draft.unit,
      mrp: mrp!,
      discountPercent: discountPercent!,
      gstPercent: gstPercent!,
      purchasePrice: purchasePrice!,
      lowStockAlert: lowStockAlert!,
      notes: draft.notes,
      imageUri: draft.imageUri,
    }

    setIsSaving(true)
    setError(null)
    try {
      if (product) {
        await updateProduct(uid, businessId, product.id, baseInput)
      } else {
        const createInput: ProductCreateInput = { ...baseInput, stockQty: stockQty! }
        await createProductWithOpeningStock(uid, businessId, createInput)
      }
      onClose()
    } catch (saveError) {
      setError(productError(saveError))
    } finally {
      setIsSaving(false)
    }
  }

  const unknownCompany = draft.companyId && !companies.some((company) => company.id === draft.companyId)
  const unknownCategory = draft.category && !topLevelCategories.some((category) => category.name === draft.category)
  const unknownSubcategory = draft.subcategory && !subcategoryOptions.some((category) => category.name === draft.subcategory)

  return (
    <section className="product-editor-panel" aria-labelledby="product-editor-title">
      <div className="editor-panel-heading">
        <div>
          <p className="panel-kicker">PRODUCT CATALOG</p>
          <h2 id="product-editor-title">{product ? `Edit ${product.name}` : 'Add product'}</h2>
        </div>
        <button className="icon-close-button" type="button" onClick={onClose} aria-label="Close product form">×</button>
      </div>

      <section className="product-form-section">
        <div className="product-section-heading">
          <span>01</span>
          <div><h3>Basic info</h3><p>Identity and product details.</p></div>
        </div>
        <div className="form-grid two-columns">
          <label className="form-field form-field-wide">
            <span>Name <b>*</b></span>
            <input autoFocus value={draft.name} maxLength={150} placeholder="e.g. Wall Hung WC" onChange={(event) => updateDraft('name', event.target.value)} />
          </label>
          <label className="form-field">
            <span>Product code</span>
            <input value={draft.code} maxLength={80} placeholder="e.g. WH-WC-001" onChange={(event) => updateDraft('code', event.target.value)} />
          </label>
          <label className="form-field">
            <span>Barcode</span>
            <input value={draft.barcode} maxLength={120} placeholder="Scan or type barcode" onChange={(event) => updateDraft('barcode', event.target.value)} />
          </label>
          <label className="form-field">
            <span>Brand</span>
            <input value={draft.brand} maxLength={100} placeholder="Optional brand label" onChange={(event) => updateDraft('brand', event.target.value)} />
          </label>
          <label className="form-field">
            <span>HSN</span>
            <input value={draft.hsn} maxLength={20} placeholder="e.g. 6910" onChange={(event) => updateDraft('hsn', event.target.value)} />
          </label>
          <label className="form-field">
            <span>Unit</span>
            <select value={draft.unit} onChange={(event) => updateDraft('unit', event.target.value)}>
              {unitOptions.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
            </select>
          </label>
          <label className="form-field form-field-wide">
            <span>Image URI</span>
            <input value={draft.imageUri} maxLength={1000} placeholder="https://…/product-image.jpg" onChange={(event) => updateDraft('imageUri', event.target.value)} />
          </label>
          <label className="form-field form-field-wide">
            <span>Notes</span>
            <textarea value={draft.notes} maxLength={1000} placeholder="Optional internal notes" onChange={(event) => updateDraft('notes', event.target.value)} />
          </label>
        </div>
      </section>

      <section className="product-form-section">
        <div className="product-section-heading">
          <span>02</span>
          <div><h3>Company &amp; category</h3><p>Classify this product for faster filtering.</p></div>
        </div>
        <div className="form-grid two-columns">
          <label className="form-field">
            <span>Company / brand</span>
            <select value={draft.companyId} onChange={(event) => selectCompany(event.target.value)}>
              <option value="">No company selected</option>
              {unknownCompany ? <option value={draft.companyId}>{draft.companyName || 'Unavailable company'}</option> : null}
              {companies.map((company) => <option value={company.id} key={company.id}>{company.name}{company.isDefault ? ' (default)' : ''}</option>)}
            </select>
          </label>
          <label className="form-field">
            <span>Category</span>
            <select value={draft.category} onChange={(event) => selectCategory(event.target.value)}>
              <option value="">No category selected</option>
              {unknownCategory ? <option value={draft.category}>{draft.category} (unavailable)</option> : null}
              {topLevelCategories.map((category) => <option value={category.name} key={category.id}>{category.name}</option>)}
            </select>
          </label>
          <label className="form-field">
            <span>Subcategory</span>
            <select value={draft.subcategory} onChange={(event) => updateDraft('subcategory', event.target.value)} disabled={!draft.category}>
              <option value="">No subcategory selected</option>
              {unknownSubcategory ? <option value={draft.subcategory}>{draft.subcategory} (unavailable)</option> : null}
              {subcategoryOptions.map((category) => <option value={category.name} key={category.id}>{category.name}</option>)}
            </select>
          </label>
        </div>
      </section>

      <section className="product-form-section">
        <div className="product-section-heading">
          <span>03</span>
          <div><h3>Pricing</h3><p>All values are stored in Indian rupees.</p></div>
        </div>
        <div className="form-grid four-columns">
          <label className="form-field"><span>MRP</span><input value={draft.mrp} type="number" min="0" step="0.01" inputMode="decimal" onChange={(event) => updateDraft('mrp', event.target.value)} /></label>
          <label className="form-field"><span>Purchase price</span><input value={draft.purchasePrice} type="number" min="0" step="0.01" inputMode="decimal" onChange={(event) => updateDraft('purchasePrice', event.target.value)} /></label>
          <label className="form-field"><span>Discount %</span><input value={draft.discountPercent} type="number" min="0" max="100" step="0.01" inputMode="decimal" onChange={(event) => updateDraft('discountPercent', event.target.value)} /></label>
          <label className="form-field"><span>GST %</span><input value={draft.gstPercent} type="number" min="0" max="100" step="0.01" inputMode="decimal" onChange={(event) => updateDraft('gstPercent', event.target.value)} /></label>
        </div>
      </section>

      <section className="product-form-section">
        <div className="product-section-heading">
          <span>04</span>
          <div><h3>Stock</h3><p>{product ? 'Current stock is ledger-controlled.' : 'Set the opening stock ledger baseline.'}</p></div>
        </div>
        <div className="form-grid two-columns">
          {product ? (
            <div className="stock-lock-note">
              <strong>Current stock: {product.stockQty} {product.unit || 'PCS'}</strong>
              <span>Stock can only be changed via Purchase, Sale, Return, or Adjustment.</span>
            </div>
          ) : (
            <label className="form-field">
              <span>Initial stock quantity</span>
              <input value={draft.stockQty} type="number" min="0" step="0.001" inputMode="decimal" onChange={(event) => updateDraft('stockQty', event.target.value)} />
              <small className="field-helper">Saving creates an OPENING stock transaction with this quantity.</small>
            </label>
          )}
          <label className="form-field">
            <span>Low-stock alert</span>
            <input value={draft.lowStockAlert} type="number" min="0" step="0.001" inputMode="decimal" onChange={(event) => updateDraft('lowStockAlert', event.target.value)} />
          </label>
        </div>
      </section>

      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="editor-actions product-editor-actions">
        <button className="outline-button" type="button" onClick={onClose}>Cancel</button>
        <button className="primary-action-button" type="button" onClick={() => void save()} disabled={isSaving}>
          {isSaving ? 'Saving…' : product ? 'Save product' : 'Create product'}
        </button>
      </div>
    </section>
  )
}

function DeleteProductDialog({
  product,
  uid,
  businessId,
  onClose,
}: {
  product: Product
  uid: string
  businessId: string
  onClose: () => void
}) {
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const remove = async () => {
    setIsDeleting(true)
    setError(null)
    try {
      await removeProduct(uid, businessId, product.id)
      onClose()
    } catch (deleteError) {
      setError(productError(deleteError))
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-product-title">
        <div className="dialog-icon danger" aria-hidden="true">!</div>
        <h2 id="delete-product-title">Delete {product.name}?</h2>
        <p>This removes the product from the catalog. Existing stock transaction history is retained for audit purposes.</p>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="dialog-actions">
          <button className="outline-button" type="button" onClick={onClose} disabled={isDeleting}>Cancel</button>
          <button className="danger-action-button" type="button" onClick={() => void remove()} disabled={isDeleting}>
            {isDeleting ? 'Deleting…' : 'Delete product'}
          </button>
        </div>
      </section>
    </div>
  )
}

export function ProductsScreen({ onNavigate }: ProductsScreenProps) {
  const { user, signOut } = useAuth()
  const { selectedBusiness, selectedBusinessId, clearBusinessSelection } = useBusiness()
  const [products, setProducts] = useState<Product[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [productsLoading, setProductsLoading] = useState(true)
  const [companiesLoading, setCompaniesLoading] = useState(true)
  const [categoriesLoading, setCategoriesLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editorTarget, setEditorTarget] = useState<Product | 'new' | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null)
  const [search, setSearch] = useState('')
  const [companyFilter, setCompanyFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [lowStockOnly, setLowStockOnly] = useState(false)

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
    if (!user || !selectedBusinessId) return
    setCompaniesLoading(true)
    setCategoriesLoading(true)
    const unsubscribeCompanies = subscribeToCompanies(
      user.uid,
      selectedBusinessId,
      (nextCompanies) => {
        setCompanies(nextCompanies)
        setCompaniesLoading(false)
      },
      (error) => {
        setLoadError(error.message || 'Companies could not be loaded.')
        setCompaniesLoading(false)
      },
    )
    const unsubscribeCategories = subscribeToCategories(
      user.uid,
      selectedBusinessId,
      (nextCategories) => {
        setCategories(nextCategories)
        setCategoriesLoading(false)
      },
      (error) => {
        setLoadError(error.message || 'Categories could not be loaded.')
        setCategoriesLoading(false)
      },
    )
    return () => {
      unsubscribeCompanies()
      unsubscribeCategories()
    }
  }, [selectedBusinessId, user?.uid])

  const categoryTree = useMemo(() => buildCategoryTree(categories), [categories])
  const topLevelCategories = useMemo(() => categoryTree.map((node) => node.category), [categoryTree])
  const filteredProducts = useMemo(() => {
    const term = search.trim().toLocaleLowerCase()
    return products.filter((product) => {
      if (term && !searchableProductText(product).includes(term)) return false
      if (companyFilter && product.companyId !== companyFilter) return false
      if (categoryFilter && product.category !== categoryFilter) return false
      if (lowStockOnly && !isLowStock(product)) return false
      return true
    })
  }, [categoryFilter, companyFilter, lowStockOnly, products, search])

  if (!user || !selectedBusiness || !selectedBusinessId) return null

  const isLoading = productsLoading || companiesLoading || categoriesLoading

  return (
    <main className="desktop-layout">
      <DesktopSidebar activePage="products" onNavigate={onNavigate} />
      <section className="dashboard-content management-content products-content">
        <header className="dashboard-header">
          <div>
            <p className="breadcrumb">SHOWROOM / MASTER DATA</p>
            <h1>Products</h1>
            <p>{selectedBusiness.name} · Catalog, pricing, company, category, and current stock visibility.</p>
          </div>
          <div className="header-actions">
            <button className="outline-button" type="button" onClick={() => onNavigate('stockLedger')}>Stock ledger</button>
            <button className="outline-button" type="button" onClick={() => onNavigate('stockAdjustment')}>± Adjust stock</button>
            <button className="outline-button" type="button" onClick={clearBusinessSelection}>Switch business</button>
            <button className="user-button" type="button" onClick={() => void signOut()} title="Sign out">
              {(user.displayName ?? user.email ?? 'U').slice(0, 1).toUpperCase()}
            </button>
          </div>
        </header>

        <section className="management-toolbar product-toolbar">
          <div>
            <span className="status-chip"><span className="live-dot" /> Live Firestore catalog</span>
            <h2>{filteredProducts.length} of {products.length} products</h2>
            <p>Opening stock creates an immutable stock-ledger baseline.</p>
          </div>
          <button className="primary-action-button" type="button" onClick={() => setEditorTarget('new')}>＋ Add product</button>
        </section>

        <section className="product-filter-bar" aria-label="Product filters">
          <label className="product-search-field">
            <span aria-hidden="true">⌕</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, code, barcode, brand, HSN…" />
          </label>
          <select value={companyFilter} onChange={(event) => setCompanyFilter(event.target.value)} aria-label="Filter by company">
            <option value="">All companies</option>
            {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
          </select>
          <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} aria-label="Filter by category">
            <option value="">All categories</option>
            {topLevelCategories.map((category) => <option key={category.id} value={category.name}>{category.name}</option>)}
          </select>
          <label className="low-stock-toggle">
            <input type="checkbox" checked={lowStockOnly} onChange={(event) => setLowStockOnly(event.target.checked)} />
            Low stock only
          </label>
        </section>

        {loadError ? <div className="settings-error" role="alert">{loadError}</div> : null}
        {isLoading ? <div className="settings-loading">Loading products, companies, and categories…</div> : null}
        {!isLoading && !loadError ? (
          products.length ? (
            filteredProducts.length ? (
              <div className="data-table-wrap product-table-wrap">
                <table className="data-table product-table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Company / category</th>
                      <th>Pricing</th>
                      <th>Stock</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProducts.map((product) => {
                      const lowStock = isLowStock(product)
                      return (
                        <tr className={lowStock ? 'low-stock-row' : ''} key={product.id}>
                          <td>
                            <div className="product-cell">
                              {product.imageUri ? <img className="product-thumb" src={product.imageUri} alt="" onError={(event) => { event.currentTarget.style.display = 'none' }} /> : <span className="product-thumb placeholder" aria-hidden="true">▤</span>}
                              <div>
                                <strong>{product.name}</strong>
                                <small>{product.code || product.barcode || product.hsn || 'No code'}</small>
                              </div>
                            </div>
                          </td>
                          <td>
                            <div className="product-meta-cell">
                              <strong>{product.companyName || product.brand || '—'}</strong>
                              <small>{displayProductCategory(product)}</small>
                            </div>
                          </td>
                          <td>
                            <div className="product-meta-cell">
                              <strong>{money(product.mrp)}</strong>
                              <small>Cost {money(product.purchasePrice)} · GST {product.gstPercent}%</small>
                            </div>
                          </td>
                          <td>
                            <div className="stock-cell">
                              <strong>{product.stockQty} {product.unit || 'PCS'}</strong>
                              {lowStock ? <span className="low-stock-badge">Low · alert {product.lowStockAlert}</span> : <small>Alert at {product.lowStockAlert}</small>}
                            </div>
                          </td>
                          <td className="row-actions">
                            <button className="row-action-button" type="button" onClick={() => setEditorTarget(product)}>Edit</button>
                            <button className="row-action-button danger-text" type="button" onClick={() => setDeleteTarget(product)}>Delete</button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <section className="empty-master-state filter-empty-state">
                <div className="empty-icon" aria-hidden="true">⌕</div>
                <h2>No matching products</h2>
                <p>Try clearing a filter or search for a different product.</p>
                <button className="outline-button" type="button" onClick={() => { setSearch(''); setCompanyFilter(''); setCategoryFilter(''); setLowStockOnly(false) }}>Clear filters</button>
              </section>
            )
          ) : (
            <section className="empty-master-state">
              <div className="empty-icon" aria-hidden="true">▤</div>
              <h2>No products yet</h2>
              <p>Create the first product and its opening stock ledger entry together.</p>
              <button className="primary-action-button" type="button" onClick={() => setEditorTarget('new')}>Add first product</button>
            </section>
          )
        ) : null}
      </section>

      {editorTarget ? (
        <div className="editor-backdrop" role="presentation">
          <ProductEditor
            product={editorTarget === 'new' ? null : editorTarget}
            products={products}
            companies={companies}
            categories={categories}
            uid={user.uid}
            businessId={selectedBusinessId}
            onClose={() => setEditorTarget(null)}
          />
        </div>
      ) : null}
      {deleteTarget ? <DeleteProductDialog product={deleteTarget} uid={user.uid} businessId={selectedBusinessId} onClose={() => setDeleteTarget(null)} /> : null}
    </main>
  )
}
