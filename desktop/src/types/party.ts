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

export interface PartyPayment {
  id: string
  direction: PaymentDirection
  amount: number
  date: string
  invoiceId: string
  mode: string
  note: string
}

export interface PartyActivity {
  salesInvoices: PartyInvoiceBalance[]
  purchaseInvoices: PartyInvoiceBalance[]
  payments: PartyPayment[]
}
