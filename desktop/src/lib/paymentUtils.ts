import type { InvoiceKind } from '../types/invoice'
import type { PaymentDirection, PaymentListFilters, PaymentListItem } from '../types/payment'

const MONEY_EPSILON = 0.005

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function invoiceKindForPaymentDirection(direction: PaymentDirection): InvoiceKind {
  return direction === 'IN' ? 'SALE' : 'PURCHASE'
}

export function paymentStatusAfterAllocation(nextPaidAmount: number, nextBalanceAmount: number): 'PAID' | 'PARTIAL' | 'UNPAID' {
  if (nextBalanceAmount <= MONEY_EPSILON) return 'PAID'
  if (nextPaidAmount > MONEY_EPSILON) return 'PARTIAL'
  return 'UNPAID'
}

export function sumPaymentAllocations(allocations: Array<{ amount: number }>): number {
  return roundMoney(allocations.reduce((total, allocation) => total + allocation.amount, 0))
}

/** Client-side filtering avoids compound Firestore indexes for the register. */
export function filterPayments(payments: PaymentListItem[], filters: PaymentListFilters): PaymentListItem[] {
  return payments
    .filter((payment) => !filters.dateFrom || payment.paymentDate >= filters.dateFrom)
    .filter((payment) => !filters.dateTo || payment.paymentDate <= filters.dateTo)
    .filter((payment) => !filters.partyId || payment.partyId === filters.partyId)
    .filter((payment) => !filters.direction || payment.direction === filters.direction)
    .filter((payment) => !filters.mode || payment.mode === filters.mode)
    .sort((left, right) => {
      const byDate = right.paymentDate.localeCompare(left.paymentDate)
      if (byDate) return byDate
      return right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)
    })
}
