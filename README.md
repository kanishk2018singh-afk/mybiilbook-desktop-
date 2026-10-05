# MyBillBook Desktop

This repository contains two applications:

- [`webapp/`](./webapp/) — existing offline/PWA billing app.
- [`desktop/`](./desktop/) — Electron + React desktop companion for the Android showroom-management app.

The desktop companion is a Firebase dashboard foundation with shared document-number settings, master-data management, an atomic opening-stock product catalog, live customer/supplier party masters with calculated balances, and atomic sales/purchase invoice creation, registers, cancellation reversals, and GST PDF export. See [`desktop/README.md`](./desktop/README.md) for Firebase setup and development commands.

## Standalone payments

The desktop companion also records independent customer receipts and supplier payouts, including settlements of old balances after an invoice was issued. A payment can be allocated across multiple confirmed, unpaid/partial invoices in a single Firestore batch: the batch creates the payment, one `invoicePayments` audit link per allocation, and updates each invoice's `paidAmount`, `balanceAmount`, and `paymentStatus`. Any remainder remains an on-account party advance. The Payments register filters by date, party, direction, and payment mode.

## Quotations and sales conversion

Quotations are separate, non-posting customer offers. They save immutable item, party, tax, and total snapshots with lifecycle statuses `DRAFT`, `SENT`, `ACCEPTED`, `REJECTED`, `EXPIRED`, and `CONVERTED`; they never alter inventory, payments, or party balances. An accepted quotation can be copied into a Sales Invoice draft. Confirming that draft runs the existing stock-safe Sales Invoice transaction and atomically marks the source quotation `CONVERTED` with the resulting `salesInvoiceId` and invoice number.

## Credit notes and debit notes

The desktop return workflow now posts sales returns as **Credit Notes** and purchase returns as **Debit Notes**. Both workflows use the original confirmed invoice’s immutable item snapshots to calculate returned taxable value, GST, and grand total. Credit Notes restore stock with `SALE_RETURN` entries; Debit Notes validate available stock before reducing it with `PURCHASE_RETURN` entries. A return can reduce the source invoice balance, create a matching refund payment, or remain as an on-account party credit/debit. Each note, item snapshot, stock movement, optional payment, source-invoice audit update, and document-number reservation is committed in one Firestore transaction.
