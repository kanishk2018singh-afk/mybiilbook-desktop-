# MyBillBook Desktop

This repository contains two applications:

- [`webapp/`](./webapp/) — existing offline/PWA billing app.
- [`desktop/`](./desktop/) — Electron + React desktop companion for the Android showroom-management app.

The desktop companion is a Firebase dashboard foundation with shared document-number settings, master-data management, an atomic opening-stock product catalog, live customer/supplier party masters with calculated balances, and atomic sales/purchase invoice creation, registers, cancellation reversals, and GST PDF export. See [`desktop/README.md`](./desktop/README.md) for Firebase setup and development commands.

## Standalone payments

The desktop companion also records independent customer receipts and supplier payouts, including settlements of old balances after an invoice was issued. A payment can be allocated across multiple confirmed, unpaid/partial invoices in a single Firestore batch: the batch creates the payment, one `invoicePayments` audit link per allocation, and updates each invoice's `paidAmount`, `balanceAmount`, and `paymentStatus`. Any remainder remains an on-account party advance. The Payments register filters by date, party, direction, and payment mode.

## Quotations and sales conversion

Quotations are separate, non-posting customer offers. They save immutable item, party, tax, and total snapshots with lifecycle statuses `DRAFT`, `SENT`, `ACCEPTED`, `REJECTED`, `EXPIRED`, and `CONVERTED`; they never alter inventory, payments, or party balances. An accepted quotation can be copied into a Sales Invoice draft. Confirming that draft runs the existing stock-safe Sales Invoice transaction and atomically marks the source quotation `CONVERTED` with the resulting `salesInvoiceId` and invoice number.
