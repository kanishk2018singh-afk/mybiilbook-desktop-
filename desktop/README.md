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

Dashboard reporting modules remain read-only. Document settings, number reservation, master-data maintenance, and product/stock-baseline creation are the intentional, scoped Firestore write workflows.

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
6. Ensure Firestore rules allow the signed-in user to read their own data and write their own `documentSettings`, `companies`, `categories`, `products`, `stockTransactions`, `parties`, and the invoice/payment documents the Party detail view reads.

Example development rule shape:

```firestore
match /users/{uid}/businesses/{businessId}/{document=**} {
  allow read, write: if request.auth != null && request.auth.uid == uid;
}
```

Do not change the shared rule to `allow write: if false` solely for desktop: that would also prevent the Android app from writing. Dashboard reporting modules are read-only; document settings, atomic sequence reservation, Companies/Categories master data, Products with their opening stock baseline, and Party masters are the limited write operations added so far.

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

## Document numbering

`src/lib/documentNumbering.ts` exposes:

```ts
generateNextDocumentNumber(uid, businessId, 'SALE')
```

It uses a Firestore `runTransaction()` on:

```text
users/{uid}/businesses/{businessId}/documentSettings/{docType}
```

If `nextNumber` is `1025`, the function returns `INV/2025-26/1025` (according to the document setting and Indian financial year) and atomically stores `1026`. This prevents duplicate numbers when Android and Electron issue documents concurrently. A later invoice-save failure can leave a gap; gaps are intentional and must never be reused.

The **Settings → Document numbering** page allows prefix, next number, and digits to be edited. To preserve uniqueness, the UI only permits advancing a next number; reducing a live sequence is blocked.

## Next module

Build read-only repositories using the selected scope, for example:

```ts
const path = getBusinessPath(uid, businessId, 'salesInvoices')
// users/{uid}/businesses/{businessId}/salesInvoices
```

Use `onSnapshot()` for dashboard data and unsubscribe when the selected business changes.
