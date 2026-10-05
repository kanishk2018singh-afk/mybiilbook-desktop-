import { describe, expect, it } from 'vitest'
import {
  deriveSyncConnectionState,
  pendingChangeCount,
  reconcilePendingDocumentPaths,
  type SyncScopeState,
} from './syncStatusUtils'

describe('Firestore sync-status helpers', () => {
  it('keeps a locally deleted document pending until its query metadata is acknowledged', () => {
    const awaitingDelete = reconcilePendingDocumentPaths(
      [],
      true,
      [{ path: 'users/u/businesses/b/products/p-1', hasPendingWrites: true }],
    )
    expect(awaitingDelete).toEqual(['users/u/businesses/b/products/p-1'])

    const acknowledged = reconcilePendingDocumentPaths(awaitingDelete, false, [])
    expect(acknowledged).toEqual([])
  })

  it('counts unique pending document changes across business-scoped listeners', () => {
    const scopes: Record<string, SyncScopeState> = {
      products: { fromCache: false, pendingDocumentPaths: ['products/a', 'products/b'] },
      invoices: { fromCache: false, pendingDocumentPaths: ['products/a', 'salesInvoices/i-1'] },
    }

    expect(pendingChangeCount(scopes)).toBe(3)
  })

  it('requires a server-backed Firestore snapshot before declaring billing online', () => {
    const cachedScope: Record<string, SyncScopeState> = {
      products: { fromCache: true, pendingDocumentPaths: [] },
    }

    expect(deriveSyncConnectionState(false, 1, cachedScope)).toBe('offline')
    expect(deriveSyncConnectionState(true, 2, cachedScope)).toBe('checking')
    expect(deriveSyncConnectionState(true, 1, cachedScope)).toBe('offline')
    expect(deriveSyncConnectionState(true, 1, {
      products: { fromCache: false, pendingDocumentPaths: [] },
    }, ['products'])).toBe('online')
    expect(deriveSyncConnectionState(true, 2, {
      products: { fromCache: true, pendingDocumentPaths: [] },
      companies: { fromCache: false, pendingDocumentPaths: [] },
    }, ['products'])).toBe('offline')
  })
})
