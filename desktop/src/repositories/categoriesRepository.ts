import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type DocumentData,
  type Unsubscribe,
} from 'firebase/firestore'
import { requireFirestore } from '../lib/firebase'
import { getBusinessPath } from '../lib/firestorePaths'
import type { Category, CategoryInput } from '../types/category'

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function toCategory(id: string, data: DocumentData): Category {
  const parentId = text(data.parentId)
  return {
    id,
    name: text(data.name) || 'Unnamed category',
    parentId: parentId || null,
    description: text(data.description),
    isActive: data.isActive !== false,
  }
}

function categoriesCollection(uid: string, businessId: string) {
  return collection(requireFirestore(), getBusinessPath(uid, businessId, 'categories'))
}

function categoryReference(uid: string, businessId: string, categoryId: string) {
  return doc(requireFirestore(), getBusinessPath(uid, businessId, 'categories'), categoryId)
}

export function subscribeToCategories(
  uid: string,
  businessId: string,
  onCategories: (categories: Category[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    categoriesCollection(uid, businessId),
    (snapshot) => {
      const categories = snapshot.docs
        .map((category) => toCategory(category.id, category.data()))
        .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }))
      onCategories(categories)
    },
    (error) => onError(error),
  )
}

export async function createCategory(uid: string, businessId: string, input: CategoryInput): Promise<void> {
  await addDoc(categoriesCollection(uid, businessId), {
    name: input.name.trim(),
    parentId: input.parentId || null,
    description: input.description.trim(),
    isActive: input.isActive,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

export async function updateCategory(
  uid: string,
  businessId: string,
  categoryId: string,
  input: CategoryInput,
): Promise<void> {
  await updateDoc(categoryReference(uid, businessId, categoryId), {
    name: input.name.trim(),
    parentId: input.parentId || null,
    description: input.description.trim(),
    isActive: input.isActive,
    updatedAt: serverTimestamp(),
  })
}

export async function removeCategory(uid: string, businessId: string, categoryId: string): Promise<void> {
  await deleteDoc(categoryReference(uid, businessId, categoryId))
}

export type CategoryDeleteBlocker =
  | { kind: 'products'; message: string }
  | { kind: 'children'; message: string }
  | null

/**
 * Firestore has no foreign keys, so check the linked products before a simple
 * delete. A descendant check also prevents orphaned subcategories.
 */
export async function getCategoryDeleteBlocker(
  uid: string,
  businessId: string,
  category: Category,
  allCategories: Category[],
): Promise<CategoryDeleteBlocker> {
  const productsRef = collection(requireFirestore(), getBusinessPath(uid, businessId, 'products'))
  const [matchingCategory, matchingSubcategory] = await Promise.all([
    getDocs(query(productsRef, where('category', '==', category.name), limit(1))),
    getDocs(query(productsRef, where('subcategory', '==', category.name), limit(1))),
  ])

  if (!matchingCategory.empty || !matchingSubcategory.empty) {
    return {
      kind: 'products',
      message: `Cannot delete “${category.name}” because one or more products are linked to it. Reassign those products first.`,
    }
  }

  const childCount = allCategories.filter((item) => item.parentId === category.id).length
  if (childCount > 0) {
    return {
      kind: 'children',
      message: `Cannot delete “${category.name}” because it has ${childCount} subcategor${childCount === 1 ? 'y' : 'ies'}. Move or delete those subcategories first.`,
    }
  }

  return null
}
