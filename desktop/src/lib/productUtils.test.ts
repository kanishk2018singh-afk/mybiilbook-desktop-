import { describe, expect, it } from 'vitest'
import { displayProductCategory, isLowStock, searchableProductText } from './productUtils'
import type { Product } from '../types/product'

const product: Product = {
  id: 'p1',
  companyId: 'c1',
  companyName: 'Jaquar',
  name: 'Wall Hung WC',
  code: 'WH-01',
  barcode: '890000000001',
  brand: 'Jaquar',
  category: 'Sanitary',
  subcategory: 'Western WC',
  hsn: '6910',
  unit: 'PCS',
  mrp: 12000,
  discountPercent: 0,
  gstPercent: 18,
  purchasePrice: 7500,
  stockQty: 2,
  lowStockAlert: 2,
  notes: '',
  imageUri: '',
}

describe('product helpers', () => {
  it('flags stock at or below the alert threshold', () => {
    expect(isLowStock(product)).toBe(true)
    expect(isLowStock({ stockQty: 3, lowStockAlert: 2 })).toBe(false)
  })

  it('builds category and search text for filtering', () => {
    expect(displayProductCategory(product)).toBe('Sanitary › Western WC')
    expect(searchableProductText(product)).toContain('jaquar')
    expect(searchableProductText(product)).toContain('890000000001')
  })
})
