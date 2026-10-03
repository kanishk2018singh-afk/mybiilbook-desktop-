import { collection, onSnapshot, type DocumentData, type Unsubscribe } from 'firebase/firestore'
import { requireFirestore } from '../lib/firebase'
import { getBusinessesPath } from '../lib/firestorePaths'
import type { Business } from '../types/business'

function textValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function nestedObject(value: unknown): DocumentData | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as DocumentData) : undefined
}

/** Accept common Android field names while the final profile contract is being aligned. */
function toBusiness(id: string, data: DocumentData): Business {
  const profile = nestedObject(data.profile)
  const name =
    textValue(data.name) ??
    textValue(data.businessName) ??
    textValue(data.showroomName) ??
    textValue(profile?.name) ??
    textValue(profile?.businessName) ??
    'Unnamed showroom'

  return {
    id,
    name,
    address: textValue(data.address) ?? textValue(profile?.address),
    phone: textValue(data.phone) ?? textValue(profile?.phone),
    gstin: textValue(data.gstin) ?? textValue(profile?.gstin),
  }
}

/**
 * Reads `users/{uid}/businesses` once immediately and stays subscribed so a new
 * showroom or renamed business appears without a desktop refresh.
 */
export function subscribeToBusinesses(
  uid: string,
  onBusinesses: (businesses: Business[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const businessesRef = collection(requireFirestore(), getBusinessesPath(uid))

  return onSnapshot(
    businessesRef,
    (snapshot) => {
      const businesses = snapshot.docs
        .map((document) => toBusiness(document.id, document.data()))
        .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }))
      onBusinesses(businesses)
    },
    (error) => onError(error),
  )
}
