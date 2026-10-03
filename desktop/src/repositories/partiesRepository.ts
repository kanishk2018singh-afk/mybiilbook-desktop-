import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type DocumentData,
  type Unsubscribe,
} from 'firebase/firestore'
import { requireFirestore } from '../lib/firebase'
import { getBusinessPath } from '../lib/firestorePaths'
import type {
  OpeningBalanceType,
  Party,
  PartyActivity,
  PartyInput,
  PartyInvoiceBalance,
  PartyPayment,
  PartyType,
  PaymentDirection,
} from '../types/party'

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function number(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** Accept ISO/string dates and Firestore Timestamp-like values from older Android documents. */
function date(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    const timestampDate = value.toDate()
    return timestampDate instanceof Date && !Number.isNaN(timestampDate.valueOf()) ? timestampDate.toISOString() : ''
  }
  return ''
}

function partyType(value: unknown): PartyType {
  const candidate = text(value).toUpperCase()
  return candidate === 'SUPPLIER' || candidate === 'BOTH' ? candidate : 'CUSTOMER'
}

function openingBalanceType(value: unknown): OpeningBalanceType {
  return text(value).toUpperCase() === 'PAYABLE' ? 'PAYABLE' : 'RECEIVABLE'
}

function paymentDirection(value: unknown): PaymentDirection {
  const direction = text(value).toUpperCase()
  if (['OUT', 'PAID', 'PAYMENT_OUT', 'SUPPLIER_PAYMENT'].includes(direction)) return 'OUT'
  return 'IN'
}

function toParty(id: string, data: DocumentData): Party {
  return {
    id,
    type: partyType(data.type),
    name: text(data.name) || 'Unnamed party',
    phone: text(data.phone),
    email: text(data.email),
    gstin: text(data.gstin),
    address: text(data.address),
    state: text(data.state),
    city: text(data.city),
    pincode: text(data.pincode),
    openingBalance: number(data.openingBalance),
    openingBalanceType: openingBalanceType(data.openingBalanceType),
    creditLimit: number(data.creditLimit),
    creditDays: number(data.creditDays),
    isActive: data.isActive !== false,
    notes: text(data.notes),
  }
}

function toInvoiceBalance(id: string, kind: PartyInvoiceBalance['kind'], data: DocumentData): PartyInvoiceBalance {
  return {
    id,
    kind,
    number: text(data.number) || text(data.invoiceNumber) || text(data.documentNumber) || 'Untitled invoice',
    date: date(data.date) || date(data.invoiceDate) || date(data.createdDate),
    // `balanceAmount` is the preferred mobile contract; fallbacks support early documents during migration.
    balanceAmount: number(data.balanceAmount, number(data.balanceDue, number(data.dueAmount))),
    status: text(data.status).toUpperCase() || 'FINAL',
  }
}

function toPayment(id: string, data: DocumentData): PartyPayment {
  return {
    id,
    direction: paymentDirection(data.direction ?? data.paymentDirection ?? data.type),
    amount: number(data.amount),
    date: date(data.date) || date(data.paymentDate) || date(data.createdDate),
    // An invoice-linked payment is already reflected in invoice.balanceAmount and is excluded from the net calculation.
    invoiceId: text(data.invoiceId) || text(data.salesInvoiceId) || text(data.purchaseInvoiceId) || text(data.againstInvoiceId),
    mode: text(data.mode) || text(data.paymentMode),
    note: text(data.note) || text(data.notes),
  }
}

function partiesCollection(uid: string, businessId: string) {
  return collection(requireFirestore(), getBusinessPath(uid, businessId, 'parties'))
}

function partyReference(uid: string, businessId: string, partyId: string) {
  return doc(requireFirestore(), getBusinessPath(uid, businessId, 'parties'), partyId)
}

export function subscribeToParties(
  uid: string,
  businessId: string,
  onParties: (parties: Party[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    partiesCollection(uid, businessId),
    (snapshot) => {
      const parties = snapshot.docs
        .map((party) => toParty(party.id, party.data()))
        .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }))
      onParties(parties)
    },
    (error) => onError(error),
  )
}

export function subscribeToParty(
  uid: string,
  businessId: string,
  partyId: string,
  onParty: (party: Party | null) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    partyReference(uid, businessId, partyId),
    (snapshot) => onParty(snapshot.exists() ? toParty(snapshot.id, snapshot.data()) : null),
    (error) => onError(error),
  )
}

export function subscribeToPartyActivity(
  uid: string,
  businessId: string,
  partyId: string,
  onActivity: (activity: PartyActivity) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const database = requireFirestore()
  let salesInvoices: PartyInvoiceBalance[] = []
  let purchaseInvoices: PartyInvoiceBalance[] = []
  let payments: PartyPayment[] = []
  const initializedSources = new Set<'sales' | 'purchases' | 'payments'>()

  // Wait for all three initial snapshots so the first balance is not briefly
  // rendered from just one collection. Every later source update emits live.
  const emit = (source: 'sales' | 'purchases' | 'payments') => {
    initializedSources.add(source)
    if (initializedSources.size === 3) onActivity({ salesInvoices, purchaseInvoices, payments })
  }
  const watch = <T>(
    source: 'sales' | 'purchases' | 'payments',
    reference: ReturnType<typeof collection>,
    map: (id: string, data: DocumentData) => T,
    set: (items: T[]) => void,
  ) => onSnapshot(
    query(reference, where('partyId', '==', partyId)),
    (snapshot) => {
      set(snapshot.docs.map((item) => map(item.id, item.data())))
      emit(source)
    },
    (error) => onError(error),
  )

  const unsubscribeSales = watch(
    'sales',
    collection(database, getBusinessPath(uid, businessId, 'salesInvoices')),
    (id, data) => toInvoiceBalance(id, 'SALE', data),
    (items) => { salesInvoices = items },
  )
  const unsubscribePurchases = watch(
    'purchases',
    collection(database, getBusinessPath(uid, businessId, 'purchaseInvoices')),
    (id, data) => toInvoiceBalance(id, 'PURCHASE', data),
    (items) => { purchaseInvoices = items },
  )
  const unsubscribePayments = watch(
    'payments',
    collection(database, getBusinessPath(uid, businessId, 'payments')),
    toPayment,
    (items) => { payments = items },
  )

  return () => {
    unsubscribeSales()
    unsubscribePurchases()
    unsubscribePayments()
  }
}

export async function createParty(uid: string, businessId: string, input: PartyInput): Promise<void> {
  await addDoc(partiesCollection(uid, businessId), {
    type: input.type,
    name: input.name.trim(),
    phone: input.phone.trim(),
    email: input.email.trim(),
    gstin: input.gstin.trim().toUpperCase(),
    address: input.address.trim(),
    state: input.state.trim(),
    city: input.city.trim(),
    pincode: input.pincode.trim(),
    openingBalance: input.openingBalance,
    openingBalanceType: input.openingBalanceType,
    creditLimit: input.creditLimit,
    creditDays: input.creditDays,
    isActive: input.isActive,
    notes: input.notes.trim(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

export async function updateParty(
  uid: string,
  businessId: string,
  partyId: string,
  input: PartyInput,
): Promise<void> {
  await updateDoc(partyReference(uid, businessId, partyId), {
    type: input.type,
    name: input.name.trim(),
    phone: input.phone.trim(),
    email: input.email.trim(),
    gstin: input.gstin.trim().toUpperCase(),
    address: input.address.trim(),
    state: input.state.trim(),
    city: input.city.trim(),
    pincode: input.pincode.trim(),
    openingBalance: input.openingBalance,
    openingBalanceType: input.openingBalanceType,
    creditLimit: input.creditLimit,
    creditDays: input.creditDays,
    isActive: input.isActive,
    notes: input.notes.trim(),
    updatedAt: serverTimestamp(),
  })
}

export async function removeParty(uid: string, businessId: string, partyId: string): Promise<void> {
  await deleteDoc(partyReference(uid, businessId, partyId))
}
