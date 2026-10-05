import type {
  DashboardData,
  DashboardInvoice,
  DashboardMetrics,
  DashboardProduct,
  DateRange,
  GstSummary,
  GstTaxTotals,
  SalesTrendPoint,
  TopSellingProduct,
} from '../types/dashboard'

const MONEY_EPSILON = 0.005

export function roundDashboardMoney(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100
}

export function roundDashboardQuantity(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 1000) / 1000
}

/** Local calendar dates avoid UTC rollover around midnight for daily business metrics. */
export function localDateKey(value = new Date()): string {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function currentMonthStartKey(value = new Date()): string {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}-01`
}

export function isConfirmed(invoice: DashboardInvoice): boolean {
  return invoice.status === 'CONFIRMED'
}

function numeric(value: number): number {
  return Number.isFinite(value) ? value : 0
}

function isWithinDateRange(date: string, range: DateRange): boolean {
  if (!date) return false
  if (range.dateFrom && date < range.dateFrom) return false
  if (range.dateTo && date > range.dateTo) return false
  return true
}

function sumGrandTotal(invoices: DashboardInvoice[]): number {
  return roundDashboardMoney(invoices.reduce((total, invoice) => total + Math.max(0, numeric(invoice.grandTotal)), 0))
}

function sumOutstanding(invoices: DashboardInvoice[]): number {
  return roundDashboardMoney(invoices.reduce((total, invoice) => {
    const unsettled = invoice.paymentStatus === 'UNPAID' || invoice.paymentStatus === 'PARTIAL'
    return total + (isConfirmed(invoice) && unsettled ? Math.max(0, numeric(invoice.balanceAmount)) : 0)
  }, 0))
}

export function calculateDashboardMetrics(data: DashboardData, now = new Date()): DashboardMetrics {
  const today = localDateKey(now)
  const monthStart = currentMonthStartKey(now)
  const confirmedSales = data.salesInvoices.filter(isConfirmed)
  const confirmedPurchases = data.purchaseInvoices.filter(isConfirmed)
  const cashInHand = data.payments.reduce((total, payment) => {
    if (payment.mode.toUpperCase() !== 'CASH') return total
    const amount = Math.max(0, numeric(payment.amount))
    return payment.direction === 'OUT' ? total - amount : total + amount
  }, 0)

  return {
    todaySales: sumGrandTotal(confirmedSales.filter((invoice) => invoice.date === today)),
    monthSales: sumGrandTotal(confirmedSales.filter((invoice) => invoice.date >= monthStart && invoice.date <= today)),
    todayPurchases: sumGrandTotal(confirmedPurchases.filter((invoice) => invoice.date === today)),
    receivables: sumOutstanding(data.salesInvoices),
    payables: sumOutstanding(data.purchaseInvoices),
    cashInHand: roundDashboardMoney(cashInHand),
  }
}

function dateAtLocalMidday(date: string): Date {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year, month - 1, day, 12)
}

function trendLabel(date: string): string {
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short' }).format(dateAtLocalMidday(date))
}

/** Builds a fixed daily series so the line chart makes zero-sales days explicit. */
export function buildSalesTrend(invoices: DashboardInvoice[], now = new Date(), days = 30): SalesTrendPoint[] {
  const safeDays = Math.max(1, Math.trunc(days))
  const latest = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12)
  const totals = new Map<string, number>()
  invoices.filter(isConfirmed).forEach((invoice) => {
    if (!invoice.date) return
    totals.set(invoice.date, roundDashboardMoney((totals.get(invoice.date) ?? 0) + Math.max(0, numeric(invoice.grandTotal))))
  })

  return Array.from({ length: safeDays }, (_, index) => {
    const cursor = new Date(latest)
    cursor.setDate(latest.getDate() - (safeDays - 1 - index))
    const date = localDateKey(cursor)
    return { date, label: trendLabel(date), sales: totals.get(date) ?? 0 }
  })
}

/** Aggregates immutable Sales Invoice item snapshots; cancelled invoices are never subscribed. */
export function topSellingProducts(data: DashboardData, limit = 5): TopSellingProduct[] {
  const grouped = new Map<string, TopSellingProduct>()
  for (const item of data.salesItems) {
    const productId = item.productId || `legacy:${item.name || item.id}`
    const existing = grouped.get(productId)
    grouped.set(productId, {
      productId,
      name: existing?.name || item.name || 'Unnamed product',
      unit: existing?.unit || item.unit || 'PCS',
      quantitySold: roundDashboardQuantity((existing?.quantitySold ?? 0) + Math.max(0, numeric(item.qty))),
      invoiceLineCount: (existing?.invoiceLineCount ?? 0) + 1,
    })
  }

  return [...grouped.values()]
    .sort((left, right) => right.quantitySold - left.quantitySold || left.name.localeCompare(right.name))
    .slice(0, Math.max(0, Math.trunc(limit)))
}

export function lowStockProducts(products: DashboardProduct[]): DashboardProduct[] {
  return products
    .filter((product) => product.stockQty <= product.lowStockAlert)
    .sort((left, right) => (
      (left.stockQty - left.lowStockAlert) - (right.stockQty - right.lowStockAlert)
      || left.stockQty - right.stockQty
      || left.name.localeCompare(right.name)
    ))
}

function emptyTaxTotals(): GstTaxTotals {
  return { cgstAmount: 0, sgstAmount: 0, igstAmount: 0, totalTax: 0 }
}

function taxTotalsFor(invoices: DashboardInvoice[], range: DateRange): GstTaxTotals {
  const totals = invoices.reduce((current, invoice) => {
    if (!isConfirmed(invoice) || !isWithinDateRange(invoice.date, range)) return current
    return {
      cgstAmount: current.cgstAmount + Math.max(0, numeric(invoice.cgstAmount)),
      sgstAmount: current.sgstAmount + Math.max(0, numeric(invoice.sgstAmount)),
      igstAmount: current.igstAmount + Math.max(0, numeric(invoice.igstAmount)),
      totalTax: current.totalTax + Math.max(0, numeric(invoice.cgstAmount)) + Math.max(0, numeric(invoice.sgstAmount)) + Math.max(0, numeric(invoice.igstAmount)),
    }
  }, emptyTaxTotals())

  return {
    cgstAmount: roundDashboardMoney(totals.cgstAmount),
    sgstAmount: roundDashboardMoney(totals.sgstAmount),
    igstAmount: roundDashboardMoney(totals.igstAmount),
    totalTax: roundDashboardMoney(totals.totalTax),
  }
}

export function calculateGstSummary(data: DashboardData, range: DateRange): GstSummary {
  return {
    sales: taxTotalsFor(data.salesInvoices, range),
    purchases: taxTotalsFor(data.purchaseInvoices, range),
  }
}

export function defaultGstDateRange(now = new Date()): DateRange {
  return { dateFrom: currentMonthStartKey(now), dateTo: localDateKey(now) }
}

export function hasOutstandingBalance(value: number): boolean {
  return value > MONEY_EPSILON
}
