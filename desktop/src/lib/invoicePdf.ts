import type { jsPDF } from 'jspdf'
import type { Business } from '../types/business'
import type { InvoiceDetail, InvoiceItemSnapshot } from '../types/invoice'

const PAGE_WIDTH = 210
const PAGE_HEIGHT = 297
const LEFT = 12
const RIGHT = 198

function money(value: number): string {
  return `INR ${Number.isFinite(value) ? value.toFixed(2) : '0.00'}`
}

function dateLabel(value: string): string {
  if (!value) return 'N/A'
  const dateOnly = value.match(/^\d{4}-\d{2}-\d{2}/)?.[0]
  const parsed = new Date(dateOnly ? `${dateOnly}T12:00:00` : value)
  return Number.isNaN(parsed.valueOf())
    ? value
    : new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(parsed)
}

function compactText(value: string, fallback = 'N/A'): string {
  const trimmed = value.trim()
  return trimmed || fallback
}

function writeWrapped(pdf: jsPDF, text: string, x: number, y: number, width: number, lineHeight = 4): number {
  const lines = pdf.splitTextToSize(text, width) as string[]
  pdf.text(lines, x, y)
  return y + Math.max(1, lines.length) * lineHeight
}

function drawPageTitle(pdf: jsPDF, invoice: InvoiceDetail, business: Business, continuation = false): number {
  pdf.setFillColor(18, 91, 87)
  pdf.rect(0, 0, PAGE_WIDTH, 27, 'F')
  pdf.setTextColor(255, 255, 255)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(15)
  pdf.text(compactText(business.name, 'MyBillBook'), LEFT, 12)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(7.5)
  const businessMeta = [business.address, business.phone ? `Phone: ${business.phone}` : '', business.gstin ? `GSTIN: ${business.gstin}` : ''].filter(Boolean).join('  |  ')
  writeWrapped(pdf, businessMeta || 'Business details', LEFT, 17, 118, 3.1)

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(12)
  const title = invoice.kind === 'SALE' ? 'TAX INVOICE' : 'PURCHASE INVOICE'
  pdf.text(continuation ? `${title} - CONTINUED` : title, RIGHT, 12, { align: 'right' })
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(7.5)
  pdf.text(invoice.status === 'CANCELLED' ? 'CANCELLED DOCUMENT' : invoice.status, RIGHT, 17, { align: 'right' })
  pdf.setTextColor(37, 62, 76)

  if (invoice.status === 'CANCELLED') {
    pdf.setTextColor(175, 62, 53)
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(8)
    pdf.text('CANCELLED - NOT VALID FOR TAX / STOCK MOVEMENT', PAGE_WIDTH / 2, 33, { align: 'center' })
    pdf.setTextColor(37, 62, 76)
  }
  return invoice.status === 'CANCELLED' ? 39 : 34
}

function drawItemHead(pdf: jsPDF, y: number): number {
  pdf.setFillColor(239, 246, 246)
  pdf.rect(LEFT, y, RIGHT - LEFT, 7, 'F')
  pdf.setDrawColor(172, 200, 201)
  pdf.rect(LEFT, y, RIGHT - LEFT, 7)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(6.7)
  pdf.setTextColor(41, 78, 82)
  const columns = [
    ['#', 14, 'left'],
    ['Description', 22, 'left'],
    ['HSN', 73, 'left'],
    ['Qty', 92, 'right'],
    ['Rate', 109, 'right'],
    ['Taxable', 132, 'right'],
    ['GST', 155, 'right'],
    ['Amount', 196, 'right'],
  ] as const
  columns.forEach(([label, x, align]) => pdf.text(label, x, y + 4.5, { align }))
  pdf.setFont('helvetica', 'normal')
  pdf.setTextColor(37, 62, 76)
  return y + 7
}

function itemDescription(item: InvoiceItemSnapshot): string {
  return [item.name, [item.code, item.unit].filter(Boolean).join(' / ')].filter(Boolean).join('\n')
}

/** Older invoice snapshots may predate per-line bill-discount allocation. */
function taxableAfterBillDiscount(item: InvoiceItemSnapshot): number {
  return item.taxableAfterBillDiscount === 0 && item.taxableAmount !== 0 && item.billDiscountAmount === 0
    ? item.taxableAmount
    : item.taxableAfterBillDiscount
}

function drawItemRow(pdf: jsPDF, item: InvoiceItemSnapshot, index: number, y: number): number {
  const descriptionLines = pdf.splitTextToSize(itemDescription(item), 47) as string[]
  const height = Math.max(8, descriptionLines.length * 3.4 + 2)
  pdf.setDrawColor(221, 232, 233)
  pdf.line(LEFT, y + height, RIGHT, y + height)
  pdf.setFontSize(6.7)
  pdf.text(String(index + 1), 14, y + 4.7)
  pdf.text(descriptionLines, 22, y + 4.7)
  pdf.text(compactText(item.hsn), 73, y + 4.7)
  pdf.text(`${item.qty} ${item.unit || ''}`.trim(), 92, y + 4.7, { align: 'right' })
  pdf.text(money(item.rate), 109, y + 4.7, { align: 'right' })
  pdf.text(money(taxableAfterBillDiscount(item)), 132, y + 4.7, { align: 'right' })
  const tax = item.igstAmount > 0
    ? `IGST ${money(item.igstAmount)}`
    : `C ${money(item.cgstAmount)} / S ${money(item.sgstAmount)}`
  pdf.text(tax, 155, y + 4.7, { align: 'right' })
  pdf.setFont('helvetica', 'bold')
  pdf.text(money(item.lineTotal), 196, y + 4.7, { align: 'right' })
  pdf.setFont('helvetica', 'normal')
  return y + height
}

function drawTotals(pdf: jsPDF, invoice: InvoiceDetail, y: number): number {
  const rows: Array<[string, string, boolean?]> = [
    ['Subtotal', money(invoice.subtotal)],
    ['Line discount', `- ${money(invoice.lineDiscountAmount)}`],
    ['Bill discount', `- ${money(invoice.billDiscount)}`],
    ['Taxable value', money(invoice.taxableAmount)],
    ...(invoice.taxType === 'IGST'
      ? [['IGST', money(invoice.igstAmount)] as [string, string]]
      : [['CGST', money(invoice.cgstAmount)] as [string, string], ['SGST', money(invoice.sgstAmount)] as [string, string]]),
    ['Round off', `${invoice.roundOff >= 0 ? '+' : '-'} ${money(Math.abs(invoice.roundOff))}`],
    ['Grand total', money(invoice.grandTotal), true],
    ['Paid amount', money(invoice.paidAmount)],
    [invoice.kind === 'SALE' ? 'Balance due' : 'Supplier payable', money(invoice.balanceAmount)],
  ]
  const x = 132
  pdf.setDrawColor(185, 207, 208)
  pdf.rect(x, y, RIGHT - x, rows.length * 6 + 2)
  rows.forEach(([label, value, strong], index) => {
    const rowY = y + 5 + index * 6
    if (strong) {
      pdf.setFillColor(228, 245, 238)
      pdf.rect(x + 0.2, rowY - 4.3, RIGHT - x - 0.4, 5.8, 'F')
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(8)
    } else {
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(7.1)
    }
    pdf.text(label, x + 3, rowY)
    pdf.text(value, RIGHT - 3, rowY, { align: 'right' })
  })
  pdf.setFont('helvetica', 'normal')
  return y + rows.length * 6 + 5
}

/** Downloads a standard GST-friendly A4 PDF from immutable invoice snapshots. */
export async function exportInvoicePdf(invoice: InvoiceDetail, business: Business): Promise<void> {
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
  let y = drawPageTitle(pdf, invoice, business)

  pdf.setFontSize(7.5)
  pdf.setDrawColor(194, 213, 214)
  pdf.rect(LEFT, y, RIGHT - LEFT, 29)
  pdf.line(112, y, 112, y + 29)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(7)
  pdf.text(invoice.kind === 'SALE' ? 'BILL TO' : 'SUPPLIER', LEFT + 3, y + 5)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8.2)
  pdf.text(compactText(invoice.partyName), LEFT + 3, y + 10)
  pdf.setFontSize(7)
  let partyY = y + 14
  partyY = writeWrapped(pdf, invoice.partyAddress || [invoice.partyState].filter(Boolean).join(', ') || 'Address not recorded', LEFT + 3, partyY, 92, 3.3)
  pdf.text(`Phone: ${compactText(invoice.partyPhone)}`, LEFT + 3, Math.min(y + 26, partyY + 2.5))
  pdf.text(`GSTIN: ${compactText(invoice.partyGstin)}`, 60, Math.min(y + 26, partyY + 2.5))

  const metadata: Array<[string, string]> = [
    ['Invoice no.', invoice.invoiceNumber || invoice.number],
    [invoice.kind === 'SALE' ? 'Invoice date' : 'Purchase date', dateLabel(invoice.date)],
    ...(invoice.kind === 'PURCHASE' ? [['Supplier bill no.', compactText(invoice.supplierInvoiceNumber)] as [string, string]] : []),
    ['Payment status', invoice.paymentStatus],
  ]
  metadata.forEach(([label, value], index) => {
    const offset = y + 5 + index * 5.5
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(6.6)
    pdf.text(label.toUpperCase(), 116, offset)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(7.5)
    pdf.text(value, 148, offset)
  })
  y += 35

  y = drawItemHead(pdf, y)
  invoice.items.forEach((item, index) => {
    const itemLines = pdf.splitTextToSize(itemDescription(item), 47) as string[]
    const itemHeight = Math.max(8, itemLines.length * 3.4 + 2)
    if (y + itemHeight > 258) {
      pdf.addPage()
      y = drawPageTitle(pdf, invoice, business, true)
      y = drawItemHead(pdf, y)
    }
    y = drawItemRow(pdf, item, index, y)
  })

  if (y + 88 > 278) {
    pdf.addPage()
    y = drawPageTitle(pdf, invoice, business, true)
  }
  y += 6
  y = drawTotals(pdf, invoice, y)

  pdf.setFontSize(7)
  pdf.setFont('helvetica', 'bold')
  pdf.text('GST tax summary', LEFT, y)
  pdf.setFont('helvetica', 'normal')
  const taxSummary = invoice.taxType === 'IGST'
    ? `Taxable ${money(invoice.taxableAmount)}  |  IGST ${money(invoice.igstAmount)}`
    : `Taxable ${money(invoice.taxableAmount)}  |  CGST ${money(invoice.cgstAmount)}  |  SGST ${money(invoice.sgstAmount)}`
  pdf.text(taxSummary, LEFT, y + 4.5)
  pdf.setDrawColor(201, 216, 217)
  pdf.line(LEFT, y + 8, RIGHT, y + 8)
  pdf.setFontSize(6.8)
  pdf.text('Declaration: Goods described above are recorded from immutable invoice snapshots. This is a computer-generated GST invoice.', LEFT, y + 13)
  if (invoice.status === 'CANCELLED') {
    pdf.setTextColor(175, 62, 53)
    pdf.setFont('helvetica', 'bold')
    pdf.text(`Cancellation reason: ${compactText(invoice.cancellationReason, 'Not provided')}`, LEFT, y + 18)
    pdf.setTextColor(37, 62, 76)
  }
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(6.3)
  const generatedAt = `Generated ${new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date())}`
  const pageCount = pdf.getNumberOfPages()
  for (let page = 1; page <= pageCount; page += 1) {
    pdf.setPage(page)
    pdf.text(generatedAt, RIGHT, PAGE_HEIGHT - 10, { align: 'right' })
    pdf.text(`Page ${page} of ${pageCount}`, LEFT, PAGE_HEIGHT - 10)
  }

  const safeNumber = (invoice.invoiceNumber || invoice.number || 'invoice').replace(/[^a-z0-9._-]+/gi, '_')
  pdf.save(`${safeNumber}.pdf`)
}
