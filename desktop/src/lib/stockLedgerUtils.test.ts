import { describe, expect, it } from 'vitest'
import { buildStockLedger, chronologicalStockTransactions, stockDirection, summarizeStockLedger } from './stockLedgerUtils'
import type { StockTransaction } from '../types/stock'

function entry(
  id: string,
  type: StockTransaction['type'],
  quantityIn: number,
  quantityOut: number,
  createdAtMillis: number,
): StockTransaction {
  return {
    id,
    productId: 'product-1',
    productName: 'Demo product',
    type,
    quantityIn,
    quantityOut,
    quantityDelta: quantityIn - quantityOut,
    balanceAfter: null,
    referenceType: '',
    referenceId: '',
    referenceNumber: '',
    reason: '',
    note: '',
    createdAt: `2026-10-0${createdAtMillis}T09:00:00.000Z`,
    createdAtMillis,
    createdBy: '',
  }
}

describe('stock ledger helpers', () => {
  it('sorts chronologically and calculates the passbook balance from every movement', () => {
    const ledger = buildStockLedger([
      entry('sale', 'SALE', 0, 4, 4),
      entry('opening', 'OPENING', 10, 0, 1),
      entry('purchase', 'PURCHASE', 5, 0, 2),
      entry('sales-return', 'SALE_RETURN', 2, 0, 3),
      entry('purchase-return', 'PURCHASE_RETURN', 0, 1, 5),
      entry('adjustment-in', 'ADJUSTMENT_IN', 3, 0, 6),
      entry('adjustment-out', 'ADJUSTMENT_OUT', 0, 2, 7),
      entry('damage', 'DAMAGE', 0, 1, 8),
    ])

    expect(ledger.map((row) => row.id)).toEqual([
      'opening', 'purchase', 'sales-return', 'sale', 'purchase-return', 'adjustment-in', 'adjustment-out', 'damage',
    ])
    expect(ledger.map((row) => row.runningBalanceQty)).toEqual([10, 15, 17, 13, 12, 15, 13, 12])

    const totals = summarizeStockLedger(ledger)
    expect(totals).toMatchObject({
      opening: 10,
      purchase: 5,
      saleReturn: 2,
      sale: 4,
      purchaseReturn: 1,
      adjustmentIn: 3,
      adjustmentOut: 2,
      damage: 1,
      calculatedCurrentStock: 12,
      totalIn: 20,
      totalOut: 8,
    })
  })

  it('keeps stable chronological ordering and direction labels', () => {
    const ordered = chronologicalStockTransactions([
      entry('b', 'PURCHASE', 2, 0, 1),
      entry('a', 'OPENING', 1, 0, 1),
    ])
    expect(ordered.map((row) => row.id)).toEqual(['a', 'b'])
    expect(stockDirection('ADJUSTMENT_IN', 1)).toBe('IN')
    expect(stockDirection('DAMAGE', -1)).toBe('OUT')
    expect(stockDirection('OTHER', 0)).toBe('NEUTRAL')
  })
})
