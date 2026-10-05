export type SyncConnectionState = 'idle' | 'checking' | 'online' | 'offline'

export interface SyncScopeState {
  /** Firestore document paths that currently have a local mutation awaiting acknowledgement. */
  pendingDocumentPaths: readonly string[]
  /** Metadata for the newest snapshot received for this scope. */
  fromCache: boolean
}

/**
 * The local browser connection signal is immediate, while Firestore snapshot
 * metadata confirms whether this business has a live server-backed listener.
 */
export function deriveSyncConnectionState(
  browserOnline: boolean,
  expectedScopeCount: number,
  scopeStates: Readonly<Record<string, SyncScopeState>>,
  requiredFreshScopes: readonly string[] = [],
): SyncConnectionState {
  if (!browserOnline) return 'offline'

  const scopes = Object.values(scopeStates)
  const hasFreshServerData = requiredFreshScopes.length
    ? requiredFreshScopes.every((scopeName) => scopeStates[scopeName] && !scopeStates[scopeName].fromCache)
    : scopes.some((scope) => !scope.fromCache)
  if (hasFreshServerData) return 'online'

  // A complete set of cache-only/error snapshots means Firestore has not
  // confirmed a server connection. Keep billing safe rather than trusting
  // potentially stale inventory data.
  if (expectedScopeCount > 0 && scopes.length >= expectedScopeCount) return 'offline'

  return 'checking'
}

export function pendingChangeCount(scopeStates: Readonly<Record<string, SyncScopeState>>): number {
  const paths = new Set<string>()
  Object.values(scopeStates).forEach((scope) => {
    scope.pendingDocumentPaths.forEach((path) => paths.add(path))
  })
  return paths.size
}

/**
 * Returns the next tracked paths for one query snapshot. `snapshotHasPendingWrites`
 * is necessary for local deletes: deleted documents disappear from `docs`, but
 * their pending removal remains visible through the query metadata until acked.
 */
export function reconcilePendingDocumentPaths(
  previousPaths: readonly string[],
  snapshotHasPendingWrites: boolean,
  documentStates: ReadonlyArray<{ path: string; hasPendingWrites: boolean }>,
): string[] {
  const next = snapshotHasPendingWrites ? new Set(previousPaths) : new Set<string>()

  documentStates.forEach(({ path, hasPendingWrites }) => {
    if (hasPendingWrites) next.add(path)
    else next.delete(path)
  })

  return [...next].sort()
}
