export interface Product {
  id: string
  companyId: string
  companyName: string
  name: string
  code: string
  barcode: string
  brand: string
  category: string
  subcategory: string
  hsn: string
  unit: string
  mrp: number
  discountPercent: number
  gstPercent: number
  purchasePrice: number
  stockQty: number
  lowStockAlert: number
  notes: string
  imageUri: string
}

export interface ProductBaseInput {
  companyId: string
  companyName: string
  name: string
  code: string
  barcode: string
  brand: string
  category: string
  subcategory: string
  hsn: string
  unit: string
  mrp: number
  discountPercent: number
  gstPercent: number
  purchasePrice: number
  lowStockAlert: number
  notes: string
  imageUri: string
}

export interface ProductCreateInput extends ProductBaseInput {
  stockQty: number
}

export type ProductUpdateInput = ProductBaseInput
