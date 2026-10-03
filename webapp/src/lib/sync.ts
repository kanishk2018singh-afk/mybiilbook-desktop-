/**
 * Cloud sync — company ka pura data cloud par (Firestore) aur wapas.
 *
 * Design:
 * - Snapshot = wahi JSON jo "Backup" file banata hai (business, items, parties,
 *   invoices, docSettings, appSettings, payments, expenses).
 * - Merge: har row ka "natural key" (item code, bill number, party naam…) dekha
 *   jata hai — dono taraf same row ho to naya wala jeetta hai; naya row ho to
 *   jud jata hai. Id clash ho to naya id milta hai aur references (partyId,
 *   itemId) apne aap theek kar diye jate hain.
 * - Har company ka data alag document me jata hai: showroomUsers/{uid}/companies/{companyId}
 */

import type { Table } from 'dexie'
import type { ShowroomDB } from './db'
import { db, dbFor } from './db'
import { listCompanies, activeCompanyId, DEFAULT_COMPANY, createCompany, renameCompany, type Company } from './company'
import {
  type RemoteCompany,
  freshToken,
  getSession,
  isCloudConfigured,
  remoteGetCompanies,
  remoteGetCompany,
  remoteSetCompanies,
  remoteSetCompany,
} from './cloud'
import { store } from './store'

export interface MergeStats {
  added: number
  updated: number
  skipped: number
}

export interface SyncResult {
  companies: number
  added: number
  updated: number
  skipped: number
  pulled: boolean
  at: number
}

type Row = Record<string, unknown>

const lastSyncKey = (companyId: string) => `showroom_last_sync_${companyId}`

export function lastSyncAt(companyId = activeCompanyId()): number {
  return Number(store.get('local', lastSyncKey(companyId)) ?? 0)
}

const stamp = (row: Row): number => Number(row.updatedAt ?? row.createdAt ?? 0)
const lower = (v: unknown): string => String(v ?? '').trim().toLowerCase()

/** Row ki pehchaan — dono devices par ek hi row ka same key banta hai */
export function naturalKey(table: string, row: Row): string {
  switch (table) {
    case 'items':
      return `i:${lower(row.code) || lower(row.name)}`
    case 'parties':
      return `p:${lower(row.name)}|${lower(row.phone)}`
    case 'invoices':
      return `v:${lower(row.docType)}|${lower(row.number)}`
    case 'payments':
      return `y:${lower(row.date)}|${lower(row.direction)}|${Number(row.amount ?? 0)}|${lower(row.partyName)}`
    case 'expenses':
      return `e:${lower(row.date)}|${lower(row.category)}|${Number(row.amount ?? 0)}|${lower(row.paidTo)}`
    case 'docSettings':
      return `d:${lower(row.docType)}`
    case 'appSettings':
      return `s:${lower(row.key)}`
    case 'business':
      return 'b:business'
    default:
      return `x:${JSON.stringify(row).slice(0, 40)}`
  }
}

const TABLE_ORDER = [
  'business',
  'docSettings',
  'appSettings',
  'parties',
  'items',
  'invoices',
  'payments',
  'expenses',
] as const

export type SyncTableName = (typeof TABLE_ORDER)[number]

const tableOf = (dbx: ShowroomDB, name: SyncTableName): Table<Row, number | string> =>
  (dbx as unknown as Record<string, Table<Row, number | string>>)[name]

/** Snapshot banao (Backup file wala hi format) */
export async function buildSnapshot(dbx: ShowroomDB = db): Promise<string> {
  const out: Record<string, unknown> = {
    app: 'showroom-manager',
    version: 2,
    exportedAt: new Date().toISOString(),
  }
  for (const name of TABLE_ORDER) out[name] = await tableOf(dbx, name).toArray()
  return JSON.stringify(out)
}

/**
 * Remote snapshot ko local database me merge karo.
 * remaps: agar id clash ki wajah se naya id diya gaya, to usko yaad rakhte hain
 * taaki invoices/payments ke references theek ho jayein.
 */
export async function mergeSnapshot(dbx: ShowroomDB, remoteJson: string): Promise<MergeStats> {
  const stats: MergeStats = { added: 0, updated: 0, skipped: 0 }
  const data = JSON.parse(remoteJson) as Record<string, unknown>

  const partyRemap = new Map<number, number>()
  const itemRemap = new Map<number, number>()

  for (const name of TABLE_ORDER) {
    const remoteRows = data[name]
    if (!Array.isArray(remoteRows) || remoteRows.length === 0) continue
    const table = tableOf(dbx, name)
    const localRows = (await table.toArray()) as Row[]
    const byKey = new Map<string, Row>()
    const byId = new Map<number, Row>()
    for (const r of localRows) {
      byKey.set(naturalKey(name, r), r)
      const id = Number(r.id)
      if (Number.isFinite(id)) byId.set(id, r)
    }

    for (const raw of remoteRows as Row[]) {
      const row: Row = { ...raw }
      // reference remap (pehle merge hui tables se)
      if (name === 'invoices' || name === 'payments') {
        const pid = Number(row.partyId)
        if (Number.isFinite(pid) && partyRemap.has(pid)) row.partyId = partyRemap.get(pid)
        if (name === 'invoices') {
          const from = Number(row.fromId)
          if (Number.isFinite(from) && partyRemap.has(from)) row.fromId = partyRemap.get(from)
          const items = Array.isArray(row.items) ? (row.items as Row[]) : []
          for (const li of items) {
            const iid = Number(li.itemId)
            if (Number.isFinite(iid) && itemRemap.has(iid)) li.itemId = itemRemap.get(iid)
          }
        }
      }

      const key = naturalKey(name, row)
      const existing = byKey.get(key)
      if (existing) {
        if (stamp(row) > stamp(existing)) {
          await table.put({ ...row, id: existing.id })
          stats.updated++
        } else {
          stats.skipped++
        }
        continue
      }

      const rid = Number(row.id)
      const idTaken = Number.isFinite(rid) && byId.has(rid)
      if (idTaken) {
        // id clash — naya id lo aur reference note karo
        const { id: _drop, ...rest } = row
        const newId = (await table.add(rest as Row)) as number
        if (name === 'parties') partyRemap.set(rid, Number(newId))
        if (name === 'items') itemRemap.set(rid, Number(newId))
        stats.added++
      } else {
        await table.put(row)
        if (name === 'parties' && Number.isFinite(rid)) partyRemap.set(rid, rid)
        if (name === 'items' && Number.isFinite(rid)) itemRemap.set(rid, rid)
        stats.added++
      }
    }
  }
  return stats
}

/** Company registry (kaun-kaun si companies hain) ka merge */
async function syncRegistry(uid: string): Promise<number> {
  const local = listCompanies()
  const remote = (await remoteGetCompanies(uid)) ?? []
  let changed = false

  for (const rc of remote) {
    const mine = local.find((c) => c.id === rc.id)
    if (!mine) {
      // remote company local me nahi hai -> add karo (payload baad me pull hoga)
      createCompany(rc.name)
      // createCompany naya id deta hai; usko remote id se jodne ke liye list ko theek karte hain
      const list = listCompanies()
      const created = list[list.length - 1]
      if (created) {
        const fixed: Company[] = list.map((c) => (c.id === created.id ? { ...c, id: rc.id, name: rc.name, createdAt: rc.createdAt } : c))
        store.set('local', 'showroom_companies', JSON.stringify(fixed))
        changed = true
      }
    } else if (mine.name !== rc.name && rc.createdAt > mine.createdAt) {
      renameCompany(mine.id, rc.name)
      changed = true
    }
  }

  const merged: RemoteCompany[] = listCompanies().map((c) => ({ id: c.id, name: c.name, createdAt: c.createdAt }))
  await remoteSetCompanies(uid, merged)
  return changed ? merged.length : merged.length
}

export interface SyncProgress {
  (info: { companyId: string; companyName: string; index: number; total: number }): void
}

/** Saari companies ka sync (default: sirf active company) */
export async function syncNow(
  opts: { all?: boolean; onProgress?: SyncProgress } = {},
): Promise<SyncResult> {
  if (!isCloudConfigured()) throw new Error('Cloud setup nahi hua — Settings → Cloud account me config daalein')
  const session = getSession()
  if (!session) throw new Error('Pehle login karein')
  await freshToken() // token taaza karo (expire ho raha ho to refresh)

  await syncRegistry(session.uid)

  const activeId = activeCompanyId()
  const all = listCompanies()
  const targets = opts.all ? all : all.filter((c) => c.id === activeId)

  const total: MergeStats = { added: 0, updated: 0, skipped: 0 }
  let pulled = false

  for (let i = 0; i < targets.length; i++) {
    const company = targets[i]
    opts.onProgress?.({ companyId: company.id, companyName: company.name, index: i + 1, total: targets.length })

    const dbx = dbFor(company.id)
    await dbx.open()

    const last = lastSyncAt(company.id)
    const remote = await remoteGetCompany(session.uid, company.id)

    if (remote && (remote.updatedAt > last || !last)) {
      const stats = await mergeSnapshot(dbx, remote.payload)
      total.added += stats.added
      total.updated += stats.updated
      total.skipped += stats.skipped
      pulled = pulled || stats.added + stats.updated > 0
    }

    // ab local (merged) snapshot cloud par chadhа do
    await remoteSetCompany(session.uid, company.id, await buildSnapshot(dbx))
    store.set('local', lastSyncKey(company.id), String(Date.now()))
  }

  return {
    companies: targets.length,
    added: total.added,
    updated: total.updated,
    skipped: total.skipped,
    pulled,
    at: Date.now(),
  }
}

/** Login ke turant baad: registry + saari companies ka data neeche kheencho */
export async function syncAfterLogin(): Promise<SyncResult> {
  return syncNow({ all: true })
}

/**
 * Company list cloud se le kar local me jodo — naye phone par login karte hi
 * user ki saari companies switch list me aa jati hain.
 */
export async function pullCompanyList(): Promise<{ added: number; total: number }> {
  const session = getSession()
  if (!session) throw new Error('Pehle login karein')
  const before = listCompanies().length
  await syncRegistry(session.uid)
  const after = listCompanies().length
  return { added: after - before, total: after }
}

/** Khaali (nayi) company ko cloud se bhardo — login ke baad pehli baar */
export async function hasLocalData(companyId = activeCompanyId()): Promise<boolean> {
  const dbx = dbFor(companyId)
  await dbx.open()
  const [items, invoices, parties] = await Promise.all([dbx.items.count(), dbx.invoices.count(), dbx.parties.count()])
  return items + invoices + parties > 0
}

export const DEFAULT_COMPANY_ID = DEFAULT_COMPANY.id
