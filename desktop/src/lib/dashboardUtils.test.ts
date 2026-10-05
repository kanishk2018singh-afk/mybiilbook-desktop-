import { describe, expect, it } from 'vitest'
import {
  buildSalesTrend,
  calculateDashboardMetrics,
  calculateGstSummary,
  lowStockProducts,
  topSellingProducts,
} from './dashboardUtils'
import type { DashboardData } from '../types/dashboard'

const data: DashboardData = {
  salesInvoices: [
    { id: 'sale-today-paid', kind: 'SALE', date: '2026-10-05', status: 'CONFIRMED', paymentStatus: 'PAID', grandTotal: 1180, balanceAmount: 0, cgstAmount: 90, sgstAmount: 90, igstAmount: 0 },
    { id: 'sale-today-due', kind: 'SALE', date: '2026-10-05', status: 'CONFIRMED', paymentStatus: 'PARTIAL', grandTotal: 2360, balanceAmount: 1100, cgstAmount: 0, sgstAmount: 0, igstAmount: 360 },
    { id: 'sale-month', kind: 'SALE', date: '2026-10-02', status: 'CONFIRMED', paymentStatus: 'UNPAID', grandTotal: 590, balanceAmount: 590, cgstAmount: 45, sgstAmount: 45, igstAmount: 0 },
    { id: 'sale-cancelled', kind: 'SALE', date: '2026-10-05', status: 'CANCELLED', paymentStatus: 'UNPAID', grandTotal: 9999, balanceAmount: 9999, cgstAmount: 100, sgstAmount: 100, igstAmount: 100 },
  ],
  purchaseInvoices: [
    { id: 'purchase-today', kind: 'PURCHASE', date: '2026-10-05', status: 'CONFIRMED', paymentStatus: 'UNPAID', grandTotal: 1770, balanceAmount: 1770, cgstAmount: 135, sgstAmount: 135, igstAmount: 0 },
    { id: 'purchase-partial', kind: 'PURCHASE', date: '2026-10-01', status: 'CONFIRMED', paymentStatus: 'PARTIAL', grandTotal: 2360, balanceAmount: 500, cgstAmount: 0, sgstAmount: 0, igstAmount: 360 },
  ],
  payments: [
    { id: 'cash-in', direction: 'IN', mode: 'CASH', amount: 800 },
    { id: 'cash-out', direction: 'OUT', mode: 'cash', amount: 275.5 },
    { id: 'bank-in', direction: 'IN', mode: 'BANK', amount: 1000 },
  ],
  products: [
    { id: 'a', name: 'Wall mixer', unit: 'PCS', stockQty: 1, lowStockAlert: 2 },
    { id: 'b', name: 'Basin', unit: 'PCS', stockQty: 5, lowStockAlert: 2 },
    { id: 'c', name: 'Tap', unit: 'PCS', stockQty: 0, lowStockAlert: 0 },
  ],
  salesItems: [
    { id: 'a1', invoiceId: 'sale-today-paid', productId: 'mixer', name: 'Wall mixer', unit: 'PCS', qty: 2 },
    { id: 'a2', invoiceId: 'sale-month', productId: 'mixer', name: 'Wall mixer', unit: 'PCS', qty: 1.5 },
    { id: 'a3', invoiceId: 'sale-today-due', productId: 'tap', name: 'Angle tap', unit: 'PCS', qty: 4 },
  ],
}

describe('home dashboard calculations', () => {
  it('derives operational metrics without counting cancelled invoices', () => {
    const metrics = calculateDashboardMetrics(data, new Date(2026, 9, 5, 10))

    expect(metrics).toEqual({
      todaySales: 3540,
      monthSales: 4130,
      todayPurchases: 1770,
      receivables: 1690,
      payables: 2270,
      cashInHand: 524.5,
    })
  })

  it('builds zero-filled trend, product, stock, and GST summaries from confirmed data', () => {
    const trend = buildSalesTrend(data.salesInvoices, new Date(2026, 9, 5, 10), 4)
    const gst = calculateGstSummary(data, { dateFrom: '2026-10-02', dateTo: '2026-10-05' })

    expect(trend.map((point) => [point.date, point.sales])).toEqual([
      ['2026-10-02', 590],
      ['2026-10-03', 0],
      ['2026-10-04', 0],
      ['2026-10-05', 3540],
    ])
    expect(topSellingProducts(data)).toEqual([
      { productId: 'tap', name: 'Angle tap', unit: 'PCS', quantitySold: 4, invoiceLineCount: 1 },
      { productId: 'mixer', name: 'Wall mixer', unit: 'PCS', quantitySold: 3.5, invoiceLineCount: 2 },
    ])
    expect(lowStockProducts(data.products).map((product) => product.id)).toEqual(['a', 'c'])
    expect(gst).toEqual({
      sales: { cgstAmount: 135, sgstAmount: 135, igstAmount: 360, totalTax: 630 },
      purchases: { cgstAmount: 135, sgstAmount: 135, igstAmount: 0, totalTax: 270 },
    })
  })
})
