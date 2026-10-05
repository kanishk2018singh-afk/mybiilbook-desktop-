import { describe, expect, it } from 'vitest'
import { canSetQuotationStatus, filterQuotations, quotationStatusLabel } from './quotationUtils'
import type { QuotationListItem } from '../types/quotation'

const quotations: QuotationListItem[] = [
  { id: 'q-old', number: 'QUO/001', date: '2026-09-01', validUntil: '', partyId: 'party-a', partyName: 'A Traders', grandTotal: 1000, status: 'SENT', salesInvoiceId: '', salesInvoiceNumber: '', createdAt: '2026-09-01T10:00:00.000Z' },
  { id: 'q-new', number: 'QUO/002', date: '2026-09-03', validUntil: '', partyId: 'party-b', partyName: 'B Supplies', grandTotal: 2000, status: 'ACCEPTED', salesInvoiceId: '', salesInvoiceNumber: '', createdAt: '2026-09-03T10:00:00.000Z' },
]

describe('quotation utilities', () => {
  it('labels all supported statuses', () => {
    expect(quotationStatusLabel('CONVERTED')).toBe('Converted')
    expect(quotationStatusLabel('EXPIRED')).toBe('Expired')
  })

  it('allows valid workflow transitions but reserves converted for the sales transaction', () => {
    expect(canSetQuotationStatus('DRAFT', 'SENT')).toBe(true)
    expect(canSetQuotationStatus('SENT', 'ACCEPTED')).toBe(true)
    expect(canSetQuotationStatus('SENT', 'CONVERTED')).toBe(false)
    expect(canSetQuotationStatus('CONVERTED', 'SENT')).toBe(false)
  })

  it('filters and orders the quotation register', () => {
    expect(filterQuotations(quotations, { dateFrom: '', dateTo: '', partyId: '', status: '' }).map((quotation) => quotation.id)).toEqual(['q-new', 'q-old'])
    expect(filterQuotations(quotations, { dateFrom: '', dateTo: '', partyId: 'party-a', status: 'SENT' }).map((quotation) => quotation.id)).toEqual(['q-old'])
  })
})
