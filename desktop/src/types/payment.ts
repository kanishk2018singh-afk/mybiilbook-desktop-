import type { InvoiceKind, InvoiceStatus } from './invoice'

export const PAYMENT_MODES = ['CASH', 'UPI', 'BANK', 'CARD', 'CHEQUE', 'OTHER'] as const

export type PaymentMode = (typeof PAYMENT_MODES)[number]
export type PaymentDirection = 'IN' | 'OUT'

/** A confirmed invoice with a positive remaining balance that can receive an allocation. */
export interface PayableInvoice {
  id: string
  kind: InvoiceKind
  number: string
  date: string
  partyId: string
  partyName: string
  grandTotal: number
  paidAmount: number
  balanceAmount: number
  paymentStatus: 'PAID' | 'UNPAID' | 'PARTIAL'
  status: InvoiceStatus
  supplierInvoiceNumber: string
}

export interface PaymentAllocationInput {
  invoiceId: string
  /** IN payments settle sales; OUT payments settle purchases. */
  invoiceKind: InvoiceKind
  amount: number
}

export interface RecordPaymentInput {
  partyId: string
  partyName: string
  amount: number
  direction: PaymentDirection
  mode: PaymentMode
  paymentDate: string
  referenceNumber: string
  note: string
  allocations: PaymentAllocationInput[]
}

export interface RecordedPaymentResult {
  id: string
  amount: number
  allocatedAmount: number
  unallocatedAmount: number
  allocationCount: number
}

export interface PaymentListItem {
  id: string
  paymentDate: string
  partyId: string
  partyName: string
  direction: PaymentDirection
  mode: PaymentMode | string
  amount: number
  allocatedAmount: number
  unallocatedAmount: number
  allocationCount: number
  referenceNumber: string
  note: string
  createdAt: string
}

export interface PaymentListFilters {
  dateFrom: string
  dateTo: string
  partyId: string
  direction: '' | PaymentDirection
  mode: '' | PaymentMode
}

export const EMPTY_PAYMENT_LIST_FILTERS: PaymentListFilters = {
  dateFrom: '',
  dateTo: '',
  partyId: '',
  direction: '',
  mode: '',
}
