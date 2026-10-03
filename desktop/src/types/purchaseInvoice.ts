import type { PaymentMode, PaymentStatus, SalesInvoiceLine } from './salesInvoice'

/** Purchase lines retain the same immutable product snapshot shape as sale lines. */
export type PurchaseInvoiceLine = SalesInvoiceLine

export interface PurchaseInvoicePartySnapshot {
  partyId: string
  partyName: string
  partyPhone: string
  partyGstin: string
  partyAddress: string
  partyState: string
  partyStateCode: string
}

export interface CreatePurchaseInvoiceInput extends PurchaseInvoicePartySnapshot {
  purchaseDate: string
  /** Supplier's own bill/reference number, entered manually from the paper/e-bill. */
  supplierInvoiceNumber: string
  businessStateCode: string
  businessState: string
  lines: PurchaseInvoiceLine[]
  billDiscount: number
  paidAmount: number
  paymentMode: PaymentMode
  /** Chosen explicitly from the UI confirmation dialog. */
  updateProductPurchasePrices: boolean
}

export interface CreatedPurchaseInvoice {
  id: string
  number: string
  grandTotal: number
  balanceAmount: number
  paymentStatus: PaymentStatus
}
