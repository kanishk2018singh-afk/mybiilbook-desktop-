import { describe, expect, it } from 'vitest'
import { cancellationMovement, filterInvoices } from './invoiceUtils'
import type { InvoiceListItem } from '../types/invoice'

const invoices: InvoiceListItem[] = [
  {
    id: 'sale-1', kind: 'SALE', number: 'INV/0001', date: '2026-10-01', partyId: 'customer-a', partyName: 'A',
    grandTotal: 100, paidAmount: 0, balanceAmount: 100, paymentStatus: 'UNPAID', status: 'CONFIRMED', supplierInvoiceNumber: '', createdAt: '2026-10-01T10:00:00Z', cancelledAt: '',
  },
  {
    id: 'sale-2', kind: 'SALE', number: 'INV/0002', date: '2026-10-03', partyId: 'customer-b', partyName: 'B',
    grandTotal: 200, paidAmount: 200, balanceAmount: 0, paymentStatus: 'PAID', status: 'CANCELLED', supplierInvoiceNumber: '', createdAt: '2026-10-03T10:00:00Z', cancelledAt: '2026-10-04T10:00:00Z',
  },
  {
    id: 'sale-3', kind: 'SALE', number: 'INV/0003', date: '2026-10-02', partyId: 'customer-a', partyName: 'A',
    grandTotal: 50, paidAmount: 20, balanceAmount: 30, paymentStatus: 'PARTIAL', status: 'DRAFT', supplierInvoiceNumber: '', createdAt: '2026-10-02T10:00:00Z', cancelledAt: '',
  },
]

describe('invoice register helpers', () => {
  it('filters by inclusive date range, party, payment state, and document state', () => {
    expect(filterInvoices(invoices, {
      dateFrom: '2026-10-02', dateTo: '2026-10-03', partyId: '', paymentStatus: '', status: '',
    }).map((invoice) => invoice.id)).toEqual(['sale-2', 'sale-3'])

    expect(filterInvoices(invoices, {
      dateFrom: '', dateTo: '', partyId: 'customer-a', paymentStatus: 'PARTIAL', status: 'DRAFT',
    }).map((invoice) => invoice.id)).toEqual(['sale-3'])
  })

  it('uses an inverse adjustment for every cancellation kind', () => {
    expect(cancellationMovement('SALE', 3)).toEqual({ type: 'ADJUSTMENT_IN', quantityIn: 3, quantityOut: 0, stockDelta: 3 })
    expect(cancellationMovement('PURCHASE', 3)).toEqual({ type: 'ADJUSTMENT_OUT', quantityIn: 0, quantityOut: 3, stockDelta: -3 })
  })
})
