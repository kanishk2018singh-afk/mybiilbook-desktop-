import { useEffect, useMemo, useState } from 'react'
import { DesktopSidebar, type DesktopPage } from '../components/DesktopSidebar'
import { useAuth } from '../context/AuthContext'
import { useBusiness } from '../context/BusinessContext'
import { buildCategoryTree, flattenCategoryTree, getDescendantIds } from '../lib/categoryTree'
import {
  createCategory,
  getCategoryDeleteBlocker,
  removeCategory,
  subscribeToCategories,
  updateCategory,
} from '../repositories/categoriesRepository'
import type { Category, CategoryInput, CategoryTreeNode } from '../types/category'

interface CategoriesScreenProps {
  onNavigate: (page: DesktopPage) => void
}

const EMPTY_CATEGORY: CategoryInput = { name: '', parentId: null, description: '', isActive: true }

function operationError(error: unknown): string {
  return error instanceof Error ? error.message : 'The category could not be saved.'
}

function CategoryEditor({
  category,
  categories,
  uid,
  businessId,
  onClose,
}: {
  category: Category | null
  categories: Category[]
  uid: string
  businessId: string
  onClose: () => void
}) {
  const [draft, setDraft] = useState<CategoryInput>(() =>
    category
      ? { name: category.name, parentId: category.parentId, description: category.description, isActive: category.isActive }
      : EMPTY_CATEGORY,
  )
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDraft(
      category
        ? { name: category.name, parentId: category.parentId, description: category.description, isActive: category.isActive }
        : EMPTY_CATEGORY,
    )
    setError(null)
  }, [category])

  const tree = useMemo(() => buildCategoryTree(categories), [categories])
  const invalidParentIds = useMemo(() => {
    if (!category) return new Set<string>()
    return new Set([category.id, ...getDescendantIds(categories, category.id)])
  }, [categories, category])
  const parentOptions = useMemo(
    () => flattenCategoryTree(tree).filter(({ category: item }) => !invalidParentIds.has(item.id)),
    [invalidParentIds, tree],
  )

  const save = async () => {
    const name = draft.name.trim()
    if (!name) {
      setError('Category name is required.')
      return
    }

    const duplicate = categories.some(
      (item) =>
        item.id !== category?.id &&
        item.parentId === (draft.parentId || null) &&
        item.name.localeCompare(name, undefined, { sensitivity: 'accent' }) === 0,
    )
    if (duplicate) {
      setError('A category with this name already exists under the selected parent.')
      return
    }

    setIsSaving(true)
    setError(null)
    try {
      const input = { ...draft, name }
      if (category) await updateCategory(uid, businessId, category.id, input)
      else await createCategory(uid, businessId, input)
      onClose()
    } catch (saveError) {
      setError(operationError(saveError))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section className="editor-panel" aria-labelledby="category-editor-title">
      <div className="editor-panel-heading">
        <div>
          <p className="panel-kicker">CATEGORY TREE</p>
          <h2 id="category-editor-title">{category ? `Edit ${category.name}` : 'Add category'}</h2>
        </div>
        <button className="icon-close-button" type="button" onClick={onClose} aria-label="Close category form">×</button>
      </div>

      <label className="form-field">
        <span>Name <b>*</b></span>
        <input
          autoFocus
          value={draft.name}
          maxLength={100}
          placeholder="e.g. Western WC"
          onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
        />
      </label>
      <label className="form-field">
        <span>Parent category</span>
        <select
          value={draft.parentId ?? ''}
          onChange={(event) => setDraft((current) => ({ ...current, parentId: event.target.value || null }))}
        >
          <option value="">No parent — top-level category</option>
          {parentOptions.map(({ category: option, depth }) => (
            <option value={option.id} key={option.id}>
              {'— '.repeat(depth)}{option.name}{option.isActive ? '' : ' (inactive)'}
            </option>
          ))}
        </select>
      </label>
      <label className="form-field">
        <span>Description</span>
        <textarea
          value={draft.description}
          maxLength={500}
          placeholder="Optional category notes"
          onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
        />
      </label>
      <label className="checkbox-field">
        <input
          checked={draft.isActive}
          type="checkbox"
          onChange={(event) => setDraft((current) => ({ ...current, isActive: event.target.checked }))}
        />
        <span>
          <strong>Active category</strong>
          <small>Inactive categories remain visible in the tree but should not be offered for new products.</small>
        </span>
      </label>

      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="editor-actions">
        <button className="outline-button" type="button" onClick={onClose}>Cancel</button>
        <button className="primary-action-button" type="button" onClick={() => void save()} disabled={isSaving}>
          {isSaving ? 'Saving…' : category ? 'Save changes' : 'Add category'}
        </button>
      </div>
    </section>
  )
}

function CategoryNode({
  node,
  depth,
  expandedIds,
  onToggle,
  onEdit,
  onDelete,
}: {
  node: CategoryTreeNode
  depth: number
  expandedIds: Set<string>
  onToggle: (categoryId: string) => void
  onEdit: (category: Category) => void
  onDelete: (category: Category) => void
}) {
  const hasChildren = node.children.length > 0
  const isExpanded = expandedIds.has(node.category.id)

  return (
    <li>
      <div className={`tree-row ${node.category.isActive ? '' : 'is-inactive'}`} style={{ paddingLeft: `${0.8 + depth * 1.45}rem` }}>
        {hasChildren ? (
          <button
            className="tree-toggle"
            type="button"
            onClick={() => onToggle(node.category.id)}
            aria-expanded={isExpanded}
            aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${node.category.name}`}
          >
            {isExpanded ? '⌄' : '›'}
          </button>
        ) : <span className="tree-leaf" aria-hidden="true">•</span>}
        <div className="tree-copy">
          <div>
            <strong>{node.category.name}</strong>
            {!node.category.isActive ? <span className="inactive-badge">Inactive</span> : null}
          </div>
          {node.category.description ? <small>{node.category.description}</small> : null}
        </div>
        <div className="tree-actions">
          <button className="row-action-button" type="button" onClick={() => onEdit(node.category)}>Edit</button>
          <button className="row-action-button danger-text" type="button" onClick={() => onDelete(node.category)}>Delete</button>
        </div>
      </div>
      {hasChildren && isExpanded ? (
        <ul className="category-tree-list">
          {node.children.map((child) => (
            <CategoryNode
              key={child.category.id}
              node={child}
              depth={depth + 1}
              expandedIds={expandedIds}
              onToggle={onToggle}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

function DeleteCategoryDialog({
  category,
  categories,
  uid,
  businessId,
  onClose,
  onBlocked,
}: {
  category: Category
  categories: Category[]
  uid: string
  businessId: string
  onClose: () => void
  onBlocked: (message: string) => void
}) {
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const remove = async () => {
    setIsDeleting(true)
    setError(null)
    try {
      // Re-check immediately before delete so a product added after the first warning check cannot be ignored.
      const blocker = await getCategoryDeleteBlocker(uid, businessId, category, categories)
      if (blocker) {
        onClose()
        onBlocked(blocker.message)
        return
      }
      await removeCategory(uid, businessId, category.id)
      onClose()
    } catch (deleteError) {
      setError(operationError(deleteError))
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-category-title">
        <div className="dialog-icon danger" aria-hidden="true">!</div>
        <h2 id="delete-category-title">Delete {category.name}?</h2>
        <p>This is only allowed when no products or subcategories are linked to this category.</p>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="dialog-actions">
          <button className="outline-button" type="button" onClick={onClose} disabled={isDeleting}>Cancel</button>
          <button className="danger-action-button" type="button" onClick={() => void remove()} disabled={isDeleting}>
            {isDeleting ? 'Checking…' : 'Delete category'}
          </button>
        </div>
      </section>
    </div>
  )
}

export function CategoriesScreen({ onNavigate }: CategoriesScreenProps) {
  const { user, signOut } = useAuth()
  const { selectedBusiness, selectedBusinessId, clearBusinessSelection } = useBusiness()
  const [categories, setCategories] = useState<Category[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editorTarget, setEditorTarget] = useState<Category | 'new' | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null)
  const [deleteWarning, setDeleteWarning] = useState<string | null>(null)
  const [checkingDeleteId, setCheckingDeleteId] = useState<string | null>(null)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!user || !selectedBusinessId) return

    setIsLoading(true)
    setLoadError(null)
    return subscribeToCategories(
      user.uid,
      selectedBusinessId,
      (nextCategories) => {
        setCategories(nextCategories)
        setIsLoading(false)
      },
      (error) => {
        setLoadError(error.message || 'Categories could not be loaded.')
        setIsLoading(false)
      },
    )
  }, [selectedBusinessId, user?.uid])

  const tree = useMemo(() => buildCategoryTree(categories), [categories])
  const parentIds = useMemo(() => new Set(categories.filter((category) => category.parentId).map((category) => category.parentId!)), [categories])

  useEffect(() => {
    setExpandedIds((current) => {
      if (current.size) return new Set([...current].filter((id) => parentIds.has(id)))
      return new Set(parentIds)
    })
  }, [parentIds])

  const toggleExpanded = (categoryId: string) => {
    setExpandedIds((current) => {
      const next = new Set(current)
      if (next.has(categoryId)) next.delete(categoryId)
      else next.add(categoryId)
      return next
    })
  }

  const requestDelete = async (category: Category) => {
    if (!user || !selectedBusinessId) return
    setCheckingDeleteId(category.id)
    setDeleteWarning(null)
    try {
      const blocker = await getCategoryDeleteBlocker(user.uid, selectedBusinessId, category, categories)
      if (blocker) setDeleteWarning(blocker.message)
      else setDeleteTarget(category)
    } catch (deleteError) {
      setDeleteWarning(operationError(deleteError))
    } finally {
      setCheckingDeleteId(null)
    }
  }

  if (!user || !selectedBusiness || !selectedBusinessId) return null

  return (
    <main className="desktop-layout">
      <DesktopSidebar activePage="categories" onNavigate={onNavigate} />
      <section className="dashboard-content management-content">
        <header className="dashboard-header">
          <div>
            <p className="breadcrumb">SHOWROOM / MASTER DATA</p>
            <h1>Categories</h1>
            <p>{selectedBusiness.name} · Organise your sanitary catalog with parent and subcategories.</p>
          </div>
          <div className="header-actions">
            <button className="outline-button" type="button" onClick={clearBusinessSelection}>Switch business</button>
            <button className="user-button" type="button" onClick={() => void signOut()} title="Sign out">
              {(user.displayName ?? user.email ?? 'U').slice(0, 1).toUpperCase()}
            </button>
          </div>
        </header>

        <section className="management-toolbar">
          <div>
            <span className="status-chip"><span className="live-dot" /> Live Firestore tree</span>
            <h2>{categories.length} {categories.length === 1 ? 'category' : 'categories'}</h2>
            <p>For example: Sanitary → Western WC → Wall Hung WC.</p>
          </div>
          <button className="primary-action-button" type="button" onClick={() => setEditorTarget('new')}>＋ Add category</button>
        </section>

        {deleteWarning ? (
          <div className="category-warning" role="alert">
            <strong>Category cannot be deleted.</strong>
            <span>{deleteWarning}</span>
            <button type="button" onClick={() => setDeleteWarning(null)} aria-label="Dismiss warning">×</button>
          </div>
        ) : null}
        {loadError ? <div className="settings-error" role="alert">{loadError}</div> : null}
        {isLoading ? <div className="settings-loading">Loading category tree…</div> : null}
        {!isLoading && !loadError ? (
          categories.length ? (
            <section className="category-tree-card" aria-label="Category hierarchy">
              <div className="tree-card-header">
                <span>Category hierarchy</span>
                <small>Expand or collapse a parent using the arrow.</small>
              </div>
              <ul className="category-tree-list">
                {tree.map((node) => (
                  <CategoryNode
                    key={node.category.id}
                    node={node}
                    depth={0}
                    expandedIds={expandedIds}
                    onToggle={toggleExpanded}
                    onEdit={(category) => setEditorTarget(category)}
                    onDelete={(category) => void requestDelete(category)}
                  />
                ))}
              </ul>
            </section>
          ) : (
            <section className="empty-master-state">
              <div className="empty-icon" aria-hidden="true">⌘</div>
              <h2>Build your first category tree</h2>
              <p>Start with a parent such as “Sanitary”, then add Western WC or Wall Hung WC below it.</p>
              <button className="primary-action-button" type="button" onClick={() => setEditorTarget('new')}>Add first category</button>
            </section>
          )
        ) : null}
      </section>

      {editorTarget ? (
        <div className="editor-backdrop" role="presentation">
          <CategoryEditor
            category={editorTarget === 'new' ? null : editorTarget}
            categories={categories}
            uid={user.uid}
            businessId={selectedBusinessId}
            onClose={() => setEditorTarget(null)}
          />
        </div>
      ) : null}
      {deleteTarget ? (
        <DeleteCategoryDialog
          category={deleteTarget}
          categories={categories}
          uid={user.uid}
          businessId={selectedBusinessId}
          onClose={() => setDeleteTarget(null)}
          onBlocked={setDeleteWarning}
        />
      ) : null}
      {checkingDeleteId ? <span className="sr-only">Checking whether category {checkingDeleteId} can be deleted</span> : null}
    </main>
  )
}
