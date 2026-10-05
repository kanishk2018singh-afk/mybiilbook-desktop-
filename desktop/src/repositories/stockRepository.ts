import {
  collection,
  doc,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  where,
  type DocumentData,
  type Unsubscribe,
} from 'firebase/firestore'
import { requireFirestore } from '../lib/firebase'
import { getBusinessPath } from '../lib/firestorePaths'
import { roundStock } from '../lib/stockLedgerUtils'
import type {
  CreatedStockAdjustment,
  StockAdjustmentInput,
  StockTransaction,
  StockTransactionType,
} from '../types/stock'

const QUANTITY_EPSILON = 0.000001

export type StockAdjustmentErrorCode =
  | 'PRODUCT_REQUIRED'
  | 'PRODUCT_NOT_FOUND'
  | 'QUANTITY_INVALID'
  | 'REASON_REQUIRED'
  | 'INSUFFICIENT_STOCK'

export class StockAdjustmentError extends Error {
  constructor(
    public readonly code: StockAdjustmentErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'StockAdjustmentError'
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numeric(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function nonNegative(value: unknown): number {
  return Math.max(0, numeric(value))
}

function normalizeType(value: unknown): StockTransactionType {
  const candidate = text(value).toUpperCase().replaceAll('-', '_').replaceAll(' ', '_')
  if (candidate === 'OPENING' || candidate === 'PURCHASE' || candidate === 'SALE' || candidate === 'SALE_RETURN' || candidate === 'PURCHASE_RETURN' || candidate === 'ADJUSTMENT_IN' || candidate === 'ADJUSTMENT_OUT' || candidate === 'DAMAGE') {
    return candidate
  }
  // A few legacy records use plural/expanded spelling.
  if (candidate === 'SALES_RETURN') return 'SALE_RETURN'
  if (candidate === 'DAMAGE_OUT' || candidate === 'DAMAGED') return 'DAMAGE'
  return 'OTHER'
}

function timestampInfo(value: unknown): { text: string; millis: number } {
  if (typeof value === 'string') {
    const candidate = value.trim()
    const parsed = Date.parse(candidate)
    return { text: candidate, millis: Number.isNaN(parsed) ? 0 : parsed }
  }
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    const converted = value.toDate()
    if (converted instanceof Date && !Number.isNaN(converted.valueOf())) {
      return { text: converted.toISOString(), millis: converted.valueOf() }
    }
  }
  return { text: '', millis: 0 }
}

function fallbackMovement(type: StockTransactionType, data: DocumentData): { quantityIn: number; quantityOut: number } {
  const rawQuantity = numeric(data.quantity, numeric(data.qty, numeric(data.adjustmentQty)))
  const magnitude = Math.abs(rawQuantity)
  if (!magnitude) return { quantityIn: 0, quantityOut: 0 }
  if (rawQuantity < 0 || type === 'SALE' || type === 'PURCHASE_RETURN' || type === 'ADJUSTMENT_OUT' || type === 'DAMAGE') {
    return { quantityIn: 0, quantityOut: magnitude }
  }
  return { quantityIn: magnitude, quantityOut: 0 }
}

function movement(type: StockTransactionType, data: DocumentData): { quantityIn: number; quantityOut: number } {
  let quantityIn = nonNegative(data.quantityIn)
  let quantityOut = nonNegative(data.quantityOut)
  if (!quantityIn && !quantityOut) return fallbackMovement(type, data)

  // Damage is always an inventory-out event. Older imported rows occasionally
  // had its magnitude under quantityIn; render it according to the ledger
  // formula rather than making damage look like stock received.
  if (type === 'DAMAGE' && quantityIn > 0 && !quantityOut) {
    quantityOut = quantityIn
    quantityIn = 0
  }
  return { quantityIn, quantityOut }
}

function toStockTransaction(id: string, data: DocumentData): StockTransaction {
  const type = normalizeType(data.type)
  const quantities = movement(type, data)
  const timestamp = timestampInfo(data.createdAt ?? data.transactionDate ?? data.date)
  const balanceAfter = typeof data.balanceAfter === 'number' && Number.isFinite(data.balanceAfter)
    ? data.balanceAfter
    : null

  return {
    id,
    productId: text(data.productId),
    productName: text(data.productName) || 'Unnamed product',
    type,
    quantityIn: roundStock(quantities.quantityIn),
    quantityOut: roundStock(quantities.quantityOut),
    quantityDelta: roundStock(quantities.quantityIn - quantities.quantityOut),
    balanceAfter,
    referenceType: text(data.referenceType),
    referenceId: text(data.referenceId),
    referenceNumber: text(data.noteNumber)
      || text(data.invoiceNumber)
      || text(data.documentNumber)
      || text(data.referenceNumber)
      || text(data.supplierInvoiceNumber),
    reason: text(data.reason) || text(data.adjustmentReason) || text(data.cancellationReason),
    note: text(data.note) || text(data.notes) || text(data.cancellationReason),
    createdAt: timestamp.text,
    createdAtMillis: timestamp.millis,
    createdBy: text(data.createdBy),
  }
}

function productReference(uid: string, businessId: string, productId: string) {
  return doc(requireFirestore(), getBusinessPath(uid, businessId, 'products'), productId)
}

/** Live product-scoped stock ledger subscription. Sorting remains client-side to avoid extra indexes. */
export function subscribeToStockTransactions(
  uid: string,
  businessId: string,
  productId: string,
  onTransactions: (transactions: StockTransaction[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  if (!productId.trim()) {
    onTransactions([])
    return () => undefined
  }
  const database = requireFirestore()
  return onSnapshot(
    query(
      collection(database, getBusinessPath(uid, businessId, 'stockTransactions')),
      where('productId', '==', productId),
    ),
    (snapshot) => onTransactions(snapshot.docs.map((entry) => toStockTransaction(entry.id, entry.data()))),
    (error) => onError(error),
  )
}

/**
 * Records an inventory correction in one transaction. Reading and updating the
 * product plus writing the ADJUSTMENT ledger row together guarantees that stock
 * cannot change without its audit entry (or vice versa), including under
 * concurrent sale/purchase/return activity.
 */
export async function createStockAdjustment(
  uid: string,
  businessId: string,
  input: StockAdjustmentInput,
): Promise<CreatedStockAdjustment> {
  const productId = input.productId.trim()
  const reason = input.reason.trim()
  const adjustmentQty = roundStock(input.adjustmentQty)
  if (!productId) {
    throw new StockAdjustmentError('PRODUCT_REQUIRED', 'Select a product before saving the stock adjustment.')
  }
  if (!Number.isFinite(input.adjustmentQty) || Math.abs(adjustmentQty) <= QUANTITY_EPSILON) {
    throw new StockAdjustmentError('QUANTITY_INVALID', 'Enter a non-zero adjustment quantity. Use + for stock-in and − for stock-out.')
  }
  if (!reason) {
    throw new StockAdjustmentError('REASON_REQUIRED', 'Enter a reason for this stock adjustment.')
  }

  const database = requireFirestore()
  const productRef = productReference(uid, businessId, productId)
  const stockTransactionRef = doc(collection(database, getBusinessPath(uid, businessId, 'stockTransactions')))

  return runTransaction(database, async (transaction) => {
    const productSnapshot = await transaction.get(productRef)
    if (!productSnapshot.exists()) {
      throw new StockAdjustmentError('PRODUCT_NOT_FOUND', 'The selected product no longer exists. Reload and try again.')
    }

    const product = productSnapshot.data()
    const currentStockQty = numeric(product.stockQty)
    const isStockIn = adjustmentQty > 0
    const quantityIn = isStockIn ? adjustmentQty : 0
    const quantityOut = isStockIn ? 0 : Math.abs(adjustmentQty)
    if (!isStockIn && currentStockQty + QUANTITY_EPSILON < quantityOut) {
      throw new StockAdjustmentError(
        'INSUFFICIENT_STOCK',
        `Cannot remove ${quantityOut} because ${text(product.name) || 'this product'} has only ${currentStockQty} in stock.`,
      )
    }

    const balanceAfter = roundStock(currentStockQty + adjustmentQty)
    const type: 'ADJUSTMENT_IN' | 'ADJUSTMENT_OUT' = isStockIn ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT'

    transaction.update(productRef, {
      stockQty: balanceAfter,
      updatedAt: serverTimestamp(),
    })
    transaction.set(stockTransactionRef, {
      productId,
      productName: text(product.name) || 'Unnamed product',
      type,
      quantityIn,
      quantityOut,
      adjustmentQty,
      balanceAfter,
      referenceType: 'STOCK_ADJUSTMENT',
      referenceId: stockTransactionRef.id,
      reason,
      note: input.note.trim(),
      createdAt: serverTimestamp(),
      createdBy: uid,
    })

    return {
      id: stockTransactionRef.id,
      productId,
      type,
      quantityIn,
      quantityOut,
      balanceAfter,
    }
  })
}
