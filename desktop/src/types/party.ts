export type PartyType = 'CUSTOMER' | 'SUPPLIER' | 'BOTH'
export type OpeningBalanceType = 'RECEIVABLE' | 'PAYABLE'

export interface Party {
  id: string
  type: PartyType
  name: string
  phone: string
  email: string
  gstin: string
  address: string
  state: string
  /** Optional explicit GST state code on newer Party documents. */
  stateCode?: string
  city: string
  pincode: string
  openingBalance: number
  openingBalanceType: OpeningBalanceType
  creditLimit: number
  creditDays: number
  isActive: boolean
  notes: string
}

export interface PartyInput {
  type: PartyType
  name: string
  phone: string
  email: string
  gstin: string
  address: string
  state: string
  /** Optional explicit GST state code on newer Party documents. */
  stateCode?: string
  city: string
  pincode: string
  openingBalance: number
  openingBalanceType: OpeningBalanceType
  creditLimit: number
  creditDays: number
  isActive: boolean
  notes: string
}

export interface PartyInvoiceBalance {
  id: string
  kind: 'SALE' | 'PURCHASE'
  number: string
  date: string
  balanceAmount: number
  status: string
}

export type PaymentDirection = 'IN' | 'OUT'

export interface PartyReturnNote {
  id: string
  kind: 'CREDIT' | 'DEBIT'
  number: string
  date: string
  /** Remaining party effect after source-invoice settlement, if any. */
  partyBalanceEffectAmount: number
  status: string
  sourceInvoiceId: string
  sourceInvoiceNumber: string
  settlementMethod: string
}

export interface PartyPayment {
  id: string
  direction: PaymentDirection
  amount: number
  /** Amount already applied through invoicePayments links. */
  allocatedAmount?: number
  /** On-account remainder; this alone changes the calculated party balance. */
  unallocatedAmount?: number
  allocationCount?: number
  date: string
  invoiceId: string
  mode: string
  referenceNumber?: string
  note: string
}

export interface PartyActivity {
  salesInvoices: PartyInvoiceBalance[]
  purchaseInvoices: PartyInvoiceBalance[]
  /** Credit notes reduce customer receivables or create a customer payable. */
  creditNotes: PartyReturnNote[]
  /** Debit notes reduce supplier payables or create a supplier receivable. */
  debitNotes: PartyReturnNote[]
  payments: PartyPayment[]
}
