import {
  collection,
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  type DocumentData,
  type DocumentReference,
  type Unsubscribe,
} from 'firebase/firestore'
import { reserveNextDocumentNumberInTransaction } from '../lib/documentNumbering'
import { requireFirestore } from '../lib/firebase'
import { getBusinessPath } from '../lib/firestorePaths'
import { collectionForInvoiceKind } from '../lib/invoiceUtils'
import { paymentStatusAfterAllocation, roundMoney } from '../lib/paymentUtils'
import { calculateReturnNoteTotals, roundQuantity, type ReturnSourceLine } from '../lib/returnNoteUtils'
import {
  PAYMENT_MODES,
  type PaymentMode,
} from '../types/payment'
import type { InvoiceKind, InvoiceStatus } from '../types/invoice'
import type {
  CreatedReturnNote,
  CreateReturnNoteInput,
  ReturnedItemBalance,
  ReturnNoteKind,
  ReturnNoteLineInput,
  ReturnSettlementMethod,
} from '../types/returnNote'
import {
  collectionForReturnNote,
  documentTypeForReturnNote,
  sourceInvoiceKindForReturnNote,
} from '../types/returnNote'

const MONEY_EPSILON = 0.005
const QUANTITY_EPSILON = 0.000001

export type ReturnNoteTransactionErrorCode =
  | 'SOURCE_INVOICE_REQUIRED'
  | 'SOURCE_INVOICE_NOT_FOUND'
  | 'SOURCE_INVOICE_NOT_CONFIRMED'
  | 'RETURN_LINE_REQUIRED'
  | 'RETURN_LINE_INVALID'
  | 'SOURCE_ITEM_NOT_FOUND'
  | 'SOURCE_ITEM_INVALID'
  | 'RETURN_QUANTITY_EXCEEDED'
  | 'PRODUCT_NOT_FOUND'
  | 'INSUFFICIENT_STOCK_FOR_PURCHASE_RETURN'
  | 'NOTE_DATE_INVALID'
  | 'SETTLEMENT_INVALID'
  | 'SETTLEMENT_EXCEEDS_INVOICE_BALANCE'
  | 'REFUND_PAYMENT_INVALID'
  | 'RETURN_TOTAL_INVALID'

export class ReturnNoteTransactionError extends Error {
  constructor(
    public readonly code: ReturnNoteTransactionErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ReturnNoteTransactionError'
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numeric(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function nonNegative(value: unknown, fallback = 0): number {
  return Math.max(0, numeric(value, fallback))
}

function roundStock(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000
}

function invoiceStatus(value: unknown): InvoiceStatus {
  const candidate = text(value).toUpperCase()
  if (candidate === 'DRAFT' || candidate === 'CANCELLED' || candidate === 'CONFIRMED') return candidate
  // Pre-desktop posted documents did not always persist the status field.
  return 'CONFIRMED'
}

function taxType(value: unknown): 'IGST' | 'CGST_SGST' {
  return text(value).toUpperCase() === 'IGST' ? 'IGST' : 'CGST_SGST'
}

function isReturnNoteKind(value: unknown): value is ReturnNoteKind {
  return value === 'CREDIT' || value === 'DEBIT'
}

function isSettlementMethod(value: unknown): value is ReturnSettlementMethod {
  return value === 'APPLY_TO_INVOICE' || value === 'REFUND_PAYMENT' || value === 'ON_ACCOUNT'
}

function normalizeLines(lines: ReturnNoteLineInput[]): ReturnNoteLineInput[] {
  const quantities = new Map<string, number>()
  for (const line of lines) {
    const sourceInvoiceItemId = line.sourceInvoiceItemId?.trim()
    if (!sourceInvoiceItemId || !Number.isFinite(line.qty) || line.qty <= 0) {
      throw new ReturnNoteTransactionError('RETURN_LINE_INVALID', 'Every returned line needs an invoice item and a quantity greater than zero.')
    }
    quantities.set(sourceInvoiceItemId, roundQuantity((quantities.get(sourceInvoiceItemId) ?? 0) + line.qty))
  }
  return [...quantities.entries()].map(([sourceInvoiceItemId, qty]) => ({ sourceInvoiceItemId, qty }))
}

function assertInput(input: CreateReturnNoteInput): ReturnNoteLineInput[] {
  if (!isReturnNoteKind(input.kind)) {
    throw new ReturnNoteTransactionError('SETTLEMENT_INVALID', 'Choose either a credit note or a debit note.')
  }
  if (!input.sourceInvoiceId.trim()) {
    throw new ReturnNoteTransactionError('SOURCE_INVOICE_REQUIRED', 'Select the original invoice before saving a return note.')
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.noteDate)) {
    throw new ReturnNoteTransactionError('NOTE_DATE_INVALID', 'Choose a valid note date.')
  }
  if (!input.lines.length) {
    throw new ReturnNoteTransactionError('RETURN_LINE_REQUIRED', 'Select at least one item and return quantity.')
  }
  if (!isSettlementMethod(input.settlementMethod)) {
    throw new ReturnNoteTransactionError('SETTLEMENT_INVALID', 'Choose how this note should settle the original invoice or party account.')
  }
  if (input.settlementMethod === 'REFUND_PAYMENT' && !PAYMENT_MODES.includes(input.refundPaymentMode as PaymentMode)) {
    throw new ReturnNoteTransactionError('REFUND_PAYMENT_INVALID', 'Choose a valid refund payment mode.')
  }
  return normalizeLines(input.lines)
}

function toSourceItem(id: string, data: DocumentData): ReturnSourceLine {
  const taxableAmount = numeric(data.taxableAmount)
  const billDiscountAmount = numeric(data.billDiscountAmount)
  const taxableAfterBillDiscount = typeof data.taxableAfterBillDiscount === 'number' && Number.isFinite(data.taxableAfterBillDiscount)
    ? data.taxableAfterBillDiscount
    : roundMoney(Math.max(0, taxableAmount - billDiscountAmount))
  const cgstAmount = numeric(data.cgstAmount)
  const sgstAmount = numeric(data.sgstAmount)
  const igstAmount = numeric(data.igstAmount)

  return {
    id,
    productId: text(data.productId),
    name: text(data.name) || 'Unnamed product',
    code: text(data.code),
    hsn: text(data.hsn),
    unit: text(data.unit),
    qty: numeric(data.qty),
    rate: numeric(data.rate),
    discountPercent: numeric(data.discountPercent),
    gstPercent: numeric(data.gstPercent),
    grossAmount: numeric(data.grossAmount),
    discountAmount: numeric(data.discountAmount),
    taxableAmount,
    billDiscountAmount,
    taxableAfterBillDiscount,
    cgstAmount,
    sgstAmount,
    igstAmount,
    lineTotal: typeof data.lineTotal === 'number' && Number.isFinite(data.lineTotal)
      ? data.lineTotal
      : roundMoney(taxableAfterBillDiscount + cgstAmount + sgstAmount + igstAmount),
  }
}

function sourceInvoiceBalance(data: DocumentData): number {
  return Math.max(0, numeric(data.balanceAmount, numeric(data.balanceDue, numeric(data.dueAmount))))
}

function sourceInvoicePaidAmount(data: DocumentData, balanceAmount: number): number {
  if (typeof data.paidAmount === 'number' && Number.isFinite(data.paidAmount)) return Math.max(0, data.paidAmount)
  return Math.max(0, numeric(data.grandTotal) - balanceAmount)
}

function productReference(
  database: ReturnType<typeof requireFirestore>,
  uid: string,
  businessId: string,
  productId: string,
): DocumentReference<DocumentData> {
  return doc(database, getBusinessPath(uid, businessId, 'products'), productId)
}

/** Watches cumulative returned quantities without modifying original invoice item snapshots. */
export function subscribeToReturnedItemBalances(
  uid: string,
  businessId: string,
  sourceKind: InvoiceKind,
  sourceInvoiceId: string,
  onBalances: (balances: ReturnedItemBalance[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  if (!sourceInvoiceId.trim()) {
    onBalances([])
    return () => undefined
  }
  const database = requireFirestore()
  const sourceRef = doc(database, getBusinessPath(uid, businessId, collectionForInvoiceKind(sourceKind)), sourceInvoiceId)
  return onSnapshot(
    collection(sourceRef, 'returnBalances'),
    (snapshot) => onBalances(snapshot.docs.map((item) => ({
      sourceInvoiceItemId: text(item.data().sourceInvoiceItemId) || item.id,
      returnedQty: nonNegative(item.data().returnedQty),
    }))),
    (error) => onError(error),
  )
}

/**
 * Posts a sales return credit note or purchase return debit note as one
 * transaction. The source invoice's item snapshots remain immutable; separate
 * `returnBalances` docs guard against cumulative over-returns and participate
 * in transaction retries. Stock, the note/items, optional settlement/payment,
 * document number, and the source-invoice audit fields commit together.
 */
export async function createConfirmedReturnNote(
  uid: string,
  businessId: string,
  input: CreateReturnNoteInput,
): Promise<CreatedReturnNote> {
  const requestedLines = assertInput(input)
  const noteText = text(input.note)
  const refundReference = text(input.refundReference)
  const refundPaymentMode = input.refundPaymentMode as PaymentMode
  const database = requireFirestore()
  const sourceKind = sourceInvoiceKindForReturnNote(input.kind)
  const sourceInvoiceRef = doc(database, getBusinessPath(uid, businessId, collectionForInvoiceKind(sourceKind)), input.sourceInvoiceId.trim())
  const noteRef = doc(collection(database, getBusinessPath(uid, businessId, collectionForReturnNote(input.kind))))
  const sourceItemRefs = requestedLines.map((line) => doc(collection(sourceInvoiceRef, 'items'), line.sourceInvoiceItemId))
  const returnBalanceRefs = requestedLines.map((line) => doc(collection(sourceInvoiceRef, 'returnBalances'), line.sourceInvoiceItemId))
  const noteItemRefs = requestedLines.map(() => doc(collection(noteRef, 'items')))
  const paymentRef = input.settlementMethod === 'REFUND_PAYMENT'
    ? doc(collection(database, getBusinessPath(uid, businessId, 'payments')))
    : null

  return runTransaction(database, async (transaction) => {
    // All source/return-state reads happen before any write. Product references
    // are derived from the immutable source item snapshots and read next, also
    // before document-number reservation begins writing.
    const [sourceInvoiceSnapshot, sourceItemSnapshots, returnBalanceSnapshots] = await Promise.all([
      transaction.get(sourceInvoiceRef),
      Promise.all(sourceItemRefs.map((reference) => transaction.get(reference))),
      Promise.all(returnBalanceRefs.map((reference) => transaction.get(reference))),
    ])

    if (!sourceInvoiceSnapshot.exists()) {
      throw new ReturnNoteTransactionError('SOURCE_INVOICE_NOT_FOUND', 'The source invoice no longer exists.')
    }
    const sourceInvoice = sourceInvoiceSnapshot.data()
    if (invoiceStatus(sourceInvoice.status) !== 'CONFIRMED') {
      throw new ReturnNoteTransactionError('SOURCE_INVOICE_NOT_CONFIRMED', 'Only a confirmed invoice can receive a return note.')
    }
    if (sourceItemSnapshots.some((snapshot) => !snapshot.exists())) {
      throw new ReturnNoteTransactionError('SOURCE_ITEM_NOT_FOUND', 'A selected invoice item no longer exists. Reload the source invoice and try again.')
    }

    const sourceItems = sourceItemSnapshots.map((snapshot) => toSourceItem(snapshot.id, snapshot.data() ?? {}))
    const sourceItemsById = new Map(sourceItems.map((item) => [item.id, item]))
    for (let index = 0; index < requestedLines.length; index += 1) {
      const requested = requestedLines[index]
      const sourceItem = sourceItemsById.get(requested.sourceInvoiceItemId)
      if (!sourceItem || !sourceItem.productId || sourceItem.qty <= 0) {
        throw new ReturnNoteTransactionError('SOURCE_ITEM_INVALID', 'A selected source item cannot be returned safely.')
      }
      const previousReturnedQty = returnBalanceSnapshots[index].exists()
        ? nonNegative(returnBalanceSnapshots[index].data()?.returnedQty)
        : 0
      if (previousReturnedQty + requested.qty > sourceItem.qty + QUANTITY_EPSILON) {
        const available = Math.max(0, roundQuantity(sourceItem.qty - previousReturnedQty))
        throw new ReturnNoteTransactionError(
          'RETURN_QUANTITY_EXCEEDED',
          `${sourceItem.name} has only ${available} ${sourceItem.unit || 'unit(s)'} available to return from the original invoice.`,
        )
      }
    }

    const totals = calculateReturnNoteTotals(sourceItems, requestedLines)
    if (!totals.lineTotals.length || totals.totalQty <= 0) {
      throw new ReturnNoteTransactionError('RETURN_LINE_REQUIRED', 'Select at least one item and return quantity.')
    }
    if (input.settlementMethod === 'REFUND_PAYMENT' && totals.grandTotal <= MONEY_EPSILON) {
      throw new ReturnNoteTransactionError('RETURN_TOTAL_INVALID', 'A refund payment requires a return amount greater than zero.')
    }

    const requestedByProduct = new Map<string, number>()
    totals.lineTotals.forEach((line) => {
      requestedByProduct.set(line.productId, roundStock((requestedByProduct.get(line.productId) ?? 0) + line.returnedQty))
    })
    const productRefs = new Map<string, DocumentReference<DocumentData>>()
    requestedByProduct.forEach((_quantity, productId) => productRefs.set(productId, productReference(database, uid, businessId, productId)))
    const productEntries = await Promise.all(
      [...productRefs.entries()].map(async ([productId, reference]) => [productId, reference, await transaction.get(reference)] as const),
    )
    const products = new Map(productEntries.map(([productId, reference, snapshot]) => [productId, { reference, snapshot }]))
    const currentStock = new Map<string, number>()

    for (const [productId, quantity] of requestedByProduct) {
      const product = products.get(productId)
      const sourceItem = totals.lineTotals.find((line) => line.productId === productId)
      if (!product?.snapshot.exists()) {
        throw new ReturnNoteTransactionError('PRODUCT_NOT_FOUND', `Product ${sourceItem?.name || productId} no longer exists.`)
      }
      const stockQty = numeric(product.snapshot.data().stockQty)
      if (input.kind === 'DEBIT' && stockQty + QUANTITY_EPSILON < quantity) {
        throw new ReturnNoteTransactionError(
          'INSUFFICIENT_STOCK_FOR_PURCHASE_RETURN',
          `Cannot return ${sourceItem?.name || productId} to the supplier because only ${stockQty} is in stock and ${quantity} must leave inventory.`,
        )
      }
      currentStock.set(productId, stockQty)
    }

    const currentInvoiceBalance = sourceInvoiceBalance(sourceInvoice)
    const sourceInvoicePaid = sourceInvoicePaidAmount(sourceInvoice, currentInvoiceBalance)
    if (input.settlementMethod === 'APPLY_TO_INVOICE' && totals.grandTotal > currentInvoiceBalance + MONEY_EPSILON) {
      throw new ReturnNoteTransactionError(
        'SETTLEMENT_EXCEEDS_INVOICE_BALANCE',
        `This return is ${totals.grandTotal.toFixed(2)}, but the source invoice has only ${currentInvoiceBalance.toFixed(2)} outstanding. Choose refund payment or leave the amount on account.`,
      )
    }

    // All transaction reads are complete. Number reservation queues its write
    // alongside every business mutation below, so a failed stock/settlement
    // validation does not consume a credit/debit note number.
    const documentType = documentTypeForReturnNote(input.kind)
    const noteNumber = await reserveNextDocumentNumberInTransaction(transaction, uid, businessId, documentType)
    const sourceInvoiceNumber = text(sourceInvoice.invoiceNumber) || text(sourceInvoice.number) || input.sourceInvoiceId
    const nextInvoiceBalance = input.settlementMethod === 'APPLY_TO_INVOICE'
      ? roundMoney(Math.max(0, currentInvoiceBalance - totals.grandTotal))
      : currentInvoiceBalance
    const appliedToInvoiceAmount = input.settlementMethod === 'APPLY_TO_INVOICE' ? totals.grandTotal : 0
    const refundAmount = input.settlementMethod === 'REFUND_PAYMENT' ? totals.grandTotal : 0
    // Applying a note directly to the source balance is already represented by
    // that lower invoice balance. Refund/on-account notes remain a separate
    // party credit/debit; refund cash then offsets that note in the party ledger.
    const partyBalanceEffectAmount = input.settlementMethod === 'APPLY_TO_INVOICE' ? 0 : totals.grandTotal
    const noteCountField = input.kind === 'CREDIT' ? 'creditNoteCount' : 'debitNoteCount'
    const noteTotalField = input.kind === 'CREDIT' ? 'creditNoteTotal' : 'debitNoteTotal'

    transaction.set(noteRef, {
      number: noteNumber,
      ...(input.kind === 'CREDIT' ? { creditNoteNumber: noteNumber } : { debitNoteNumber: noteNumber }),
      type: documentType,
      noteKind: input.kind,
      status: 'CONFIRMED',
      noteDate: input.noteDate,
      date: input.noteDate,
      sourceInvoiceId: sourceInvoiceRef.id,
      sourceInvoiceNumber,
      sourceInvoiceType: sourceKind,
      sourceInvoiceDate: text(sourceInvoice.date) || text(sourceInvoice.invoiceDate) || text(sourceInvoice.purchaseDate),
      partyId: text(sourceInvoice.partyId),
      partyName: text(sourceInvoice.partyName),
      partyPhone: text(sourceInvoice.partyPhone),
      partyGstin: text(sourceInvoice.partyGstin),
      partyAddress: text(sourceInvoice.partyAddress),
      partyState: text(sourceInvoice.partyState),
      partyStateCode: text(sourceInvoice.partyStateCode),
      businessState: text(sourceInvoice.businessState),
      businessStateCode: text(sourceInvoice.businessStateCode),
      taxType: taxType(sourceInvoice.taxType),
      taxJurisdictionResolved: sourceInvoice.taxJurisdictionResolved === true,
      itemCount: totals.lineTotals.length,
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
      settlementMethod: input.settlementMethod,
      appliedToInvoiceAmount,
      refundAmount,
      partyBalanceEffectAmount,
      sourceInvoiceBalanceBefore: currentInvoiceBalance,
      sourceInvoiceBalanceAfter: nextInvoiceBalance,
      ...(paymentRef ? {
        refundPaymentId: paymentRef.id,
        refundPaymentMode,
        refundReference,
      } : {}),
      note: noteText,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: uid,
    })

    const runningStock = new Map(currentStock)
    totals.lineTotals.forEach((line, index) => {
      const nextStockQty = roundStock((runningStock.get(line.productId) ?? 0) + (input.kind === 'CREDIT' ? line.returnedQty : -line.returnedQty))
      runningStock.set(line.productId, nextStockQty)

      transaction.set(noteItemRefs[index], {
        sourceInvoiceItemId: line.sourceInvoiceItemId,
        sourceInvoiceId: sourceInvoiceRef.id,
        productId: line.productId,
        name: line.name,
        code: line.code,
        hsn: line.hsn,
        unit: line.unit,
        sourceInvoiceQty: line.sourceInvoiceQty,
        qty: line.returnedQty,
        returnedQty: line.returnedQty,
        rate: line.rate,
        discountPercent: line.discountPercent,
        gstPercent: line.gstPercent,
        grossAmount: line.grossAmount,
        discountAmount: line.discountAmount,
        taxableAmount: line.taxableAmount,
        billDiscountAmount: line.billDiscountAmount,
        taxableAfterBillDiscount: line.taxableAfterBillDiscount,
        cgstAmount: line.cgstAmount,
        sgstAmount: line.sgstAmount,
        igstAmount: line.igstAmount,
        lineTotal: line.lineTotal,
        createdAt: serverTimestamp(),
      })

      const stockTransactionRef = doc(collection(database, getBusinessPath(uid, businessId, 'stockTransactions')))
      transaction.set(stockTransactionRef, {
        productId: line.productId,
        productName: line.name,
        type: input.kind === 'CREDIT' ? 'SALE_RETURN' : 'PURCHASE_RETURN',
        quantityIn: input.kind === 'CREDIT' ? line.returnedQty : 0,
        quantityOut: input.kind === 'DEBIT' ? line.returnedQty : 0,
        balanceAfter: nextStockQty,
        referenceType: documentType,
        referenceId: noteRef.id,
        ...(input.kind === 'CREDIT' ? { creditNoteId: noteRef.id } : { debitNoteId: noteRef.id }),
        noteNumber,
        sourceInvoiceId: sourceInvoiceRef.id,
        ...(sourceKind === 'SALE' ? { salesInvoiceId: sourceInvoiceRef.id } : { purchaseInvoiceId: sourceInvoiceRef.id }),
        sourceInvoiceNumber,
        partyId: text(sourceInvoice.partyId),
        partyName: text(sourceInvoice.partyName),
        createdAt: serverTimestamp(),
        createdBy: uid,
      })
    })

    for (let index = 0; index < requestedLines.length; index += 1) {
      const currentReturnedQty = returnBalanceSnapshots[index].exists()
        ? nonNegative(returnBalanceSnapshots[index].data()?.returnedQty)
        : 0
      transaction.set(returnBalanceRefs[index], {
        sourceInvoiceItemId: requestedLines[index].sourceInvoiceItemId,
        sourceInvoiceId: sourceInvoiceRef.id,
        returnedQty: roundQuantity(currentReturnedQty + requestedLines[index].qty),
        lastReturnNoteId: noteRef.id,
        lastReturnNoteNumber: noteNumber,
        lastReturnNoteKind: input.kind,
        updatedAt: serverTimestamp(),
        ...(returnBalanceSnapshots[index].exists() ? {} : { createdAt: serverTimestamp(), createdBy: uid }),
        updatedBy: uid,
      }, { merge: true })
    }

    for (const [productId, nextStockQty] of runningStock) {
      const product = products.get(productId)
      if (!product) continue
      transaction.update(product.reference, {
        stockQty: nextStockQty,
        updatedAt: serverTimestamp(),
      })
    }

    transaction.update(sourceInvoiceRef, {
      [noteCountField]: Math.max(0, Math.trunc(numeric(sourceInvoice[noteCountField]))) + 1,
      [noteTotalField]: roundMoney(nonNegative(sourceInvoice[noteTotalField]) + totals.grandTotal),
      lastReturnNoteId: noteRef.id,
      lastReturnNoteNumber: noteNumber,
      lastReturnNoteKind: input.kind,
      lastReturnNoteAt: serverTimestamp(),
      ...(input.settlementMethod === 'APPLY_TO_INVOICE' ? {
        balanceAmount: nextInvoiceBalance,
        paymentStatus: paymentStatusAfterAllocation(sourceInvoicePaid, nextInvoiceBalance),
        [input.kind === 'CREDIT' ? 'creditNoteAppliedAmount' : 'debitNoteAppliedAmount']:
          roundMoney(nonNegative(sourceInvoice[input.kind === 'CREDIT' ? 'creditNoteAppliedAmount' : 'debitNoteAppliedAmount']) + totals.grandTotal),
      } : {}),
      updatedAt: serverTimestamp(),
    })

    if (paymentRef) {
      const paymentDirection = input.kind === 'CREDIT' ? 'OUT' : 'IN'
      transaction.set(paymentRef, {
        direction: paymentDirection,
        paymentDirection,
        amount: refundAmount,
        allocatedAmount: 0,
        unallocatedAmount: refundAmount,
        allocationCount: 0,
        paymentDate: input.noteDate,
        date: input.noteDate,
        mode: refundPaymentMode,
        paymentMode: refundPaymentMode,
        referenceNumber: refundReference,
        note: `${input.kind === 'CREDIT' ? 'Customer refund' : 'Supplier refund'} for ${noteNumber}${noteText ? ` · ${noteText}` : ''}`,
        partyId: text(sourceInvoice.partyId),
        partyName: text(sourceInvoice.partyName),
        ...(input.kind === 'CREDIT' ? { creditNoteId: noteRef.id } : { debitNoteId: noteRef.id }),
        sourceInvoiceId: sourceInvoiceRef.id,
        sourceInvoiceNumber,
        source: input.kind === 'CREDIT' ? 'CREDIT_NOTE_REFUND' : 'DEBIT_NOTE_REFUND',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: uid,
      })
    }

    return {
      id: noteRef.id,
      number: noteNumber,
      kind: input.kind,
      sourceInvoiceId: sourceInvoiceRef.id,
      grandTotal: totals.grandTotal,
      appliedToInvoiceAmount,
      refundAmount,
      refundPaymentId: paymentRef?.id ?? '',
    }
  })
}
