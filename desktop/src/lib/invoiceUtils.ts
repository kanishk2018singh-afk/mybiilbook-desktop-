import type { InvoiceKind, InvoiceListFilters, InvoiceListItem } from '../types/invoice'

export function collectionForInvoiceKind(kind: InvoiceKind): 'salesInvoices' | 'purchaseInvoices' {
  return kind === 'SALE' ? 'salesInvoices' : 'purchaseInvoices'
}

export function invoiceKindLabel(kind: InvoiceKind): string {
  return kind === 'SALE' ? 'Sales' : 'Purchase'
}

export function invoicePartyLabel(kind: InvoiceKind): string {
  return kind === 'SALE' ? 'Customer' : 'Supplier'
}

/** ISO date strings sort lexicographically, which lets filtering remain index-free and client-safe. */
export function filterInvoices(invoices: InvoiceListItem[], filters: InvoiceListFilters): InvoiceListItem[] {
  return invoices
    .filter((invoice) => !filters.dateFrom || invoice.date >= filters.dateFrom)
    .filter((invoice) => !filters.dateTo || invoice.date <= filters.dateTo)
    .filter((invoice) => !filters.partyId || invoice.partyId === filters.partyId)
    .filter((invoice) => !filters.paymentStatus || invoice.paymentStatus === filters.paymentStatus)
    .filter((invoice) => !filters.status || invoice.status === filters.status)
    .sort((left, right) => {
      const byDate = right.date.localeCompare(left.date)
      if (byDate) return byDate
      return right.createdAt.localeCompare(left.createdAt) || right.number.localeCompare(left.number)
    })
}

export interface CancellationMovement {
  type: 'ADJUSTMENT_IN' | 'ADJUSTMENT_OUT'
  quantityIn: number
  quantityOut: number
  /** +1 adds stock, -1 removes stock. */
  stockDelta: number
}

/** The cancellation journal is always the exact inverse of the original invoice movement. */
export function cancellationMovement(kind: InvoiceKind, quantity: number): CancellationMovement {
  if (kind === 'SALE') {
    return { type: 'ADJUSTMENT_IN', quantityIn: quantity, quantityOut: 0, stockDelta: quantity }
  }
  return { type: 'ADJUSTMENT_OUT', quantityIn: 0, quantityOut: quantity, stockDelta: -quantity }
}

export function paymentStatusLabel(status: InvoiceListItem['paymentStatus']): string {
  if (status === 'PAID') return 'Paid'
  if (status === 'PARTIAL') return 'Partial'
  return 'Unpaid'
}
