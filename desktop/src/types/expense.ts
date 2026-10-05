export const EXPENSE_PAYMENT_MODES = ['CASH', 'UPI', 'BANK', 'CARD', 'CHEQUE', 'OTHER'] as const

export type ExpensePaymentMode = (typeof EXPENSE_PAYMENT_MODES)[number]

/** A reusable master record, scoped to the selected business. */
export interface ExpenseCategory {
  id: string
  name: string
  description: string
  isActive: boolean
}

export interface ExpenseCategoryInput {
  name: string
  description: string
  isActive: boolean
}

/**
 * Expense category names are snapshotted on the expense so historical reports
 * remain readable if a category is later renamed or deactivated.
 */
export interface Expense {
  id: string
  date: string
  categoryId: string
  categoryName: string
  amount: number
  mode: ExpensePaymentMode | string
  paidTo: string
  referenceNumber: string
  note: string
  createdAt: string
}

export interface ExpenseInput {
  date: string
  categoryId: string
  categoryName: string
  amount: number
  mode: ExpensePaymentMode
  paidTo: string
  referenceNumber: string
  note: string
}

export interface ExpenseFilters {
  dateFrom: string
  dateTo: string
  categoryId: string
  mode: '' | ExpensePaymentMode
}

export const EMPTY_EXPENSE_FILTERS: ExpenseFilters = {
  dateFrom: '',
  dateTo: '',
  categoryId: '',
  mode: '',
}

export interface ExpenseCategoryTotal {
  categoryId: string
  categoryName: string
  amount: number
  expenseCount: number
}
