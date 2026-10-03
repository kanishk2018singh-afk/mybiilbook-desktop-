import type { PaymentStatus, SalesInvoiceLine } from './salesInvoice'

export type InvoiceKind = 'SALE' | 'PURCHASE'
export type InvoiceStatus = 'DRAFT' | 'CONFIRMED' | 'CANCELLED'

/**
 * A compact, normalized invoice header used by the invoice registers. Product
 * and party master records are intentionally not joined here: invoices retain
 * their own immutable snapshots.
 */
export interface InvoiceListItem {
  id: string
  kind: InvoiceKind
  number: string
  date: string
  partyId: string
  partyName: string
  grandTotal: number
  paidAmount: number
  balanceAmount: number
  paymentStatus: PaymentStatus
  status: InvoiceStatus
  supplierInvoiceNumber: string
  createdAt: string
  cancelledAt: string
}

export interface InvoiceItemSnapshot extends SalesInvoiceLine {
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

export interface InvoicePaymentLink {
  id: string
  paymentId: string
  direction: 'IN' | 'OUT'
  amount: number
  paymentDate: string
  paymentMode: string
  status: string
  /** A cancelled invoice keeps the historical link but releases its payment as an advance. */
  unlinkedAt: string
}

export interface InvoiceDetail extends InvoiceListItem {
  invoiceNumber: string
  partyPhone: string
  partyGstin: string
  partyAddress: string
  partyState: string
  partyStateCode: string
  businessState: string
  businessStateCode: string
  taxType: 'IGST' | 'CGST_SGST'
  taxJurisdictionResolved: boolean
  itemCount: number
  totalQty: number
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
  paymentMode: string
  createdBy: string
  cancellationReason: string
  cancelledBy: string
  items: InvoiceItemSnapshot[]
  paymentLinks: InvoicePaymentLink[]
}

export interface InvoiceListFilters {
  dateFrom: string
  dateTo: string
  partyId: string
  paymentStatus: '' | PaymentStatus
  status: '' | InvoiceStatus
}

export const EMPTY_INVOICE_FILTERS: InvoiceListFilters = {
  dateFrom: '',
  dateTo: '',
  partyId: '',
  paymentStatus: '',
  status: '',
}
