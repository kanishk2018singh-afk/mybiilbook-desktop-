import {
  collection,
  doc,
  onSnapshot,
  type DocumentData,
  type Unsubscribe,
} from 'firebase/firestore'
import { requireFirestore } from '../lib/firebase'
import { getBusinessPath } from '../lib/firestorePaths'
import type { InvoiceKind, InvoiceStatus } from '../types/invoice'
import type { PaymentStatus } from '../types/salesInvoice'
import type {
  DashboardData,
  DashboardInvoice,
  DashboardPayment,
  DashboardProduct,
  DashboardSalesItem,
} from '../types/dashboard'

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numeric(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return fallback
}

function dateText(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    const date = value.toDate()
    return date instanceof Date && !Number.isNaN(date.valueOf()) ? date.toISOString() : ''
  }
  return ''
}

function dateOnly(value: unknown): string {
  const raw = dateText(value)
  return raw.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? raw
}

function documentDate(data: DocumentData): string {
  return dateOnly(data.date) || dateOnly(data.invoiceDate) || dateOnly(data.purchaseDate) || dateOnly(data.createdAt)
}

function invoiceStatus(value: unknown): InvoiceStatus {
  const candidate = text(value).toUpperCase()
  if (candidate === 'DRAFT' || candidate === 'CANCELLED' || candidate === 'CONFIRMED') return candidate
  // Historic invoice headers predate an explicit status and represent posted records.
  return 'CONFIRMED'
}

function paymentStatus(value: unknown, balanceAmount: number): PaymentStatus {
  const candidate = text(value).toUpperCase()
  if (candidate === 'PAID' || candidate === 'PARTIAL' || candidate === 'UNPAID') return candidate
  return balanceAmount > 0.005 ? 'UNPAID' : 'PAID'
}

function paymentDirection(value: unknown): 'IN' | 'OUT' {
  return text(value).toUpperCase() === 'OUT' ? 'OUT' : 'IN'
}

function toDashboardInvoice(id: string, kind: InvoiceKind, data: DocumentData): DashboardInvoice {
  const balanceAmount = Math.max(0, numeric(data.balanceAmount, numeric(data.balanceDue, numeric(data.dueAmount))))
  return {
    id,
    kind,
    date: documentDate(data),
    status: invoiceStatus(data.status),
    paymentStatus: paymentStatus(data.paymentStatus, balanceAmount),
    grandTotal: Math.max(0, numeric(data.grandTotal)),
    balanceAmount,
    cgstAmount: Math.max(0, numeric(data.cgstAmount)),
    sgstAmount: Math.max(0, numeric(data.sgstAmount)),
    igstAmount: Math.max(0, numeric(data.igstAmount)),
  }
}

function toDashboardPayment(id: string, data: DocumentData): DashboardPayment {
  return {
    id,
    direction: paymentDirection(data.direction ?? data.paymentDirection),
    mode: text(data.mode ?? data.paymentMode).toUpperCase() || 'OTHER',
    amount: Math.max(0, numeric(data.amount)),
  }
}

function toDashboardProduct(id: string, data: DocumentData): DashboardProduct {
  return {
    id,
    name: text(data.name) || 'Unnamed product',
    unit: text(data.unit) || 'PCS',
    stockQty: numeric(data.stockQty),
    lowStockAlert: Math.max(0, numeric(data.lowStockAlert)),
  }
}

function toDashboardSalesItem(invoiceId: string, id: string, data: DocumentData): DashboardSalesItem {
  return {
    id,
    invoiceId,
    productId: text(data.productId),
    name: text(data.name) || text(data.productName) || 'Unnamed product',
    unit: text(data.unit) || 'PCS',
    qty: Math.max(0, numeric(data.qty, numeric(data.quantity))),
  }
}

/**
 * Watches the dashboard's business-scoped source collections in real time. Item
 * documents do not yet carry businessId, so a collection-group query could not
 * safely target only the active business. Instead this subscribes to each
 * confirmed sales invoice's own immutable `items` subcollection and aggregates
 * those snapshots client-side. This keeps top-product totals scoped correctly
 * without requiring a cross-business Firestore index or schema migration.
 */
export function subscribeToDashboardData(
  uid: string,
  businessId: string,
  onData: (data: DashboardData) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const database = requireFirestore()
  const salesReference = collection(database, getBusinessPath(uid, businessId, 'salesInvoices'))
  const purchasesReference = collection(database, getBusinessPath(uid, businessId, 'purchaseInvoices'))
  const paymentsReference = collection(database, getBusinessPath(uid, businessId, 'payments'))
  const productsReference = collection(database, getBusinessPath(uid, businessId, 'products'))

  let salesInvoices: DashboardInvoice[] = []
  let purchaseInvoices: DashboardInvoice[] = []
  let payments: DashboardPayment[] = []
  let products: DashboardProduct[] = []
  const initialized = new Set<'sales' | 'purchases' | 'payments' | 'products'>()
  const itemUnsubscribers = new Map<string, Unsubscribe>()
  const salesItemsByInvoice = new Map<string, DashboardSalesItem[]>()
  const initializedItemInvoiceIds = new Set<string>()
  let stopped = false

  const confirmedInvoiceIds = () => new Set(salesInvoices.filter((invoice) => invoice.status === 'CONFIRMED').map((invoice) => invoice.id))

  const emit = () => {
    if (stopped || initialized.size !== 4) return
    const activeInvoiceIds = confirmedInvoiceIds()
    // Do not show incomplete leaderboards while a new invoice's items are still arriving.
    if ([...activeInvoiceIds].some((invoiceId) => !initializedItemInvoiceIds.has(invoiceId))) return
    onData({
      salesInvoices,
      purchaseInvoices,
      payments,
      products,
      salesItems: [...activeInvoiceIds].flatMap((invoiceId) => salesItemsByInvoice.get(invoiceId) ?? []),
    })
  }

  const synchronizeSalesItemSubscriptions = () => {
    const activeInvoiceIds = confirmedInvoiceIds()
    for (const [invoiceId, unsubscribe] of itemUnsubscribers) {
      if (activeInvoiceIds.has(invoiceId)) continue
      unsubscribe()
      itemUnsubscribers.delete(invoiceId)
      salesItemsByInvoice.delete(invoiceId)
      initializedItemInvoiceIds.delete(invoiceId)
    }

    for (const invoiceId of activeInvoiceIds) {
      if (itemUnsubscribers.has(invoiceId)) continue
      const itemReference = collection(doc(salesReference, invoiceId), 'items')
      const unsubscribe = onSnapshot(
        itemReference,
        (snapshot) => {
          salesItemsByInvoice.set(invoiceId, snapshot.docs.map((item) => toDashboardSalesItem(invoiceId, item.id, item.data())))
          initializedItemInvoiceIds.add(invoiceId)
          emit()
        },
        (error) => onError(error),
      )
      itemUnsubscribers.set(invoiceId, unsubscribe)
    }
  }

  const unsubscribeSales = onSnapshot(
    salesReference,
    (snapshot) => {
      salesInvoices = snapshot.docs.map((invoice) => toDashboardInvoice(invoice.id, 'SALE', invoice.data()))
      initialized.add('sales')
      synchronizeSalesItemSubscriptions()
      emit()
    },
    (error) => onError(error),
  )
  const unsubscribePurchases = onSnapshot(
    purchasesReference,
    (snapshot) => {
      purchaseInvoices = snapshot.docs.map((invoice) => toDashboardInvoice(invoice.id, 'PURCHASE', invoice.data()))
      initialized.add('purchases')
      emit()
    },
    (error) => onError(error),
  )
  const unsubscribePayments = onSnapshot(
    paymentsReference,
    (snapshot) => {
      payments = snapshot.docs.map((payment) => toDashboardPayment(payment.id, payment.data()))
      initialized.add('payments')
      emit()
    },
    (error) => onError(error),
  )
  const unsubscribeProducts = onSnapshot(
    productsReference,
    (snapshot) => {
      products = snapshot.docs.map((product) => toDashboardProduct(product.id, product.data()))
      initialized.add('products')
      emit()
    },
    (error) => onError(error),
  )

  return () => {
    stopped = true
    unsubscribeSales()
    unsubscribePurchases()
    unsubscribePayments()
    unsubscribeProducts()
    itemUnsubscribers.forEach((unsubscribe) => unsubscribe())
    itemUnsubscribers.clear()
    salesItemsByInvoice.clear()
  }
}
