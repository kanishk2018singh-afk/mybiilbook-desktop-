import { describe, expect, it } from 'vitest'
import { calculatePartyBalance } from './partyBalance'
import type { Party, PartyActivity } from '../types/party'

const customer: Party = {
  id: 'party-1',
  type: 'BOTH',
  name: 'Demo Party',
  phone: '',
  email: '',
  gstin: '',
  address: '',
  state: '',
  city: '',
  pincode: '',
  openingBalance: 100,
  openingBalanceType: 'RECEIVABLE',
  creditLimit: 0,
  creditDays: 0,
  isActive: true,
  notes: '',
}

const activity: PartyActivity = {
  salesInvoices: [
    { id: 's1', kind: 'SALE', number: 'INV-1', date: '2026-10-01', balanceAmount: 200, status: 'FINAL' },
    { id: 's2', kind: 'SALE', number: 'INV-X', date: '2026-10-01', balanceAmount: 99, status: 'CANCELLED' },
  ],
  purchaseInvoices: [
    { id: 'p1', kind: 'PURCHASE', number: 'PUR-1', date: '2026-10-01', balanceAmount: 50, status: 'FINAL' },
  ],
  creditNotes: [],
  debitNotes: [],
  payments: [
    { id: 'in-advance', direction: 'IN', amount: 30, date: '2026-10-01', invoiceId: '', mode: 'UPI', note: '' },
    { id: 'out-advance', direction: 'OUT', amount: 20, date: '2026-10-01', invoiceId: '', mode: 'BANK', note: '' },
    // This was allocated to an invoice and is already reflected in INV-1.balanceAmount.
    { id: 'in-allocated', direction: 'IN', amount: 100, date: '2026-10-01', invoiceId: 's1', mode: 'CASH', note: '' },
  ],
}

describe('party balance calculation', () => {
  it('uses the signed receivable/payable convention and skips invoice-linked payments', () => {
    const balance = calculatePartyBalance(customer, activity)
    // +100 opening +200 sale −50 purchase −30 received +20 paid = +240 receivable.
    expect(balance).toMatchObject({
      openingSigned: 100,
      salesInvoiceBalance: 200,
      purchaseInvoiceBalance: 50,
      unallocatedMoneyIn: 30,
      unallocatedMoneyOut: 20,
      currentSigned: 240,
      amount: 240,
      position: 'RECEIVABLE',
    })
  })

  it('returns a payable position for a supplier-style opening balance', () => {
    const payableParty: Party = { ...customer, openingBalance: 400, openingBalanceType: 'PAYABLE' }
    const balance = calculatePartyBalance(payableParty, {
        salesInvoices: [],
        purchaseInvoices: [{ id: 'p2', kind: 'PURCHASE', number: 'PUR-2', date: '', balanceAmount: 200, status: 'FINAL' }],
        creditNotes: [],
        debitNotes: [],
        payments: [{ id: 'out', direction: 'OUT', amount: 100, date: '', invoiceId: '', mode: '', note: '' }],
    })
    // −400 opening −200 purchase +100 paid = −500 payable.
    expect(balance).toMatchObject({ currentSigned: -500, amount: 500, position: 'PAYABLE' })
  })

  it('treats on-account return notes as party credits/debits and offsets their refund cash movement', () => {
    const balance = calculatePartyBalance(
      { ...customer, openingBalance: 0 },
      {
        salesInvoices: [],
        purchaseInvoices: [],
        creditNotes: [{
          id: 'cn-1', kind: 'CREDIT', number: 'CN-1', date: '', partyBalanceEffectAmount: 30,
          status: 'CONFIRMED', sourceInvoiceId: 's1', sourceInvoiceNumber: 'INV-1', settlementMethod: 'REFUND_PAYMENT',
        }],
        debitNotes: [{
          id: 'dn-1', kind: 'DEBIT', number: 'DN-1', date: '', partyBalanceEffectAmount: 20,
          status: 'CONFIRMED', sourceInvoiceId: 'p1', sourceInvoiceNumber: 'PUR-1', settlementMethod: 'ON_ACCOUNT',
        }],
        // The customer refund is an OUT payment and exactly clears the customer credit.
        payments: [{ id: 'customer-refund', direction: 'OUT', amount: 30, unallocatedAmount: 30, date: '', invoiceId: '', mode: 'CASH', note: '' }],
      },
    )
    // -30 customer credit +20 supplier debit +30 outgoing refund = +20 receivable.
    expect(balance).toMatchObject({ creditNoteBalance: 30, debitNoteBalance: 20, currentSigned: 20, position: 'RECEIVABLE' })
  })

  it('counts only the unallocated remainder of a multi-invoice payment', () => {
    const balance = calculatePartyBalance(
      { ...customer, openingBalance: 0 },
      {
        salesInvoices: [{ id: 's3', kind: 'SALE', number: 'INV-3', date: '', balanceAmount: 100, status: 'FINAL' }],
        purchaseInvoices: [],
        creditNotes: [],
        debitNotes: [],
        payments: [{
          id: 'split-receipt',
          direction: 'IN',
          amount: 100,
          allocatedAmount: 60,
          unallocatedAmount: 40,
          allocationCount: 2,
          date: '',
          invoiceId: '',
          mode: 'UPI',
          note: '',
        }],
      },
    )
    // The invoice balance has already fallen by the allocated 60. Only the
    // remaining 40 receipt is an on-account advance: +100 −40 = +60 due.
    expect(balance).toMatchObject({ salesInvoiceBalance: 100, unallocatedMoneyIn: 40, currentSigned: 60 })
  })
})
