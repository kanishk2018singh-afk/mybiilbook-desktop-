/**
 * Treat half a paisa as equal so number-input and Firestore floating-point
 * representations do not raise a needless master-price confirmation.
 */
export const PURCHASE_PRICE_CHANGE_EPSILON = 0.005

export function purchasePriceChanged(currentPrice: number, proposedPrice: number): boolean {
  return Number.isFinite(currentPrice)
    && Number.isFinite(proposedPrice)
    && Math.abs(currentPrice - proposedPrice) > PURCHASE_PRICE_CHANGE_EPSILON
}
