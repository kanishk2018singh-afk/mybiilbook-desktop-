import { describe, expect, it } from 'vitest'
import {
  calculateSalesInvoiceTotals,
  resolveTaxJurisdiction,
  stateCodeFromGstin,
} from './salesInvoiceTotals'
import type { SalesInvoiceLine } from '../types/salesInvoice'

const lines: SalesInvoiceLine[] = [
  {
    id: 'line-1',
    productId: 'product-1',
    name: 'Wall mixer',
    code: 'WM-1',
    hsn: '8481',
    unit: 'PCS',
    qty: 2,
    rate: 100,
    discountPercent: 10,
    gstPercent: 18,
  },
]

describe('sales invoice totals', () => {
  it('calculates same-state taxable value, split CGST/SGST, round-off, and partial balance', () => {
    const totals = calculateSalesInvoiceTotals(lines, 0, 100, false)

    expect(totals.lineTotals[0]).toMatchObject({
      grossAmount: 200,
      discountAmount: 20,
      taxableAmount: 180,
      cgstAmount: 16.2,
      sgstAmount: 16.2,
      igstAmount: 0,
      lineTotal: 212.4,
    })
    expect(totals).toMatchObject({
      subtotal: 200,
      taxableAmount: 180,
      cgstAmount: 16.2,
      sgstAmount: 16.2,
      igstAmount: 0,
      beforeRoundOff: 212.4,
      roundOff: -0.4,
      grandTotal: 212,
      paidAmount: 100,
      balanceAmount: 112,
      paymentStatus: 'PARTIAL',
    })
  })

  it('allocates bill discount before interstate IGST and reports paid status', () => {
    const totals = calculateSalesInvoiceTotals(lines, 30, 999, true)

    expect(totals.lineTotals[0]).toMatchObject({
      billDiscountAmount: 30,
      taxableAfterBillDiscount: 150,
      cgstAmount: 0,
      sgstAmount: 0,
      igstAmount: 27,
      lineTotal: 177,
    })
    expect(totals).toMatchObject({
      billDiscount: 30,
      taxableAmount: 150,
      igstAmount: 27,
      grandTotal: 177,
      paidAmount: 177,
      balanceAmount: 0,
      paymentStatus: 'PAID',
    })
  })

  it('reports an unpaid balance when no receipt is recorded', () => {
    const totals = calculateSalesInvoiceTotals(lines, 0, 0, false)
    expect(totals).toMatchObject({ paymentStatus: 'UNPAID', balanceAmount: 212 })
  })

  it('uses GST state codes to choose IGST and accepts GSTIN state-code fallback', () => {
    expect(stateCodeFromGstin('08ABCDE1234F1Z5')).toBe('08')
    expect(resolveTaxJurisdiction('08', '08')).toMatchObject({ isResolved: true, isInterState: false })
    expect(resolveTaxJurisdiction('08', '27')).toMatchObject({ isResolved: true, isInterState: true })
    expect(resolveTaxJurisdiction('', '')).toMatchObject({ isResolved: false, isInterState: false })
  })
})
