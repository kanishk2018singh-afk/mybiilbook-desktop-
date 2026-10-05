import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type DocumentData,
  type DocumentReference,
  type Unsubscribe,
} from 'firebase/firestore'
import { requireFirestore } from '../lib/firebase'
import { getBusinessPath } from '../lib/firestorePaths'
import {
  invoiceKindForPaymentDirection,
  paymentStatusAfterAllocation,
  roundMoney,
  sumPaymentAllocations,
} from '../lib/paymentUtils'
import type { InvoiceKind, InvoiceStatus } from '../types/invoice'
import {
  PAYMENT_MODES,
  type PaymentAllocationInput,
  type PaymentDirection,
  type PaymentListItem,
  type PayableInvoice,
  type RecordedPaymentResult,
  type RecordPaymentInput,
} from '../types/payment'

const MONEY_EPSILON = 0.005

export type RecordPaymentErrorCode =
  | 'PARTY_REQUIRED'
  | 'AMOUNT_INVALID'
  | 'DATE_INVALID'
  | 'MODE_INVALID'
  | 'ALLOCATION_INVALID'
  | 'ALLOCATION_EXCEEDS_PAYMENT'
  | 'BATCH_LIMIT_EXCEEDED'
  | 'INVOICE_NOT_FOUND'
  | 'INVOICE_NOT_CONFIRMABLE'
  | 'INVOICE_PARTY_MISMATCH'
  | 'INVOICE_ALREADY_SETTLED'
  | 'INVOICE_BALANCE_CHANGED'

export class RecordPaymentError extends Error {
  constructor(
    public readonly code: RecordPaymentErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'RecordPaymentError'
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numeric(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Supports date strings and Firestore Timestamp-like values from older clients. */
function dateText(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    const converted = value.toDate()
    return converted instanceof Date && !Number.isNaN(converted.valueOf()) ? converted.toISOString() : ''
  }
  return ''
}

function dateOnly(value: unknown): string {
  const raw = dateText(value)
  return raw.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? raw
}

function invoiceStatus(value: unknown): InvoiceStatus {
  const candidate = text(value).toUpperCase()
  if (candidate === 'DRAFT' || candidate === 'CANCELLED' || candidate === 'CONFIRMED') return candidate
  // Legacy posted invoices did not always persist a status field.
  return 'CONFIRMED'
}

function paymentStatus(value: unknown, balanceAmount: number): 'PAID' | 'PARTIAL' | 'UNPAID' {
  const candidate = text(value).toUpperCase()
  if (candidate === 'PAID' || candidate === 'PARTIAL' || candidate === 'UNPAID') return candidate
  return balanceAmount <= MONEY_EPSILON ? 'PAID' : 'UNPAID'
}

function invoiceCollection(kind: InvoiceKind): 'salesInvoices' | 'purchaseInvoices' {
  return kind === 'SALE' ? 'salesInvoices' : 'purchaseInvoices'
}

function paymentDirection(value: unknown): PaymentDirection {
  return text(value).toUpperCase() === 'OUT' ? 'OUT' : 'IN'
}

function paymentMode(value: unknown): string {
  return text(value).toUpperCase() || 'OTHER'
}

function invoiceBalance(data: DocumentData): number {
  return Math.max(0, numeric(data.balanceAmount, numeric(data.balanceDue, numeric(data.dueAmount))))
}

function invoicePaidAmount(data: DocumentData, balanceAmount: number): number {
  const explicit = finiteNumber(data.paidAmount)
  if (explicit !== null) return Math.max(0, explicit)
  const grandTotal = numeric(data.grandTotal)
  return grandTotal > 0 ? Math.max(0, grandTotal - balanceAmount) : 0
}

function toPayableInvoice(id: string, kind: InvoiceKind, data: DocumentData): PayableInvoice {
  const balanceAmount = invoiceBalance(data)
  return {
    id,
    kind,
    number: text(data.number) || text(data.invoiceNumber) || text(data.documentNumber) || 'Untitled invoice',
    date: dateOnly(data.date) || dateOnly(data.invoiceDate) || dateOnly(data.purchaseDate) || dateOnly(data.createdAt),
    partyId: text(data.partyId),
    partyName: text(data.partyName) || 'Unnamed party',
    grandTotal: numeric(data.grandTotal),
    paidAmount: invoicePaidAmount(data, balanceAmount),
    balanceAmount,
    paymentStatus: paymentStatus(data.paymentStatus, balanceAmount),
    status: invoiceStatus(data.status),
    supplierInvoiceNumber: text(data.supplierInvoiceNumber),
  }
}

function toPaymentListItem(id: string, data: DocumentData): PaymentListItem {
  const amount = Math.max(0, numeric(data.amount))
  const legacyInvoiceId = text(data.invoiceId) || text(data.salesInvoiceId) || text(data.purchaseInvoiceId) || text(data.againstInvoiceId)
  const storedUnallocatedAmount = finiteNumber(data.unallocatedAmount)
  const unallocatedAmount = roundMoney(Math.max(0, storedUnallocatedAmount ?? (legacyInvoiceId ? 0 : amount)))
  const storedAllocatedAmount = finiteNumber(data.allocatedAmount)
  const allocatedAmount = roundMoney(Math.max(0, storedAllocatedAmount ?? Math.max(0, amount - unallocatedAmount)))
  const storedAllocationCount = finiteNumber(data.allocationCount)

  return {
    id,
    paymentDate: dateOnly(data.paymentDate) || dateOnly(data.date) || dateOnly(data.createdAt),
    partyId: text(data.partyId),
    partyName: text(data.partyName) || 'Unnamed party',
    direction: paymentDirection(data.direction ?? data.paymentDirection),
    mode: paymentMode(data.paymentMode ?? data.mode),
    amount,
    allocatedAmount,
    unallocatedAmount,
    allocationCount: Math.max(0, Math.trunc(storedAllocationCount ?? (legacyInvoiceId ? 1 : 0))),
    referenceNumber: text(data.referenceNumber) || text(data.reference) || text(data.transactionId),
    note: text(data.note) || text(data.notes),
    createdAt: dateText(data.createdAt),
  }
}

function normalizeAllocations(
  allocations: PaymentAllocationInput[],
  expectedKind: InvoiceKind,
): PaymentAllocationInput[] {
  const merged = new Map<string, PaymentAllocationInput>()
  for (const allocation of allocations) {
    if (!allocation.invoiceId.trim() || allocation.invoiceKind !== expectedKind || !Number.isFinite(allocation.amount) || allocation.amount <= 0) {
      throw new RecordPaymentError('ALLOCATION_INVALID', 'Each allocation must have a valid invoice and an amount greater than zero.')
    }
    const key = `${allocation.invoiceKind}:${allocation.invoiceId}`
    const existing = merged.get(key)
    merged.set(key, {
      invoiceId: allocation.invoiceId,
      invoiceKind: allocation.invoiceKind,
      amount: roundMoney((existing?.amount ?? 0) + allocation.amount),
    })
  }
  return [...merged.values()]
}

function invoiceReference(
  uid: string,
  businessId: string,
  kind: InvoiceKind,
  invoiceId: string,
): DocumentReference<DocumentData> {
  return doc(requireFirestore(), getBusinessPath(uid, businessId, invoiceCollection(kind)), invoiceId)
}

/** Watches the unpaid/partial invoice collection that logically matches a payment direction. */
export function subscribeToPayableInvoices(
  uid: string,
  businessId: string,
  partyId: string,
  direction: PaymentDirection,
  onInvoices: (invoices: PayableInvoice[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  if (!partyId.trim()) {
    onInvoices([])
    return () => undefined
  }

  const database = requireFirestore()
  const kind = invoiceKindForPaymentDirection(direction)
  return onSnapshot(
    query(
      collection(database, getBusinessPath(uid, businessId, invoiceCollection(kind))),
      where('partyId', '==', partyId),
    ),
    (snapshot) => {
      const invoices = snapshot.docs
        .map((item) => toPayableInvoice(item.id, kind, item.data()))
        .filter((invoice) => (
          invoice.status === 'CONFIRMED'
          && (invoice.paymentStatus === 'UNPAID' || invoice.paymentStatus === 'PARTIAL')
          && invoice.balanceAmount > MONEY_EPSILON
        ))
        .sort((left, right) => right.date.localeCompare(left.date) || right.number.localeCompare(left.number))
      onInvoices(invoices)
    },
    (error) => onError(error),
  )
}

export function subscribeToPayments(
  uid: string,
  businessId: string,
  onPayments: (payments: PaymentListItem[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const database = requireFirestore()
  return onSnapshot(
    collection(database, getBusinessPath(uid, businessId, 'payments')),
    (snapshot) => onPayments(snapshot.docs.map((item) => toPaymentListItem(item.id, item.data()))),
    (error) => onError(error),
  )
}

/**
 * Records an independent cash/bank payment and any invoice allocations in one
 * Firestore batch. There is deliberately no stock movement and no transaction:
 * the preflight reads validate each live invoice, then the batch atomically
 * creates the payment/link audit rows and updates all involved invoice headers.
 */
export async function recordStandalonePayment(
  uid: string,
  businessId: string,
  input: RecordPaymentInput,
): Promise<RecordedPaymentResult> {
  if (!input.partyId.trim() || !input.partyName.trim()) {
    throw new RecordPaymentError('PARTY_REQUIRED', 'Select a party before recording a payment.')
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new RecordPaymentError('AMOUNT_INVALID', 'Enter a payment amount greater than zero.')
  }
  if (!PAYMENT_MODES.includes(input.mode)) {
    throw new RecordPaymentError('MODE_INVALID', 'Choose a valid payment mode.')
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.paymentDate)) {
    throw new RecordPaymentError('DATE_INVALID', 'Choose a valid payment date.')
  }

  const expectedKind = invoiceKindForPaymentDirection(input.direction)
  const allocations = normalizeAllocations(input.allocations, expectedKind)
  if (allocations.length > 249) {
    throw new RecordPaymentError('BATCH_LIMIT_EXCEEDED', 'A single payment can be allocated to at most 249 invoices.')
  }

  const totalAllocated = sumPaymentAllocations(allocations)
  const paymentAmount = roundMoney(input.amount)
  if (totalAllocated > paymentAmount + MONEY_EPSILON) {
    throw new RecordPaymentError('ALLOCATION_EXCEEDS_PAYMENT', 'Allocated total cannot be more than the payment amount.')
  }
  const unallocatedAmount = roundMoney(Math.max(0, paymentAmount - totalAllocated))

  const database = requireFirestore()
  const paymentRef = doc(collection(database, getBusinessPath(uid, businessId, 'payments')))
  const allocationSnapshots = await Promise.all(
    allocations.map(async (allocation) => {
      const reference = invoiceReference(uid, businessId, allocation.invoiceKind, allocation.invoiceId)
      return { allocation, reference, snapshot: await getDoc(reference) }
    }),
  )

  const batch = writeBatch(database)
  const allocationAudit: Array<{ invoiceId: string; invoiceKind: InvoiceKind; invoiceNumber: string; amount: number }> = []

  for (const entry of allocationSnapshots) {
    const { allocation, reference, snapshot } = entry
    if (!snapshot.exists()) {
      throw new RecordPaymentError('INVOICE_NOT_FOUND', 'An invoice selected for allocation no longer exists. Reload and try again.')
    }

    const data = snapshot.data()
    if (text(data.partyId) !== input.partyId.trim()) {
      throw new RecordPaymentError('INVOICE_PARTY_MISMATCH', 'An invoice no longer belongs to the selected party. Reload and try again.')
    }
    if (invoiceStatus(data.status) !== 'CONFIRMED') {
      throw new RecordPaymentError('INVOICE_NOT_CONFIRMABLE', 'Only confirmed invoices can receive a payment allocation.')
    }

    const balanceAmount = invoiceBalance(data)
    if (balanceAmount <= MONEY_EPSILON) {
      throw new RecordPaymentError('INVOICE_ALREADY_SETTLED', 'An invoice selected for allocation is already paid. Reload and try again.')
    }
    if (allocation.amount > balanceAmount + MONEY_EPSILON) {
      throw new RecordPaymentError('INVOICE_BALANCE_CHANGED', 'An allocation is more than the invoice’s remaining balance. Reload and adjust it.')
    }

    const currentPaidAmount = invoicePaidAmount(data, balanceAmount)
    const grandTotal = numeric(data.grandTotal)
    const nextBalanceAmount = roundMoney(Math.max(0, balanceAmount - allocation.amount))
    const nextPaidAmount = roundMoney(grandTotal > 0
      ? Math.min(grandTotal, currentPaidAmount + allocation.amount)
      : currentPaidAmount + allocation.amount)
    const nextPaymentStatus = paymentStatusAfterAllocation(nextPaidAmount, nextBalanceAmount)
    const invoiceNumber = text(data.invoiceNumber) || text(data.number) || allocation.invoiceId
    const linkRef = doc(collection(database, getBusinessPath(uid, businessId, 'invoicePayments')))

    batch.update(reference, {
      paidAmount: nextPaidAmount,
      balanceAmount: nextBalanceAmount,
      paymentStatus: nextPaymentStatus,
      updatedAt: serverTimestamp(),
    })
    batch.set(linkRef, {
      invoiceId: allocation.invoiceId,
      ...(allocation.invoiceKind === 'SALE' ? { salesInvoiceId: allocation.invoiceId } : { purchaseInvoiceId: allocation.invoiceId }),
      invoiceNumber,
      paymentId: paymentRef.id,
      partyId: input.partyId.trim(),
      partyName: input.partyName.trim(),
      direction: input.direction,
      paymentDirection: input.direction,
      amount: allocation.amount,
      paymentDate: input.paymentDate,
      paymentMode: input.mode,
      referenceNumber: input.referenceNumber.trim(),
      source: 'STANDALONE_PAYMENT',
      status: 'APPLIED',
      createdAt: serverTimestamp(),
      createdBy: uid,
    })
    allocationAudit.push({
      invoiceId: allocation.invoiceId,
      invoiceKind: allocation.invoiceKind,
      invoiceNumber,
      amount: allocation.amount,
    })
  }

  batch.set(paymentRef, {
    direction: input.direction,
    paymentDirection: input.direction,
    amount: paymentAmount,
    allocatedAmount: totalAllocated,
    unallocatedAmount,
    allocationCount: allocations.length,
    allocations: allocationAudit,
    invoiceIds: allocations.map((allocation) => allocation.invoiceId),
    paymentDate: input.paymentDate,
    date: input.paymentDate,
    mode: input.mode,
    paymentMode: input.mode,
    referenceNumber: input.referenceNumber.trim(),
    note: input.note.trim(),
    partyId: input.partyId.trim(),
    partyName: input.partyName.trim(),
    source: 'STANDALONE_PAYMENT',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: uid,
  })

  await batch.commit()
  return {
    id: paymentRef.id,
    amount: paymentAmount,
    allocatedAmount: totalAllocated,
    unallocatedAmount,
    allocationCount: allocations.length,
  }
}
