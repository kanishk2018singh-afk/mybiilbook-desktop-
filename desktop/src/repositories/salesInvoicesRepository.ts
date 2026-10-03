import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
  type DocumentData,
  type DocumentReference,
} from 'firebase/firestore'
import { reserveNextDocumentNumberInTransaction } from '../lib/documentNumbering'
import { calculateSalesInvoiceTotals, resolveTaxJurisdiction } from '../lib/salesInvoiceTotals'
import { requireFirestore } from '../lib/firebase'
import { getBusinessPath } from '../lib/firestorePaths'
import type {
  CreatedSalesInvoice,
  CreateSalesInvoiceInput,
  SalesInvoiceLine,
} from '../types/salesInvoice'

export type SalesInvoiceTransactionErrorCode =
  | 'PARTY_REQUIRED'
  | 'LINE_REQUIRED'
  | 'LINE_INVALID'
  | 'BILL_DISCOUNT_INVALID'
  | 'PAID_AMOUNT_INVALID'
  | 'PRODUCT_NOT_FOUND'
  | 'INSUFFICIENT_STOCK'

export class SalesInvoiceTransactionError extends Error {
  constructor(
    public readonly code: SalesInvoiceTransactionErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'SalesInvoiceTransactionError'
  }
}

function nonNegativeFinite(value: number): boolean {
  return Number.isFinite(value) && value >= 0
}

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

function stockQuantity(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

function roundStock(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000
}

function productReference(uid: string, businessId: string, productId: string): DocumentReference<DocumentData> {
  return doc(requireFirestore(), getBusinessPath(uid, businessId, 'products'), productId)
}

function assertLine(line: SalesInvoiceLine): void {
  if (!line.productId.trim() || !line.name.trim()) {
    throw new SalesInvoiceTransactionError('LINE_INVALID', 'Every invoice line needs a selected product.')
  }
  if (!positiveFinite(line.qty)) {
    throw new SalesInvoiceTransactionError('LINE_INVALID', `Enter a quantity greater than zero for ${line.name || 'each product'}.`)
  }
  if (!nonNegativeFinite(line.rate)) {
    throw new SalesInvoiceTransactionError('LINE_INVALID', `Enter a valid rate for ${line.name || 'each product'}.`)
  }
  if (!nonNegativeFinite(line.discountPercent) || line.discountPercent > 100) {
    throw new SalesInvoiceTransactionError('LINE_INVALID', `Enter a discount from 0 to 100 for ${line.name || 'each product'}.`)
  }
  if (!nonNegativeFinite(line.gstPercent) || line.gstPercent > 100) {
    throw new SalesInvoiceTransactionError('LINE_INVALID', `Enter a GST rate from 0 to 100 for ${line.name || 'each product'}.`)
  }
}

function assertInput(input: CreateSalesInvoiceInput): void {
  if (!input.partyId.trim() || !input.partyName.trim()) {
    throw new SalesInvoiceTransactionError('PARTY_REQUIRED', 'Select a customer before confirming the sales invoice.')
  }
  if (!input.invoiceDate.trim()) {
    throw new SalesInvoiceTransactionError('LINE_INVALID', 'Choose an invoice date before confirming the sale.')
  }
  if (!input.lines.length) {
    throw new SalesInvoiceTransactionError('LINE_REQUIRED', 'Add at least one product to the sales invoice.')
  }
  input.lines.forEach(assertLine)
  if (!nonNegativeFinite(input.billDiscount)) {
    throw new SalesInvoiceTransactionError('BILL_DISCOUNT_INVALID', 'Enter a valid non-negative bill discount.')
  }
  if (!nonNegativeFinite(input.paidAmount)) {
    throw new SalesInvoiceTransactionError('PAID_AMOUNT_INVALID', 'Enter a valid non-negative Paid Now amount.')
  }
}

/**
 * Creates a confirmed sale as one Firestore transaction.
 *
 * A sale changes a shared number sequence, multiple product stocks, the invoice
 * header, immutable item snapshots, stock ledger entries, and sometimes a
 * payment/link. If these were independent writes, an app crash could leave an
 * invoice without stock movement (or stock removed without an invoice). The
 * transaction also retries when a product changes concurrently, so every stock
 * check is made against the same committed product version that is decremented.
 */
export async function createConfirmedSalesInvoice(
  uid: string,
  businessId: string,
  input: CreateSalesInvoiceInput,
): Promise<CreatedSalesInvoice> {
  assertInput(input)

  const jurisdiction = resolveTaxJurisdiction(input.businessStateCode, input.partyStateCode)
  const totals = calculateSalesInvoiceTotals(input.lines, input.billDiscount, input.paidAmount, jurisdiction.isInterState)
  if (input.billDiscount > totals.taxableBeforeBillDiscount + 0.005) {
    throw new SalesInvoiceTransactionError('BILL_DISCOUNT_INVALID', 'Bill discount cannot be more than the taxable amount.')
  }
  if (input.paidAmount > totals.grandTotal + 0.005) {
    throw new SalesInvoiceTransactionError('PAID_AMOUNT_INVALID', 'Paid Now cannot be more than the grand total.')
  }

  const database = requireFirestore()
  const invoiceRef = doc(collection(database, getBusinessPath(uid, businessId, 'salesInvoices')))
  const itemRefs = input.lines.map(() => doc(collection(invoiceRef, 'items')))
  const paymentRef = totals.paidAmount > 0 ? doc(collection(database, getBusinessPath(uid, businessId, 'payments'))) : null
  const invoicePaymentRef = totals.paidAmount > 0 ? doc(collection(database, getBusinessPath(uid, businessId, 'invoicePayments'))) : null

  // Read each distinct product once. Duplicate lines are still supported—their
  // quantities are aggregated for the stock check and a SALE ledger row remains
  // present for each invoice line as requested.
  const productRefs = new Map<string, DocumentReference<DocumentData>>()
  input.lines.forEach((line) => productRefs.set(line.productId, productReference(uid, businessId, line.productId)))

  return runTransaction(database, async (transaction) => {
    // All reads happen before the number helper starts writing the sequence.
    // Firestore requires this ordering inside a transaction.
    const productEntries = await Promise.all(
      [...productRefs.entries()].map(async ([productId, reference]) => [productId, reference, await transaction.get(reference)] as const),
    )
    const products = new Map(productEntries.map(([productId, reference, snapshot]) => [productId, { reference, snapshot }]))

    const requestedByProduct = new Map<string, number>()
    input.lines.forEach((line) => {
      requestedByProduct.set(line.productId, roundStock((requestedByProduct.get(line.productId) ?? 0) + line.qty))
    })

    const currentStock = new Map<string, number>()
    for (const [productId, requestedQty] of requestedByProduct) {
      const product = products.get(productId)
      const matchingLine = input.lines.find((line) => line.productId === productId)
      if (!product?.snapshot.exists()) {
        throw new SalesInvoiceTransactionError('PRODUCT_NOT_FOUND', `Product ${matchingLine?.name || productId} no longer exists.`)
      }
      const availableQty = stockQuantity(product.snapshot.data().stockQty)
      if (availableQty + 0.000001 < requestedQty) {
        throw new SalesInvoiceTransactionError(
          'INSUFFICIENT_STOCK',
          `Insufficient stock for ${matchingLine?.name || product.snapshot.data().name || 'selected product'} (available ${availableQty}, requested ${requestedQty}).`,
        )
      }
      currentStock.set(productId, availableQty)
    }

    // This reads the SALE setting and queues its update. No transaction reads
    // occur after this point, preserving Firestore's read-before-write rule.
    const invoiceNumber = await reserveNextDocumentNumberInTransaction(transaction, uid, businessId, 'SALE')

    transaction.set(invoiceRef, {
      number: invoiceNumber,
      invoiceNumber,
      type: 'SALE',
      status: 'CONFIRMED',
      invoiceDate: input.invoiceDate,
      date: input.invoiceDate,
      partyId: input.partyId,
      partyName: input.partyName.trim(),
      partyPhone: input.partyPhone.trim(),
      partyGstin: input.partyGstin.trim().toUpperCase(),
      partyAddress: input.partyAddress.trim(),
      partyState: input.partyState.trim(),
      partyStateCode: jurisdiction.partyStateCode,
      businessState: input.businessState.trim(),
      businessStateCode: jurisdiction.businessStateCode,
      taxType: jurisdiction.isInterState ? 'IGST' : 'CGST_SGST',
      taxJurisdictionResolved: jurisdiction.isResolved,
      itemCount: input.lines.length,
      totalQty: totals.totalQty,
      subtotal: totals.subtotal,
      lineDiscountAmount: totals.lineDiscountAmount,
      taxableBeforeBillDiscount: totals.taxableBeforeBillDiscount,
      billDiscount: totals.billDiscount,
      taxableAmount: totals.taxableAmount,
      cgstAmount: totals.cgstAmount,
      sgstAmount: totals.sgstAmount,
      igstAmount: totals.igstAmount,
      totalTax: totals.totalTax,
      beforeRoundOff: totals.beforeRoundOff,
      roundOff: totals.roundOff,
      grandTotal: totals.grandTotal,
      paidAmount: totals.paidAmount,
      balanceAmount: totals.balanceAmount,
      paymentStatus: totals.paymentStatus,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: uid,
    })

    const remainingStock = new Map(currentStock)
    input.lines.forEach((line, index) => {
      const lineTotals = totals.lineTotals[index]
      const stockAfterLine = roundStock((remainingStock.get(line.productId) ?? 0) - line.qty)
      remainingStock.set(line.productId, stockAfterLine)

      transaction.set(itemRefs[index], {
        productId: line.productId,
        name: line.name.trim(),
        code: line.code.trim(),
        hsn: line.hsn.trim(),
        unit: line.unit.trim(),
        qty: line.qty,
        rate: line.rate,
        discountPercent: line.discountPercent,
        gstPercent: line.gstPercent,
        grossAmount: lineTotals.grossAmount,
        discountAmount: lineTotals.discountAmount,
        taxableAmount: lineTotals.taxableAmount,
        billDiscountAmount: lineTotals.billDiscountAmount,
        taxableAfterBillDiscount: lineTotals.taxableAfterBillDiscount,
        cgstAmount: lineTotals.cgstAmount,
        sgstAmount: lineTotals.sgstAmount,
        igstAmount: lineTotals.igstAmount,
        lineTotal: lineTotals.lineTotal,
        createdAt: serverTimestamp(),
      })

      const stockTransactionRef = doc(collection(database, getBusinessPath(uid, businessId, 'stockTransactions')))
      transaction.set(stockTransactionRef, {
        productId: line.productId,
        productName: line.name.trim(),
        type: 'SALE',
        quantityIn: 0,
        quantityOut: line.qty,
        balanceAfter: stockAfterLine,
        referenceType: 'SALES_INVOICE',
        referenceId: invoiceRef.id,
        invoiceId: invoiceRef.id,
        invoiceNumber,
        partyId: input.partyId,
        createdAt: serverTimestamp(),
        createdBy: uid,
      })
    })

    for (const [productId, stockAfter] of remainingStock) {
      const product = products.get(productId)
      if (product) {
        transaction.update(product.reference, {
          stockQty: stockAfter,
          updatedAt: serverTimestamp(),
        })
      }
    }

    if (paymentRef && invoicePaymentRef) {
      transaction.set(paymentRef, {
        direction: 'IN',
        paymentDirection: 'IN',
        amount: totals.paidAmount,
        date: input.invoiceDate,
        paymentDate: input.invoiceDate,
        mode: input.paymentMode,
        paymentMode: input.paymentMode,
        partyId: input.partyId,
        partyName: input.partyName.trim(),
        invoiceId: invoiceRef.id,
        salesInvoiceId: invoiceRef.id,
        invoiceNumber,
        source: 'SALES_INVOICE',
        createdAt: serverTimestamp(),
        createdBy: uid,
      })
      transaction.set(invoicePaymentRef, {
        invoiceId: invoiceRef.id,
        salesInvoiceId: invoiceRef.id,
        invoiceNumber,
        paymentId: paymentRef.id,
        partyId: input.partyId,
        partyName: input.partyName.trim(),
        direction: 'IN',
        amount: totals.paidAmount,
        paymentDate: input.invoiceDate,
        paymentMode: input.paymentMode,
        status: 'APPLIED',
        createdAt: serverTimestamp(),
        createdBy: uid,
      })
    }

    return {
      id: invoiceRef.id,
      number: invoiceNumber,
      grandTotal: totals.grandTotal,
      balanceAmount: totals.balanceAmount,
      paymentStatus: totals.paymentStatus,
    }
  })
}
