import { useEffect, useMemo, useState } from 'react'
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { DesktopSidebar, type DesktopPage } from '../components/DesktopSidebar'
import { useAuth } from '../context/AuthContext'
import { useBusiness } from '../context/BusinessContext'
import { filterExpenses, groupExpensesByCategory, totalExpenseAmount } from '../lib/expenseUtils'
import { subscribeToExpenseCategories } from '../repositories/expenseCategoriesRepository'
import { createExpense, removeExpense, subscribeToExpenses, updateExpense } from '../repositories/expensesRepository'
import {
  EMPTY_EXPENSE_FILTERS,
  EXPENSE_PAYMENT_MODES,
  type Expense,
  type ExpenseCategory,
  type ExpenseFilters,
  type ExpenseInput,
  type ExpensePaymentMode,
} from '../types/expense'

interface ExpensesScreenProps {
  onNavigate: (page: DesktopPage) => void
}

interface ExpenseDraft {
  date: string
  categoryId: string
  amount: string
  mode: ExpensePaymentMode
  paidTo: string
  referenceNumber: string
  note: string
}

const CHART_COLORS = ['#14785e', '#3d7ab6', '#cc8440', '#9462b6', '#c65567', '#389a9c', '#728c48', '#6f728c']

function today(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const EMPTY_DRAFT: ExpenseDraft = {
  date: today(),
  categoryId: '',
  amount: '',
  mode: 'CASH',
  paidTo: '',
  referenceNumber: '',
  note: '',
}

function expenseDraft(expense: Expense): ExpenseDraft {
  return {
    date: expense.date || today(),
    categoryId: expense.categoryId,
    amount: expense.amount ? String(expense.amount) : '',
    mode: EXPENSE_PAYMENT_MODES.includes(expense.mode as ExpensePaymentMode) ? expense.mode as ExpensePaymentMode : 'OTHER',
    paidTo: expense.paidTo,
    referenceNumber: expense.referenceNumber,
    note: expense.note,
  }
}

function money(value: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value)
}

function dateLabel(value: string): string {
  if (!value) return '—'
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00`)
  return Number.isNaN(parsed.valueOf()) ? value : new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(parsed)
}

function expenseError(error: unknown): string {
  return error instanceof Error ? error.message : 'The expense could not be saved.'
}

function ExpenseEditor({
  expense,
  categories,
  uid,
  businessId,
  onClose,
  onManageCategories,
}: {
  expense: Expense | null
  categories: ExpenseCategory[]
  uid: string
  businessId: string
  onClose: () => void
  onManageCategories: () => void
}) {
  const [draft, setDraft] = useState<ExpenseDraft>(() => expense ? expenseDraft(expense) : EMPTY_DRAFT)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDraft(expense ? expenseDraft(expense) : { ...EMPTY_DRAFT, date: today() })
    setError(null)
  }, [expense])

  const selectedCategory = categories.find((category) => category.id === draft.categoryId) ?? null
  const categoryOptions = categories.filter((category) => category.isActive || category.id === draft.categoryId)
  const hasNoActiveCategories = !categories.some((category) => category.isActive)

  const updateDraft = <K extends keyof ExpenseDraft>(key: K, value: ExpenseDraft[K]) => {
    setError(null)
    setDraft((current) => ({ ...current, [key]: value }))
  }

  const save = async () => {
    const amount = Number(draft.amount)
    if (!selectedCategory) {
      setError('Choose an expense category before saving.')
      return
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Enter an amount greater than zero.')
      return
    }

    setIsSaving(true)
    setError(null)
    try {
      const input: ExpenseInput = {
        date: draft.date,
        categoryId: selectedCategory.id,
        categoryName: selectedCategory.name,
        amount,
        mode: draft.mode,
        paidTo: draft.paidTo,
        referenceNumber: draft.referenceNumber,
        note: draft.note,
      }
      if (expense) await updateExpense(uid, businessId, expense.id, input)
      else await createExpense(uid, businessId, input)
      onClose()
    } catch (saveError) {
      setError(expenseError(saveError))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section className="expense-editor-panel" role="dialog" aria-modal="true" aria-labelledby="expense-editor-title">
      <div className="editor-panel-heading">
        <div><p className="panel-kicker">EXPENSE ENTRY</p><h2 id="expense-editor-title">{expense ? 'Edit expense' : 'Record expense'}</h2></div>
        <button className="icon-close-button" type="button" onClick={onClose} aria-label="Close expense form">×</button>
      </div>
      <p className="expense-editor-intro">Record a business outgoing with its payment evidence. The category name is saved as an audit snapshot for your reports.</p>
      <div className="form-grid two-columns expense-form-grid">
        <label className="form-field"><span>Date <b>*</b></span><input type="date" value={draft.date} onChange={(event) => updateDraft('date', event.target.value)} /></label>
        <label className="form-field"><span>Amount <b>*</b></span><input type="number" min="0.01" step="0.01" inputMode="decimal" value={draft.amount} placeholder="0.00" onChange={(event) => updateDraft('amount', event.target.value)} /></label>
        <label className="form-field form-field-wide">
          <span>Expense category <b>*</b></span>
          <select value={draft.categoryId} onChange={(event) => updateDraft('categoryId', event.target.value)} disabled={!categoryOptions.length}>
            <option value="">{hasNoActiveCategories ? 'Create an expense category first' : 'Select expense category'}</option>
            {!selectedCategory && expense?.categoryId ? <option value={expense.categoryId}>{expense.categoryName || 'Unavailable category'}</option> : null}
            {categoryOptions.map((category) => <option value={category.id} key={category.id}>{category.name}{category.isActive ? '' : ' (inactive)'}</option>)}
          </select>
          {hasNoActiveCategories ? <small className="field-helper">No active category is available. <button className="inline-link-button" type="button" onClick={onManageCategories}>Manage categories</button></small> : null}
        </label>
        <label className="form-field"><span>Mode <b>*</b></span><select value={draft.mode} onChange={(event) => updateDraft('mode', event.target.value as ExpensePaymentMode)}>{EXPENSE_PAYMENT_MODES.map((mode) => <option value={mode} key={mode}>{mode}</option>)}</select></label>
        <label className="form-field"><span>Paid to <b>*</b></span><input value={draft.paidTo} maxLength={150} placeholder="Payee, supplier, landlord, employee…" onChange={(event) => updateDraft('paidTo', event.target.value)} /></label>
        <label className="form-field form-field-wide"><span>Reference number</span><input value={draft.referenceNumber} maxLength={120} placeholder={draft.mode === 'UPI' ? 'UPI / UTR reference' : 'Cheque, bank, bill, or receipt number'} onChange={(event) => updateDraft('referenceNumber', event.target.value)} /></label>
        <label className="form-field form-field-wide"><span>Note</span><textarea value={draft.note} maxLength={1000} placeholder="Optional note, bill details, or internal context" onChange={(event) => updateDraft('note', event.target.value)} /></label>
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="editor-actions">
        <button className="outline-button" type="button" onClick={onClose} disabled={isSaving}>Cancel</button>
        <button className="primary-action-button" type="button" onClick={() => void save()} disabled={isSaving || !categoryOptions.length}>{isSaving ? 'Saving…' : expense ? 'Save expense' : 'Record expense'}</button>
      </div>
    </section>
  )
}

function DeleteExpenseDialog({
  expense,
  uid,
  businessId,
  onClose,
}: {
  expense: Expense
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
      await removeExpense(uid, businessId, expense.id)
      onClose()
    } catch (deleteError) {
      setError(expenseError(deleteError))
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-expense-title">
        <div className="dialog-icon danger" aria-hidden="true">!</div>
        <h2 id="delete-expense-title">Delete this expense?</h2>
        <p>{money(expense.amount)} paid to {expense.paidTo || 'this payee'} on {dateLabel(expense.date)} will be removed from the expense register and category report.</p>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="dialog-actions">
          <button className="outline-button" type="button" onClick={onClose} disabled={isDeleting}>Cancel</button>
          <button className="danger-action-button" type="button" onClick={() => void remove()} disabled={isDeleting}>{isDeleting ? 'Deleting…' : 'Delete expense'}</button>
        </div>
      </section>
    </div>
  )
}

export function ExpensesScreen({ onNavigate }: ExpensesScreenProps) {
  const { user, signOut } = useAuth()
  const { selectedBusiness, selectedBusinessId, clearBusinessSelection } = useBusiness()
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [categories, setCategories] = useState<ExpenseCategory[]>([])
  const [expensesLoading, setExpensesLoading] = useState(true)
  const [categoriesLoading, setCategoriesLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [filters, setFilters] = useState<ExpenseFilters>(EMPTY_EXPENSE_FILTERS)
  const [editorTarget, setEditorTarget] = useState<Expense | 'new' | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Expense | null>(null)

  useEffect(() => {
    if (!user || !selectedBusinessId) return
    setExpensesLoading(true)
    setLoadError(null)
    return subscribeToExpenses(
      user.uid,
      selectedBusinessId,
      (nextExpenses) => {
        setExpenses(nextExpenses)
        setExpensesLoading(false)
      },
      (error) => {
        setLoadError(error.message || 'Expenses could not be loaded.')
        setExpensesLoading(false)
      },
    )
  }, [selectedBusinessId, user?.uid])

  useEffect(() => {
    if (!user || !selectedBusinessId) return
    setCategoriesLoading(true)
    return subscribeToExpenseCategories(
      user.uid,
      selectedBusinessId,
      (nextCategories) => {
        setCategories(nextCategories)
        setCategoriesLoading(false)
      },
      (error) => {
        setLoadError(error.message || 'Expense categories could not be loaded.')
        setCategoriesLoading(false)
      },
    )
  }, [selectedBusinessId, user?.uid])

  const visibleExpenses = useMemo(() => filterExpenses(expenses, filters), [expenses, filters])
  const categoryTotals = useMemo(() => groupExpensesByCategory(visibleExpenses), [visibleExpenses])
  const visibleTotal = useMemo(() => totalExpenseAmount(visibleExpenses), [visibleExpenses])
  const categoryOptions = useMemo(() => {
    const options = new Map(categories.map((category) => [category.id, category.name]))
    expenses.forEach((expense) => {
      if (expense.categoryId && !options.has(expense.categoryId)) options.set(expense.categoryId, expense.categoryName || 'Unavailable category')
    })
    return [...options.entries()].sort((left, right) => left[1].localeCompare(right[1], undefined, { sensitivity: 'base' }))
  }, [categories, expenses])

  const updateFilter = <K extends keyof ExpenseFilters>(key: K, value: ExpenseFilters[K]) => {
    setFilters((current) => ({ ...current, [key]: value }))
  }

  if (!user || !selectedBusiness || !selectedBusinessId) return null

  const loading = expensesLoading || categoriesLoading
  const chartData = categoryTotals.map((category) => ({ name: category.categoryName, value: category.amount }))

  return (
    <main className="desktop-layout">
      <DesktopSidebar activePage="expenses" onNavigate={onNavigate} />
      <section className="dashboard-content expenses-content">
        <header className="dashboard-header">
          <div>
            <p className="breadcrumb">SHOWROOM / EXPENSES</p>
            <h1>Expenses</h1>
            <p>{selectedBusiness.name} · Record operating costs and understand where your money is going.</p>
          </div>
          <div className="header-actions">
            <button className="outline-button" type="button" onClick={() => onNavigate('expenseCategories')}>Manage categories</button>
            <button className="primary-action-button" type="button" onClick={() => setEditorTarget('new')}>＋ Record expense</button>
            <button className="outline-button" type="button" onClick={clearBusinessSelection}>Switch business</button>
            <button className="user-button" type="button" onClick={() => void signOut()} title="Sign out">{(user.displayName ?? user.email ?? 'U').slice(0, 1).toUpperCase()}</button>
          </div>
        </header>

        <section className="expense-report-filters" aria-label="Expense report filters">
          <label><span>From date</span><input type="date" value={filters.dateFrom} onChange={(event) => updateFilter('dateFrom', event.target.value)} /></label>
          <label><span>To date</span><input type="date" min={filters.dateFrom || undefined} value={filters.dateTo} onChange={(event) => updateFilter('dateTo', event.target.value)} /></label>
          <label><span>Category</span><select value={filters.categoryId} onChange={(event) => updateFilter('categoryId', event.target.value)}><option value="">All categories</option>{categoryOptions.map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select></label>
          <label><span>Mode</span><select value={filters.mode} onChange={(event) => updateFilter('mode', event.target.value as ExpenseFilters['mode'])}><option value="">All modes</option>{EXPENSE_PAYMENT_MODES.map((mode) => <option value={mode} key={mode}>{mode}</option>)}</select></label>
          <button className="outline-button compact-action expense-filter-reset" type="button" onClick={() => setFilters(EMPTY_EXPENSE_FILTERS)}>Reset filters</button>
        </section>

        {loadError ? <div className="settings-error" role="alert">{loadError}</div> : null}
        {loading ? <div className="settings-loading">Loading expenses and categories…</div> : null}

        {!loading && !loadError ? (
          <>
            <section className="expense-report-overview" aria-label="Expense category analysis">
              <article className="expense-total-card"><span>Filtered expense total</span><strong>{money(visibleTotal)}</strong><small>{visibleExpenses.length} {visibleExpenses.length === 1 ? 'entry' : 'entries'} in the selected range</small></article>
              <section className="expense-category-summary-card">
                <div className="expense-report-card-heading"><div><p className="panel-kicker">CATEGORY TOTALS</p><h2>Where you spent</h2></div><span>{categoryTotals.length} {categoryTotals.length === 1 ? 'head' : 'heads'}</span></div>
                {categoryTotals.length ? <div className="expense-category-total-list">{categoryTotals.map((category, index) => {
                  const share = visibleTotal > 0 ? (category.amount / visibleTotal) * 100 : 0
                  return <div className="expense-category-total-row" key={category.categoryId}><i style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }} /><div><strong>{category.categoryName}</strong><small>{category.expenseCount} {category.expenseCount === 1 ? 'entry' : 'entries'} · {share.toFixed(1)}%</small></div><b>{money(category.amount)}</b></div>
                })}</div> : <p className="expense-analysis-empty">No expense total is available for the current filters.</p>}
              </section>
              <section className="expense-pie-card">
                <div className="expense-report-card-heading"><div><p className="panel-kicker">DISTRIBUTION</p><h2>Category-wise split</h2></div></div>
                {chartData.length ? <div className="expense-pie-wrap"><ResponsiveContainer width="100%" height={250}><PieChart><Pie data={chartData} dataKey="value" nameKey="name" innerRadius={54} outerRadius={90} paddingAngle={2}>{chartData.map((entry, index) => <Cell key={`${entry.name}-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}</Pie><Tooltip formatter={(value) => money(Number(value))} /><Legend verticalAlign="bottom" height={32} iconType="circle" /></PieChart></ResponsiveContainer></div> : <div className="expense-chart-empty"><span>◔</span><p>Record expenses to see the category distribution pie chart.</p></div>}
              </section>
            </section>

            <section className="expense-register-card">
              <div className="expense-register-heading"><div><p className="panel-kicker">EXPENSE REGISTER</p><h2>All expense entries</h2><p>Amounts and category totals below reflect the active filters.</p></div><button className="primary-action-button compact-action" type="button" onClick={() => setEditorTarget('new')}>＋ Record expense</button></div>
              {visibleExpenses.length ? <div className="expense-register-table-wrap"><table className="expense-register-table"><thead><tr><th>Date</th><th>Category</th><th>Paid to</th><th>Mode / reference</th><th>Note</th><th>Amount</th><th aria-label="Actions" /></tr></thead><tbody>{visibleExpenses.map((expense) => <tr key={expense.id}><td>{dateLabel(expense.date)}</td><td><span className="expense-category-pill">{expense.categoryName}</span></td><td><strong>{expense.paidTo || '—'}</strong></td><td><div className="expense-mode-cell"><strong>{expense.mode}</strong><small>{expense.referenceNumber || '—'}</small></div></td><td className="expense-note-cell">{expense.note || '—'}</td><td><strong className="expense-amount">{money(expense.amount)}</strong></td><td><div className="table-actions"><button className="row-action-button" type="button" onClick={() => setEditorTarget(expense)}>Edit</button><button className="row-action-button danger-text" type="button" onClick={() => setDeleteTarget(expense)}>Delete</button></div></td></tr>)}</tbody></table></div> : <div className="invoice-register-empty expense-register-empty"><span aria-hidden="true">₹</span><h2>{expenses.length ? 'No expense entries match these filters' : 'No expenses recorded yet'}</h2><p>{expenses.length ? 'Try widening the date range or resetting the category and payment-mode filters.' : 'Create expense categories such as Rent, Salary, and Electricity, then record your first operating cost.'}</p>{!expenses.length ? <div className="expense-empty-actions"><button className="outline-button compact-action" type="button" onClick={() => onNavigate('expenseCategories')}>Manage categories</button><button className="primary-action-button compact-action" type="button" onClick={() => setEditorTarget('new')}>Record first expense</button></div> : null}</div>}
            </section>
          </>
        ) : null}
      </section>

      {editorTarget ? <div className="editor-backdrop" role="presentation"><ExpenseEditor expense={editorTarget === 'new' ? null : editorTarget} categories={categories} uid={user.uid} businessId={selectedBusinessId} onClose={() => setEditorTarget(null)} onManageCategories={() => { setEditorTarget(null); onNavigate('expenseCategories') }} /></div> : null}
      {deleteTarget ? <DeleteExpenseDialog expense={deleteTarget} uid={user.uid} businessId={selectedBusinessId} onClose={() => setDeleteTarget(null)} /> : null}
    </main>
  )
}
