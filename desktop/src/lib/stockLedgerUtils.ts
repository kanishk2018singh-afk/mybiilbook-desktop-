import type { StockLedgerEntry, StockLedgerTotals, StockTransaction, StockTransactionType } from '../types/stock'

const STOCK_PRECISION = 1000

export function roundStock(value: number): number {
  return Math.round((value + Number.EPSILON) * STOCK_PRECISION) / STOCK_PRECISION
}

export function stockTransactionTypeLabel(type: StockTransactionType): string {
  const labels: Record<StockTransactionType, string> = {
    OPENING: 'Opening stock',
    PURCHASE: 'Purchase',
    SALE: 'Sale',
    SALE_RETURN: 'Sales return',
    PURCHASE_RETURN: 'Purchase return',
    ADJUSTMENT_IN: 'Adjustment in',
    ADJUSTMENT_OUT: 'Adjustment out',
    DAMAGE: 'Damage',
    OTHER: 'Other movement',
  }
  return labels[type]
}

/** Return a stable ascending order for the stock passbook. */
export function chronologicalStockTransactions(transactions: StockTransaction[]): StockTransaction[] {
  return [...transactions].sort((left, right) => (
    left.createdAtMillis - right.createdAtMillis
    || left.createdAt.localeCompare(right.createdAt)
    || left.id.localeCompare(right.id)
  ))
}

/**
 * Builds a bank-passbook-style stock balance from movement fields, rather than
 * trusting a row's stored `balanceAfter`. This detects historical/migrated
 * ledger gaps while preserving `balanceAfter` as a separate audit value.
 */
export function buildStockLedger(transactions: StockTransaction[]): StockLedgerEntry[] {
  let runningBalanceQty = 0
  return chronologicalStockTransactions(transactions).map((transaction) => {
    runningBalanceQty = roundStock(runningBalanceQty + transaction.quantityDelta)
    return { ...transaction, runningBalanceQty }
  })
}

/**
 * Presents the explicit inventory formula used by the report:
 * Opening + Purchase + Sales Return − Sales − Purchase Return
 * + Adjustment In − Adjustment Out − Damage + other movements.
 */
export function summarizeStockLedger(entries: StockLedgerEntry[]): StockLedgerTotals {
  const totals: StockLedgerTotals = {
    opening: 0,
    purchase: 0,
    saleReturn: 0,
    sale: 0,
    purchaseReturn: 0,
    adjustmentIn: 0,
    adjustmentOut: 0,
    damage: 0,
    otherDelta: 0,
    totalIn: 0,
    totalOut: 0,
    calculatedCurrentStock: 0,
  }

  entries.forEach((entry) => {
    totals.totalIn = roundStock(totals.totalIn + entry.quantityIn)
    totals.totalOut = roundStock(totals.totalOut + entry.quantityOut)
    switch (entry.type) {
      case 'OPENING':
        totals.opening = roundStock(totals.opening + entry.quantityDelta)
        break
      case 'PURCHASE':
        totals.purchase = roundStock(totals.purchase + entry.quantityIn)
        break
      case 'SALE_RETURN':
        totals.saleReturn = roundStock(totals.saleReturn + entry.quantityIn)
        break
      case 'SALE':
        totals.sale = roundStock(totals.sale + entry.quantityOut)
        break
      case 'PURCHASE_RETURN':
        totals.purchaseReturn = roundStock(totals.purchaseReturn + entry.quantityOut)
        break
      case 'ADJUSTMENT_IN':
        totals.adjustmentIn = roundStock(totals.adjustmentIn + entry.quantityIn)
        break
      case 'ADJUSTMENT_OUT':
        totals.adjustmentOut = roundStock(totals.adjustmentOut + entry.quantityOut)
        break
      case 'DAMAGE':
        totals.damage = roundStock(totals.damage + entry.quantityOut)
        break
      case 'OTHER':
        totals.otherDelta = roundStock(totals.otherDelta + entry.quantityDelta)
        break
      default:
        break
    }
  })

  totals.calculatedCurrentStock = roundStock(
    totals.opening
    + totals.purchase
    + totals.saleReturn
    - totals.sale
    - totals.purchaseReturn
    + totals.adjustmentIn
    - totals.adjustmentOut
    - totals.damage
    + totals.otherDelta,
  )
  return totals
}

export function stockDirection(type: StockTransactionType, quantityDelta: number): 'IN' | 'OUT' | 'NEUTRAL' {
  if (quantityDelta > 0) return 'IN'
  if (quantityDelta < 0) return 'OUT'
  if (type === 'DAMAGE' || type === 'SALE' || type === 'PURCHASE_RETURN' || type === 'ADJUSTMENT_OUT') return 'OUT'
  if (type === 'OPENING' || type === 'PURCHASE' || type === 'SALE_RETURN' || type === 'ADJUSTMENT_IN') return 'IN'
  return 'NEUTRAL'
}
