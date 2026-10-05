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
import type { ExpenseCategory, ExpenseCategoryInput } from '../types/expense'

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function toExpenseCategory(id: string, data: DocumentData): ExpenseCategory {
  return {
    id,
    name: text(data.name) || 'Unnamed expense category',
    description: text(data.description),
    isActive: data.isActive !== false,
  }
}

function expenseCategoriesCollection(uid: string, businessId: string) {
  return collection(requireFirestore(), getBusinessPath(uid, businessId, 'expenseCategories'))
}

function expenseCategoryReference(uid: string, businessId: string, categoryId: string) {
  return doc(requireFirestore(), getBusinessPath(uid, businessId, 'expenseCategories'), categoryId)
}

export function subscribeToExpenseCategories(
  uid: string,
  businessId: string,
  onCategories: (categories: ExpenseCategory[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    expenseCategoriesCollection(uid, businessId),
    (snapshot) => onCategories(snapshot.docs
      .map((item) => toExpenseCategory(item.id, item.data()))
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }))),
    (error) => onError(error),
  )
}

/** Expense categories are independent master records, so ordinary document writes are intentional. */
export async function createExpenseCategory(
  uid: string,
  businessId: string,
  input: ExpenseCategoryInput,
): Promise<void> {
  await addDoc(expenseCategoriesCollection(uid, businessId), {
    name: input.name.trim(),
    description: input.description.trim(),
    isActive: input.isActive,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

export async function updateExpenseCategory(
  uid: string,
  businessId: string,
  categoryId: string,
  input: ExpenseCategoryInput,
): Promise<void> {
  await updateDoc(expenseCategoryReference(uid, businessId, categoryId), {
    name: input.name.trim(),
    description: input.description.trim(),
    isActive: input.isActive,
    updatedAt: serverTimestamp(),
  })
}

/**
 * Keep category history stable: an expense snapshots the category name and a
 * category cannot be deleted while any expense still references its ID.
 */
export async function expenseCategoryHasExpenses(
  uid: string,
  businessId: string,
  categoryId: string,
): Promise<boolean> {
  const expenses = collection(requireFirestore(), getBusinessPath(uid, businessId, 'expenses'))
  const result = await getDocs(query(expenses, where('categoryId', '==', categoryId), limit(1)))
  return !result.empty
}

export async function removeExpenseCategory(uid: string, businessId: string, categoryId: string): Promise<void> {
  await deleteDoc(expenseCategoryReference(uid, businessId, categoryId))
}
