import { useSyncStatus } from '../context/SyncStatusContext'

function pendingLabel(count: number): string {
  return `${count} changes pending sync`
}

/** A compact, global desktop signal for Firestore's local-write acknowledgement state. */
export function SyncStatusBanner() {
  const { connectionState, pendingChanges } = useSyncStatus()

  if (connectionState === 'idle') return null
  if (connectionState === 'online' && pendingChanges === 0) return null

  const isOffline = connectionState === 'offline'
  const isChecking = connectionState === 'checking'

  return (
    <aside
      className={`sync-status-banner ${isOffline ? 'offline' : isChecking ? 'checking' : 'pending'}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span className="sync-status-icon" aria-hidden="true">{isOffline ? '○' : isChecking ? '◌' : '↻'}</span>
      <div>
        <strong>{isOffline ? 'Offline' : isChecking ? 'Checking Firestore connection' : 'Pending Sync'}</strong>
        <span>{pendingChanges > 0 ? pendingLabel(pendingChanges) : 'Final billing and stock actions are paused until live data is confirmed.'}</span>
        {isOffline ? <small>Ordinary local changes will sync after reconnecting. Final invoices and stock changes stay online-only to prevent conflicts.</small> : null}
      </div>
    </aside>
  )
}
