import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  writeBatch,
  type DocumentData,
  type Unsubscribe,
} from 'firebase/firestore'
import { requireFirestore } from '../lib/firebase'
import { getBusinessPath } from '../lib/firestorePaths'
import type { Product, ProductCreateInput, ProductUpdateInput } from '../types/product'

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function number(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function toProduct(id: string, data: DocumentData): Product {
  return {
    id,
    companyId: text(data.companyId),
    companyName: text(data.companyName),
    name: text(data.name) || 'Unnamed product',
    code: text(data.code),
    barcode: text(data.barcode),
    brand: text(data.brand),
    category: text(data.category),
    subcategory: text(data.subcategory),
    hsn: text(data.hsn),
    unit: text(data.unit),
    mrp: number(data.mrp),
    discountPercent: number(data.discountPercent),
    gstPercent: number(data.gstPercent),
    purchasePrice: number(data.purchasePrice),
    stockQty: number(data.stockQty),
    lowStockAlert: number(data.lowStockAlert),
    notes: text(data.notes),
    imageUri: text(data.imageUri),
  }
}

function productsCollection(uid: string, businessId: string) {
  return collection(requireFirestore(), getBusinessPath(uid, businessId, 'products'))
}

function stockTransactionsCollection(uid: string, businessId: string) {
  return collection(requireFirestore(), getBusinessPath(uid, businessId, 'stockTransactions'))
}

function productReference(uid: string, businessId: string, productId: string) {
  return doc(requireFirestore(), getBusinessPath(uid, businessId, 'products'), productId)
}

export function subscribeToProducts(
  uid: string,
  businessId: string,
  onProducts: (products: Product[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    productsCollection(uid, businessId),
    (snapshot) => {
      const products = snapshot.docs
        .map((product) => toProduct(product.id, product.data()))
        .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }))
      onProducts(products)
    },
    (error) => onError(error),
  )
}

/**
 * Product and OPENING ledger entry are committed together. A product is never
 * visible without the stock baseline that created its initial quantity.
 */
export async function createProductWithOpeningStock(
  uid: string,
  businessId: string,
  input: ProductCreateInput,
): Promise<string> {
  const database = requireFirestore()
  const productRef = doc(productsCollection(uid, businessId))
  const stockTransactionRef = doc(stockTransactionsCollection(uid, businessId))
  const batch = writeBatch(database)

  batch.set(productRef, {
    companyId: input.companyId,
    companyName: input.companyName,
    name: input.name.trim(),
    code: input.code.trim(),
    barcode: input.barcode.trim(),
    brand: input.brand.trim(),
    category: input.category.trim(),
    subcategory: input.subcategory.trim(),
    hsn: input.hsn.trim(),
    unit: input.unit.trim(),
    mrp: input.mrp,
    discountPercent: input.discountPercent,
    gstPercent: input.gstPercent,
    purchasePrice: input.purchasePrice,
    stockQty: input.stockQty,
    lowStockAlert: input.lowStockAlert,
    notes: input.notes.trim(),
    imageUri: input.imageUri.trim(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })

  batch.set(stockTransactionRef, {
    productId: productRef.id,
    productName: input.name.trim(),
    type: 'OPENING',
    quantityIn: input.stockQty,
    quantityOut: 0,
    balanceAfter: input.stockQty,
    referenceType: 'PRODUCT_CREATE',
    createdAt: serverTimestamp(),
  })

  await batch.commit()
  return productRef.id
}

/** Stock quantity is deliberately absent from the update payload. */
export async function updateProduct(
  uid: string,
  businessId: string,
  productId: string,
  input: ProductUpdateInput,
): Promise<void> {
  await updateDoc(productReference(uid, businessId, productId), {
    companyId: input.companyId,
    companyName: input.companyName,
    name: input.name.trim(),
    code: input.code.trim(),
    barcode: input.barcode.trim(),
    brand: input.brand.trim(),
    category: input.category.trim(),
    subcategory: input.subcategory.trim(),
    hsn: input.hsn.trim(),
    unit: input.unit.trim(),
    mrp: input.mrp,
    discountPercent: input.discountPercent,
    gstPercent: input.gstPercent,
    purchasePrice: input.purchasePrice,
    lowStockAlert: input.lowStockAlert,
    notes: input.notes.trim(),
    imageUri: input.imageUri.trim(),
    updatedAt: serverTimestamp(),
  })
}

export async function removeProduct(uid: string, businessId: string, productId: string): Promise<void> {
  await deleteDoc(productReference(uid, businessId, productId))
}
