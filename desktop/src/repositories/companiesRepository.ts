import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  type DocumentData,
  type Unsubscribe,
} from 'firebase/firestore'
import { requireFirestore } from '../lib/firebase'
import { getBusinessPath } from '../lib/firestorePaths'
import type { Company, CompanyInput } from '../types/company'

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function toCompany(id: string, data: DocumentData): Company {
  return {
    id,
    name: text(data.name) || 'Unnamed company',
    description: text(data.description),
    isDefault: data.isDefault === true,
  }
}

function companiesCollection(uid: string, businessId: string) {
  return collection(requireFirestore(), getBusinessPath(uid, businessId, 'companies'))
}

function companyReference(uid: string, businessId: string, companyId: string) {
  return doc(requireFirestore(), getBusinessPath(uid, businessId, 'companies'), companyId)
}

export function subscribeToCompanies(
  uid: string,
  businessId: string,
  onCompanies: (companies: Company[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    companiesCollection(uid, businessId),
    (snapshot) => {
      const companies = snapshot.docs
        .map((company) => toCompany(company.id, company.data()))
        .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }))
      onCompanies(companies)
    },
    (error) => onError(error),
  )
}

export async function createCompany(uid: string, businessId: string, input: CompanyInput): Promise<void> {
  await addDoc(companiesCollection(uid, businessId), {
    name: input.name.trim(),
    description: input.description.trim(),
    isDefault: input.isDefault,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

export async function updateCompany(
  uid: string,
  businessId: string,
  companyId: string,
  input: CompanyInput,
): Promise<void> {
  await updateDoc(companyReference(uid, businessId, companyId), {
    name: input.name.trim(),
    description: input.description.trim(),
    isDefault: input.isDefault,
    updatedAt: serverTimestamp(),
  })
}

export async function removeCompany(uid: string, businessId: string, companyId: string): Promise<void> {
  await deleteDoc(companyReference(uid, businessId, companyId))
}
