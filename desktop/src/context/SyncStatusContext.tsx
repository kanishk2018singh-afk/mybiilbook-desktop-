import { collection, onSnapshot } from 'firebase/firestore'
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { firestoreDb, isDesktopPreviewMode } from '../lib/firebase'
import { getBusinessPath, type BusinessCollectionName } from '../lib/firestorePaths'
import {
  deriveSyncConnectionState,
  pendingChangeCount,
  reconcilePendingDocumentPaths,
  type SyncConnectionState,
  type SyncScopeState,
} from '../lib/syncStatusUtils'
import { useAuth } from './AuthContext'
import { useBusiness } from './BusinessContext'

/** Exact safety guidance shown wherever a finalized billing/stock action is unavailable. */
export const BILLING_CONNECTION_MESSAGE = 'Billing requires internet connection to prevent stock conflicts. Please reconnect.'

/**
 * These are the primary business-root documents written by desktop workflows.
 * Their metadata covers every ordinary/local write while intentionally avoiding
 * the large append-only stock and invoice-payment audit collections: those
 * writes always have a corresponding monitored product, invoice, payment, or
 * return-note header mutation. This remains business-scoped and avoids an
 * unsafe collection-group query.
 */
const STOCK_FRESHNESS_SCOPE: BusinessCollectionName = 'products'

const SYNCED_BUSINESS_COLLECTIONS: readonly BusinessCollectionName[] = [
  'companies',
  'categories',
  'products',
  'parties',
  'salesInvoices',
  'purchaseInvoices',
  'payments',
  'expenseCategories',
  'expenses',
  'quotations',
  'creditNotes',
  'debitNotes',
  'documentSettings',
]

interface SyncStatusContextValue {
  /** `online` only after a selected-business listener has been confirmed by Firestore's server. */
  connectionState: SyncConnectionState
  /** Safe to use for transaction-backed billing and inventory operations. */
  isOnline: boolean
  /** Distinct root documents with local writes that have not been acknowledged yet. */
  pendingChanges: number
}

const SyncStatusContext = createContext<SyncStatusContextValue | undefined>(undefined)

function browserReportsOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine
}

function samePaths(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((path, index) => path === right[index])
}

function pendingScopePlaceholder(scope: string): string {
  return `__pending_scope__:${scope}`
}

export function SyncStatusProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const { selectedBusinessId } = useBusiness()
  const [browserOnline, setBrowserOnline] = useState(browserReportsOnline)
  const [scopeStates, setScopeStates] = useState<Record<string, SyncScopeState>>({})

  useEffect(() => {
    if (typeof window === 'undefined') return

    const handleOnline = () => {
      setBrowserOnline(true)
      // Do not trust the last server-backed metadata after a browser network
      // transition. The next metadata-enabled Firestore snapshot must confirm it.
      setScopeStates((current) => Object.fromEntries(
        Object.entries(current).map(([scope, state]) => [scope, { ...state, fromCache: true }]),
      ))
    }
    const handleOffline = () => setBrowserOnline(false)

    setBrowserOnline(browserReportsOnline())
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  useEffect(() => {
    setScopeStates({})

    // Preview Mode is deliberately local-only. It must never create monitor
    // listeners, just as the rest of the live Firebase providers do not.
    const database = firestoreDb
    if (!database || !user || !selectedBusinessId || isDesktopPreviewMode) return

    let active = true
    const updateScope = (
      scope: BusinessCollectionName,
      fromCache: boolean,
      snapshotHasPendingWrites: boolean,
      documentStates: ReadonlyArray<{ path: string; hasPendingWrites: boolean }>,
    ) => {
      if (!active) return
      setScopeStates((current) => {
        const previous = current[scope]
        const placeholder = pendingScopePlaceholder(scope)
        const reconciledPaths = reconcilePendingDocumentPaths(
          (previous?.pendingDocumentPaths ?? []).filter((path) => path !== placeholder),
          snapshotHasPendingWrites,
          documentStates,
        )
        // A locally deleted document can be absent from an initial cached query
        // result after an app restart. Query metadata still tells us a write is
        // pending, so retain one scope-level count until Firestore acknowledges it.
        const pendingDocumentPaths = snapshotHasPendingWrites && reconciledPaths.length === 0
          ? [placeholder]
          : reconciledPaths
        const nextState: SyncScopeState = { fromCache, pendingDocumentPaths }
        if (previous && previous.fromCache === nextState.fromCache && samePaths(previous.pendingDocumentPaths, nextState.pendingDocumentPaths)) {
          return current
        }
        return { ...current, [scope]: nextState }
      })
    }

    const markScopeUnavailable = (scope: BusinessCollectionName) => {
      if (!active) return
      setScopeStates((current) => {
        const previous = current[scope]
        if (previous?.fromCache) return current
        return {
          ...current,
          [scope]: {
            fromCache: true,
            // Do not erase a previously observed local write just because this
            // monitor target subsequently errors or goes unavailable.
            pendingDocumentPaths: previous?.pendingDocumentPaths ?? [],
          },
        }
      })
    }

    const unsubscribes = SYNCED_BUSINESS_COLLECTIONS.map((scope) => onSnapshot(
      collection(database, getBusinessPath(user.uid, selectedBusinessId, scope)),
      { includeMetadataChanges: true },
      (snapshot) => {
        // On the initial snapshot this includes every document as an `added`
        // change. On later metadata snapshots it only contains changed docs,
        // avoiding a full collection walk for each pending-write update.
        const documentStates = snapshot.docChanges({ includeMetadataChanges: true }).map((change) => ({
          path: change.doc.ref.path,
          hasPendingWrites: change.doc.metadata.hasPendingWrites,
        }))

        // A local delete is represented as a `removed` change above even though
        // it is absent from `snapshot.docs`, so reconciliation retains it until
        // the query metadata reports acknowledgement.
        updateScope(scope, snapshot.metadata.fromCache, snapshot.metadata.hasPendingWrites, documentStates)
      },
      () => {
        // An unavailable/denied target must never be mistaken for fresh stock.
        // Individual screen listeners continue to surface their own actionable
        // Firestore errors; this status layer simply keeps billing unavailable.
        markScopeUnavailable(scope)
      },
    ))

    return () => {
      active = false
      unsubscribes.forEach((unsubscribe) => unsubscribe())
    }
  }, [selectedBusinessId, user?.uid])

  const connectionState = useMemo<SyncConnectionState>(() => {
    if (!user || !selectedBusinessId || isDesktopPreviewMode || !firestoreDb) return 'idle'
    // Every finalized billing route validates or changes product stock. A live
    // response for an unrelated collection is not enough; the products target
    // itself must be server-backed before transaction buttons are enabled.
    return deriveSyncConnectionState(
      browserOnline,
      SYNCED_BUSINESS_COLLECTIONS.length,
      scopeStates,
      [STOCK_FRESHNESS_SCOPE],
    )
  }, [browserOnline, scopeStates, selectedBusinessId, user])
  const pendingChanges = useMemo(() => pendingChangeCount(scopeStates), [scopeStates])
  const isOnline = connectionState === 'online'

  const value = useMemo<SyncStatusContextValue>(
    () => ({ connectionState, isOnline, pendingChanges }),
    [connectionState, isOnline, pendingChanges],
  )

  return <SyncStatusContext.Provider value={value}>{children}</SyncStatusContext.Provider>
}

export function useSyncStatus(): SyncStatusContextValue {
  const context = useContext(SyncStatusContext)
  if (!context) throw new Error('useSyncStatus must be used inside SyncStatusProvider')
  return context
}
