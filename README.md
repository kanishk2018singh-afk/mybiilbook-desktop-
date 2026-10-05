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

## Stock adjustments and stock ledger

The desktop inventory tools include transaction-safe **Stock Adjustments** and a product-level **Stock Ledger**. Adjustments use signed quantities (`+` stock-in / `−` stock-out), require an audit reason, update `products.stockQty`, and write matching `ADJUSTMENT_IN` or `ADJUSTMENT_OUT` ledger rows in the same Firestore transaction. The Stock Ledger presents all movements in chronological passbook order and calculates the balance as: Opening + Purchase + Sales Return − Sales − Purchase Return ± Adjustment − Damage.

## Expenses and category analysis

The **Expenses** workspace provides business-scoped CRUD for expense categories and expense entries. Create heads such as Rent, Salary, Electricity, Internet, Transport, Repairs, and Office supplies, then record the date, category, amount, payment mode, payee, reference number, and note for each outgoing cost. The live register filters by inclusive date range, category, and payment mode; its category totals and Recharts pie chart always use the same filtered records. Expense entries snapshot their category name so historical reports remain legible after a category is renamed or made inactive.
