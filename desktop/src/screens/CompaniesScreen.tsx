import { useEffect, useState } from 'react'
import { DesktopSidebar, type DesktopPage } from '../components/DesktopSidebar'
import { useAuth } from '../context/AuthContext'
import { useBusiness } from '../context/BusinessContext'
import { createCompany, removeCompany, subscribeToCompanies, updateCompany } from '../repositories/companiesRepository'
import type { Company, CompanyInput } from '../types/company'

interface CompaniesScreenProps {
  onNavigate: (page: DesktopPage) => void
}

const EMPTY_COMPANY: CompanyInput = { name: '', description: '', isDefault: false }

function companyError(error: unknown): string {
  return error instanceof Error ? error.message : 'The company could not be saved.'
}

function CompanyEditor({
  company,
  companies,
  uid,
  businessId,
  onClose,
}: {
  company: Company | null
  companies: Company[]
  uid: string
  businessId: string
  onClose: () => void
}) {
  const [draft, setDraft] = useState<CompanyInput>(() =>
    company ? { name: company.name, description: company.description, isDefault: company.isDefault } : EMPTY_COMPANY,
  )
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDraft(company ? { name: company.name, description: company.description, isDefault: company.isDefault } : EMPTY_COMPANY)
    setError(null)
  }, [company])

  const save = async () => {
    const name = draft.name.trim()
    if (!name) {
      setError('Company name is required.')
      return
    }

    const duplicate = companies.some(
      (item) => item.id !== company?.id && item.name.localeCompare(name, undefined, { sensitivity: 'accent' }) === 0,
    )
    if (duplicate) {
      setError('A company with this name already exists for this showroom.')
      return
    }

    setIsSaving(true)
    setError(null)
    try {
      const input = { ...draft, name }
      if (company) await updateCompany(uid, businessId, company.id, input)
      else await createCompany(uid, businessId, input)
      onClose()
    } catch (saveError) {
      setError(companyError(saveError))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section className="editor-panel" aria-labelledby="company-editor-title">
      <div className="editor-panel-heading">
        <div>
          <p className="panel-kicker">COMPANY / BRAND</p>
          <h2 id="company-editor-title">{company ? `Edit ${company.name}` : 'Add company'}</h2>
        </div>
        <button className="icon-close-button" type="button" onClick={onClose} aria-label="Close company form">×</button>
      </div>

      <label className="form-field">
        <span>Name <b>*</b></span>
        <input
          autoFocus
          value={draft.name}
          maxLength={100}
          placeholder="e.g. Hindware"
          onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
        />
      </label>
      <label className="form-field">
        <span>Description</span>
        <textarea
          value={draft.description}
          maxLength={500}
          placeholder="Optional brand notes"
          onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
        />
      </label>
      <label className="checkbox-field">
        <input
          checked={draft.isDefault}
          type="checkbox"
          onChange={(event) => setDraft((current) => ({ ...current, isDefault: event.target.checked }))}
        />
        <span>
          <strong>Default company</strong>
          <small>Use this as the preferred brand in future product workflows.</small>
        </span>
      </label>

      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="editor-actions">
        <button className="outline-button" type="button" onClick={onClose}>Cancel</button>
        <button className="primary-action-button" type="button" onClick={() => void save()} disabled={isSaving}>
          {isSaving ? 'Saving…' : company ? 'Save changes' : 'Add company'}
        </button>
      </div>
    </section>
  )
}

function DeleteCompanyDialog({
  company,
  uid,
  businessId,
  onClose,
}: {
  company: Company
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
      await removeCompany(uid, businessId, company.id)
      onClose()
    } catch (deleteError) {
      setError(companyError(deleteError))
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-company-title">
        <div className="dialog-icon danger" aria-hidden="true">!</div>
        <h2 id="delete-company-title">Delete {company.name}?</h2>
        <p>This removes the company/brand record from this showroom. Existing products are not changed.</p>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="dialog-actions">
          <button className="outline-button" type="button" onClick={onClose} disabled={isDeleting}>Cancel</button>
          <button className="danger-action-button" type="button" onClick={() => void remove()} disabled={isDeleting}>
            {isDeleting ? 'Deleting…' : 'Delete company'}
          </button>
        </div>
      </section>
    </div>
  )
}

export function CompaniesScreen({ onNavigate }: CompaniesScreenProps) {
  const { user, signOut } = useAuth()
  const { selectedBusiness, selectedBusinessId, clearBusinessSelection } = useBusiness()
  const [companies, setCompanies] = useState<Company[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editorTarget, setEditorTarget] = useState<Company | 'new' | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Company | null>(null)

  useEffect(() => {
    if (!user || !selectedBusinessId) return

    setIsLoading(true)
    setLoadError(null)
    return subscribeToCompanies(
      user.uid,
      selectedBusinessId,
      (nextCompanies) => {
        setCompanies(nextCompanies)
        setIsLoading(false)
      },
      (error) => {
        setLoadError(error.message || 'Companies could not be loaded.')
        setIsLoading(false)
      },
    )
  }, [selectedBusinessId, user?.uid])

  if (!user || !selectedBusiness || !selectedBusinessId) return null

  return (
    <main className="desktop-layout">
      <DesktopSidebar activePage="companies" onNavigate={onNavigate} />
      <section className="dashboard-content management-content">
        <header className="dashboard-header">
          <div>
            <p className="breadcrumb">SHOWROOM / MASTER DATA</p>
            <h1>Companies &amp; brands</h1>
            <p>{selectedBusiness.name} · Manage brands such as Hindware, Jaquar, and Cera.</p>
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
            <span className="status-chip"><span className="live-dot" /> Live Firestore list</span>
            <h2>{companies.length} {companies.length === 1 ? 'company' : 'companies'}</h2>
            <p>Changes made here appear in real time for other signed-in clients.</p>
          </div>
          <button className="primary-action-button" type="button" onClick={() => setEditorTarget('new')}>＋ Add company</button>
        </section>

        {loadError ? <div className="settings-error" role="alert">{loadError}</div> : null}
        {isLoading ? <div className="settings-loading">Loading companies…</div> : null}
        {!isLoading && !loadError ? (
          companies.length ? (
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Company / brand</th>
                    <th>Description</th>
                    <th>Default</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {companies.map((company) => (
                    <tr key={company.id}>
                      <td><strong>{company.name}</strong></td>
                      <td className="description-cell">{company.description || '—'}</td>
                      <td>{company.isDefault ? <span className="setting-flag is-enabled">Default</span> : <span className="muted-value">—</span>}</td>
                      <td className="row-actions">
                        <button className="row-action-button" type="button" onClick={() => setEditorTarget(company)}>Edit</button>
                        <button className="row-action-button danger-text" type="button" onClick={() => setDeleteTarget(company)}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <section className="empty-master-state">
              <div className="empty-icon" aria-hidden="true">◈</div>
              <h2>No companies yet</h2>
              <p>Add the brands you sell to keep your product master organised.</p>
              <button className="primary-action-button" type="button" onClick={() => setEditorTarget('new')}>Add first company</button>
            </section>
          )
        ) : null}
      </section>

      {editorTarget ? (
        <div className="editor-backdrop" role="presentation">
          <CompanyEditor
            company={editorTarget === 'new' ? null : editorTarget}
            companies={companies}
            uid={user.uid}
            businessId={selectedBusinessId}
            onClose={() => setEditorTarget(null)}
          />
        </div>
      ) : null}
      {deleteTarget ? (
        <DeleteCompanyDialog
          company={deleteTarget}
          uid={user.uid}
          businessId={selectedBusinessId}
          onClose={() => setDeleteTarget(null)}
        />
      ) : null}
    </main>
  )
}
