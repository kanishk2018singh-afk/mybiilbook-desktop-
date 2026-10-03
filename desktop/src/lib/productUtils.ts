import type { Product } from '../types/product'

export const PRODUCT_UNITS = ['PCS', 'NOS', 'SET', 'BOX', 'KG', 'MTR', 'LTR', 'SQFT', 'PKT', 'BAG', 'BUNDLE', 'PAIR']

export function isLowStock(product: Pick<Product, 'stockQty' | 'lowStockAlert'>): boolean {
  return product.stockQty <= product.lowStockAlert
}

export function searchableProductText(product: Product): string {
  return [
    product.name,
    product.code,
    product.barcode,
    product.brand,
    product.companyName,
    product.category,
    product.subcategory,
    product.hsn,
  ]
    .join(' ')
    .toLocaleLowerCase()
}

export function displayProductCategory(product: Pick<Product, 'category' | 'subcategory'>): string {
  return [product.category, product.subcategory].filter(Boolean).join(' › ') || 'Uncategorised'
}
