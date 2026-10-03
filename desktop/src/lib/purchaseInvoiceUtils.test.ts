import { describe, expect, it } from 'vitest'
import { purchasePriceChanged } from './purchaseInvoiceUtils'

describe('purchase price confirmation comparison', () => {
  it('does not prompt for the current rate or insignificant floating-point drift', () => {
    expect(purchasePriceChanged(100, 100)).toBe(false)
    expect(purchasePriceChanged(100, 100.004)).toBe(false)
  })

  it('prompts when the supplier bill has a materially different rate', () => {
    expect(purchasePriceChanged(100, 100.01)).toBe(true)
    expect(purchasePriceChanged(0, 275)).toBe(true)
  })

  it('does not treat malformed values as a price update', () => {
    expect(purchasePriceChanged(Number.NaN, 100)).toBe(false)
    expect(purchasePriceChanged(100, Number.POSITIVE_INFINITY)).toBe(false)
  })
})
