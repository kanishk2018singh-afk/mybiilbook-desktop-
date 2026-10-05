import type { SalesInvoiceLine } from './salesInvoice'

export const QUOTATION_STATUSES = ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CONVERTED'] as const

export type QuotationStatus = (typeof QUOTATION_STATUSES)[number]
export type QuotationInitialStatus = 'DRAFT' | 'SENT'

export interface QuotationListItem {
  id: string
  number: string
  date: string
  validUntil: string
  partyId: string
  partyName: string
  grandTotal: number
  status: QuotationStatus
  salesInvoiceId: string
  salesInvoiceNumber: string
  createdAt: string
}

/** Quotation lines are immutable snapshots and use the same GST fields as sales lines. */
export interface QuotationItemSnapshot extends SalesInvoiceLine {
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

export interface QuotationDetail extends QuotationListItem {
  quotationNumber: string
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
  note: string
  createdBy: string
  items: QuotationItemSnapshot[]
}

export interface CreateQuotationInput {
  quotationDate: string
  validUntil: string
  status: QuotationInitialStatus
  partyId: string
  partyName: string
  partyPhone: string
  partyGstin: string
  partyAddress: string
  partyState: string
  partyStateCode: string
  businessState: string
  businessStateCode: string
  lines: SalesInvoiceLine[]
  billDiscount: number
  note: string
}

export interface CreatedQuotation {
  id: string
  number: string
  grandTotal: number
  status: QuotationInitialStatus
}

export interface QuotationListFilters {
  dateFrom: string
  dateTo: string
  partyId: string
  status: '' | QuotationStatus
}

export const EMPTY_QUOTATION_LIST_FILTERS: QuotationListFilters = {
  dateFrom: '',
  dateTo: '',
  partyId: '',
  status: '',
}

/** The exact snapshots copied into the Sales Invoice form during conversion. */
export interface QuotationConversionDraft {
  quotationId: string
  quotationNumber: string
  quotationDate: string
  partyId: string
  partyName: string
  partyPhone: string
  partyGstin: string
  partyAddress: string
  partyState: string
  partyStateCode: string
  billDiscount: number
  lines: SalesInvoiceLine[]
}
