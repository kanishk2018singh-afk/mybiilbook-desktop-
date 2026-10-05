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
import { roundExpenseMoney } from '../lib/expenseUtils'
import { EXPENSE_PAYMENT_MODES, type Expense, type ExpenseInput } from '../types/expense'

export type ExpenseSaveErrorCode = 'DATE_INVALID' | 'CATEGORY_REQUIRED' | 'AMOUNT_INVALID' | 'MODE_INVALID' | 'PAID_TO_REQUIRED'

export class ExpenseSaveError extends Error {
  constructor(
    public readonly code: ExpenseSaveErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ExpenseSaveError'
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numberValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return 0
}

function dateText(value: unknown): string {
  if (typeof value === 'string') return value.trim().match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? value.trim()
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    const date = value.toDate()
    return date instanceof Date && !Number.isNaN(date.valueOf()) ? date.toISOString().slice(0, 10) : ''
  }
  return ''
}

function timestampText(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    const date = value.toDate()
    return date instanceof Date && !Number.isNaN(date.valueOf()) ? date.toISOString() : ''
  }
  return ''
}

function normalizedMode(value: unknown): string {
  return text(value).toUpperCase() || 'OTHER'
}

function toExpense(id: string, data: DocumentData): Expense {
  return {
    id,
    date: dateText(data.date) || dateText(data.expenseDate) || dateText(data.createdAt),
    categoryId: text(data.categoryId),
    categoryName: text(data.categoryName) || text(data.category) || 'Uncategorised',
    amount: Math.max(0, roundExpenseMoney(numberValue(data.amount))),
    mode: normalizedMode(data.mode ?? data.paymentMode),
    paidTo: text(data.paidTo) || text(data.payee) || text(data.partyName),
    referenceNumber: text(data.referenceNumber) || text(data.reference) || text(data.transactionId),
    note: text(data.note) || text(data.notes),
    createdAt: timestampText(data.createdAt),
  }
}

function expensesCollection(uid: string, businessId: string) {
  return collection(requireFirestore(), getBusinessPath(uid, businessId, 'expenses'))
}

function expenseReference(uid: string, businessId: string, expenseId: string) {
  return doc(requireFirestore(), getBusinessPath(uid, businessId, 'expenses'), expenseId)
}

function isDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T12:00:00`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
}

function validateInput(input: ExpenseInput): ExpenseInput {
  const date = input.date.trim()
  const categoryId = input.categoryId.trim()
  const categoryName = input.categoryName.trim()
  const paidTo = input.paidTo.trim()
  const amount = roundExpenseMoney(input.amount)
  const mode = input.mode

  if (!isDateOnly(date)) throw new ExpenseSaveError('DATE_INVALID', 'Choose a valid expense date.')
  if (!categoryId || !categoryName) throw new ExpenseSaveError('CATEGORY_REQUIRED', 'Choose an expense category.')
  if (!Number.isFinite(amount) || amount <= 0) throw new ExpenseSaveError('AMOUNT_INVALID', 'Enter an amount greater than zero.')
  if (!EXPENSE_PAYMENT_MODES.includes(mode)) throw new ExpenseSaveError('MODE_INVALID', 'Choose a valid payment mode.')
  if (!paidTo) throw new ExpenseSaveError('PAID_TO_REQUIRED', 'Enter who this expense was paid to.')

  return {
    date,
    categoryId,
    categoryName,
    amount,
    mode,
    paidTo,
    referenceNumber: input.referenceNumber.trim(),
    note: input.note.trim(),
  }
}

function expenseFields(input: ExpenseInput) {
  const expense = validateInput(input)
  return {
    date: expense.date,
    expenseDate: expense.date,
    categoryId: expense.categoryId,
    categoryName: expense.categoryName,
    amount: expense.amount,
    mode: expense.mode,
    paymentMode: expense.mode,
    paidTo: expense.paidTo,
    referenceNumber: expense.referenceNumber,
    note: expense.note,
  }
}

export function subscribeToExpenses(
  uid: string,
  businessId: string,
  onExpenses: (expenses: Expense[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    expensesCollection(uid, businessId),
    (snapshot) => onExpenses(snapshot.docs.map((item) => toExpense(item.id, item.data()))),
    (error) => onError(error),
  )
}

export async function createExpense(uid: string, businessId: string, input: ExpenseInput): Promise<void> {
  await addDoc(expensesCollection(uid, businessId), {
    ...expenseFields(input),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: uid,
  })
}

export async function updateExpense(
  uid: string,
  businessId: string,
  expenseId: string,
  input: ExpenseInput,
): Promise<void> {
  await updateDoc(expenseReference(uid, businessId, expenseId), {
    ...expenseFields(input),
    updatedAt: serverTimestamp(),
  })
}

export async function removeExpense(uid: string, businessId: string, expenseId: string): Promise<void> {
  await deleteDoc(expenseReference(uid, businessId, expenseId))
}
