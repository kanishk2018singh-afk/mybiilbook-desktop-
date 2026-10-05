import type { Expense, ExpenseCategoryTotal, ExpenseFilters } from '../types/expense'

/** Keep display totals and chart percentages consistent with stored paise values. */
export function roundExpenseMoney(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100
}

/** Date-only values are ISO-formatted, so lexical comparison is inclusive and timezone-safe. */
export function filterExpenses(expenses: Expense[], filters: ExpenseFilters): Expense[] {
  return expenses
    .filter((expense) => {
      if (filters.dateFrom && (!expense.date || expense.date < filters.dateFrom)) return false
      if (filters.dateTo && (!expense.date || expense.date > filters.dateTo)) return false
      if (filters.categoryId && expense.categoryId !== filters.categoryId) return false
      if (filters.mode && expense.mode !== filters.mode) return false
      return true
    })
    .sort((left, right) => right.date.localeCompare(left.date) || right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
}

/** Groups the filtered report rather than every expense, so cards and chart match the list exactly. */
export function groupExpensesByCategory(expenses: Expense[]): ExpenseCategoryTotal[] {
  const grouped = new Map<string, ExpenseCategoryTotal>()

  for (const expense of expenses) {
    const categoryId = expense.categoryId || `legacy:${expense.categoryName || 'uncategorised'}`
    const categoryName = expense.categoryName || 'Uncategorised'
    const current = grouped.get(categoryId)
    grouped.set(categoryId, {
      categoryId,
      categoryName: current?.categoryName || categoryName,
      amount: roundExpenseMoney((current?.amount ?? 0) + Math.max(0, expense.amount)),
      expenseCount: (current?.expenseCount ?? 0) + 1,
    })
  }

  return [...grouped.values()].sort((left, right) => right.amount - left.amount || left.categoryName.localeCompare(right.categoryName))
}

export function totalExpenseAmount(expenses: Expense[]): number {
  return roundExpenseMoney(expenses.reduce((total, expense) => total + Math.max(0, expense.amount), 0))
}
