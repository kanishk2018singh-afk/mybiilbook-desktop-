import { describe, expect, it } from 'vitest'
import { calculateReturnNoteTotals, returnStockDelta } from './returnNoteUtils'
import type { InvoiceItemSnapshot } from '../types/invoice'

const item: InvoiceItemSnapshot = {
  id: 'line-1',
  productId: 'product-1',
  name: 'Widget',
  code: 'W-1',
  hsn: '1234',
  unit: 'pcs',
  qty: 4,
  rate: 100,
  discountPercent: 10,
  gstPercent: 18,
  grossAmount: 400,
  discountAmount: 40,
  taxableAmount: 360,
  billDiscountAmount: 20,
  taxableAfterBillDiscount: 340,
  cgstAmount: 30.6,
  sgstAmount: 30.6,
  igstAmount: 0,
  lineTotal: 401.2,
}

describe('return note totals', () => {
  it('uses immutable posted values and pro-rates every tax component for a partial return', () => {
    const totals = calculateReturnNoteTotals([item], [{ sourceInvoiceItemId: 'line-1', qty: 2 }])

    expect(totals.lineTotals).toHaveLength(1)
    expect(totals.lineTotals[0]).toMatchObject({
      sourceInvoiceItemId: 'line-1',
      sourceInvoiceQty: 4,
      returnedQty: 2,
      grossAmount: 200,
      discountAmount: 20,
      taxableAmount: 180,
      billDiscountAmount: 10,
      taxableAfterBillDiscount: 170,
      cgstAmount: 15.3,
      sgstAmount: 15.3,
      lineTotal: 200.6,
    })
    expect(totals).toMatchObject({
      totalQty: 2,
      taxableAmount: 170,
      totalTax: 30.6,
      beforeRoundOff: 200.6,
      grandTotal: 201,
      roundOff: 0.4,
    })
  })

  it('ignores zero/unknown requested lines and uses exact return stock directions', () => {
    const totals = calculateReturnNoteTotals([item], [
      { sourceInvoiceItemId: 'line-1', qty: 0 },
      { sourceInvoiceItemId: 'not-a-line', qty: 3 },
    ])

    expect(totals.lineTotals).toEqual([])
    expect(totals.grandTotal).toBe(0)
    expect(returnStockDelta('CREDIT', 3)).toBe(3)
    expect(returnStockDelta('DEBIT', 3)).toBe(-3)
  })
})
