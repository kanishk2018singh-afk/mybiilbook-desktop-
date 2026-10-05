import { useEffect, useState } from 'react'
import { DesktopSidebar, type DesktopPage } from '../components/DesktopSidebar'
import { useAuth } from '../context/AuthContext'
import { useBusiness } from '../context/BusinessContext'
import {
  createExpenseCategory,
  expenseCategoryHasExpenses,
  removeExpenseCategory,
  subscribeToExpenseCategories,
  updateExpenseCategory,
} from '../repositories/expenseCategoriesRepository'
import type { ExpenseCategory, ExpenseCategoryInput } from '../types/expense'

interface ExpenseCategoriesScreenProps {
  onNavigate: (page: DesktopPage) => void
}

const EMPTY_CATEGORY: ExpenseCategoryInput = { name: '', description: '', isActive: true }

function categoryError(error: unknown): string {
  return error instanceof Error ? error.message : 'The expense category could not be saved.'
}

function ExpenseCategoryEditor({
  category,
  categories,
  uid,
  businessId,
  onClose,
}: {
  category: ExpenseCategory | null
  categories: ExpenseCategory[]
  uid: string
  businessId: string
  onClose: () => void
}) {
  const [draft, setDraft] = useState<ExpenseCategoryInput>(() => category
    ? { name: category.name, description: category.description, isActive: category.isActive }
    : EMPTY_CATEGORY)
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    setDraft(category
      ? { name: category.name, description: category.description, isActive: category.isActive }
      : EMPTY_CATEGORY)
    setError(null)
  }, [category])

  const save = async () => {
    const name = draft.name.trim()
    if (!name) {
      setError('Expense category name is required.')
      return
    }
    const hasDuplicate = categories.some((item) => (
      item.id !== category?.id
      && item.name.localeCompare(name, undefined, { sensitivity: 'accent' }) === 0
    ))
    if (hasDuplicate) {
      setError('An expense category with this name already exists.')
      return
    }

    setIsSaving(true)
    setError(null)
    try {
      const input = { ...draft, name }
      if (category) await updateExpenseCategory(uid, businessId, category.id, input)
      else await createExpenseCategory(uid, businessId, input)
      onClose()
    } catch (saveError) {
      setError(categoryError(saveError))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section className="editor-panel" role="dialog" aria-modal="true" aria-labelledby="expense-category-editor-title">
      <div className="editor-panel-heading">
        <div><p className="panel-kicker">EXPENSE MASTER</p><h2 id="expense-category-editor-title">{category ? `Edit ${category.name}` : 'Add expense category'}</h2></div>
        <button className="icon-close-button" type="button" onClick={onClose} aria-label="Close expense category form">×</button>
      </div>
      <label className="form-field">
        <span>Category name <b>*</b></span>
        <input autoFocus value={draft.name} maxLength={100} placeholder="e.g. Rent, Salary, Electricity" onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
      </label>
      <label className="form-field">
        <span>Description</span>
        <textarea value={draft.description} maxLength={500} placeholder="Optional internal description" onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} />
      </label>
      <label className="checkbox-field">
        <input type="checkbox" checked={draft.isActive} onChange={(event) => setDraft((current) => ({ ...current, isActive: event.target.checked }))} />
        <span><strong>Active category</strong><small>Inactive categories remain available in historical reports but cannot be selected for new expenses.</small></span>
      </label>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="editor-actions">
        <button className="outline-button" type="button" onClick={onClose} disabled={isSaving}>Cancel</button>
        <button className="primary-action-button" type="button" onClick={() => void save()} disabled={isSaving}>{isSaving ? 'Saving…' : category ? 'Save category' : 'Add category'}</button>
      </div>
    </section>
  )
}

function DeleteExpenseCategoryDialog({
  category,
  uid,
  businessId,
  onClose,
  onBlocked,
}: {
  category: ExpenseCategory
  uid: string
  businessId: string
  onClose: () => void
  onBlocked: (message: string) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const remove = async () => {
    setIsDeleting(true)
    setError(null)
    try {
      if (await expenseCategoryHasExpenses(uid, businessId, category.id)) {
        onClose()
        onBlocked(`Cannot delete “${category.name}” because one or more expense entries use it. Keep it for report history or edit those expenses first.`)
        return
      }
      await removeExpenseCategory(uid, businessId, category.id)
      onClose()
    } catch (deleteError) {
      setError(categoryError(deleteError))
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-expense-category-title">
        <div className="dialog-icon danger" aria-hidden="true">!</div>
        <h2 id="delete-expense-category-title">Delete {category.name}?</h2>
        <p>This is only allowed when no expense entry uses this category, preserving category-wise report history.</p>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="dialog-actions">
          <button className="outline-button" type="button" onClick={onClose} disabled={isDeleting}>Cancel</button>
          <button className="danger-action-button" type="button" onClick={() => void remove()} disabled={isDeleting}>{isDeleting ? 'Checking…' : 'Delete category'}</button>
        </div>
      </section>
    </div>
  )
}

export function ExpenseCategoriesScreen({ onNavigate }: ExpenseCategoriesScreenProps) {
  const { user, signOut } = useAuth()
  const { selectedBusiness, selectedBusinessId, clearBusinessSelection } = useBusiness()
  const [categories, setCategories] = useState<ExpenseCategory[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editorTarget, setEditorTarget] = useState<ExpenseCategory | 'new' | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ExpenseCategory | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [checkingId, setCheckingId] = useState<string | null>(null)

  useEffect(() => {
    if (!user || !selectedBusinessId) return
    setIsLoading(true)
    setLoadError(null)
    return subscribeToExpenseCategories(
      user.uid,
      selectedBusinessId,
      (nextCategories) => {
        setCategories(nextCategories)
        setIsLoading(false)
      },
      (error) => {
        setLoadError(error.message || 'Expense categories could not be loaded.')
        setIsLoading(false)
      },
    )
  }, [selectedBusinessId, user?.uid])

  const requestDelete = async (category: ExpenseCategory) => {
    if (!user || !selectedBusinessId) return
    setCheckingId(category.id)
    setWarning(null)
    try {
      if (await expenseCategoryHasExpenses(user.uid, selectedBusinessId, category.id)) {
        setWarning(`Cannot delete “${category.name}” because one or more expense entries use it. Keep it for report history or edit those expenses first.`)
      } else {
        setDeleteTarget(category)
      }
    } catch (error) {
      setWarning(categoryError(error))
    } finally {
      setCheckingId(null)
    }
  }

  if (!user || !selectedBusiness || !selectedBusinessId) return null

  return (
    <main className="desktop-layout">
      <DesktopSidebar activePage="expenses" onNavigate={onNavigate} />
      <section className="dashboard-content expense-categories-content">
        <header className="dashboard-header">
          <div>
            <button className="back-link-button" type="button" onClick={() => onNavigate('expenses')}>← Expenses</button>
            <p className="breadcrumb">SHOWROOM / EXPENSES / MASTER</p>
            <h1>Expense categories</h1>
            <p>{selectedBusiness.name} · Create the heads used by your expense register and category analysis.</p>
          </div>
          <div className="header-actions">
            <button className="primary-action-button" type="button" onClick={() => setEditorTarget('new')}>＋ Add category</button>
            <button className="outline-button" type="button" onClick={clearBusinessSelection}>Switch business</button>
            <button className="user-button" type="button" onClick={() => void signOut()} title="Sign out">{(user.displayName ?? user.email ?? 'U').slice(0, 1).toUpperCase()}</button>
          </div>
        </header>

        <section className="expense-category-intro">
          <div><span className="status-chip"><span className="live-dot" /> Live Firestore master</span><h2>Organise outgoing costs</h2><p>Create categories such as Rent, Salary, Electricity, Internet, Transport, Repairs, and Office supplies. Category names are snapshotted on each expense for durable reports.</p></div>
          <button className="outline-button compact-action" type="button" onClick={() => onNavigate('expenses')}>Open expense register</button>
        </section>

        {warning ? <div className="category-warning" role="alert"><strong>Category cannot be deleted.</strong><span>{warning}</span><button type="button" onClick={() => setWarning(null)} aria-label="Dismiss warning">×</button></div> : null}
        {loadError ? <div className="settings-error" role="alert">{loadError}</div> : null}
        {isLoading ? <div className="settings-loading">Loading expense categories…</div> : null}
        {!isLoading && !loadError ? (
          categories.length ? (
            <section className="expense-category-table-card">
              <div className="expense-category-table-heading"><strong>{categories.length} {categories.length === 1 ? 'category' : 'categories'}</strong><span>Disable a category to hide it from new expense entry while preserving its history.</span></div>
              <div className="management-table-wrap">
                <table className="management-table expense-category-table">
                  <thead><tr><th>Category</th><th>Description</th><th>Status</th><th aria-label="Actions" /></tr></thead>
                  <tbody>{categories.map((category) => (
                    <tr key={category.id}>
                      <td><strong>{category.name}</strong></td>
                      <td>{category.description || '—'}</td>
                      <td><span className={`expense-category-status ${category.isActive ? 'active' : 'inactive'}`}>{category.isActive ? 'Active' : 'Inactive'}</span></td>
                      <td><div className="table-actions"><button className="row-action-button" type="button" onClick={() => setEditorTarget(category)}>Edit</button><button className="row-action-button danger-text" type="button" onClick={() => void requestDelete(category)} disabled={checkingId === category.id}>{checkingId === category.id ? 'Checking…' : 'Delete'}</button></div></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </section>
          ) : (
            <section className="empty-master-state"><span className="empty-icon">▤</span><h2>Set up your expense heads</h2><p>Start with common categories like Rent, Salary, and Electricity, then record each outgoing expense against the right head.</p><button className="primary-action-button" type="button" onClick={() => setEditorTarget('new')}>Add first category</button></section>
          )
        ) : null}
      </section>

      {editorTarget ? <div className="editor-backdrop" role="presentation"><ExpenseCategoryEditor category={editorTarget === 'new' ? null : editorTarget} categories={categories} uid={user.uid} businessId={selectedBusinessId} onClose={() => setEditorTarget(null)} /></div> : null}
      {deleteTarget ? <DeleteExpenseCategoryDialog category={deleteTarget} uid={user.uid} businessId={selectedBusinessId} onClose={() => setDeleteTarget(null)} onBlocked={setWarning} /> : null}
    </main>
  )
}
