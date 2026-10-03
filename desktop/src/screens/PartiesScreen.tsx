import { useEffect, useMemo, useState } from 'react'
import { DesktopSidebar, type DesktopPage } from '../components/DesktopSidebar'
import { useAuth } from '../context/AuthContext'
import { useBusiness } from '../context/BusinessContext'
import { createParty, removeParty, subscribeToParties, updateParty } from '../repositories/partiesRepository'
import type { OpeningBalanceType, Party, PartyInput, PartyType } from '../types/party'

interface PartiesScreenProps {
  onNavigate: (page: DesktopPage) => void
  onOpenParty: (partyId: string) => void
}

type PartyTab = 'ALL' | 'CUSTOMERS' | 'SUPPLIERS'

interface PartyDraft {
  type: PartyType
  name: string
  phone: string
  email: string
  gstin: string
  address: string
  state: string
  stateCode: string
  city: string
  pincode: string
  openingBalance: string
  openingBalanceType: OpeningBalanceType
  creditLimit: string
  creditDays: string
  isActive: boolean
  notes: string
}

const EMPTY_PARTY: PartyDraft = {
  type: 'CUSTOMER',
  name: '',
  phone: '',
  email: '',
  gstin: '',
  address: '',
  state: '',
  stateCode: '',
  city: '',
  pincode: '',
  openingBalance: '0',
  openingBalanceType: 'RECEIVABLE',
  creditLimit: '0',
  creditDays: '0',
  isActive: true,
  notes: '',
}

function draftFromParty(party: Party): PartyDraft {
  return {
    type: party.type,
    name: party.name,
    phone: party.phone,
    email: party.email,
    gstin: party.gstin,
    address: party.address,
    state: party.state,
    stateCode: party.stateCode ?? '',
    city: party.city,
    pincode: party.pincode,
    openingBalance: String(party.openingBalance),
    openingBalanceType: party.openingBalanceType,
    creditLimit: String(party.creditLimit),
    creditDays: String(party.creditDays),
    isActive: party.isActive,
    notes: party.notes,
  }
}

function nonNegativeNumber(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function nonNegativeInteger(value: string): number | null {
  const parsed = nonNegativeNumber(value)
  return parsed !== null && Number.isInteger(parsed) ? parsed : null
}

function partyError(error: unknown): string {
  return error instanceof Error ? error.message : 'The party could not be saved.'
}

function money(value: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value)
}

function partyTypeLabel(type: PartyType): string {
  return type === 'BOTH' ? 'Customer & supplier' : type.charAt(0) + type.slice(1).toLowerCase()
}

function PartyEditor({
  party,
  parties,
  uid,
  businessId,
  onClose,
}: {
  party: Party | null
  parties: Party[]
  uid: string
  businessId: string
  onClose: () => void
}) {
  const [draft, setDraft] = useState<PartyDraft>(() => (party ? draftFromParty(party) : EMPTY_PARTY))
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDraft(party ? draftFromParty(party) : EMPTY_PARTY)
    setError(null)
  }, [party])

  const updateDraft = <K extends keyof PartyDraft>(field: K, value: PartyDraft[K]) => {
    setError(null)
    setDraft((current) => ({ ...current, [field]: value }))
  }

  const save = async () => {
    const openingBalance = nonNegativeNumber(draft.openingBalance)
    const creditLimit = nonNegativeNumber(draft.creditLimit)
    const creditDays = nonNegativeInteger(draft.creditDays)

    if (!draft.name.trim()) {
      setError('Party name is required.')
      return
    }
    if (openingBalance === null || creditLimit === null || creditDays === null) {
      setError('Enter valid non-negative values for opening balance, credit limit, and credit days.')
      return
    }
    if (draft.stateCode && !/^\d{2}$/.test(draft.stateCode)) {
      setError('GST state code must be a two-digit code, such as 08 for Rajasthan.')
      return
    }

    const duplicate = parties.some(
      (item) => item.id !== party?.id && item.name.localeCompare(draft.name.trim(), undefined, { sensitivity: 'accent' }) === 0,
    )
    if (duplicate) {
      setError('A party with this name already exists for this showroom.')
      return
    }

    const input: PartyInput = {
      type: draft.type,
      name: draft.name,
      phone: draft.phone,
      email: draft.email,
      gstin: draft.gstin,
      address: draft.address,
      state: draft.state,
      stateCode: draft.stateCode,
      city: draft.city,
      pincode: draft.pincode,
      openingBalance,
      openingBalanceType: draft.openingBalanceType,
      creditLimit,
      creditDays,
      isActive: draft.isActive,
      notes: draft.notes,
    }

    setIsSaving(true)
    setError(null)
    try {
      if (party) await updateParty(uid, businessId, party.id, input)
      else await createParty(uid, businessId, input)
      onClose()
    } catch (saveError) {
      setError(partyError(saveError))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section className="party-editor-panel" aria-labelledby="party-editor-title">
      <div className="editor-panel-heading">
        <div>
          <p className="panel-kicker">PARTY MASTER</p>
          <h2 id="party-editor-title">{party ? `Edit ${party.name}` : 'Add party'}</h2>
        </div>
        <button className="icon-close-button" type="button" onClick={onClose} aria-label="Close party form">×</button>
      </div>

      <section className="product-form-section party-first-section">
        <div className="product-section-heading">
          <span>01</span>
          <div><h3>Party type &amp; contact</h3><p>Classify the relationship before recording transactions.</p></div>
        </div>
        <div className="party-type-selector" role="radiogroup" aria-label="Party type">
          {(['CUSTOMER', 'SUPPLIER', 'BOTH'] as PartyType[]).map((type) => (
            <button
              className={draft.type === type ? 'selected' : ''}
              type="button"
              role="radio"
              aria-checked={draft.type === type}
              key={type}
              onClick={() => updateDraft('type', type)}
            >
              {type === 'BOTH' ? 'Both' : type.charAt(0) + type.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
        <div className="form-grid two-columns">
          <label className="form-field form-field-wide">
            <span>Name <b>*</b></span>
            <input autoFocus value={draft.name} maxLength={150} placeholder="e.g. Sharma Sanitary Store" onChange={(event) => updateDraft('name', event.target.value)} />
          </label>
          <label className="form-field"><span>Phone</span><input value={draft.phone} maxLength={25} inputMode="tel" placeholder="Mobile number" onChange={(event) => updateDraft('phone', event.target.value)} /></label>
          <label className="form-field"><span>Email</span><input value={draft.email} maxLength={150} inputMode="email" placeholder="name@example.com" onChange={(event) => updateDraft('email', event.target.value)} /></label>
          <label className="form-field form-field-wide"><span>GSTIN</span><input value={draft.gstin} maxLength={30} placeholder="Optional GSTIN" onChange={(event) => updateDraft('gstin', event.target.value.toUpperCase())} /></label>
        </div>
      </section>

      <section className="product-form-section">
        <div className="product-section-heading">
          <span>02</span>
          <div><h3>Address</h3><p>Useful for delivery documents and GST reporting.</p></div>
        </div>
        <div className="form-grid two-columns">
          <label className="form-field form-field-wide"><span>Address</span><textarea value={draft.address} maxLength={500} placeholder="Street, area, landmark" onChange={(event) => updateDraft('address', event.target.value)} /></label>
          <label className="form-field"><span>State</span><input value={draft.state} maxLength={100} placeholder="e.g. Rajasthan" onChange={(event) => updateDraft('state', event.target.value)} /></label>
          <label className="form-field"><span>GST state code</span><input value={draft.stateCode} maxLength={2} inputMode="numeric" placeholder="e.g. 08" onChange={(event) => updateDraft('stateCode', event.target.value.replace(/[^0-9]/g, ''))} /><small className="field-helper">Used to choose CGST/SGST or IGST on sales invoices.</small></label>
          <label className="form-field"><span>City</span><input value={draft.city} maxLength={100} placeholder="e.g. Jaipur" onChange={(event) => updateDraft('city', event.target.value)} /></label>
          <label className="form-field"><span>Pincode</span><input value={draft.pincode} maxLength={12} inputMode="numeric" placeholder="e.g. 302001" onChange={(event) => updateDraft('pincode', event.target.value)} /></label>
        </div>
      </section>

      <section className="product-form-section">
        <div className="product-section-heading">
          <span>03</span>
          <div><h3>Opening &amp; credit</h3><p>These values establish the party ledger starting point.</p></div>
        </div>
        <div className="form-grid four-columns">
          <label className="form-field"><span>Opening balance</span><input value={draft.openingBalance} type="number" min="0" step="0.01" inputMode="decimal" onChange={(event) => updateDraft('openingBalance', event.target.value)} /></label>
          <label className="form-field"><span>Opening type</span><select value={draft.openingBalanceType} onChange={(event) => updateDraft('openingBalanceType', event.target.value as OpeningBalanceType)}><option value="RECEIVABLE">Receivable</option><option value="PAYABLE">Payable</option></select></label>
          <label className="form-field"><span>Credit limit</span><input value={draft.creditLimit} type="number" min="0" step="0.01" inputMode="decimal" onChange={(event) => updateDraft('creditLimit', event.target.value)} /></label>
          <label className="form-field"><span>Credit days</span><input value={draft.creditDays} type="number" min="0" step="1" inputMode="numeric" onChange={(event) => updateDraft('creditDays', event.target.value)} /></label>
        </div>
      </section>

      <section className="product-form-section">
        <div className="product-section-heading">
          <span>04</span>
          <div><h3>Status &amp; notes</h3><p>Inactive parties remain in historical records.</p></div>
        </div>
        <label className="checkbox-field">
          <input checked={draft.isActive} type="checkbox" onChange={(event) => updateDraft('isActive', event.target.checked)} />
          <span><strong>Active party</strong><small>Inactive parties should not be used for new sales or purchases.</small></span>
        </label>
        <label className="form-field"><span>Notes</span><textarea value={draft.notes} maxLength={1000} placeholder="Optional internal notes" onChange={(event) => updateDraft('notes', event.target.value)} /></label>
      </section>

      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="editor-actions product-editor-actions">
        <button className="outline-button" type="button" onClick={onClose}>Cancel</button>
        <button className="primary-action-button" type="button" onClick={() => void save()} disabled={isSaving}>{isSaving ? 'Saving…' : party ? 'Save party' : 'Add party'}</button>
      </div>
    </section>
  )
}

function DeletePartyDialog({ party, uid, businessId, onClose }: { party: Party; uid: string; businessId: string; onClose: () => void }) {
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const remove = async () => {
    setIsDeleting(true)
    setError(null)
    try {
      await removeParty(uid, businessId, party.id)
      onClose()
    } catch (deleteError) {
      setError(partyError(deleteError))
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-party-title">
        <div className="dialog-icon danger" aria-hidden="true">!</div>
        <h2 id="delete-party-title">Delete {party.name}?</h2>
        <p>This removes the party master record. Existing invoices and payment history are retained for audit purposes.</p>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="dialog-actions">
          <button className="outline-button" type="button" onClick={onClose} disabled={isDeleting}>Cancel</button>
          <button className="danger-action-button" type="button" onClick={() => void remove()} disabled={isDeleting}>{isDeleting ? 'Deleting…' : 'Delete party'}</button>
        </div>
      </section>
    </div>
  )
}

export function PartiesScreen({ onNavigate, onOpenParty }: PartiesScreenProps) {
  const { user, signOut } = useAuth()
  const { selectedBusiness, selectedBusinessId, clearBusinessSelection } = useBusiness()
  const [parties, setParties] = useState<Party[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [tab, setTab] = useState<PartyTab>('ALL')
  const [search, setSearch] = useState('')
  const [editorTarget, setEditorTarget] = useState<Party | 'new' | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Party | null>(null)

  useEffect(() => {
    if (!user || !selectedBusinessId) return
    setIsLoading(true)
    setLoadError(null)
    return subscribeToParties(
      user.uid,
      selectedBusinessId,
      (nextParties) => {
        setParties(nextParties)
        setIsLoading(false)
      },
      (error) => {
        setLoadError(error.message || 'Parties could not be loaded.')
        setIsLoading(false)
      },
    )
  }, [selectedBusinessId, user?.uid])

  const filteredParties = useMemo(() => {
    const term = search.trim().toLocaleLowerCase()
    return parties.filter((party) => {
      if (tab === 'CUSTOMERS' && !['CUSTOMER', 'BOTH'].includes(party.type)) return false
      if (tab === 'SUPPLIERS' && !['SUPPLIER', 'BOTH'].includes(party.type)) return false
      if (term && ![party.name, party.phone, party.email, party.gstin, party.city].join(' ').toLocaleLowerCase().includes(term)) return false
      return true
    })
  }, [parties, search, tab])

  if (!user || !selectedBusiness || !selectedBusinessId) return null

  return (
    <main className="desktop-layout">
      <DesktopSidebar activePage="parties" onNavigate={onNavigate} />
      <section className="dashboard-content management-content parties-content">
        <header className="dashboard-header">
          <div>
            <p className="breadcrumb">SHOWROOM / PARTY MASTER</p>
            <h1>Customers &amp; suppliers</h1>
            <p>{selectedBusiness.name} · Credit terms, contact information, and party ledger access.</p>
          </div>
          <div className="header-actions">
            <button className="outline-button" type="button" onClick={clearBusinessSelection}>Switch business</button>
            <button className="user-button" type="button" onClick={() => void signOut()} title="Sign out">{(user.displayName ?? user.email ?? 'U').slice(0, 1).toUpperCase()}</button>
          </div>
        </header>

        <section className="management-toolbar party-toolbar">
          <div>
            <span className="status-chip"><span className="live-dot" /> Live party master</span>
            <h2>{filteredParties.length} of {parties.length} parties</h2>
            <p>Open a party to view its calculated receivable or payable position.</p>
          </div>
          <button className="primary-action-button" type="button" onClick={() => setEditorTarget('new')}>＋ Add party</button>
        </section>

        <section className="party-list-controls" aria-label="Party filters">
          <div className="party-tabs" role="tablist" aria-label="Party type">
            {([
              ['ALL', 'All'],
              ['CUSTOMERS', 'Customers'],
              ['SUPPLIERS', 'Suppliers'],
            ] as Array<[PartyTab, string]>).map(([key, label]) => (
              <button className={tab === key ? 'active' : ''} type="button" role="tab" aria-selected={tab === key} key={key} onClick={() => setTab(key)}>{label}</button>
            ))}
          </div>
          <label className="product-search-field party-search-field"><span aria-hidden="true">⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, phone, city, GSTIN…" /></label>
        </section>

        {loadError ? <div className="settings-error" role="alert">{loadError}</div> : null}
        {isLoading ? <div className="settings-loading">Loading parties…</div> : null}
        {!isLoading && !loadError ? (
          parties.length ? (
            filteredParties.length ? (
              <div className="data-table-wrap party-table-wrap">
                <table className="data-table party-table">
                  <thead><tr><th>Party</th><th>Type</th><th>Contact</th><th>Opening balance</th><th>Credit</th><th>Status</th><th aria-label="Actions" /></tr></thead>
                  <tbody>
                    {filteredParties.map((party) => (
                      <tr key={party.id}>
                        <td><button className="party-name-button" type="button" onClick={() => onOpenParty(party.id)}><strong>{party.name}</strong><small>{party.city || party.state || party.gstin || 'View ledger'}</small></button></td>
                        <td><span className={`party-type-badge ${party.type.toLowerCase()}`}>{partyTypeLabel(party.type)}</span></td>
                        <td className="description-cell">{party.phone || party.email || '—'}</td>
                        <td><div className="party-opening-cell"><strong>{money(party.openingBalance)}</strong><small>{party.openingBalanceType.toLowerCase()}</small></div></td>
                        <td><div className="party-opening-cell"><strong>{money(party.creditLimit)}</strong><small>{party.creditDays} days</small></div></td>
                        <td>{party.isActive ? <span className="setting-flag is-enabled">Active</span> : <span className="inactive-badge">Inactive</span>}</td>
                        <td className="row-actions"><button className="row-action-button" type="button" onClick={() => onOpenParty(party.id)}>View</button><button className="row-action-button" type="button" onClick={() => setEditorTarget(party)}>Edit</button><button className="row-action-button danger-text" type="button" onClick={() => setDeleteTarget(party)}>Delete</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <section className="empty-master-state filter-empty-state"><div className="empty-icon" aria-hidden="true">⌕</div><h2>No matching parties</h2><p>Try another tab or search term.</p><button className="outline-button" type="button" onClick={() => { setSearch(''); setTab('ALL') }}>Clear filters</button></section>
            )
          ) : (
            <section className="empty-master-state"><div className="empty-icon" aria-hidden="true">◎</div><h2>No parties yet</h2><p>Add your first customer, supplier, or a party that is both.</p><button className="primary-action-button" type="button" onClick={() => setEditorTarget('new')}>Add first party</button></section>
          )
        ) : null}
      </section>

      {editorTarget ? <div className="editor-backdrop" role="presentation"><PartyEditor party={editorTarget === 'new' ? null : editorTarget} parties={parties} uid={user.uid} businessId={selectedBusinessId} onClose={() => setEditorTarget(null)} /></div> : null}
      {deleteTarget ? <DeletePartyDialog party={deleteTarget} uid={user.uid} businessId={selectedBusinessId} onClose={() => setDeleteTarget(null)} /> : null}
    </main>
  )
}
