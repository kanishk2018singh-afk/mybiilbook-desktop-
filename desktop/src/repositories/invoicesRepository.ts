import {
  collection,
  deleteField,
  doc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  where,
  type DocumentData,
  type DocumentReference,
  type Unsubscribe,
} from 'firebase/firestore'
import { cancellationMovement, collectionForInvoiceKind } from '../lib/invoiceUtils'
import { requireFirestore } from '../lib/firebase'
import { getBusinessPath } from '../lib/firestorePaths'
import type {
  InvoiceDetail,
  InvoiceItemSnapshot,
  InvoiceKind,
  InvoiceListItem,
  InvoicePaymentLink,
  InvoiceStatus,
} from '../types/invoice'
import type { PaymentStatus } from '../types/salesInvoice'

export type InvoiceCancellationErrorCode =
  | 'INVOICE_NOT_FOUND'
  | 'INVOICE_NOT_CONFIRMED'
  | 'INVOICE_ITEMS_MISSING'
  | 'INVOICE_ITEM_INVALID'
  | 'PRODUCT_NOT_FOUND'
  | 'INSUFFICIENT_STOCK_TO_CANCEL'

export class InvoiceCancellationError extends Error {
  constructor(
    public readonly code: InvoiceCancellationErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'InvoiceCancellationError'
  }
}

export interface CancelledInvoiceResult {
  id: string
  kind: InvoiceKind
  stockAdjustmentCount: number
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numeric(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** Supports ISO date strings and Firestore Timestamp-like values from mobile clients. */
function dateText(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    const converted = value.toDate()
    return converted instanceof Date && !Number.isNaN(converted.valueOf()) ? converted.toISOString() : ''
  }
  return ''
}

function invoiceDateOnly(value: unknown): string {
  const raw = dateText(value)
  return raw.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? raw
}

function documentDate(data: DocumentData): string {
  return invoiceDateOnly(data.date) || invoiceDateOnly(data.invoiceDate) || invoiceDateOnly(data.purchaseDate) || invoiceDateOnly(data.createdAt)
}

function invoiceStatus(value: unknown): InvoiceStatus {
  const candidate = text(value).toUpperCase()
  if (candidate === 'DRAFT' || candidate === 'CANCELLED' || candidate === 'CONFIRMED') return candidate
  // Pre-desktop invoice records were effectively confirmed documents.
  return 'CONFIRMED'
}

function paymentStatus(value: unknown): PaymentStatus {
  const candidate = text(value).toUpperCase()
  if (candidate === 'PAID' || candidate === 'PARTIAL' || candidate === 'UNPAID') return candidate
  return 'UNPAID'
}

function direction(value: unknown): 'IN' | 'OUT' {
  return text(value).toUpperCase() === 'OUT' ? 'OUT' : 'IN'
}

function taxType(value: unknown): 'IGST' | 'CGST_SGST' {
  return text(value).toUpperCase() === 'IGST' ? 'IGST' : 'CGST_SGST'
}

function toInvoiceListItem(id: string, kind: InvoiceKind, data: DocumentData): InvoiceListItem {
  return {
    id,
    kind,
    number: text(data.number) || text(data.invoiceNumber) || text(data.documentNumber) || 'Untitled invoice',
    date: documentDate(data),
    partyId: text(data.partyId),
    partyName: text(data.partyName) || 'Unnamed party',
    grandTotal: numeric(data.grandTotal),
    paidAmount: numeric(data.paidAmount),
    balanceAmount: numeric(data.balanceAmount, numeric(data.balanceDue, numeric(data.dueAmount))),
    paymentStatus: paymentStatus(data.paymentStatus),
    status: invoiceStatus(data.status),
    supplierInvoiceNumber: text(data.supplierInvoiceNumber),
    createdAt: dateText(data.createdAt),
    cancelledAt: dateText(data.cancelledAt),
  }
}

function toInvoiceItem(id: string, data: DocumentData): InvoiceItemSnapshot {
  return {
    id,
    productId: text(data.productId),
    name: text(data.name) || 'Unnamed product',
    code: text(data.code),
    hsn: text(data.hsn),
    unit: text(data.unit),
    qty: numeric(data.qty),
    rate: numeric(data.rate),
    discountPercent: numeric(data.discountPercent),
    gstPercent: numeric(data.gstPercent),
    grossAmount: numeric(data.grossAmount),
    discountAmount: numeric(data.discountAmount),
    taxableAmount: numeric(data.taxableAmount),
    billDiscountAmount: numeric(data.billDiscountAmount),
    taxableAfterBillDiscount: numeric(data.taxableAfterBillDiscount),
    cgstAmount: numeric(data.cgstAmount),
    sgstAmount: numeric(data.sgstAmount),
    igstAmount: numeric(data.igstAmount),
    lineTotal: numeric(data.lineTotal),
  }
}

function toPaymentLink(id: string, data: DocumentData): InvoicePaymentLink {
  return {
    id,
    paymentId: text(data.paymentId),
    direction: direction(data.direction ?? data.paymentDirection),
    amount: numeric(data.amount),
    paymentDate: dateText(data.paymentDate) || dateText(data.date),
    paymentMode: text(data.paymentMode) || text(data.mode),
    status: text(data.status).toUpperCase() || 'APPLIED',
    unlinkedAt: dateText(data.unlinkedAt),
  }
}

function toInvoiceDetail(id: string, kind: InvoiceKind, data: DocumentData): Omit<InvoiceDetail, 'items' | 'paymentLinks'> {
  return {
    ...toInvoiceListItem(id, kind, data),
    invoiceNumber: text(data.invoiceNumber) || text(data.number) || text(data.documentNumber) || 'Untitled invoice',
    partyPhone: text(data.partyPhone),
    partyGstin: text(data.partyGstin),
    partyAddress: text(data.partyAddress),
    partyState: text(data.partyState),
    partyStateCode: text(data.partyStateCode),
    businessState: text(data.businessState),
    businessStateCode: text(data.businessStateCode),
    taxType: taxType(data.taxType),
    taxJurisdictionResolved: data.taxJurisdictionResolved === true,
    itemCount: numeric(data.itemCount),
    totalQty: numeric(data.totalQty),
    subtotal: numeric(data.subtotal),
    lineDiscountAmount: numeric(data.lineDiscountAmount),
    taxableBeforeBillDiscount: numeric(data.taxableBeforeBillDiscount),
    billDiscount: numeric(data.billDiscount),
    taxableAmount: numeric(data.taxableAmount),
    cgstAmount: numeric(data.cgstAmount),
    sgstAmount: numeric(data.sgstAmount),
    igstAmount: numeric(data.igstAmount),
    totalTax: numeric(data.totalTax),
    beforeRoundOff: numeric(data.beforeRoundOff),
    roundOff: numeric(data.roundOff),
    paymentMode: text(data.paymentMode),
    createdBy: text(data.createdBy),
    cancellationReason: text(data.cancellationReason),
    cancelledBy: text(data.cancelledBy),
  }
}

function invoiceReference(uid: string, businessId: string, kind: InvoiceKind, invoiceId: string): DocumentReference<DocumentData> {
  return doc(requireFirestore(), getBusinessPath(uid, businessId, collectionForInvoiceKind(kind)), invoiceId)
}

function roundStock(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000
}

export function subscribeToInvoices(
  uid: string,
  businessId: string,
  kind: InvoiceKind,
  onInvoices: (invoices: InvoiceListItem[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const database = requireFirestore()
  return onSnapshot(
    collection(database, getBusinessPath(uid, businessId, collectionForInvoiceKind(kind))),
    (snapshot) => onInvoices(snapshot.docs.map((item) => toInvoiceListItem(item.id, kind, item.data()))),
    (error) => onError(error),
  )
}

/**
 * Watches the header, immutable item subcollection, and top-level payment links
 * independently. The links are the audit source of payment history; keeping the
 * listener on them also preserves history after cancellation releases a payment
 * to an unallocated party advance.
 */
export function subscribeToInvoiceDetail(
  uid: string,
  businessId: string,
  kind: InvoiceKind,
  invoiceId: string,
  onDetail: (detail: InvoiceDetail | null) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const database = requireFirestore()
  const reference = invoiceReference(uid, businessId, kind, invoiceId)
  const initialized = new Set<'header' | 'items' | 'payments'>()
  let header: Omit<InvoiceDetail, 'items' | 'paymentLinks'> | null = null
  let items: InvoiceItemSnapshot[] = []
  let paymentLinks: InvoicePaymentLink[] = []

  const emit = (source: 'header' | 'items' | 'payments') => {
    initialized.add(source)
    if (initialized.size !== 3) return
    onDetail(header ? { ...header, items, paymentLinks } : null)
  }

  const unsubscribeHeader = onSnapshot(
    reference,
    (snapshot) => {
      header = snapshot.exists() ? toInvoiceDetail(snapshot.id, kind, snapshot.data()) : null
      emit('header')
    },
    (error) => onError(error),
  )
  const unsubscribeItems = onSnapshot(
    collection(reference, 'items'),
    (snapshot) => {
      items = snapshot.docs.map((item) => toInvoiceItem(item.id, item.data()))
      emit('items')
    },
    (error) => onError(error),
  )
  const unsubscribePayments = onSnapshot(
    query(collection(database, getBusinessPath(uid, businessId, 'invoicePayments')), where('invoiceId', '==', invoiceId)),
    (snapshot) => {
      paymentLinks = snapshot.docs
        .map((item) => toPaymentLink(item.id, item.data()))
        .sort((left, right) => right.paymentDate.localeCompare(left.paymentDate))
      emit('payments')
    },
    (error) => onError(error),
  )

  return () => {
    unsubscribeHeader()
    unsubscribeItems()
    unsubscribePayments()
  }
}

/**
 * Cancels a posted invoice without mutating its historic item/amount snapshots.
 * A single Firestore transaction marks the header CANCELLED, writes one inverse
 * stock adjustment per item, updates product quantities, and releases any
 * invoice-linked payment into an unallocated advance. This keeps stock, party
 * balance, payment history, and document audit trail internally consistent.
 */
export async function cancelConfirmedInvoice(
  uid: string,
  businessId: string,
  kind: InvoiceKind,
  invoiceId: string,
  cancellationReason = '',
): Promise<CancelledInvoiceResult> {
  const database = requireFirestore()
  const reference = invoiceReference(uid, businessId, kind, invoiceId)
  const itemsReference = collection(reference, 'items')
  const paymentLinksQuery = query(
    collection(database, getBusinessPath(uid, businessId, 'invoicePayments')),
    where('invoiceId', '==', invoiceId),
  )

  // The Web Firestore SDK transaction API accepts document references but not
  // collection/query reads. Invoice item snapshots and payment links are
  // immutable after confirmation, so first enumerate their refs, then re-read
  // every one inside the transaction. A missing/refreshed snapshot aborts the
  // cancellation; product stock and the invoice header remain transaction-read.
  const [seedItemsSnapshot, seedPaymentLinksSnapshot] = await Promise.all([
    getDocs(itemsReference),
    getDocs(paymentLinksQuery),
  ])
  const itemReferences = seedItemsSnapshot.docs.map((item) => item.ref)
  const seededItemMovements = new Map(seedItemsSnapshot.docs.map((item) => [
    item.ref.path,
    { productId: text(item.data().productId), qty: numeric(item.data().qty) },
  ]))
  const paymentLinkReferences = seedPaymentLinksSnapshot.docs.map((link) => link.ref)

  return runTransaction(database, async (transaction) => {
    // Do all document reads before every write: this lets a concurrent product
    // stock change retry the complete cancellation safely.
    const initialSnapshots = await Promise.all([
      transaction.get(reference),
      ...itemReferences.map((itemReference) => transaction.get(itemReference)),
      ...paymentLinkReferences.map((linkReference) => transaction.get(linkReference)),
    ])
    const invoiceSnapshot = initialSnapshots[0]
    const itemDocumentSnapshots = initialSnapshots.slice(1, 1 + itemReferences.length)
    const paymentLinkDocumentSnapshots = initialSnapshots.slice(1 + itemReferences.length)

    if (!invoiceSnapshot.exists()) {
      throw new InvoiceCancellationError('INVOICE_NOT_FOUND', 'This invoice no longer exists.')
    }
    if (invoiceStatus(invoiceSnapshot.data().status) !== 'CONFIRMED') {
      throw new InvoiceCancellationError('INVOICE_NOT_CONFIRMED', 'Only confirmed invoices can be cancelled. Drafts may be edited; cancelled invoices are immutable.')
    }

    if (itemDocumentSnapshots.some((item) => !item.exists())) {
      throw new InvoiceCancellationError('INVOICE_ITEMS_MISSING', 'An invoice item changed while cancellation was starting. Reload and try again.')
    }
    const items = itemDocumentSnapshots.map((item) => ({ id: item.id, referencePath: item.ref.path, snapshot: toInvoiceItem(item.id, item.data() ?? {}) }))
    const declaredItemCount = numeric(invoiceSnapshot.data().itemCount)
    if (!items.length || (declaredItemCount > 0 && declaredItemCount !== items.length)) {
      throw new InvoiceCancellationError('INVOICE_ITEMS_MISSING', 'This invoice has incomplete immutable item snapshots, so it cannot be cancelled safely.')
    }
    items.forEach((item) => {
      const seeded = seededItemMovements.get(item.referencePath)
      if (!seeded || seeded.productId !== item.snapshot.productId || Math.abs(seeded.qty - item.snapshot.qty) > 0.000001) {
        throw new InvoiceCancellationError('INVOICE_ITEM_INVALID', `Invoice item ${item.snapshot.name || item.id} changed while cancellation was starting. Reload and try again.`)
      }
      if (!item.snapshot.productId || !Number.isFinite(item.snapshot.qty) || item.snapshot.qty <= 0) {
        throw new InvoiceCancellationError('INVOICE_ITEM_INVALID', `Invoice item ${item.snapshot.name || item.id} cannot be reversed safely.`)
      }
    })

    const productReferences = new Map<string, DocumentReference<DocumentData>>()
    items.forEach((item) => {
      productReferences.set(
        item.snapshot.productId,
        doc(database, getBusinessPath(uid, businessId, 'products'), item.snapshot.productId),
      )
    })
    const paymentReferences = new Map<string, DocumentReference<DocumentData>>()
    paymentLinkDocumentSnapshots.filter((link) => link.exists()).forEach((link) => {
      const paymentId = text(link.data()?.paymentId)
      if (paymentId) paymentReferences.set(paymentId, doc(database, getBusinessPath(uid, businessId, 'payments'), paymentId))
    })

    const [productEntries, paymentEntries] = await Promise.all([
      Promise.all([...productReferences.entries()].map(async ([id, productReference]) => [id, productReference, await transaction.get(productReference)] as const)),
      Promise.all([...paymentReferences.entries()].map(async ([id, paymentReference]) => [id, paymentReference, await transaction.get(paymentReference)] as const)),
    ])
    const products = new Map(productEntries.map(([id, productReference, snapshot]) => [id, { reference: productReference, snapshot }]))
    const payments = new Map(paymentEntries.map(([id, paymentReference, snapshot]) => [id, { reference: paymentReference, snapshot }]))

    const originalData = invoiceSnapshot.data()
    const invoiceNumber = text(originalData.invoiceNumber) || text(originalData.number) || invoiceId
    const partyId = text(originalData.partyId)
    const partyName = text(originalData.partyName)
    const movementByProduct = new Map<string, number>()
    for (const item of items) {
      const current = movementByProduct.get(item.snapshot.productId) ?? 0
      movementByProduct.set(item.snapshot.productId, roundStock(current + item.snapshot.qty))
    }

    const currentStock = new Map<string, number>()
    for (const [productId, quantity] of movementByProduct) {
      const product = products.get(productId)
      const item = items.find((candidate) => candidate.snapshot.productId === productId)?.snapshot
      if (!product?.snapshot.exists()) {
        throw new InvoiceCancellationError('PRODUCT_NOT_FOUND', `Product ${item?.name || productId} no longer exists.`)
      }
      const stockQty = numeric(product.snapshot.data().stockQty)
      // Cancelling a purchase removes goods. Never make stock negative merely
      // to satisfy a cancellation: it must be resolved through a valid stock
      // adjustment/sale reversal first.
      if (kind === 'PURCHASE' && stockQty + 0.000001 < quantity) {
        throw new InvoiceCancellationError(
          'INSUFFICIENT_STOCK_TO_CANCEL',
          `Cannot cancel this purchase because ${item?.name || productId} has only ${stockQty} in stock and ${quantity} must be removed.`,
        )
      }
      currentStock.set(productId, stockQty)
    }

    const stockAfter = new Map(currentStock)
    for (const item of items) {
      const movement = cancellationMovement(kind, item.snapshot.qty)
      const nextStock = roundStock((stockAfter.get(item.snapshot.productId) ?? 0) + movement.stockDelta)
      stockAfter.set(item.snapshot.productId, nextStock)

      const stockTransactionReference = doc(collection(database, getBusinessPath(uid, businessId, 'stockTransactions')))
      transaction.set(stockTransactionReference, {
        productId: item.snapshot.productId,
        productName: item.snapshot.name,
        type: movement.type,
        quantityIn: movement.quantityIn,
        quantityOut: movement.quantityOut,
        balanceAfter: nextStock,
        referenceType: 'INVOICE_CANCELLATION',
        referenceId: invoiceId,
        invoiceId,
        ...(kind === 'SALE' ? { salesInvoiceId: invoiceId } : { purchaseInvoiceId: invoiceId }),
        invoiceNumber,
        originalInvoiceType: kind,
        originalItemId: item.id,
        partyId,
        partyName,
        cancellationReason: cancellationReason.trim(),
        createdAt: serverTimestamp(),
        createdBy: uid,
      })
    }

    for (const [productId, nextStock] of stockAfter) {
      const product = products.get(productId)
      if (!product) continue
      transaction.update(product.reference, {
        stockQty: nextStock,
        updatedAt: serverTimestamp(),
      })
    }

    transaction.update(reference, {
      status: 'CANCELLED',
      cancelledAt: serverTimestamp(),
      cancelledBy: uid,
      cancellationReason: cancellationReason.trim(),
      cancellationStockType: kind === 'SALE' ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
      updatedAt: serverTimestamp(),
    })

    // An invoice-linked payment is already accounted for by balanceAmount. Once
    // the invoice is cancelled, release that payment to an unallocated advance
    // rather than deleting cash/bank history. The invoicePayment link remains
    // intact (but marked unlinked) so the detail view retains its audit trail.
    for (const link of paymentLinkDocumentSnapshots) {
      if (!link.exists()) continue
      const paymentId = text(link.data()?.paymentId)
      const payment = paymentId ? payments.get(paymentId) : undefined
      transaction.update(link.ref, {
        status: 'UNLINKED_ON_CANCELLATION',
        unlinkedAt: serverTimestamp(),
        cancellationReason: cancellationReason.trim(),
        updatedAt: serverTimestamp(),
      })
      if (payment?.snapshot.exists()) {
        transaction.update(payment.reference, {
          invoiceId: deleteField(),
          salesInvoiceId: deleteField(),
          purchaseInvoiceId: deleteField(),
          source: 'INVOICE_CANCELLED_PAYMENT_ADVANCE',
          unlinkedFromInvoiceId: invoiceId,
          unlinkedFromInvoiceNumber: invoiceNumber,
          unlinkedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      }
    }

    return { id: invoiceId, kind, stockAdjustmentCount: items.length }
  })
}
