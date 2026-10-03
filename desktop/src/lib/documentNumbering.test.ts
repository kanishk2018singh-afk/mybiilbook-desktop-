import { describe, expect, it } from 'vitest'
import { formatDocumentNumber, getFinancialYear, normalizeDocumentSetting } from './documentNumbering'

describe('Indian financial-year numbering', () => {
  it('uses 1 April as the financial-year boundary in Asia/Kolkata', () => {
    expect(getFinancialYear(new Date('2026-03-31T18:29:59.000Z'))).toBe('2025-26')
    expect(getFinancialYear(new Date('2026-03-31T18:30:00.000Z'))).toBe('2026-27')
  })

  it('formats a prefix, financial year, and zero-padded serial', () => {
    expect(
      formatDocumentNumber(
        { prefix: 'INV', includeFy: true, digits: 4 },
        1025,
        new Date('2025-06-15T06:00:00.000Z'),
      ),
    ).toBe('INV/2025-26/1025')
  })

  it('keeps serials longer than the requested padding width intact', () => {
    expect(
      formatDocumentNumber(
        { prefix: 'PAY', includeFy: false, digits: 4 },
        10001,
        new Date('2025-06-15T06:00:00.000Z'),
      ),
    ).toBe('PAY/10001')
  })

  it('uses schema defaults while a document setting does not yet exist', () => {
    expect(normalizeDocumentSetting('SALE')).toMatchObject({
      docType: 'SALE',
      prefix: 'INV',
      includeFy: true,
      nextNumber: 1,
      digits: 4,
      enabled: true,
      exists: false,
    })
  })
})
