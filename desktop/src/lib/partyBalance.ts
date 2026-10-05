import type { Party, PartyActivity, PartyPayment } from '../types/party'

export interface PartyBalanceBreakdown {
  /** Positive values mean the party owes the showroom; negative values mean the showroom owes the party. */
  openingSigned: number
  salesInvoiceBalance: number
  purchaseInvoiceBalance: number
  unallocatedMoneyIn: number
  unallocatedMoneyOut: number
  currentSigned: number
  /** Amount always presented as a positive figure in the UI. */
  amount: number
  position: 'RECEIVABLE' | 'PAYABLE' | 'SETTLED'
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/**
 * Invoice `balanceAmount` is expected to be its *remaining* balance after any
 * payment allocated to that invoice. Adding an allocated amount again would
 * double count it, so only a payment's explicit on-account remainder enters
 * this calculation. Legacy records use invoiceId as the allocation signal.
 *
 * Sign convention used throughout this file:
 *   + = RECEIVABLE (party owes the showroom)
 *   - = PAYABLE    (showroom owes the party)
 *
 * Therefore:
 *   opening RECEIVABLE       => + openingBalance
 *   opening PAYABLE          => - openingBalance
 *   sales invoice balance    => + (customer still owes us)
 *   purchase invoice balance => - (we still owe supplier)
 *   unallocated IN payment   => - (customer payment reduces receivable)
 *   unallocated OUT payment  => + (supplier payment reduces payable)
 */
export function calculatePartyBalance(party: Party, activity: PartyActivity): PartyBalanceBreakdown {
  const openingSigned = party.openingBalanceType === 'PAYABLE' ? -party.openingBalance : party.openingBalance
  const salesInvoiceBalance = activity.salesInvoices
    .filter((invoice) => invoice.status !== 'CANCELLED')
    .reduce((total, invoice) => total + invoice.balanceAmount, 0)
  const purchaseInvoiceBalance = activity.purchaseInvoices
    .filter((invoice) => invoice.status !== 'CANCELLED')
    .reduce((total, invoice) => total + invoice.balanceAmount, 0)

  // A standalone payment may be divided across multiple invoices. Only its
  // explicit on-account remainder affects the party total: linked amounts are
  // already reflected by each invoice's reduced balanceAmount.
  const unallocatedMoneyIn = activity.payments
    .filter((payment) => payment.direction === 'IN')
    .reduce((total, payment) => total + onAccountAmount(payment), 0)
  const unallocatedMoneyOut = activity.payments
    .filter((payment) => payment.direction === 'OUT')
    .reduce((total, payment) => total + onAccountAmount(payment), 0)

  const currentSigned = roundMoney(
    openingSigned + salesInvoiceBalance - purchaseInvoiceBalance - unallocatedMoneyIn + unallocatedMoneyOut,
  )
  const position = currentSigned > 0.005 ? 'RECEIVABLE' : currentSigned < -0.005 ? 'PAYABLE' : 'SETTLED'

  return {
    openingSigned: roundMoney(openingSigned),
    salesInvoiceBalance: roundMoney(salesInvoiceBalance),
    purchaseInvoiceBalance: roundMoney(purchaseInvoiceBalance),
    unallocatedMoneyIn: roundMoney(unallocatedMoneyIn),
    unallocatedMoneyOut: roundMoney(unallocatedMoneyOut),
    currentSigned,
    amount: roundMoney(Math.abs(currentSigned)),
    position,
  }
}

function onAccountAmount(payment: PartyPayment): number {
  // New standalone-payment records persist this field. The fallback preserves
  // the legacy convention: one invoiceId means fully allocated; no invoiceId
  // means the entire payment remains on account.
  const explicitOnAccountAmount = payment.unallocatedAmount
  if (typeof explicitOnAccountAmount === 'number' && Number.isFinite(explicitOnAccountAmount)) {
    return Math.max(0, explicitOnAccountAmount)
  }
  return payment.invoiceId.trim() ? 0 : payment.amount
}
