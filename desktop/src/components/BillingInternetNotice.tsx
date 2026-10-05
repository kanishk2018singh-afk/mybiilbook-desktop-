import { BILLING_CONNECTION_MESSAGE, useSyncStatus } from '../context/SyncStatusContext'

/**
 * Keeps the transaction-safety decision next to every stock-affecting action,
 * rather than leaving a disabled button without a reason.
 */
export function BillingInternetNotice() {
  const { connectionState, isOnline } = useSyncStatus()

  if (isOnline) return null

  return (
    <section className="billing-connection-notice" role="alert">
      <span aria-hidden="true">⌁</span>
      <div>
        <strong>{BILLING_CONNECTION_MESSAGE}</strong>
        <p>{connectionState === 'checking'
          ? 'Checking Firestore for fresh inventory data. Finalized billing stays paused until that check completes.'
          : 'Other non-stock updates can remain on this device and show as Pending Sync, but finalized invoices, returns, cancellations, opening stock, and adjustments are not queued offline.'}</p>
      </div>
    </section>
  )
}
