export type PaymentStatus = 'PAID' | 'PARTIAL' | 'UNPAID'
export type PaymentMode = 'CASH' | 'UPI' | 'CARD' | 'BANK' | 'CHEQUE' | 'OTHER'

/**
 * A client-side draft and the immutable invoice-item snapshot share these fields.
 * Product master values are copied here at selection time; invoices must never
 * depend on future edits to a product's name, rate, or tax rate.
 */
export interface SalesInvoiceLine {
  id: string
  productId: string
  name: string
  code: string
  hsn: string
  unit: string
  qty: number
  rate: number
  discountPercent: number
  gstPercent: number
}

export interface SalesInvoiceLineTotals {
  grossAmount: number
  discountAmount: number
  taxableAmount: number
  billDiscountAmount: number
  taxableAfterBillDiscount: number
  cgstAmount: number
  sgstAmount: number
  igstAmount: number
  lineTotal: number
}

export interface SalesInvoiceTotals {
  lineTotals: SalesInvoiceLineTotals[]
  subtotal: number
  lineDiscountAmount: number
  taxableBeforeBillDiscount: number
  billDiscount: number
  taxableAmount: number
  cgstAmount: number
  sgstAmount: number
  igstAmount: number
  totalTax: number
  beforeRoundOff: number
  roundOff: number
  grandTotal: number
  paidAmount: number
  balanceAmount: number
  paymentStatus: PaymentStatus
  totalQty: number
  isInterState: boolean
}

export interface SalesInvoicePartySnapshot {
  partyId: string
  partyName: string
  partyPhone: string
  partyGstin: string
  partyAddress: string
  partyState: string
  partyStateCode: string
}

export interface CreateSalesInvoiceInput extends SalesInvoicePartySnapshot {
  invoiceDate: string
  businessStateCode: string
  businessState: string
  lines: SalesInvoiceLine[]
  billDiscount: number
  paidAmount: number
  paymentMode: PaymentMode
}

export interface CreatedSalesInvoice {
  id: string
  number: string
  grandTotal: number
  balanceAmount: number
  paymentStatus: PaymentStatus
}
