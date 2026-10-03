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
import { purchasePriceChanged } from '../lib/purchaseInvoiceUtils'
import type {
  CreatedPurchaseInvoice,
  CreatePurchaseInvoiceInput,
  PurchaseInvoiceLine,
} from '../types/purchaseInvoice'

export type PurchaseInvoiceTransactionErrorCode =
  | 'SUPPLIER_REQUIRED'
  | 'SUPPLIER_INVOICE_NUMBER_REQUIRED'
  | 'LINE_REQUIRED'
  | 'LINE_INVALID'
  | 'BILL_DISCOUNT_INVALID'
  | 'PAID_AMOUNT_INVALID'
  | 'PRODUCT_NOT_FOUND'

export class PurchaseInvoiceTransactionError extends Error {
  constructor(
    public readonly code: PurchaseInvoiceTransactionErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'PurchaseInvoiceTransactionError'
  }
}

function nonNegativeFinite(value: number): boolean {
  return Number.isFinite(value) && value >= 0
}

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function roundStock(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000
}

function productReference(uid: string, businessId: string, productId: string): DocumentReference<DocumentData> {
  return doc(requireFirestore(), getBusinessPath(uid, businessId, 'products'), productId)
}

function assertLine(line: PurchaseInvoiceLine): void {
  if (!line.productId.trim() || !line.name.trim()) {
    throw new PurchaseInvoiceTransactionError('LINE_INVALID', 'Every purchase line needs a selected product.')
  }
  if (!positiveFinite(line.qty)) {
    throw new PurchaseInvoiceTransactionError('LINE_INVALID', `Enter a quantity greater than zero for ${line.name || 'each product'}.`)
  }
  if (!nonNegativeFinite(line.rate)) {
    throw new PurchaseInvoiceTransactionError('LINE_INVALID', `Enter a valid purchase rate for ${line.name || 'each product'}.`)
  }
  if (!nonNegativeFinite(line.discountPercent) || line.discountPercent > 100) {
    throw new PurchaseInvoiceTransactionError('LINE_INVALID', `Enter a discount from 0 to 100 for ${line.name || 'each product'}.`)
  }
  if (!nonNegativeFinite(line.gstPercent) || line.gstPercent > 100) {
    throw new PurchaseInvoiceTransactionError('LINE_INVALID', `Enter a GST rate from 0 to 100 for ${line.name || 'each product'}.`)
  }
}

function assertInput(input: CreatePurchaseInvoiceInput): void {
  if (!input.partyId.trim() || !input.partyName.trim()) {
    throw new PurchaseInvoiceTransactionError('SUPPLIER_REQUIRED', 'Select a supplier before confirming the purchase invoice.')
  }
  if (!input.supplierInvoiceNumber.trim()) {
    throw new PurchaseInvoiceTransactionError('SUPPLIER_INVOICE_NUMBER_REQUIRED', "Enter the supplier's invoice number from their bill.")
  }
  if (!input.purchaseDate.trim()) {
    throw new PurchaseInvoiceTransactionError('LINE_INVALID', 'Choose a purchase date before confirming the purchase.')
  }
  if (!input.lines.length) {
    throw new PurchaseInvoiceTransactionError('LINE_REQUIRED', 'Add at least one product to the purchase invoice.')
  }
  input.lines.forEach(assertLine)
  if (!nonNegativeFinite(input.billDiscount)) {
    throw new PurchaseInvoiceTransactionError('BILL_DISCOUNT_INVALID', 'Enter a valid non-negative bill discount.')
  }
  if (!nonNegativeFinite(input.paidAmount)) {
    throw new PurchaseInvoiceTransactionError('PAID_AMOUNT_INVALID', 'Enter a valid non-negative Paid Now amount.')
  }
}

/**
 * Creates a confirmed purchase in one transaction. The transaction reads the
 * current products, reserves the PURCHASE sequence, increases stock, writes the
 * invoice and immutable item snapshots, emits PURCHASE ledger rows, and applies
 * the optional supplier payment. Keeping them together prevents a partial
 * purchase (for example, stock added without an auditable supplier bill).
 */
export async function createConfirmedPurchaseInvoice(
  uid: string,
  businessId: string,
  input: CreatePurchaseInvoiceInput,
): Promise<CreatedPurchaseInvoice> {
  assertInput(input)

  const jurisdiction = resolveTaxJurisdiction(input.businessStateCode, input.partyStateCode)
  const totals = calculateSalesInvoiceTotals(input.lines, input.billDiscount, input.paidAmount, jurisdiction.isInterState)
  if (input.billDiscount > totals.taxableBeforeBillDiscount + 0.005) {
    throw new PurchaseInvoiceTransactionError('BILL_DISCOUNT_INVALID', 'Bill discount cannot be more than the taxable amount.')
  }
  if (input.paidAmount > totals.grandTotal + 0.005) {
    throw new PurchaseInvoiceTransactionError('PAID_AMOUNT_INVALID', 'Paid Now cannot be more than the grand total.')
  }

  const database = requireFirestore()
  const invoiceRef = doc(collection(database, getBusinessPath(uid, businessId, 'purchaseInvoices')))
  const itemRefs = input.lines.map(() => doc(collection(invoiceRef, 'items')))
  const paymentRef = totals.paidAmount > 0 ? doc(collection(database, getBusinessPath(uid, businessId, 'payments'))) : null
  const invoicePaymentRef = totals.paidAmount > 0 ? doc(collection(database, getBusinessPath(uid, businessId, 'invoicePayments'))) : null
  const productRefs = new Map<string, DocumentReference<DocumentData>>()
  input.lines.forEach((line) => productRefs.set(line.productId, productReference(uid, businessId, line.productId)))

  return runTransaction(database, async (transaction) => {
    // Read every product before the document-number helper queues any write;
    // Firestore requires all transaction reads to precede transaction writes.
    const productEntries = await Promise.all(
      [...productRefs.entries()].map(async ([productId, reference]) => [productId, reference, await transaction.get(reference)] as const),
    )
    const products = new Map(productEntries.map(([productId, reference, snapshot]) => [productId, { reference, snapshot }]))

    const incomingByProduct = new Map<string, number>()
    const purchaseRateByProduct = new Map<string, number>()
    input.lines.forEach((line) => {
      incomingByProduct.set(line.productId, roundStock((incomingByProduct.get(line.productId) ?? 0) + line.qty))
      // The UI keeps one line per product; retaining the final line is a safe
      // fallback if an imported/legacy draft contains duplicates.
      purchaseRateByProduct.set(line.productId, line.rate)
    })

    const currentStock = new Map<string, number>()
    for (const productId of incomingByProduct.keys()) {
      const product = products.get(productId)
      const matchingLine = input.lines.find((line) => line.productId === productId)
      if (!product?.snapshot.exists()) {
        throw new PurchaseInvoiceTransactionError('PRODUCT_NOT_FOUND', `Product ${matchingLine?.name || productId} no longer exists.`)
      }
      // Preserve the committed stock as-is and add the received quantity below.
      // (A legacy negative balance must not be silently reset by a purchase.)
      currentStock.set(productId, numberValue(product.snapshot.data().stockQty))
    }

    // This transaction-aware helper uses the exact Phase 2 numbering rules and
    // keeps sequence advancement atomic with the purchase and stock increase.
    const invoiceNumber = await reserveNextDocumentNumberInTransaction(transaction, uid, businessId, 'PURCHASE')

    transaction.set(invoiceRef, {
      number: invoiceNumber,
      invoiceNumber,
      supplierInvoiceNumber: input.supplierInvoiceNumber.trim(),
      type: 'PURCHASE',
      status: 'CONFIRMED',
      purchaseDate: input.purchaseDate,
      date: input.purchaseDate,
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
      updateProductPurchasePrices: input.updateProductPurchasePrices,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: uid,
    })

    const stockAfter = new Map(currentStock)
    input.lines.forEach((line, index) => {
      const lineTotals = totals.lineTotals[index]
      const stockAfterLine = roundStock((stockAfter.get(line.productId) ?? 0) + line.qty)
      stockAfter.set(line.productId, stockAfterLine)

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
        type: 'PURCHASE',
        quantityIn: line.qty,
        quantityOut: 0,
        balanceAfter: stockAfterLine,
        referenceType: 'PURCHASE_INVOICE',
        referenceId: invoiceRef.id,
        invoiceId: invoiceRef.id,
        purchaseInvoiceId: invoiceRef.id,
        invoiceNumber,
        supplierInvoiceNumber: input.supplierInvoiceNumber.trim(),
        partyId: input.partyId,
        createdAt: serverTimestamp(),
        createdBy: uid,
      })
    })

    for (const [productId, newStockQty] of stockAfter) {
      const product = products.get(productId)
      if (!product) continue
      const productData = product.snapshot.data() ?? {}
      const newPurchasePrice = purchaseRateByProduct.get(productId) ?? numberValue(productData.purchasePrice)
      const currentPurchasePrice = numberValue(productData.purchasePrice)
      const shouldUpdatePurchasePrice = input.updateProductPurchasePrices && purchasePriceChanged(currentPurchasePrice, newPurchasePrice)
      transaction.update(product.reference, {
        stockQty: newStockQty,
        ...(shouldUpdatePurchasePrice ? { purchasePrice: newPurchasePrice } : {}),
        updatedAt: serverTimestamp(),
      })
    }

    if (paymentRef && invoicePaymentRef) {
      transaction.set(paymentRef, {
        direction: 'OUT',
        paymentDirection: 'OUT',
        amount: totals.paidAmount,
        date: input.purchaseDate,
        paymentDate: input.purchaseDate,
        mode: input.paymentMode,
        paymentMode: input.paymentMode,
        partyId: input.partyId,
        partyName: input.partyName.trim(),
        invoiceId: invoiceRef.id,
        purchaseInvoiceId: invoiceRef.id,
        invoiceNumber,
        supplierInvoiceNumber: input.supplierInvoiceNumber.trim(),
        source: 'PURCHASE_INVOICE',
        createdAt: serverTimestamp(),
        createdBy: uid,
      })
      transaction.set(invoicePaymentRef, {
        invoiceId: invoiceRef.id,
        purchaseInvoiceId: invoiceRef.id,
        invoiceNumber,
        supplierInvoiceNumber: input.supplierInvoiceNumber.trim(),
        paymentId: paymentRef.id,
        partyId: input.partyId,
        partyName: input.partyName.trim(),
        direction: 'OUT',
        amount: totals.paidAmount,
        paymentDate: input.purchaseDate,
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
