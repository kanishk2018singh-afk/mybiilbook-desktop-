import { roundMoney } from './salesInvoiceTotals'
import type { InvoiceItemSnapshot } from '../types/invoice'
import type { ReturnNoteLineInput, ReturnNoteLineTotals, ReturnNoteTotals } from '../types/returnNote'

const QUANTITY_PRECISION = 1000

export function roundQuantity(value: number): number {
  return Math.round((value + Number.EPSILON) * QUANTITY_PRECISION) / QUANTITY_PRECISION
}

export interface ReturnSourceLine extends InvoiceItemSnapshot {
  /** The immutable invoice item document ID. */
  id: string
}

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * Pro-rates posted item snapshots for the quantity being returned. This is
 * intentionally based on `taxableAfterBillDiscount` and the saved GST amounts,
 * not today's product price/tax configuration, so the return stays tied to the
 * original invoice's immutable accounting values.
 */
export function calculateReturnNoteTotals(
  sourceItems: ReturnSourceLine[],
  requestedLines: ReturnNoteLineInput[],
): ReturnNoteTotals {
  const requestedBySourceItem = new Map<string, number>()
  requestedLines.forEach((line) => {
    if (!line.sourceInvoiceItemId || !Number.isFinite(line.qty) || line.qty <= 0) return
    requestedBySourceItem.set(line.sourceInvoiceItemId, roundQuantity((requestedBySourceItem.get(line.sourceInvoiceItemId) ?? 0) + line.qty))
  })

  const lineTotals: ReturnNoteLineTotals[] = sourceItems.flatMap((item) => {
    const returnedQty = requestedBySourceItem.get(item.id) ?? 0
    const sourceQty = safeNumber(item.qty)
    if (returnedQty <= 0 || sourceQty <= 0) return []

    const fraction = returnedQty / sourceQty
    const scale = (amount: number) => roundMoney(safeNumber(amount) * fraction)
    const grossAmount = scale(item.grossAmount)
    const discountAmount = scale(item.discountAmount)
    const taxableAmount = scale(item.taxableAmount)
    const billDiscountAmount = scale(item.billDiscountAmount)
    const taxableAfterBillDiscount = scale(item.taxableAfterBillDiscount)
    const cgstAmount = scale(item.cgstAmount)
    const sgstAmount = scale(item.sgstAmount)
    const igstAmount = scale(item.igstAmount)

    return [{
      sourceInvoiceItemId: item.id,
      productId: item.productId,
      name: item.name,
      code: item.code,
      hsn: item.hsn,
      unit: item.unit,
      sourceInvoiceQty: sourceQty,
      returnedQty: roundQuantity(returnedQty),
      rate: item.rate,
      discountPercent: item.discountPercent,
      gstPercent: item.gstPercent,
      grossAmount,
      discountAmount,
      taxableAmount,
      billDiscountAmount,
      taxableAfterBillDiscount,
      cgstAmount,
      sgstAmount,
      igstAmount,
      lineTotal: roundMoney(taxableAfterBillDiscount + cgstAmount + sgstAmount + igstAmount),
    }]
  })

  const subtotal = roundMoney(lineTotals.reduce((total, line) => total + line.grossAmount, 0))
  const lineDiscountAmount = roundMoney(lineTotals.reduce((total, line) => total + line.discountAmount, 0))
  const taxableBeforeBillDiscount = roundMoney(lineTotals.reduce((total, line) => total + line.taxableAmount, 0))
  const billDiscount = roundMoney(lineTotals.reduce((total, line) => total + line.billDiscountAmount, 0))
  const taxableAmount = roundMoney(lineTotals.reduce((total, line) => total + line.taxableAfterBillDiscount, 0))
  const cgstAmount = roundMoney(lineTotals.reduce((total, line) => total + line.cgstAmount, 0))
  const sgstAmount = roundMoney(lineTotals.reduce((total, line) => total + line.sgstAmount, 0))
  const igstAmount = roundMoney(lineTotals.reduce((total, line) => total + line.igstAmount, 0))
  const totalTax = roundMoney(cgstAmount + sgstAmount + igstAmount)
  const beforeRoundOff = roundMoney(taxableAmount + totalTax)
  const grandTotal = Math.round(beforeRoundOff)

  return {
    lineTotals,
    totalQty: roundQuantity(lineTotals.reduce((total, line) => total + line.returnedQty, 0)),
    subtotal,
    lineDiscountAmount,
    taxableBeforeBillDiscount,
    billDiscount,
    taxableAmount,
    cgstAmount,
    sgstAmount,
    igstAmount,
    totalTax,
    beforeRoundOff,
    roundOff: roundMoney(grandTotal - beforeRoundOff),
    grandTotal,
  }
}

export function returnStockDelta(kind: 'CREDIT' | 'DEBIT', quantity: number): number {
  return kind === 'CREDIT' ? quantity : -quantity
}
