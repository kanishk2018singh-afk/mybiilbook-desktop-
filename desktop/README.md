# MyBillBook Desktop Companion — V1 foundation

A secure Electron + React + TypeScript desktop companion for the Android Showroom Management app. This first module implements:

- Firebase Web SDK initialisation
- Firebase Authentication with **Google Sign-In**
- Reading all business documents from `users/{uid}/businesses`
- A business picker when a user owns more than one showroom
- `BusinessContext`, which stores the active `businessId`
- A reusable `getBusinessPath(uid, businessId, collectionName)` helper for every subsequent Firestore query
- Electron security defaults (`contextIsolation`, no Node integration, narrow preload bridge)
- Shared document-number settings and atomic number reservation for document creation
- Real-time Companies/Brands and hierarchical Categories CRUD
- Full Product CRUD with atomic opening-stock ledger creation
- Full Party CRUD, Customer/Supplier tabs, and live calculated party balances
- Sales Invoice creation with live GST/payment totals and one atomic Firestore commit
- Purchase Invoice creation with supplier references, stock increases, linked payments, and optional cost-price updates
- Live Sales/Purchase invoice registers, immutable detail/payment history, stock-safe cancellation, and GST PDF export
- Live Expenses register, expense-category masters, date/category totals, and a category-wise Recharts pie chart

Other dashboard reporting modules remain read-only. Document settings, number reservation, master-data maintenance, product/stock-baseline creation, Sales/Purchase Invoice confirmation or cancellation, and Expenses are the intentional, scoped Firestore write workflows.

## Run locally

```bash
cd desktop
cp .env.example .env
# Fill in the Firebase Web app config for the Android app's existing Firebase project.
npm install
npm run dev
```

To type-check and create a production build:

```bash
npm run build
npm run dist
```

## Firebase configuration

1. Open the **same Firebase project** used by the Android app.
2. In **Project settings → Your apps**, add or select a **Web app**. Do not copy the Android app ID into this project.
3. Copy the Web app's `firebaseConfig` fields to `desktop/.env`.
4. In **Authentication → Sign-in method**, enable **Google**.
5. In **Authentication → Settings → Authorized domains**, add `localhost` and `127.0.0.1` for local/Electron development. The packaged desktop app serves its renderer over a loopback HTTP origin because Firebase's browser Auth SDK does not support `file://` OAuth.
6. Ensure Firestore rules allow the signed-in user to read their own data and write their own `documentSettings`, `companies`, `categories`, `products`, `stockTransactions`, `parties`, `salesInvoices`, `purchaseInvoices`, invoice `items`, `payments`, `invoicePayments`, `expenseCategories`, `expenses`, `creditNotes`, `debitNotes`, their `items` documents, and source-invoice `returnBalances` documents used by invoice/return workflows.

Example development rule shape:

```firestore
match /users/{uid}/businesses/{businessId}/{document=**} {
  allow read, write: if request.auth != null && request.auth.uid == uid;
}
```

Do not change the shared rule to `allow write: if false` solely for desktop: that would also prevent the Android app from writing. Dashboard reporting modules are read-only; document settings, atomic sequence reservation, Companies/Categories master data, Products with their opening stock baseline, Party masters, Sales/Purchase Invoice confirmation or cancellation, Credit/Debit Note return posting, Stock Adjustments, and Expense Categories/Entries are the limited write operations added so far.

## Data flow

```text
Google Sign-In
  → Firebase Auth User (uid)
  → onSnapshot(users/{uid}/businesses)
  → BusinessContext.selectedBusinessId
  → getBusinessPath(uid, businessId, 'salesInvoices')
  → all dashboard/module subscriptions
```

## Key files

| File | Responsibility |
| --- | --- |
| `src/lib/firebase.ts` | Firebase Web SDK initialisation from environment variables |
| `src/context/AuthContext.tsx` | Auth session and Google Sign-In |
| `src/context/BusinessContext.tsx` | Business list and selected `businessId` |
| `src/lib/firestorePaths.ts` | Scoped, validated Firestore path helpers |
| `src/repositories/businessRepository.ts` | Real-time business subscription |
| `electron/main.ts` | Secure Electron window and loopback renderer host |

## Master data: companies and categories

The **Companies** page manages brand records at:

```text
users/{uid}/businesses/{businessId}/companies/{companyId}
```

with `name`, `description`, and `isDefault`. The **Categories** page manages:

```text
users/{uid}/businesses/{businessId}/categories/{categoryId}
```

with `name`, `parentId`, `description`, and `isActive`. Both pages use `onSnapshot()` for live lists and use `addDoc`, `updateDoc`, and `deleteDoc` for master-data changes.

Categories render as an expandable tree. Before deletion, the client checks whether a `products` document has a matching `category` or `subcategory` name, and blocks the delete with a warning. It also blocks deletion of a category that still has subcategories to prevent orphaned hierarchy data.

## Product catalog and opening stock

The **Products** page manages:

```text
users/{uid}/businesses/{businessId}/products/{productId}
```

with company identity, denormalized `companyName`, basic product details, pricing, category/subcategory strings, stock quantity, notes, and image URI. It subscribes with `onSnapshot()` and offers search, Company/Category filters, and low-stock highlighting.

On **create**, `createProductWithOpeningStock()` uses one Firestore `writeBatch()` to create both the product and:

```text
users/{uid}/businesses/{businessId}/stockTransactions/{transactionId}
```

The stock transaction always includes:

```ts
{
  productId,
  type: 'OPENING',
  quantityIn: initialStockQty,
}
```

The edit payload intentionally excludes `stockQty`; it can only change through Purchase, Sale, or Adjustment workflows.

## Parties and calculated balances

The **Parties** page manages the live master collection:

```text
users/{uid}/businesses/{businessId}/parties/{partyId}
```

Each record stores `type` (`CUSTOMER`, `SUPPLIER`, or `BOTH`), contact/GST/address fields, `openingBalance`, `openingBalanceType` (`RECEIVABLE` or `PAYABLE`), `creditLimit`, `creditDays`, `isActive`, and `notes`. The Customers and Suppliers tabs deliberately include a `BOTH` party in each applicable list. Party create, edit, and delete use ordinary `addDoc`, `updateDoc`, and `deleteDoc`; party lists use `onSnapshot()`.

The Party Detail page derives a **current** balance from three scoped real-time queries:

```text
users/{uid}/businesses/{businessId}/salesInvoices   where partyId == partyId
users/{uid}/businesses/{businessId}/purchaseInvoices where partyId == partyId
users/{uid}/businesses/{businessId}/payments        where partyId == partyId
```

Its signed convention is `+` receivable (the party owes the showroom) and `-` payable (the showroom owes the party):

```text
signed opening balance
+ remaining sales-invoice balanceAmount
- remaining purchase-invoice balanceAmount
- unallocated incoming payment
+ unallocated outgoing payment
```

Invoice documents must expose numeric `balanceAmount` (the remaining amount after allocations) and `partyId`; the reader accepts `balanceDue` and `dueAmount` only as migration fallbacks. Payments must expose `partyId`, numeric `amount`, an incoming/outgoing direction, and—when allocated—one of `invoiceId`, `salesInvoiceId`, `purchaseInvoiceId`, or `againstInvoiceId`. An invoice-linked payment is intentionally excluded from the arithmetic because that allocation is already represented by the invoice's remaining `balanceAmount`; including both would double count it.

Firestore rules must permit the user to read `salesInvoices`, `purchaseInvoices`, and `payments` below their selected business as well as write their `parties` documents. For production, replace the broad example rule above with field and ownership validation appropriate to the shared Android data model.

## Sales invoices: atomic stock-safe confirmation

The **Sales invoice** screen subscribes to the selected business's `products` and active customer-capable (`CUSTOMER` / `BOTH`) `parties`. Selecting either writes a snapshot into the invoice draft; the save never relies on a later product price or party-profile edit. Product rate begins at `mrp`, while quantity, rate, and line discount remain editable.

GST is calculated per line as:

```text
gross = qty × rate
line taxable = gross − line discount
line/bill-discount-adjusted taxable × GST percent
```

An optional rupee bill discount is allocated pro-rata to taxable line amounts before GST, so the stored line snapshots sum exactly to the invoice header. Matching business and party GST state codes create CGST/SGST; differing codes create IGST. The screen reads explicit `stateCode` first, then the first two GSTIN digits as a compatibility fallback. New Party records can also store the optional two-digit GST state code.

On confirm, `createConfirmedSalesInvoice()` executes one Firestore `runTransaction()` across:

```text
users/{uid}/businesses/{businessId}/documentSettings/SALE
users/{uid}/businesses/{businessId}/products/{productId}
users/{uid}/businesses/{businessId}/salesInvoices/{invoiceId}
users/{uid}/businesses/{businessId}/salesInvoices/{invoiceId}/items/{itemId}
users/{uid}/businesses/{businessId}/stockTransactions/{transactionId}
users/{uid}/businesses/{businessId}/payments/{paymentId}              (only when Paid Now > 0)
users/{uid}/businesses/{businessId}/invoicePayments/{linkId}          (only when Paid Now > 0)
```

The transaction first reads current stock for every selected product, aggregates duplicate lines, and aborts with `Insufficient stock for [product]` if the committed quantity cannot cover the sale. It then reserves the SALE number, decrements stock, writes the `CONFIRMED` invoice, immutable item snapshots, one `SALE` stock transaction per line, and (when applicable) the incoming payment plus its invoice-payment link. They must be in **one** transaction so a crash can never leave stock reduced without an invoice, an invoice without item/ledger history, or a payment without its invoice; Firestore retries concurrent stock changes and rechecks availability before committing.

The invoice header stores `balanceAmount = grandTotal - paidAmount` with `PAID`, `PARTIAL`, or `UNPAID` status. Its payment document carries `invoiceId` / `salesInvoiceId`, so the Party detail calculator deliberately does not double-count that invoice-linked receipt.

## Purchase invoices: stock-in and supplier payable

The **Purchase invoice** screen uses the same taxable/GST/round-off summary and atomic document-number reservation pattern, but its party selector is restricted to active `SUPPLIER` and `BOTH` records. It records both the desktop `PURCHASE` number and the required manual `supplierInvoiceNumber` from the supplier's own bill. Product lines begin at the product master `purchasePrice`.

On confirmation, `createConfirmedPurchaseInvoice()` runs one Firestore transaction that reads each affected product and then writes:

```text
users/{uid}/businesses/{businessId}/documentSettings/PURCHASE
users/{uid}/businesses/{businessId}/products/{productId}                  stockQty + qty
users/{uid}/businesses/{businessId}/purchaseInvoices/{invoiceId}
users/{uid}/businesses/{businessId}/purchaseInvoices/{invoiceId}/items/{itemId}
users/{uid}/businesses/{businessId}/stockTransactions/{transactionId}     type PURCHASE, quantityIn = qty
users/{uid}/businesses/{businessId}/payments/{paymentId}                  direction OUT, when Paid Now > 0
users/{uid}/businesses/{businessId}/invoicePayments/{linkId}              when Paid Now > 0
```

The optional Paid Now amount reduces the supplier invoice's `balanceAmount`; its linked payment is `OUT` and is intentionally excluded from the Party Detail net balance because the invoice balance already reflects it.

Before confirmation, the screen compares each entered purchase rate with the current product `purchasePrice`. If one or more rates differ, it presents **“Update product’s purchase price to new rate?”** and lists the changes. Choosing **Update prices & confirm** stores each accepted new rate in the corresponding product in the same transaction as the stock increase and invoice. **Keep current prices** confirms the purchase without changing the product master cost. This explicit choice prevents an accidental supplier-bill rate from silently changing future purchase defaults.

## Invoice registers, detail, cancellation, and PDF

The **Sales invoices** and **Purchase invoices** sidebar entries open real-time registers backed by their respective business-scoped collections. Registers offer client-side, inclusive filtering by date range, party snapshot, `paymentStatus` (`PAID`, `PARTIAL`, `UNPAID`), and document `status` (`DRAFT`, `CONFIRMED`, `CANCELLED`). Selecting a row opens an immutable detail page with the complete item snapshots, GST totals, party snapshot, and payment history read from:

```text
users/{uid}/businesses/{businessId}/invoicePayments  where invoiceId == {invoiceId}
```

New invoice-payment links also retain `paymentMode`, so the detail history does not need to infer it from a mutable party record. The printed **Print Invoice (PDF)** action uses `jspdf` to create a standard A4 GST-friendly document from the immutable invoice/item snapshots. It includes the business and party GST identities, document/date data, HSN/quantity/rate/tax line table, CGST/SGST or IGST summary, totals, and a prominent cancelled marker when applicable.

### Cancellation is a reversal, not an edit

`cancelConfirmedInvoice()` uses one Firestore transaction to change a `CONFIRMED` header to `CANCELLED`, update the affected product balances, and write one auditable inverse stock ledger row for every stored invoice item:

| Original document | Cancellation stock row | Product stock effect |
| --- | --- | --- |
| Sale | `ADJUSTMENT_IN`, `quantityIn = item.qty` | Adds the sold quantity back |
| Purchase | `ADJUSTMENT_OUT`, `quantityOut = item.qty` | Removes the received quantity |

Every adjustment has `referenceType: 'INVOICE_CANCELLATION'`, the original `invoiceId`/number, source item ID, party snapshot, cancellation reason, and resulting `balanceAfter`. Purchase cancellation first verifies that the currently committed stock can cover the quantity to remove; it refuses the transaction rather than driving stock negative. As with confirmation, a concurrent product write makes Firestore retry the entire cancellation rather than leave a partial reversal.

A linked payment is not deleted when an invoice is cancelled: deleting cash/bank history would be unsafe. The transaction marks its `invoicePayments` link `UNLINKED_ON_CANCELLATION` for the detail audit trail and removes the payment's invoice allocation fields, making it an unallocated customer/supplier advance in the Party balance calculation.

**Confirmed invoices are deliberately never editable.** Their quantities already changed stock, their totals already changed a party balance, and their payment links may have posted cash/bank history. Editing any of those fields directly would break the audit trail and accounting integrity. Only an invoice with `status: 'DRAFT'` may be edited before it posts stock or payment effects; a confirmed mistake must be cancelled (posting the inverse adjustment) and replaced with a new invoice.

## Document numbering

`src/lib/documentNumbering.ts` exposes:

```ts
generateNextDocumentNumber(uid, businessId, 'SALE')
```

It uses a Firestore `runTransaction()` on:

```text
users/{uid}/businesses/{businessId}/documentSettings/{docType}
```

If `nextNumber` is `1025`, the function returns `INV/2025-26/1025` (according to the document setting and Indian financial year) and atomically stores `1026`. This prevents duplicate numbers when Android and Electron issue documents concurrently. Standalone number reservations can leave a gap after a later document-save failure; gaps are intentional and must never be reused. Sales and Purchase Invoice confirmation instead reserve their SALE/PURCHASE number inside the same stock-and-invoice transaction, so a failed stock check or invoice write does not consume it.

The **Settings → Document numbering** page allows prefix, next number, and digits to be edited. To preserve uniqueness, the UI only permits advancing a next number; reducing a live sequence is blocked.

## Further modules

Build remaining reporting and workflow repositories using the selected scope, for example:

```ts
const path = getBusinessPath(uid, businessId, 'salesInvoices')
// users/{uid}/businesses/{businessId}/salesInvoices
```

Use `onSnapshot()` for dashboard data and unsubscribe when the selected business changes.

## Standalone payments and multi-invoice allocations

The **Payments** sidebar entry opens a register of incoming and outgoing payments with date range, party, direction, and payment-mode filters. **Record payment** handles a customer receipt (`IN`) or supplier payout (`OUT`) independently of invoice creation, which is useful when an old balance is settled later.

An `IN` payment offers that customer's confirmed `UNPAID` / `PARTIAL` Sales invoices; an `OUT` payment offers the supplier's matching Purchase invoices. The operator may assign different amounts to multiple invoices or leave some/all of the amount on account. On save, `recordStandalonePayment()` first validates the selected invoice snapshots, then uses one Firestore `writeBatch()` to create:

```text
users/{uid}/businesses/{businessId}/payments/{paymentId}
users/{uid}/businesses/{businessId}/invoicePayments/{linkId}  (one per allocation)
```

and update every affected invoice header's `paidAmount`, `balanceAmount`, and `paymentStatus`. A standalone payment stores `allocatedAmount`, `unallocatedAmount`, and `allocationCount`; Party Balance calculations use only `unallocatedAmount` because allocated amounts are already included in the invoice's reduced `balanceAmount`. This prevents a multi-invoice payment from being double counted.

Invoice cancellation preserves the same invariant. Cancelling an invoice releases only that payment link's amount from a split standalone payment into its `unallocatedAmount`; allocations to the payment's other invoices remain intact.

## Quotations and Sales Invoice conversion

The **Quotations** register creates customer offers without posting inventory or payment effects. A quotation reserves the `QUOTATION` document sequence and writes its header plus immutable `items` snapshots in one Firestore transaction, but does **not** read/update product stock or create payment records.

Supported statuses are `DRAFT`, `SENT`, `ACCEPTED`, `REJECTED`, `EXPIRED`, and `CONVERTED`. The detail page provides the customer-response workflow; terminal rejected/expired/converted records cannot be moved back into the sales workflow. `CONVERTED` is reserved for the Sales Invoice transaction and cannot be selected manually.

Only an **ACCEPTED** quotation exposes **Convert to Sales Invoice**. It copies the quotation's customer and item snapshots into a new Sales Invoice draft. On confirmation, `createConfirmedSalesInvoice()` transaction-reads the source quotation along with products, verifies that it is still accepted and belongs to the selected customer, then atomically:

```text
1. reserves the SALE number
2. validates and decrements product stock
3. writes the confirmed Sales Invoice, immutable items, and SALE stock ledger rows
4. writes an optional Paid Now payment/link
5. marks the source quotation CONVERTED with salesInvoiceId and salesInvoiceNumber
```

If stock validation or any write fails, no Sales Invoice is created and the quotation remains accepted and convertible. Firestore rules must grant the signed-in owner access to the business-scoped `quotations` collection and its `items` subcollections in addition to the existing invoice collections.

## Credit Notes, Debit Notes, and returns

**Credit notes** are sales returns and select a confirmed Sales Invoice. **Debit notes** are purchase returns and select a confirmed Purchase Invoice. The form only lets the operator choose source-item quantities; it calculates taxable value, GST, and return totals from the immutable source item snapshots rather than current product prices or tax settings.

`createConfirmedReturnNote()` posts each note in one Firestore transaction:

```text
1. reads the confirmed source invoice, selected immutable items, per-item return balances, and products
2. prevents a cumulative return quantity above the original source-item quantity
3. reserves the CREDIT_NOTE or DEBIT_NOTE number
4. writes creditNotes/{id} or debitNotes/{id} plus immutable items snapshots
5. updates product stock and writes SALE_RETURN or PURCHASE_RETURN stockTransactions
6. optionally lowers the source invoice balance, or writes the matching refund payment
7. writes separate source-invoice returnBalances documents and source audit metadata
```

A Credit Note adds inventory; a Debit Note removes inventory and aborts if the required returned stock is no longer available. The original invoice item snapshots remain immutable. Once a source invoice has return notes, full invoice cancellation is intentionally blocked because a full cancellation would otherwise double-post stock reversal.

Settlement choices are explicit:

- **Apply to source invoice** reduces its remaining balance, when the note does not exceed that balance.
- **Refund payment** creates an `OUT` customer refund for a Credit Note or an `IN` supplier refund for a Debit Note.
- **Leave on account** retains the return as a party credit/debit.

The Party Ledger includes credit/debit-note effects, so on-account notes and their refund payments remain balanced. Firestore rules must permit the business-scoped `creditNotes`, `debitNotes`, their `items` subcollections, source-invoice `returnBalances` subcollections, and the existing products, stockTransactions, payments, and invoice collections.

## Stock Adjustments and Stock Ledger

The **Stock Adjustment** screen is the only direct inventory-correction workflow. It selects a live product, accepts a non-zero signed quantity (`+` adds stock; `−` removes stock), requires an audit reason, and accepts an optional note. `createStockAdjustment()` runs one Firestore transaction that reads the current product, rejects a stock-out that would go negative, updates `products.stockQty`, and writes the matching `stockTransactions` row as `ADJUSTMENT_IN` or `ADJUSTMENT_OUT` with its resulting `balanceAfter`.

The **Stock Ledger** is a real-time, product-scoped inventory passbook. It reads every `stockTransactions` record for the selected product and sorts client-side in chronological order so it does not require a compound Firestore index. Its running balance is calculated from movement quantities rather than trusting a stored balance field, and the report reconciles that result against the live product `stockQty`.

```text
Current stock = Opening + Purchase + Sales Return
              - Sales - Purchase Return
              + Adjustment In - Adjustment Out - Damage
              + any legacy/other movement
```

The ledger recognizes `OPENING`, `PURCHASE`, `SALE`, `SALE_RETURN`, `PURCHASE_RETURN`, `ADJUSTMENT_IN`, `ADJUSTMENT_OUT`, and `DAMAGE` rows, including previously migrated entries that use a signed quantity instead of explicit `quantityIn` / `quantityOut` fields.

## Expenses and category-wise distribution

The **Expenses** sidebar entry opens a business-scoped outgoing-cost register. Expense category masters are stored at:

```text
users/{uid}/businesses/{businessId}/expenseCategories/{categoryId}
```

with `name`, `description`, and `isActive`. Use **Manage categories** to create, edit, deactivate, or delete heads such as Rent, Salary, Electricity, Internet, Transport, Repairs, and Office supplies. Category deletion is blocked while an expense references that category, which keeps historical reporting intact. Categories use a real-time `onSnapshot()` list and ordinary `addDoc`, `updateDoc`, and `deleteDoc` master-data writes.

Expense entries are stored at:

```text
users/{uid}/businesses/{businessId}/expenses/{expenseId}
```

with a date, category ID and category-name snapshot, positive amount, payment mode, `paidTo`, optional reference number, and optional note. New entries require date, category, amount, mode, and payee; create, edit, and delete use ordinary document writes. The category name is deliberately copied into each expense, so category-wise reports remain understandable after a category is renamed or deactivated.

The live register uses client-side inclusive date-range, category, and payment-mode filters, avoiding extra Firestore composite indexes. Its total card, grouped category totals, and Recharts pie chart are all calculated from the same filtered entries, so the displayed distribution always reconciles to the register total.
