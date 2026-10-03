import type {
  PaymentStatus,
  SalesInvoiceLine,
  SalesInvoiceLineTotals,
  SalesInvoiceTotals,
} from '../types/salesInvoice'

const MONEY_PRECISION = 100

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * MONEY_PRECISION) / MONEY_PRECISION
}

export function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0))
}

function nonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0
}

/**
 * GSTINs begin with the two-digit GST state code. This fallback lets the sales
 * screen determine tax treatment for older Party/Business documents that have
 * not yet been migrated to an explicit `stateCode` field.
 */
export function stateCodeFromGstin(gstin: string | undefined): string {
  const match = (gstin ?? '').trim().toUpperCase().match(/^(\d{2})[A-Z0-9]{13}$/)
  return match?.[1] ?? ''
}

/** Normalizes either a two-digit state code or an empty/missing value. */
export function normalizeStateCode(value: string | undefined): string {
  const candidate = (value ?? '').trim()
  return /^\d{2}$/.test(candidate) ? candidate : ''
}

export interface TaxJurisdiction {
  businessStateCode: string
  partyStateCode: string
  /** False means neither side supplied a reliably comparable GST state code. */
  isResolved: boolean
  isInterState: boolean
}

/**
 * GST treatment is determined by the business and party GST state codes. A
 * differing code means IGST; matching codes mean the GST is split into CGST
 * and SGST. When legacy data has no usable code on either side, we retain the
 * domestic same-state fallback and flag it as unresolved for the UI.
 */
export function resolveTaxJurisdiction(
  businessStateCode: string | undefined,
  partyStateCode: string | undefined,
): TaxJurisdiction {
  const business = normalizeStateCode(businessStateCode)
  const party = normalizeStateCode(partyStateCode)
  const isResolved = Boolean(business && party)
  return {
    businessStateCode: business,
    partyStateCode: party,
    isResolved,
    isInterState: isResolved ? business !== party : false,
  }
}

function paymentStatus(grandTotal: number, paidAmount: number): PaymentStatus {
  if (grandTotal <= 0.005 || paidAmount >= grandTotal - 0.005) return 'PAID'
  return paidAmount > 0.005 ? 'PARTIAL' : 'UNPAID'
}

/**
 * Calculates the invoice from immutable line snapshots. Line discount is
 * applied first. The optional bill discount is then allocated pro-rata across
 * line taxable amounts before GST, which keeps GST and item totals auditable.
 */
export function calculateSalesInvoiceTotals(
  lines: SalesInvoiceLine[],
  billDiscountInput: number,
  paidAmountInput: number,
  isInterState: boolean,
): SalesInvoiceTotals {
  const preliminary = lines.map((line) => {
    const qty = nonNegative(line.qty)
    const rate = nonNegative(line.rate)
    const grossAmount = roundMoney(qty * rate)
    const discountAmount = roundMoney(grossAmount * (clampPercent(line.discountPercent) / 100))
    const taxableAmount = roundMoney(grossAmount - discountAmount)
    return { grossAmount, discountAmount, taxableAmount }
  })

  const subtotal = roundMoney(preliminary.reduce((total, line) => total + line.grossAmount, 0))
  const lineDiscountAmount = roundMoney(preliminary.reduce((total, line) => total + line.discountAmount, 0))
  const taxableBeforeBillDiscount = roundMoney(preliminary.reduce((total, line) => total + line.taxableAmount, 0))
  const billDiscount = roundMoney(Math.min(nonNegative(billDiscountInput), taxableBeforeBillDiscount))

  let allocatedBillDiscount = 0
  const lineTotals: SalesInvoiceLineTotals[] = preliminary.map((line, index) => {
    // Give the final line any one-paise allocation remainder so the summary
    // always equals the sum of saved item snapshots.
    const billDiscountAmount = index === preliminary.length - 1
      ? roundMoney(billDiscount - allocatedBillDiscount)
      : roundMoney(taxableBeforeBillDiscount > 0 ? billDiscount * (line.taxableAmount / taxableBeforeBillDiscount) : 0)
    allocatedBillDiscount = roundMoney(allocatedBillDiscount + billDiscountAmount)
    const taxableAfterBillDiscount = roundMoney(line.taxableAmount - billDiscountAmount)
    const gstPercent = clampPercent(lines[index]?.gstPercent ?? 0)
    const tax = roundMoney(taxableAfterBillDiscount * (gstPercent / 100))
    const cgstAmount = isInterState ? 0 : roundMoney(tax / 2)
    const sgstAmount = isInterState ? 0 : roundMoney(tax - cgstAmount)
    const igstAmount = isInterState ? tax : 0
    return {
      ...line,
      billDiscountAmount,
      taxableAfterBillDiscount,
      cgstAmount,
      sgstAmount,
      igstAmount,
      lineTotal: roundMoney(taxableAfterBillDiscount + tax),
    }
  })

  const taxableAmount = roundMoney(lineTotals.reduce((total, line) => total + line.taxableAfterBillDiscount, 0))
  const cgstAmount = roundMoney(lineTotals.reduce((total, line) => total + line.cgstAmount, 0))
  const sgstAmount = roundMoney(lineTotals.reduce((total, line) => total + line.sgstAmount, 0))
  const igstAmount = roundMoney(lineTotals.reduce((total, line) => total + line.igstAmount, 0))
  const totalTax = roundMoney(cgstAmount + sgstAmount + igstAmount)
  const beforeRoundOff = roundMoney(taxableAmount + totalTax)
  const grandTotal = Math.round(beforeRoundOff)
  const roundOff = roundMoney(grandTotal - beforeRoundOff)
  const paidAmount = roundMoney(Math.min(nonNegative(paidAmountInput), grandTotal))
  const balanceAmount = roundMoney(Math.max(0, grandTotal - paidAmount))

  return {
    lineTotals,
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
    roundOff,
    grandTotal,
    paidAmount,
    balanceAmount,
    paymentStatus: paymentStatus(grandTotal, paidAmount),
    totalQty: roundMoney(lines.reduce((total, line) => total + nonNegative(line.qty), 0)),
    isInterState,
  }
}
