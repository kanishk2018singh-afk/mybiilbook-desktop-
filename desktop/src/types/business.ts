/** A lightweight business document used before module-specific models are loaded. */
export interface Business {
  id: string
  name: string
  address?: string
  phone?: string
  gstin?: string
}
