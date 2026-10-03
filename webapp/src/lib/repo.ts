import { db, DEFAULT_TERMS, getBusiness, getDocSetting, setSetting } from './db'
import { computeTotals } from './calc'
import { daysBetween, financialYear, round2, todayISO, uid } from './format'
import type {
  AgingBucket,
  DocSetting,
  DocType,
  Expense,
  Invoice,
  Item,
  LineItem,
  Party,
  PartyPayment,
  PaymentDirection,
  PaymentEntry,
  PaymentMode,
} from './types'
import { docMeta } from './types'

// ---------------- Numbering ----------------

export const formatDocNumber = (s: DocSetting, date: string, n: number): string => {
  const serial = String(n).padStart(Math.max(1, s.digits), '0')
  return s.includeFy ? `${s.prefix}/${financialYear(date)}/${serial}` : `${s.prefix}/${serial}`
}

/** Preview of the next number (does not consume it) */
export async function peekNumber(docType: DocType, date: string): Promise<string> {
  const s = await getDocSetting(docType)
  return formatDocNumber(s, date, s.nextNumber)
}

async function allocateNumber(docType: DocType, date: string): Promise<string> {
  const s = await db.docSettings.get(docType)
  const setting: DocSetting = s ?? (await getDocSetting(docType))
  const number = formatDocNumber(setting, date, setting.nextNumber)
  await db.docSettings.put({ ...setting, nextNumber: setting.nextNumber + 1 })
  return number
}

// ---------------- Items ----------------

export const listItems = () => db.items.orderBy('name').toArray()

export async function upsertItem(item: Item): Promise<number> {
  const rec = { ...item, updatedAt: Date.now() }
  if (rec.id) {
    await db.items.put(rec)
    return rec.id
  }
  const { id: _drop, ...rest } = rec
  void _drop
  return db.items.add(rest as Item)
}

export async function deleteItem(id: number): Promise<void> {
  await db.items.delete(id)
}

export async function adjustStock(itemId: number, delta: number): Promise<void> {
  await db.transaction('rw', db.items, async () => {
    const item = await db.items.get(itemId)
    if (!item?.id) return
    await db.items.update(item.id, {
      stockQty: Math.max(0, (item.stockQty || 0) + delta),
      updatedAt: Date.now(),
    })
  })
}

export async function findItemByCode(code: string): Promise<Item | undefined> {
  const c = code.trim().toLowerCase()
  if (!c) return undefined
  const items = await db.items.toArray()
  return items.find(
    (i) => i.code.toLowerCase() === c || (i.barcode ?? '').toLowerCase() === c,
  )
}

// ---------------- Parties ----------------

export const listParties = () => db.parties.orderBy('name').toArray()

export async function upsertParty(p: Party): Promise<number> {
  if (p.id) {
    await db.parties.put(p)
    return p.id
  }
  const { id: _drop, ...rest } = p
  void _drop
  return db.parties.add(rest as Party)
}

export async function deleteParty(id: number): Promise<void> {
  await db.parties.delete(id)
}

/** All invoices (final) of a party + outstanding balance */
export async function partyInvoices(partyId: number): Promise<Invoice[]> {
  const list = await db.invoices.where('partyId').equals(partyId).toArray()
  return list.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
}

export async function balanceOf(
  partyId: number,
  shopState = '08',
): Promise<number> {
  const [party, invoices, payments] = await Promise.all([
    db.parties.get(partyId),
    db.invoices.where('partyId').equals(partyId).toArray(),
    db.payments.where('partyId').equals(partyId).toArray(),
  ])
  let bal = party?.openingBalance ?? 0
  for (const inv of invoices) {
    if (inv.status !== 'FINAL') continue
    const meta = docMeta(inv.docType)
    const net = computeTotals(inv, shopState).grandTotal - computeTotals(inv, shopState).paid
    if (meta.isSale) bal += net
    else if (meta.negative) bal -= net
    else if (meta.isPurchase) bal -= net
  }
  for (const p of payments) bal += p.direction === 'OUT' ? p.amount : -p.amount
  return round2(bal)
}

export async function allBalances(shopState = '08'): Promise<Map<number, number>> {
  const [parties, invoices, payments] = await Promise.all([
    db.parties.toArray(),
    db.invoices.toArray(),
    db.payments.toArray(),
  ])
  const map = new Map<number, number>()
  parties.forEach((p) => p.id && map.set(p.id, p.openingBalance || 0))
  invoices.forEach((inv) => {
    if (inv.status !== 'FINAL' || !inv.partyId || !map.has(inv.partyId)) return
    const meta = docMeta(inv.docType)
    const t = computeTotals(inv, shopState)
    const net = t.grandTotal - t.paid
    if (meta.isSale) map.set(inv.partyId, round2((map.get(inv.partyId) ?? 0) + net))
    else if (meta.negative) map.set(inv.partyId, round2((map.get(inv.partyId) ?? 0) - net))
    else if (meta.isPurchase) map.set(inv.partyId, round2((map.get(inv.partyId) ?? 0) - net))
  })
  payments.forEach((p) => {
    if (!p.partyId || !map.has(p.partyId)) return
    const delta = p.direction === 'OUT' ? p.amount : -p.amount
    map.set(p.partyId, round2((map.get(p.partyId) ?? 0) + delta))
  })
  return map
}

// ---------------- Invoices ----------------

async function applyStockEffect(inv: Invoice, direction: 1 | -1): Promise<void> {
  const meta = docMeta(inv.docType)
  if (!meta.stockOut && !meta.stockIn) return
  const sign = (meta.stockOut ? -1 : 1) * direction
  for (const line of inv.items) {
    if (!line.itemId) continue
    const item = await db.items.get(line.itemId)
    if (!item?.id) continue
    await db.items.update(item.id, {
      stockQty: Math.max(0, (item.stockQty || 0) + sign * line.qty),
      updatedAt: Date.now(),
    })
  }
}

export async function saveInvoice(inv: Invoice, shopState = '08'): Promise<number> {
  void shopState
  return db.transaction('rw', db.invoices, db.docSettings, db.items, async () => {
    const now = Date.now()
    let id = inv.id
    const existing = id ? await db.invoices.get(id) : undefined
    if (existing) await applyStockEffect(existing, -1)

    const number = inv.number?.trim() ? inv.number.trim() : await allocateNumber(inv.docType, inv.date)
    const rec: Invoice = {
      ...inv,
      number,
      status: inv.status ?? 'FINAL',
      createdAt: existing?.createdAt ?? inv.createdAt ?? now,
      updatedAt: now,
    }
    if (existing?.id) {
      await db.invoices.put({ ...rec, id: existing.id })
      id = existing.id
    } else {
      const { id: _drop, ...rest } = rec
      void _drop
      id = await db.invoices.add(rest as Invoice)
    }

    const saved = await db.invoices.get(id)
    if (saved) await applyStockEffect(saved, 1)

    // link converted document
    if (inv.fromId) {
      await db.invoices.update(inv.fromId, { convertedToId: id, updatedAt: now })
    }
    return id
  })
}

export async function deleteInvoice(id: number): Promise<void> {
  await db.transaction('rw', db.invoices, db.items, async () => {
    const inv = await db.invoices.get(id)
    if (inv) await applyStockEffect(inv, -1)
    await db.invoices.delete(id)
  })
}

export async function cancelInvoice(id: number): Promise<void> {
  await db.transaction('rw', db.invoices, db.items, async () => {
    const inv = await db.invoices.get(id)
    if (!inv?.id) return
    if (inv.status === 'FINAL') await applyStockEffect(inv, -1)
    await db.invoices.update(id, { status: 'CANCELLED', updatedAt: Date.now() })
  })
}

export async function restoreInvoice(id: number): Promise<void> {
  await db.transaction('rw', db.invoices, db.items, async () => {
    const inv = await db.invoices.get(id)
    if (!inv?.id) return
    if (inv.status !== 'FINAL') await applyStockEffect(inv, 1)
    await db.invoices.update(id, { status: 'FINAL', updatedAt: Date.now() })
  })
}

export async function recordPayment(
  invoiceId: number,
  payment: Omit<PaymentEntry, 'id'>,
): Promise<void> {
  const inv = await db.invoices.get(invoiceId)
  if (!inv) return
  const entry: PaymentEntry = { ...payment, id: uid() }
  await db.invoices.update(invoiceId, {
    payments: [...(inv.payments ?? []), entry],
    updatedAt: Date.now(),
  })
}

export async function removePayment(invoiceId: number, paymentId: string): Promise<void> {
  const inv = await db.invoices.get(invoiceId)
  if (!inv) return
  await db.invoices.update(invoiceId, {
    payments: (inv.payments ?? []).filter((p) => p.id !== paymentId),
    updatedAt: Date.now(),
  })
}

export const listInvoices = (): Promise<Invoice[]> =>
  db.invoices.orderBy('createdAt').reverse().toArray()

export const invoicesBetween = (from: string, to: string): Promise<Invoice[]> =>
  db.invoices
    .where('date')
    .between(from, to, true, true)
    .toArray()
    .then((list) => list.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt))

/** Build a fresh draft invoice (also used for "convert to" and "duplicate") */
export async function newInvoice(docType: DocType, date = todayISO()): Promise<Invoice> {
  const setting = await getDocSetting(docType)
  return {
    docType,
    number: '',
    date,
    partyName: '',
    placeOfSupply: '',
    items: [],
    billDiscountType: 'PERCENT',
    billDiscountValue: 0,
    extraCharges: [],
    roundOffEnabled: true,
    notes: '',
    status: 'FINAL',
    payments: [],
    terms: setting.terms || DEFAULT_TERMS,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

export async function duplicateInvoice(inv: Invoice, date = todayISO()): Promise<Invoice> {
  const draft = await newInvoice(inv.docType, date)
  return {
    ...draft,
    partyId: inv.partyId,
    partyName: inv.partyName,
    partyPhone: inv.partyPhone,
    partyGstin: inv.partyGstin,
    partyAddress: inv.partyAddress,
    placeOfSupply: inv.placeOfSupply,
    items: inv.items.map((l) => ({ ...l, id: uid() })),
    billDiscountType: inv.billDiscountType,
    billDiscountValue: inv.billDiscountValue,
    extraCharges: inv.extraCharges.map((c) => ({ ...c })),
    roundOffEnabled: inv.roundOffEnabled,
    notes: inv.notes,
    terms: inv.terms,
  }
}

export async function convertInvoice(inv: Invoice, to: DocType): Promise<Invoice> {
  const draft = await newInvoice(to)
  return {
    ...draft,
    fromId: inv.id,
    partyId: inv.partyId,
    partyName: inv.partyName,
    partyPhone: inv.partyPhone,
    partyGstin: inv.partyGstin,
    partyAddress: inv.partyAddress,
    placeOfSupply: inv.placeOfSupply || '',
    items: inv.items.map((l: LineItem) => ({ ...l, id: uid() })),
    billDiscountType: inv.billDiscountType,
    billDiscountValue: inv.billDiscountValue,
    extraCharges: inv.extraCharges.map((c) => ({ ...c })),
    roundOffEnabled: inv.roundOffEnabled,
    notes: inv.notes,
    terms: inv.terms,
  }
}

// ---------------- Payments (khata: in / out) ----------------

export const listPayments = (): Promise<PartyPayment[]> =>
  db.payments.orderBy('date').reverse().toArray()

export async function addPayment(p: Omit<PartyPayment, 'id'>): Promise<number> {
  const { id: _drop, ...rest } = p as PartyPayment
  void _drop
  return db.payments.add(rest as PartyPayment)
}

export const deletePayment = (id: number): Promise<void> => db.payments.delete(id)

export interface PaymentRow {
  key: string
  date: string
  direction: PaymentDirection
  partyName: string
  amount: number
  mode: PaymentMode
  note?: string
  source: 'BILL' | 'PARTY'
  invoiceId?: number
  invoiceNumber?: string
  docType?: DocType
  entryId?: string
}

/** Everything that moved money: bill-wise payments + standalone khata payments */
export async function paymentRegister(from: string, to: string): Promise<PaymentRow[]> {
  const [invoices, payments] = await Promise.all([
    db.invoices.where('date').between(from, to, true, true).toArray(),
    db.payments.where('date').between(from, to, true, true).toArray(),
  ])
  const rows: PaymentRow[] = []
  invoices.forEach((inv) => {
    const meta = docMeta(inv.docType)
    const direction: PaymentDirection = meta.isPurchase || meta.negative ? 'OUT' : 'IN'
    ;(inv.payments ?? []).forEach((p) => {
      rows.push({
        key: `bill-${inv.id}-${p.id}`,
        date: p.date || inv.date,
        direction,
        partyName: inv.partyName || 'Cash Sale',
        amount: p.amount,
        mode: p.mode,
        note: p.note,
        source: 'BILL',
        invoiceId: inv.id,
        invoiceNumber: inv.number,
        docType: inv.docType,
        entryId: p.id,
      })
    })
  })
  payments.forEach((p) => {
    rows.push({
      key: `party-${p.id}`,
      date: p.date,
      direction: p.direction,
      partyName: p.partyName || '—',
      amount: p.amount,
      mode: p.mode,
      note: p.note,
      source: 'PARTY',
      invoiceId: p.id,
      entryId: String(p.id),
      docType: undefined,
    })
  })
  return rows.sort((a, b) => b.date.localeCompare(a.date))
}

// ---------------- Expenses ----------------

export const listExpenses = (): Promise<Expense[]> => db.expenses.orderBy('date').reverse().toArray()

export async function upsertExpense(e: Expense): Promise<number> {
  if (e.id) {
    await db.expenses.put(e)
    return e.id
  }
  const { id: _drop, ...rest } = e
  void _drop
  return db.expenses.add(rest as Expense)
}

export const deleteExpense = (id: number): Promise<void> => db.expenses.delete(id)

export const expensesBetween = (from: string, to: string): Promise<Expense[]> =>
  db.expenses.where('date').between(from, to, true, true).toArray()

// ---------------- Party-wise aging (receivable / payable) ----------------

export interface AgingReport {
  receivables: AgingBucket[]
  payables: AgingBucket[]
  totalReceivable: number
  totalPayable: number
  overdueReceivable: number
  overduePayable: number
}

export async function agingReport(shopState = '08', today = todayISO()): Promise<AgingReport> {
  const [invoices, parties, payments] = await Promise.all([
    db.invoices.toArray(),
    db.parties.toArray(),
    db.payments.toArray(),
  ])
  const partyMap = new Map(parties.map((p) => [p.id!, p]))
  const recv = new Map<string, AgingBucket>()
  const pay = new Map<string, AgingBucket>()

  const blank = (name: string, phone?: string): AgingBucket => ({
    partyName: name,
    phone,
    d0_30: 0,
    d31_60: 0,
    d61_90: 0,
    d90plus: 0,
    total: 0,
    oldestDays: 0,
  })

  for (const inv of invoices) {
    if (inv.status !== 'FINAL') continue
    const meta = docMeta(inv.docType)
    if (!meta.isSale && !meta.isPurchase) continue
    const t = computeTotals(inv, shopState)
    const due = t.due
    if (due <= 0.5 && !meta.isSale) continue
    if (inv.docType === 'CREDIT_NOTE') continue
    const amount = Math.max(0, round2(due))
    if (amount <= 0) continue
    const name = inv.partyName || 'Cash Sale'
    const target = meta.isPurchase ? pay : recv
    const key = inv.partyId ? String(inv.partyId) : `name:${name}`
    const row = target.get(key) ?? blank(name, partyMap.get(inv.partyId ?? -1)?.phone)
    const age = Math.max(0, daysBetween(inv.date, today))
    if (age <= 30) row.d0_30 = round2(row.d0_30 + amount)
    else if (age <= 60) row.d31_60 = round2(row.d31_60 + amount)
    else if (age <= 90) row.d61_90 = round2(row.d61_90 + amount)
    else row.d90plus = round2(row.d90plus + amount)
    row.total = round2(row.total + amount)
    row.oldestDays = Math.max(row.oldestDays, age)
    row.partyId = inv.partyId
    target.set(key, row)
  }

  // on-account (standalone) payments kam karein — sabse purane bill se pehle
  const reduceBuckets = (row: AgingBucket, amount: number) => {
    let left = amount
    const order: (keyof AgingBucket)[] = ['d90plus', 'd61_90', 'd31_60', 'd0_30']
    for (const key of order) {
      if (left <= 0) break
      const val = row[key] as number
      const take = Math.min(val, left)
      ;(row[key] as number) = round2(val - take)
      left = round2(left - take)
    }
    row.total = round2(row.d0_30 + row.d31_60 + row.d61_90 + row.d90plus)
  }

  const partyKey = (p: { partyId?: number; partyName: string }) =>
    p.partyId ? String(p.partyId) : `name:${p.partyName}`
  const paidIn = new Map<string, number>()
  const paidOut = new Map<string, number>()
  payments.forEach((p) => {
    const key = partyKey({ partyId: p.partyId, partyName: p.partyName })
    if (p.direction === 'IN') paidIn.set(key, round2((paidIn.get(key) ?? 0) + p.amount))
    else paidOut.set(key, round2((paidOut.get(key) ?? 0) + p.amount))
  })
  recv.forEach((row, key) => {
    const credit = round2((paidIn.get(key) ?? 0) - (paidOut.get(key) ?? 0))
    if (credit > 0) reduceBuckets(row, credit)
  })
  pay.forEach((row, key) => {
    const paid = round2((paidOut.get(key) ?? 0) - (paidIn.get(key) ?? 0))
    if (paid > 0) reduceBuckets(row, paid)
  })

  const receivables = [...recv.values()]
    .filter((r) => r.total > 0.5)
    .sort((a, b) => b.total - a.total)
  const payables = [...pay.values()]
    .filter((r) => r.total > 0.5)
    .sort((a, b) => b.total - a.total)
  const sum = (rows: AgingBucket[]) => round2(rows.reduce((s, r) => s + r.total, 0))
  return {
    receivables,
    payables,
    totalReceivable: sum(receivables),
    totalPayable: sum(payables),
    overdueReceivable: round2(receivables.reduce((s, r) => s + r.d31_60 + r.d61_90 + r.d90plus, 0)),
    overduePayable: round2(payables.reduce((s, r) => s + r.d31_60 + r.d61_90 + r.d90plus, 0)),
  }
}

/** Purchase bill ke rate se item ka purchase price update karein */
export async function applyPurchaseRates(inv: Invoice): Promise<number> {
  let updated = 0
  for (const line of inv.items) {
    if (!line.itemId) continue
    const item = await db.items.get(line.itemId)
    if (!item?.id) continue
    const newCost = round2(line.rate * (1 - (line.discountPercent || 0) / 100))
    if (newCost > 0 && Math.abs((item.purchasePrice || 0) - newCost) > 0.01) {
      await db.items.update(item.id, { purchasePrice: newCost, updatedAt: Date.now() })
      updated++
    }
  }
  return updated
}

// ---------------- Backup ----------------

export async function exportBackup(): Promise<string> {
  const [business, items, parties, invoices, docSettings, appSettings, payments, expenses] = await Promise.all([
    db.business.toArray(),
    db.items.toArray(),
    db.parties.toArray(),
    db.invoices.toArray(),
    db.docSettings.toArray(),
    db.appSettings.toArray(),
    db.payments.toArray(),
    db.expenses.toArray(),
  ])
  return JSON.stringify(
    {
      app: 'showroom-manager',
      version: 2,
      exportedAt: new Date().toISOString(),
      business,
      items,
      parties,
      invoices,
      docSettings,
      appSettings,
      payments,
      expenses,
    },
    null,
    2,
  )
}

export async function importBackup(json: string, mode: 'replace' | 'merge' = 'merge'): Promise<void> {
  const data = JSON.parse(json)
  if (Array.isArray(data.business) && data.business.length) {
    if (mode === 'replace') await db.business.clear()
    const existing = await db.business.count()
    if (existing === 0) await db.business.bulkAdd(data.business)
  }
  await db.transaction(
    'rw',
    db.items,
    db.parties,
    db.invoices,
    db.docSettings,
    db.appSettings,
    async () => {
      if (mode === 'replace') {
        await Promise.all([
          db.items.clear(),
          db.parties.clear(),
          db.invoices.clear(),
          db.docSettings.clear(),
          db.appSettings.clear(),
          db.payments.clear(),
          db.expenses.clear(),
        ])
      }
      for (const table of ['items', 'parties', 'invoices', 'docSettings', 'appSettings'] as const) {
        const rows = data[table]
        if (!Array.isArray(rows)) continue
        for (const row of rows) {
          if (table === 'items') await db.items.put(row)
          else if (table === 'parties') await db.parties.put(row)
          else if (table === 'invoices') await db.invoices.put(row)
          else if (table === 'docSettings') await db.docSettings.put(row)
          else await db.appSettings.put(row)
        }
      }
    },
  )
  if (Array.isArray(data.payments)) for (const row of data.payments) await db.payments.put(row)
  if (Array.isArray(data.expenses)) for (const row of data.expenses) await db.expenses.put(row)
}

export async function wipeAllData(): Promise<void> {
  await Promise.all([
    db.items.clear(),
    db.parties.clear(),
    db.invoices.clear(),
    db.docSettings.clear(),
    db.appSettings.clear(),
    db.payments.clear(),
    db.expenses.clear(),
    db.business.clear(),
  ])
  await setSetting('onboarded', 'no')
}

export { getBusiness }
