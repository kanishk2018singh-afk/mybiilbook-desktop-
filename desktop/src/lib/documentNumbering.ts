import {
  doc,
  runTransaction,
  serverTimestamp,
  type DocumentData,
  type DocumentReference,
} from 'firebase/firestore'
import { requireFirestore } from './firebase'
import { getBusinessPath } from './firestorePaths'

export const DOCUMENT_TYPES = ['SALE', 'PURCHASE', 'QUOTATION', 'CREDIT_NOTE', 'DEBIT_NOTE', 'PAYMENT'] as const
export type DocumentType = (typeof DOCUMENT_TYPES)[number]

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  SALE: 'Sales invoice',
  PURCHASE: 'Purchase invoice',
  QUOTATION: 'Quotation',
  CREDIT_NOTE: 'Credit note',
  DEBIT_NOTE: 'Debit note',
  PAYMENT: 'Payment receipt',
}

export interface DocumentSetting {
  docType: DocumentType
  prefix: string
  includeFy: boolean
  /** The next unused serial number. It is issued first, then atomically increased. */
  nextNumber: number
  digits: number
  enabled: boolean
  /** False means this is an in-memory default and no Firestore document exists yet. */
  exists: boolean
}

export interface DocumentSettingUpdate {
  prefix: string
  nextNumber: number
  /** The value shown when the editor loaded. It prevents a stale save from moving a live sequence backwards. */
  originalNextNumber: number
  digits: number
}

export type DocumentNumberingErrorCode =
  | 'DOCUMENT_TYPE_INVALID'
  | 'DOCUMENT_SETTING_INVALID'
  | 'DOCUMENT_TYPE_DISABLED'
  | 'NUMBER_LIMIT_REACHED'
  | 'NEXT_NUMBER_CANNOT_DECREASE'

export class DocumentNumberingError extends Error {
  constructor(
    public readonly code: DocumentNumberingErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'DocumentNumberingError'
  }
}

const MAX_DIGITS = 12

const DEFAULT_SETTINGS: Record<DocumentType, Omit<DocumentSetting, 'docType' | 'exists'>> = {
  SALE: { prefix: 'INV', includeFy: true, nextNumber: 1, digits: 4, enabled: true },
  PURCHASE: { prefix: 'PUR', includeFy: true, nextNumber: 1, digits: 4, enabled: true },
  QUOTATION: { prefix: 'QUO', includeFy: true, nextNumber: 1, digits: 4, enabled: true },
  CREDIT_NOTE: { prefix: 'CN', includeFy: true, nextNumber: 1, digits: 4, enabled: true },
  DEBIT_NOTE: { prefix: 'DN', includeFy: true, nextNumber: 1, digits: 4, enabled: true },
  PAYMENT: { prefix: 'PAY', includeFy: true, nextNumber: 1, digits: 4, enabled: true },
}

function isDocumentType(value: string): value is DocumentType {
  return (DOCUMENT_TYPES as readonly string[]).includes(value)
}

function assertDocumentType(docType: DocumentType): void {
  if (!isDocumentType(docType)) {
    throw new DocumentNumberingError('DOCUMENT_TYPE_INVALID', `Unsupported document type: ${String(docType)}`)
  }
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}

function validDigits(value: unknown): number | null {
  const digits = positiveInteger(value)
  return digits && digits <= MAX_DIGITS ? digits : null
}

function nonBlankText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text ? text : null
}

function defaultSetting(docType: DocumentType): DocumentSetting {
  return { docType, ...DEFAULT_SETTINGS[docType], exists: false }
}

/**
 * Converts the Firestore schema to a safe UI model. Missing documents are shown
 * with sensible defaults and are created atomically when first used or saved.
 */
export function normalizeDocumentSetting(
  docType: DocumentType,
  data?: DocumentData,
  exists = Boolean(data),
): DocumentSetting {
  assertDocumentType(docType)
  const fallback = defaultSetting(docType)

  return {
    docType,
    prefix: nonBlankText(data?.prefix) ?? fallback.prefix,
    includeFy: typeof data?.includeFy === 'boolean' ? data.includeFy : fallback.includeFy,
    nextNumber: positiveInteger(data?.nextNumber) ?? fallback.nextNumber,
    digits: validDigits(data?.digits) ?? fallback.digits,
    enabled: typeof data?.enabled === 'boolean' ? data.enabled : fallback.enabled,
    exists,
  }
}

function issuableDocumentSetting(docType: DocumentType, data: DocumentData): DocumentSetting {
  const setting = normalizeDocumentSetting(docType, data, true)
  if (!positiveInteger(data.nextNumber)) {
    throw new DocumentNumberingError(
      'DOCUMENT_SETTING_INVALID',
      `${DOCUMENT_TYPE_LABELS[docType]} has an invalid next number. Open Settings and correct it before issuing a document.`,
    )
  }
  if (!validDigits(data.digits)) {
    throw new DocumentNumberingError(
      'DOCUMENT_SETTING_INVALID',
      `${DOCUMENT_TYPE_LABELS[docType]} has an invalid digit length. Open Settings and correct it before issuing a document.`,
    )
  }
  if (!nonBlankText(data.prefix)) {
    throw new DocumentNumberingError(
      'DOCUMENT_SETTING_INVALID',
      `${DOCUMENT_TYPE_LABELS[docType]} needs a document prefix before it can issue a number.`,
    )
  }
  return setting
}

function documentSettingReference(uid: string, businessId: string, docType: DocumentType): DocumentReference<DocumentData> {
  assertDocumentType(docType)
  return doc(requireFirestore(), getBusinessPath(uid, businessId, 'documentSettings'), docType)
}

/** India financial year: 1 April through 31 March, calculated in Asia/Kolkata. */
export function getFinancialYear(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date)
  const year = Number(parts.find((part) => part.type === 'year')?.value)
  const month = Number(parts.find((part) => part.type === 'month')?.value)

  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    throw new Error('Could not determine the current financial year.')
  }

  const financialYearStart = month >= 4 ? year : year - 1
  return `${financialYearStart}-${String((financialYearStart + 1) % 100).padStart(2, '0')}`
}

/** Formats an already-reserved serial number without making a Firestore write. */
export function formatDocumentNumber(
  setting: Pick<DocumentSetting, 'prefix' | 'includeFy' | 'digits'>,
  serialNumber: number,
  date = new Date(),
): string {
  const prefix = nonBlankText(setting.prefix)
  const digits = validDigits(setting.digits)
  const serial = positiveInteger(serialNumber)

  if (!prefix || !digits || !serial) {
    throw new DocumentNumberingError('DOCUMENT_SETTING_INVALID', 'A valid prefix, serial number, and digit length are required.')
  }

  const parts = [prefix]
  if (setting.includeFy) parts.push(getFinancialYear(date))
  parts.push(String(serial).padStart(digits, '0'))
  return parts.join('/')
}

/**
 * Atomically reserves the current `nextNumber` and advances it by one.
 *
 * If `nextNumber` is 1025, this returns `.../1025` and writes 1026. That
 * definition means `nextNumber` always represents the next unused number,
 * making the function safe across mobile and desktop clients.
 */
export async function generateNextDocumentNumber(
  uid: string,
  businessId: string,
  docType: DocumentType,
): Promise<string> {
  const database = requireFirestore()
  const reference = documentSettingReference(uid, businessId, docType)

  return runTransaction(database, async (transaction) => {
    const snapshot = await transaction.get(reference)

    if (!snapshot.exists()) {
      const initial = defaultSetting(docType)
      transaction.set(reference, {
        prefix: initial.prefix,
        includeFy: initial.includeFy,
        nextNumber: initial.nextNumber + 1,
        digits: initial.digits,
        enabled: initial.enabled,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      return formatDocumentNumber(initial, initial.nextNumber)
    }

    const setting = issuableDocumentSetting(docType, snapshot.data())
    if (!setting.enabled) {
      throw new DocumentNumberingError(
        'DOCUMENT_TYPE_DISABLED',
        `${DOCUMENT_TYPE_LABELS[docType]} numbering is disabled in Settings.`,
      )
    }
    if (setting.nextNumber >= Number.MAX_SAFE_INTEGER) {
      throw new DocumentNumberingError('NUMBER_LIMIT_REACHED', 'The document sequence has reached its maximum safe value.')
    }

    const serialNumber = setting.nextNumber
    transaction.update(reference, {
      nextNumber: serialNumber + 1,
      updatedAt: serverTimestamp(),
    })

    return formatDocumentNumber(setting, serialNumber)
  })
}

/**
 * Saves administrator edits without allowing a stale form to roll an actively
 * used counter backwards. Advancing a sequence is safe; reducing it can create
 * duplicate invoice numbers and is intentionally blocked.
 */
export async function saveDocumentSetting(
  uid: string,
  businessId: string,
  docType: DocumentType,
  update: DocumentSettingUpdate,
): Promise<DocumentSetting> {
  assertDocumentType(docType)
  const prefix = nonBlankText(update.prefix)
  const requestedNextNumber = positiveInteger(update.nextNumber)
  const originalNextNumber = positiveInteger(update.originalNextNumber)
  const digits = validDigits(update.digits)

  if (!prefix || !requestedNextNumber || !originalNextNumber || !digits) {
    throw new DocumentNumberingError(
      'DOCUMENT_SETTING_INVALID',
      `Enter a prefix, a positive next number, and between 1 and ${MAX_DIGITS} digits.`,
    )
  }

  const database = requireFirestore()
  const reference = documentSettingReference(uid, businessId, docType)

  return runTransaction(database, async (transaction) => {
    const snapshot = await transaction.get(reference)
    const current = snapshot.exists() ? normalizeDocumentSetting(docType, snapshot.data(), true) : defaultSetting(docType)
    const isManualSequenceChange = requestedNextNumber !== originalNextNumber

    if (isManualSequenceChange && requestedNextNumber < current.nextNumber) {
      throw new DocumentNumberingError(
        'NEXT_NUMBER_CANNOT_DECREASE',
        `The next ${DOCUMENT_TYPE_LABELS[docType].toLowerCase()} number is already ${current.nextNumber}. It can only be advanced to prevent duplicates.`,
      )
    }

    const nextNumber = isManualSequenceChange ? requestedNextNumber : current.nextNumber
    const saved: DocumentSetting = {
      docType,
      prefix,
      nextNumber,
      digits,
      includeFy: current.includeFy,
      enabled: current.enabled,
      exists: true,
    }

    transaction.set(
      reference,
      {
        prefix: saved.prefix,
        includeFy: saved.includeFy,
        nextNumber: saved.nextNumber,
        digits: saved.digits,
        enabled: saved.enabled,
        ...(snapshot.exists() ? {} : { createdAt: serverTimestamp() }),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    )

    return saved
  })
}
