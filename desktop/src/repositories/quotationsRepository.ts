import {
  collection,
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  type DocumentData,
  type Unsubscribe,
} from 'firebase/firestore'
import { reserveNextDocumentNumberInTransaction } from '../lib/documentNumbering'
import { canSetQuotationStatus } from '../lib/quotationUtils'
import { calculateSalesInvoiceTotals, resolveTaxJurisdiction } from '../lib/salesInvoiceTotals'
import { requireFirestore } from '../lib/firebase'
import { getBusinessPath } from '../lib/firestorePaths'
import type { SalesInvoiceLine } from '../types/salesInvoice'
import type {
  CreatedQuotation,
  CreateQuotationInput,
  QuotationConversionDraft,
  QuotationDetail,
  QuotationItemSnapshot,
  QuotationListItem,
  QuotationStatus,
} from '../types/quotation'

export type QuotationErrorCode =
  | 'PARTY_REQUIRED'
  | 'LINE_REQUIRED'
  | 'LINE_INVALID'
  | 'BILL_DISCOUNT_INVALID'
  | 'DATE_INVALID'
  | 'VALID_UNTIL_INVALID'
  | 'QUOTATION_NOT_FOUND'
  | 'STATUS_TRANSITION_INVALID'
  | 'STATUS_RESERVED'

export class QuotationError extends Error {
  constructor(
    public readonly code: QuotationErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'QuotationError'
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numeric(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function dateText(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    const converted = value.toDate()
    return converted instanceof Date && !Number.isNaN(converted.valueOf()) ? converted.toISOString() : ''
  }
  return ''
}

function dateOnly(value: unknown): string {
  const raw = dateText(value)
  return raw.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? raw
}

function quotationStatus(value: unknown): QuotationStatus {
  const candidate = text(value).toUpperCase()
  if (candidate === 'SENT' || candidate === 'ACCEPTED' || candidate === 'REJECTED' || candidate === 'EXPIRED' || candidate === 'CONVERTED') {
    return candidate
  }
  return 'DRAFT'
}

function taxType(value: unknown): 'IGST' | 'CGST_SGST' {
  return text(value).toUpperCase() === 'IGST' ? 'IGST' : 'CGST_SGST'
}

function nonNegativeFinite(value: number): boolean {
  return Number.isFinite(value) && value >= 0
}

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

function assertLine(line: SalesInvoiceLine): void {
  if (!line.productId.trim() || !line.name.trim()) {
    throw new QuotationError('LINE_INVALID', 'Every quotation line needs a selected product.')
  }
  if (!positiveFinite(line.qty)) {
    throw new QuotationError('LINE_INVALID', `Enter a quantity greater than zero for ${line.name || 'each product'}.`)
  }
  if (!nonNegativeFinite(line.rate)) {
    throw new QuotationError('LINE_INVALID', `Enter a valid rate for ${line.name || 'each product'}.`)
  }
  if (!nonNegativeFinite(line.discountPercent) || line.discountPercent > 100) {
    throw new QuotationError('LINE_INVALID', `Enter a discount from 0 to 100 for ${line.name || 'each product'}.`)
  }
  if (!nonNegativeFinite(line.gstPercent) || line.gstPercent > 100) {
    throw new QuotationError('LINE_INVALID', `Enter a GST rate from 0 to 100 for ${line.name || 'each product'}.`)
  }
}

function assertInput(input: CreateQuotationInput): void {
  if (!input.partyId.trim() || !input.partyName.trim()) {
    throw new QuotationError('PARTY_REQUIRED', 'Select a customer before saving the quotation.')
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.quotationDate)) {
    throw new QuotationError('DATE_INVALID', 'Choose a valid quotation date.')
  }
  if (input.validUntil && !/^\d{4}-\d{2}-\d{2}$/.test(input.validUntil)) {
    throw new QuotationError('VALID_UNTIL_INVALID', 'Choose a valid quotation expiry date.')
  }
  if (input.validUntil && input.validUntil < input.quotationDate) {
    throw new QuotationError('VALID_UNTIL_INVALID', 'Valid until date cannot be before the quotation date.')
  }
  if (!input.lines.length) {
    throw new QuotationError('LINE_REQUIRED', 'Add at least one product to the quotation.')
  }
  input.lines.forEach(assertLine)
  if (!nonNegativeFinite(input.billDiscount)) {
    throw new QuotationError('BILL_DISCOUNT_INVALID', 'Enter a valid non-negative bill discount.')
  }
}

function toQuotationListItem(id: string, data: DocumentData): QuotationListItem {
  return {
    id,
    number: text(data.number) || text(data.quotationNumber) || text(data.documentNumber) || 'Untitled quotation',
    date: dateOnly(data.date) || dateOnly(data.quotationDate) || dateOnly(data.createdAt),
    validUntil: dateOnly(data.validUntil),
    partyId: text(data.partyId),
    partyName: text(data.partyName) || 'Unnamed party',
    grandTotal: numeric(data.grandTotal),
    status: quotationStatus(data.status),
    salesInvoiceId: text(data.salesInvoiceId),
    salesInvoiceNumber: text(data.salesInvoiceNumber),
    createdAt: dateText(data.createdAt),
  }
}

function toQuotationItem(id: string, data: DocumentData): QuotationItemSnapshot {
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
    taxableAmount: numeric(data.taxableAmount),
    billDiscountAmount: numeric(data.billDiscountAmount),
    taxableAfterBillDiscount: numeric(data.taxableAfterBillDiscount),
    cgstAmount: numeric(data.cgstAmount),
    sgstAmount: numeric(data.sgstAmount),
    igstAmount: numeric(data.igstAmount),
    lineTotal: numeric(data.lineTotal),
  }
}

function toQuotationDetail(id: string, data: DocumentData): Omit<QuotationDetail, 'items'> {
  return {
    ...toQuotationListItem(id, data),
    quotationNumber: text(data.quotationNumber) || text(data.number) || text(data.documentNumber) || 'Untitled quotation',
    partyPhone: text(data.partyPhone),
    partyGstin: text(data.partyGstin),
    partyAddress: text(data.partyAddress),
    partyState: text(data.partyState),
    partyStateCode: text(data.partyStateCode),
    businessState: text(data.businessState),
    businessStateCode: text(data.businessStateCode),
    taxType: taxType(data.taxType),
    taxJurisdictionResolved: data.taxJurisdictionResolved === true,
    itemCount: numeric(data.itemCount),
    totalQty: numeric(data.totalQty),
    subtotal: numeric(data.subtotal),
    lineDiscountAmount: numeric(data.lineDiscountAmount),
    taxableBeforeBillDiscount: numeric(data.taxableBeforeBillDiscount),
    billDiscount: numeric(data.billDiscount),
    taxableAmount: numeric(data.taxableAmount),
    cgstAmount: numeric(data.cgstAmount),
    sgstAmount: numeric(data.sgstAmount),
    igstAmount: numeric(data.igstAmount),
    totalTax: numeric(data.totalTax),
    beforeRoundOff: numeric(data.beforeRoundOff),
    roundOff: numeric(data.roundOff),
    note: text(data.note),
    createdBy: text(data.createdBy),
  }
}

function quotationReference(uid: string, businessId: string, quotationId: string) {
  return doc(requireFirestore(), getBusinessPath(uid, businessId, 'quotations'), quotationId)
}

/**
 * Saves a quotation and immutable line snapshots without touching inventory or
 * payments. Number reservation and all quotation rows are one transaction so
 * a number cannot be consumed without its document audit trail.
 */
export async function createQuotation(
  uid: string,
  businessId: string,
  input: CreateQuotationInput,
): Promise<CreatedQuotation> {
  assertInput(input)
  const jurisdiction = resolveTaxJurisdiction(input.businessStateCode, input.partyStateCode)
  const totals = calculateSalesInvoiceTotals(input.lines, input.billDiscount, 0, jurisdiction.isInterState)
  if (input.billDiscount > totals.taxableBeforeBillDiscount + 0.005) {
    throw new QuotationError('BILL_DISCOUNT_INVALID', 'Bill discount cannot be more than the taxable amount.')
  }

  const database = requireFirestore()
  const quotationRef = doc(collection(database, getBusinessPath(uid, businessId, 'quotations')))
  const itemRefs = input.lines.map(() => doc(collection(quotationRef, 'items')))

  return runTransaction(database, async (transaction) => {
    const quotationNumber = await reserveNextDocumentNumberInTransaction(transaction, uid, businessId, 'QUOTATION')

    transaction.set(quotationRef, {
      number: quotationNumber,
      quotationNumber,
      type: 'QUOTATION',
      status: input.status,
      quotationDate: input.quotationDate,
      date: input.quotationDate,
      validUntil: input.validUntil,
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
      note: input.note.trim(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      ...(input.status === 'SENT' ? { sentAt: serverTimestamp() } : {}),
      createdBy: uid,
    })

    input.lines.forEach((line, index) => {
      const lineTotals = totals.lineTotals[index]
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
    })

    return { id: quotationRef.id, number: quotationNumber, grandTotal: totals.grandTotal, status: input.status }
  })
}

export function subscribeToQuotations(
  uid: string,
  businessId: string,
  onQuotations: (quotations: QuotationListItem[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const database = requireFirestore()
  return onSnapshot(
    collection(database, getBusinessPath(uid, businessId, 'quotations')),
    (snapshot) => onQuotations(snapshot.docs.map((item) => toQuotationListItem(item.id, item.data()))),
    (error) => onError(error),
  )
}

export function subscribeToQuotationDetail(
  uid: string,
  businessId: string,
  quotationId: string,
  onQuotation: (quotation: QuotationDetail | null) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const reference = quotationReference(uid, businessId, quotationId)
  const initialized = new Set<'header' | 'items'>()
  let header: Omit<QuotationDetail, 'items'> | null = null
  let items: QuotationItemSnapshot[] = []

  const emit = (source: 'header' | 'items') => {
    initialized.add(source)
    if (initialized.size !== 2) return
    onQuotation(header ? { ...header, items } : null)
  }

  const unsubscribeHeader = onSnapshot(
    reference,
    (snapshot) => {
      header = snapshot.exists() ? toQuotationDetail(snapshot.id, snapshot.data()) : null
      emit('header')
    },
    (error) => onError(error),
  )
  const unsubscribeItems = onSnapshot(
    collection(reference, 'items'),
    (snapshot) => {
      items = snapshot.docs.map((item) => toQuotationItem(item.id, item.data()))
      emit('items')
    },
    (error) => onError(error),
  )

  return () => {
    unsubscribeHeader()
    unsubscribeItems()
  }
}

export async function setQuotationStatus(
  uid: string,
  businessId: string,
  quotationId: string,
  nextStatus: QuotationStatus,
): Promise<void> {
  if (nextStatus === 'CONVERTED') {
    throw new QuotationError('STATUS_RESERVED', 'Only a successful Sales Invoice conversion can mark a quotation as converted.')
  }

  const database = requireFirestore()
  const reference = doc(database, getBusinessPath(uid, businessId, 'quotations'), quotationId)
  await runTransaction(database, async (transaction) => {
    const snapshot = await transaction.get(reference)
    if (!snapshot.exists()) {
      throw new QuotationError('QUOTATION_NOT_FOUND', 'This quotation no longer exists.')
    }
    const currentStatus = quotationStatus(snapshot.data().status)
    if (!canSetQuotationStatus(currentStatus, nextStatus)) {
      throw new QuotationError('STATUS_TRANSITION_INVALID', `Cannot change a ${currentStatus.toLowerCase()} quotation to ${nextStatus.toLowerCase()}.`)
    }

    transaction.update(reference, {
      status: nextStatus,
      [`${nextStatus.toLowerCase()}At`]: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedBy: uid,
    })
  })
}

export function quotationToSalesInvoiceDraft(quotation: QuotationDetail): QuotationConversionDraft {
  return {
    quotationId: quotation.id,
    quotationNumber: quotation.quotationNumber,
    quotationDate: quotation.date,
    partyId: quotation.partyId,
    partyName: quotation.partyName,
    partyPhone: quotation.partyPhone,
    partyGstin: quotation.partyGstin,
    partyAddress: quotation.partyAddress,
    partyState: quotation.partyState,
    partyStateCode: quotation.partyStateCode,
    billDiscount: quotation.billDiscount,
    lines: quotation.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      name: item.name,
      code: item.code,
      hsn: item.hsn,
      unit: item.unit,
      qty: item.qty,
      rate: item.rate,
      discountPercent: item.discountPercent,
      gstPercent: item.gstPercent,
    })),
  }
}
