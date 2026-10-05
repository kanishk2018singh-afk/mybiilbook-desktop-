import type { QuotationListFilters, QuotationListItem, QuotationStatus } from '../types/quotation'

export function quotationStatusLabel(status: QuotationStatus): string {
  const labels: Record<QuotationStatus, string> = {
    DRAFT: 'Draft',
    SENT: 'Sent',
    ACCEPTED: 'Accepted',
    REJECTED: 'Rejected',
    EXPIRED: 'Expired',
    CONVERTED: 'Converted',
  }
  return labels[status]
}

/** Quotation workflow keeps terminal outcomes immutable and reserves CONVERTED for the sale transaction. */
export function canSetQuotationStatus(current: QuotationStatus, next: QuotationStatus): boolean {
  if (current === next) return true
  if (current === 'CONVERTED' || current === 'REJECTED' || current === 'EXPIRED') return false
  if (next === 'CONVERTED') return false
  if (current === 'DRAFT') return next === 'SENT' || next === 'ACCEPTED' || next === 'REJECTED' || next === 'EXPIRED'
  return next === 'ACCEPTED' || next === 'REJECTED' || next === 'EXPIRED'
}

export function filterQuotations(quotations: QuotationListItem[], filters: QuotationListFilters): QuotationListItem[] {
  return quotations
    .filter((quotation) => !filters.dateFrom || quotation.date >= filters.dateFrom)
    .filter((quotation) => !filters.dateTo || quotation.date <= filters.dateTo)
    .filter((quotation) => !filters.partyId || quotation.partyId === filters.partyId)
    .filter((quotation) => !filters.status || quotation.status === filters.status)
    .sort((left, right) => {
      const byDate = right.date.localeCompare(left.date)
      if (byDate) return byDate
      return right.createdAt.localeCompare(left.createdAt) || right.number.localeCompare(left.number)
    })
}
