import { useEffect, useMemo, useState } from 'react'
import { BrandMark } from '../components/BrandMark'
import { useAuth } from '../context/AuthContext'
import { useBusiness } from '../context/BusinessContext'
import {
  DOCUMENT_TYPE_LABELS,
  formatDocumentNumber,
  getFinancialYear,
  saveDocumentSetting,
  type DocumentSetting,
} from '../lib/documentNumbering'
import { subscribeToDocumentSettings } from '../repositories/documentSettingsRepository'

interface DocumentSettingsScreenProps {
  onBack: () => void
}

interface SettingDraft {
  prefix: string
  nextNumber: string
  digits: string
}

function toDraft(setting: DocumentSetting): SettingDraft {
  return {
    prefix: setting.prefix,
    nextNumber: String(setting.nextNumber),
    digits: String(setting.digits),
  }
}

function positiveInteger(value: string): number | null {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : null
}

function displayError(error: unknown): string {
  return error instanceof Error ? error.message : 'The document setting could not be saved.'
}

function SettingCard({ setting, uid, businessId }: { setting: DocumentSetting; uid: string; businessId: string }) {
  const [draft, setDraft] = useState<SettingDraft>(() => toDraft(setting))
  const [baselineNextNumber, setBaselineNextNumber] = useState(setting.nextNumber)
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDraft(toDraft(setting))
    setBaselineNextNumber(setting.nextNumber)
  }, [setting.digits, setting.nextNumber, setting.prefix])

  const parsedNextNumber = positiveInteger(draft.nextNumber)
  const parsedDigits = positiveInteger(draft.digits)
  const preview = useMemo(() => {
    if (!parsedNextNumber || !parsedDigits || !draft.prefix.trim()) return 'Enter valid values to preview the number'
    try {
      return formatDocumentNumber(
        { prefix: draft.prefix, includeFy: setting.includeFy, digits: parsedDigits },
        parsedNextNumber,
      )
    } catch {
      return 'Enter valid values to preview the number'
    }
  }, [draft.prefix, parsedDigits, parsedNextNumber, setting.includeFy])

  const updateDraft = (field: keyof SettingDraft, value: string) => {
    setMessage(null)
    setError(null)
    setDraft((current) => ({ ...current, [field]: value }))
  }

  const save = async () => {
    const nextNumber = positiveInteger(draft.nextNumber)
    const digits = positiveInteger(draft.digits)
    if (!nextNumber || !digits || !draft.prefix.trim()) {
      setError('Enter a prefix, a positive next number, and a positive digit length before saving.')
      return
    }

    setIsSaving(true)
    setError(null)
    setMessage(null)
    try {
      const saved = await saveDocumentSetting(uid, businessId, setting.docType, {
        prefix: draft.prefix,
        nextNumber,
        originalNextNumber: baselineNextNumber,
        digits,
      })
      setDraft(toDraft(saved))
      setBaselineNextNumber(saved.nextNumber)
      setMessage('Saved. New documents will use this sequence.')
    } catch (saveError) {
      setError(displayError(saveError))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <article className="numbering-card">
      <div className="numbering-card-heading">
        <div>
          <p className="numbering-code">{setting.docType.replace('_', ' ')}</p>
          <h2>{DOCUMENT_TYPE_LABELS[setting.docType]}</h2>
        </div>
        <div className="numbering-flags">
          <span className="setting-flag">FY {setting.includeFy ? 'included' : 'off'}</span>
          <span className={`setting-flag ${setting.enabled ? 'is-enabled' : 'is-disabled'}`}>
            {setting.enabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>
      </div>

      <div className="numbering-fields">
        <label className="setting-field">
          <span>Prefix</span>
          <input
            value={draft.prefix}
            maxLength={24}
            onChange={(event) => updateDraft('prefix', event.target.value)}
            placeholder="e.g. INV"
            aria-label={`${DOCUMENT_TYPE_LABELS[setting.docType]} prefix`}
          />
        </label>
        <label className="setting-field">
          <span>Next number</span>
          <input
            value={draft.nextNumber}
            type="number"
            min="1"
            step="1"
            inputMode="numeric"
            onChange={(event) => updateDraft('nextNumber', event.target.value)}
            aria-label={`${DOCUMENT_TYPE_LABELS[setting.docType]} next number`}
          />
        </label>
        <label className="setting-field">
          <span>Digits</span>
          <input
            value={draft.digits}
            type="number"
            min="1"
            max="12"
            step="1"
            inputMode="numeric"
            onChange={(event) => updateDraft('digits', event.target.value)}
            aria-label={`${DOCUMENT_TYPE_LABELS[setting.docType]} digits`}
          />
        </label>
      </div>

      <div className="numbering-card-footer">
        <div className="number-preview">
          <span>{setting.includeFy ? `Next document preview · FY ${getFinancialYear()}` : 'Next document preview'}</span>
          <code>{preview}</code>
        </div>
        <button className="save-setting-button" type="button" onClick={() => void save()} disabled={isSaving}>
          {isSaving ? 'Saving…' : 'Save settings'}
        </button>
      </div>

      {message ? <p className="setting-message success" role="status">{message}</p> : null}
      {error ? <p className="setting-message error" role="alert">{error}</p> : null}
    </article>
  )
}

export function DocumentSettingsScreen({ onBack }: DocumentSettingsScreenProps) {
  const { user, signOut } = useAuth()
  const { selectedBusiness, selectedBusinessId, clearBusinessSelection } = useBusiness()
  const [settings, setSettings] = useState<DocumentSetting[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!user || !selectedBusinessId) return

    setIsLoading(true)
    setError(null)
    const unsubscribe = subscribeToDocumentSettings(
      user.uid,
      selectedBusinessId,
      (nextSettings) => {
        setSettings(nextSettings)
        setIsLoading(false)
      },
      (listenerError) => {
        setError(listenerError.message || 'Document settings could not be loaded.')
        setIsLoading(false)
      },
    )

    return unsubscribe
  }, [selectedBusinessId, user?.uid])

  if (!user || !selectedBusiness || !selectedBusinessId) return null

  return (
    <main className="desktop-layout">
      <aside className="sidebar">
        <BrandMark />
        <nav aria-label="Desktop navigation">
          <button className="nav-item" type="button" onClick={onBack}><span>▦</span> Overview</button>
          <button className="nav-item" type="button" disabled><span>↗</span> Sales</button>
          <button className="nav-item" type="button" disabled><span>□</span> Inventory</button>
          <button className="nav-item" type="button" disabled><span>◎</span> Parties</button>
          <button className="nav-item" type="button" disabled><span>▤</span> Reports</button>
          <button className="nav-item active" type="button"><span>⚙</span> Settings</button>
        </nav>
        <div className="sidebar-foot">
          <span className="live-dot" /> Settings sync live with Firestore
        </div>
      </aside>

      <section className="dashboard-content settings-content">
        <header className="dashboard-header">
          <div>
            <p className="breadcrumb">SHOWROOM / SETTINGS</p>
            <h1>Document numbering</h1>
            <p>{selectedBusiness.name} · Configure the next number before creating a document.</p>
          </div>
          <div className="header-actions">
            <button className="outline-button" type="button" onClick={clearBusinessSelection}>Switch business</button>
            <button className="user-button" type="button" onClick={() => void signOut()} title="Sign out">
              {(user.displayName ?? user.email ?? 'U').slice(0, 1).toUpperCase()}
            </button>
          </div>
        </header>

        <section className="settings-intro">
          <div className="settings-intro-icon" aria-hidden="true">#</div>
          <div>
            <h2>Shared, atomic sequences</h2>
            <p>
              The mobile and desktop apps reserve numbers through the same Firestore transaction. “Next number” is the next unused serial and can only be moved forward here, protecting already issued documents from duplicate numbers.
            </p>
          </div>
        </section>

        {isLoading ? <div className="settings-loading">Loading document settings…</div> : null}
        {error ? <div className="settings-error" role="alert">{error}</div> : null}
        {!isLoading && !error ? <section className="numbering-list">{settings.map((setting) => (
          <SettingCard key={setting.docType} setting={setting} uid={user.uid} businessId={selectedBusinessId} />
        ))}</section> : null}
      </section>
    </main>
  )
}
