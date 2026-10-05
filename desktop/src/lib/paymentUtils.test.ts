import { describe, expect, it } from 'vitest'
import { filterPayments, invoiceKindForPaymentDirection, paymentStatusAfterAllocation, sumPaymentAllocations } from './paymentUtils'
import type { PaymentListItem } from '../types/payment'

const payments: PaymentListItem[] = [
  {
    id: 'payment-old',
    paymentDate: '2026-09-01',
    partyId: 'party-a',
    partyName: 'A Traders',
    direction: 'IN',
    mode: 'UPI',
    amount: 800,
    allocatedAmount: 500,
    unallocatedAmount: 300,
    allocationCount: 2,
    referenceNumber: 'UPI-001',
    note: '',
    createdAt: '2026-09-01T10:00:00.000Z',
  },
  {
    id: 'payment-new',
    paymentDate: '2026-09-03',
    partyId: 'party-b',
    partyName: 'B Supplies',
    direction: 'OUT',
    mode: 'BANK',
    amount: 1200,
    allocatedAmount: 1200,
    unallocatedAmount: 0,
    allocationCount: 1,
    referenceNumber: 'BANK-002',
    note: 'Supplier transfer',
    createdAt: '2026-09-03T11:00:00.000Z',
  },
]

describe('payment utilities', () => {
  it('maps receipt and payout directions to their matching invoice registers', () => {
    expect(invoiceKindForPaymentDirection('IN')).toBe('SALE')
    expect(invoiceKindForPaymentDirection('OUT')).toBe('PURCHASE')
  })

  it('derives invoice payment status from the remaining balance', () => {
    expect(paymentStatusAfterAllocation(1000, 0)).toBe('PAID')
    expect(paymentStatusAfterAllocation(350, 650)).toBe('PARTIAL')
    expect(paymentStatusAfterAllocation(0, 650)).toBe('UNPAID')
  })

  it('rounds multi-invoice allocations to money precision', () => {
    expect(sumPaymentAllocations([{ amount: 100.105 }, { amount: 29.895 }])).toBe(130)
  })

  it('filters and sorts the payment register client-side', () => {
    expect(filterPayments(payments, { dateFrom: '', dateTo: '', partyId: '', direction: '', mode: '' }).map((payment) => payment.id)).toEqual(['payment-new', 'payment-old'])
    expect(filterPayments(payments, { dateFrom: '2026-09-02', dateTo: '', partyId: '', direction: '', mode: '' }).map((payment) => payment.id)).toEqual(['payment-new'])
    expect(filterPayments(payments, { dateFrom: '', dateTo: '', partyId: 'party-a', direction: 'IN', mode: 'UPI' }).map((payment) => payment.id)).toEqual(['payment-old'])
  })
})
