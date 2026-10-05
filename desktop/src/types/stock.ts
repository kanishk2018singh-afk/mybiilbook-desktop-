export const STOCK_TRANSACTION_TYPES = [
  'OPENING',
  'PURCHASE',
  'SALE',
  'SALE_RETURN',
  'PURCHASE_RETURN',
  'ADJUSTMENT_IN',
  'ADJUSTMENT_OUT',
  'DAMAGE',
  'OTHER',
] as const

export type StockTransactionType = (typeof STOCK_TRANSACTION_TYPES)[number]

/** Normalized, business-scoped stock ledger row read from Firestore. */
export interface StockTransaction {
  id: string
  productId: string
  productName: string
  type: StockTransactionType
  quantityIn: number
  quantityOut: number
  /** Always `quantityIn - quantityOut`, rounded to three stock decimals. */
  quantityDelta: number
  /** Audit value written by the posting transaction, if the legacy row has it. */
  balanceAfter: number | null
  referenceType: string
  referenceId: string
  referenceNumber: string
  reason: string
  note: string
  createdAt: string
  createdAtMillis: number
  createdBy: string
}

export interface StockAdjustmentInput {
  productId: string
  /** Positive means stock-in; negative means stock-out. Zero is never valid. */
  adjustmentQty: number
  reason: string
  note: string
}

export interface CreatedStockAdjustment {
  id: string
  productId: string
  type: 'ADJUSTMENT_IN' | 'ADJUSTMENT_OUT'
  quantityIn: number
  quantityOut: number
  balanceAfter: number
}

export interface StockLedgerEntry extends StockTransaction {
  /** Calculated in chronological order from every visible ledger movement. */
  runningBalanceQty: number
}

export interface StockLedgerTotals {
  opening: number
  purchase: number
  saleReturn: number
  sale: number
  purchaseReturn: number
  adjustmentIn: number
  adjustmentOut: number
  damage: number
  otherDelta: number
  totalIn: number
  totalOut: number
  calculatedCurrentStock: number
}
