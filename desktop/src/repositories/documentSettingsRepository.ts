import { collection, onSnapshot, type Unsubscribe } from 'firebase/firestore'
import {
  DOCUMENT_TYPES,
  normalizeDocumentSetting,
  type DocumentSetting,
} from '../lib/documentNumbering'
import { requireFirestore } from '../lib/firebase'
import { getBusinessPath } from '../lib/firestorePaths'

/** Keeps the numbering settings page in sync with edits made on mobile or another desktop. */
export function subscribeToDocumentSettings(
  uid: string,
  businessId: string,
  onSettings: (settings: DocumentSetting[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const settingsRef = collection(requireFirestore(), getBusinessPath(uid, businessId, 'documentSettings'))

  return onSnapshot(
    settingsRef,
    (snapshot) => {
      const byType = new Map(snapshot.docs.map((setting) => [setting.id, setting.data()]))
      const settings = DOCUMENT_TYPES.map((docType) =>
        normalizeDocumentSetting(docType, byType.get(docType), byType.has(docType)),
      )
      onSettings(settings)
    },
    (error) => onError(error),
  )
}
