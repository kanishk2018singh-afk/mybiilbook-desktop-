import type { InvoiceKind, InvoiceStatus } from './invoice'
import type { PaymentStatus } from './salesInvoice'

/** Compact, normalized data contracts used by the business-scoped Home Dashboard. */
export interface DashboardInvoice {
  id: string
  kind: InvoiceKind
  date: string
  status: InvoiceStatus
  paymentStatus: PaymentStatus
  grandTotal: number
  balanceAmount: number
  cgstAmount: number
  sgstAmount: number
  igstAmount: number
}

export interface DashboardPayment {
  id: string
  direction: 'IN' | 'OUT'
  mode: string
  amount: number
}

export interface DashboardProduct {
  id: string
  name: string
  unit: string
  stockQty: number
  lowStockAlert: number
}

/** Immutable item snapshot belonging to a confirmed Sales Invoice. */
export interface DashboardSalesItem {
  id: string
  invoiceId: string
  productId: string
  name: string
  unit: string
  qty: number
}

export interface DashboardData {
  salesInvoices: DashboardInvoice[]
  purchaseInvoices: DashboardInvoice[]
  payments: DashboardPayment[]
  products: DashboardProduct[]
  salesItems: DashboardSalesItem[]
}

export interface DashboardMetrics {
  todaySales: number
  monthSales: number
  todayPurchases: number
  receivables: number
  payables: number
  cashInHand: number
}

export interface SalesTrendPoint {
  date: string
  label: string
  sales: number
}

export interface TopSellingProduct {
  productId: string
  name: string
  unit: string
  quantitySold: number
  invoiceLineCount: number
}

export interface GstTaxTotals {
  cgstAmount: number
  sgstAmount: number
  igstAmount: number
  totalTax: number
}

export interface GstSummary {
  sales: GstTaxTotals
  purchases: GstTaxTotals
}

export interface DateRange {
  dateFrom: string
  dateTo: string
}
