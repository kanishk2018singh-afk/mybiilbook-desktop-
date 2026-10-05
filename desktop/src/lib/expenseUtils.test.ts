import { describe, expect, it } from 'vitest'
import { filterExpenses, groupExpensesByCategory, totalExpenseAmount } from './expenseUtils'
import type { Expense } from '../types/expense'

const expenses: Expense[] = [
  { id: 'rent', date: '2026-10-01', categoryId: 'rent', categoryName: 'Rent', amount: 12000, mode: 'BANK', paidTo: 'Landlord', referenceNumber: 'NEFT-1', note: '', createdAt: '2026-10-01T09:00:00.000Z' },
  { id: 'power', date: '2026-10-03', categoryId: 'power', categoryName: 'Electricity', amount: 1540.75, mode: 'UPI', paidTo: 'Discom', referenceNumber: '', note: '', createdAt: '2026-10-03T09:00:00.000Z' },
  { id: 'salary-a', date: '2026-10-03', categoryId: 'salary', categoryName: 'Salary', amount: 8000, mode: 'CASH', paidTo: 'Aarav', referenceNumber: '', note: '', createdAt: '2026-10-03T11:00:00.000Z' },
  { id: 'salary-b', date: '2026-10-05', categoryId: 'salary', categoryName: 'Salary', amount: 7000, mode: 'CASH', paidTo: 'Diya', referenceNumber: '', note: '', createdAt: '2026-10-05T10:00:00.000Z' },
]

describe('expense report helpers', () => {
  it('filters inclusive date ranges and returns the newest entries first', () => {
    const result = filterExpenses(expenses, { dateFrom: '2026-10-03', dateTo: '2026-10-03', categoryId: '', mode: '' })

    expect(result.map((expense) => expense.id)).toEqual(['salary-a', 'power'])
  })

  it('groups only the visible expense records and totals money accurately', () => {
    const visible = filterExpenses(expenses, { dateFrom: '', dateTo: '', categoryId: '', mode: 'CASH' })
    const totals = groupExpensesByCategory(visible)

    expect(totals).toEqual([
      { categoryId: 'salary', categoryName: 'Salary', amount: 15000, expenseCount: 2 },
    ])
    expect(totalExpenseAmount(expenses)).toBe(28540.75)
  })
})
