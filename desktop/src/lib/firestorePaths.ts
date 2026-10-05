/**
 * Names of the first-level collections within a business. The string extension
 * intentionally keeps the helper reusable for future read-only collections.
 */
export type BusinessCollectionName =
  | 'companies'
  | 'categories'
  | 'products'
  | 'parties'
  | 'salesInvoices'
  | 'purchaseInvoices'
  | 'payments'
  | 'invoicePayments'
  | 'expenseCategories'
  | 'expenses'
  | 'quotations'
  | 'creditNotes'
  | 'debitNotes'
  | 'stockTransactions'
  | 'documentSettings'
  | (string & {})

function requirePathSegment(label: string, value: string): string {
  const segment = value.trim()
  if (!segment) throw new Error(`${label} is required`)
  if (segment.includes('/')) throw new Error(`${label} must be a single Firestore path segment`)
  return segment
}

export function getBusinessesPath(uid: string): string {
  return `users/${requirePathSegment('uid', uid)}/businesses`
}

export function getBusinessDocumentPath(uid: string, businessId: string): string {
  return `${getBusinessesPath(uid)}/${requirePathSegment('businessId', businessId)}`
}

/**
 * Returns a collection path scoped to both the Firebase user and the selected business.
 * Every V1 data repository must use this helper rather than building a path inline.
 */
export function getBusinessPath(uid: string, businessId: string, collectionName: BusinessCollectionName): string {
  return `${getBusinessDocumentPath(uid, businessId)}/${requirePathSegment('collectionName', collectionName)}`
}
