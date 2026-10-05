import type { InvoiceItemSnapshot, InvoiceKind } from './invoice'
import type { PaymentMode } from './salesInvoice'

/** A credit note reverses a sale; a debit note reverses a purchase. */
export type ReturnNoteKind = 'CREDIT' | 'DEBIT'

export type ReturnSettlementMethod = 'APPLY_TO_INVOICE' | 'REFUND_PAYMENT' | 'ON_ACCOUNT'

export interface ReturnNoteLineInput {
  /** Immutable item document ID from the source invoice. */
  sourceInvoiceItemId: string
  qty: number
}

/**
 * The source item is read from the confirmed invoice inside the write
 * transaction. Client-side line fields are deliberately not trusted for the
 * posting calculation.
 */
export interface ReturnNoteItemSnapshot extends InvoiceItemSnapshot {
  sourceInvoiceItemId: string
  sourceInvoiceQty: number
  returnedQty: number
}

export interface ReturnNoteLineTotals {
  sourceInvoiceItemId: string
  productId: string
  name: string
  code: string
  hsn: string
  unit: string
  sourceInvoiceQty: number
  returnedQty: number
  rate: number
  discountPercent: number
  gstPercent: number
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

export interface ReturnNoteTotals {
  lineTotals: ReturnNoteLineTotals[]
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
  grandTotal: number
}

export interface CreateReturnNoteInput {
  kind: ReturnNoteKind
  sourceInvoiceId: string
  noteDate: string
  lines: ReturnNoteLineInput[]
  settlementMethod: ReturnSettlementMethod
  refundPaymentMode?: PaymentMode
  refundReference?: string
  note: string
}

export interface CreatedReturnNote {
  id: string
  number: string
  kind: ReturnNoteKind
  sourceInvoiceId: string
  grandTotal: number
  appliedToInvoiceAmount: number
  refundAmount: number
  refundPaymentId: string
}

/** A small live projection of quantities already returned against a source item. */
export interface ReturnedItemBalance {
  sourceInvoiceItemId: string
  returnedQty: number
}

export interface PartyReturnNoteBalance {
  id: string
  kind: ReturnNoteKind
  number: string
  date: string
  /** Amount that remains as a party credit/debit rather than source-invoice settlement. */
  partyBalanceEffectAmount: number
  status: string
  sourceInvoiceId: string
  sourceInvoiceNumber: string
  settlementMethod: ReturnSettlementMethod | string
}

export function sourceInvoiceKindForReturnNote(kind: ReturnNoteKind): InvoiceKind {
  return kind === 'CREDIT' ? 'SALE' : 'PURCHASE'
}

export function documentTypeForReturnNote(kind: ReturnNoteKind): 'CREDIT_NOTE' | 'DEBIT_NOTE' {
  return kind === 'CREDIT' ? 'CREDIT_NOTE' : 'DEBIT_NOTE'
}

export function collectionForReturnNote(kind: ReturnNoteKind): 'creditNotes' | 'debitNotes' {
  return kind === 'CREDIT' ? 'creditNotes' : 'debitNotes'
}
