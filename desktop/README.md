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

Dashboard reporting modules remain read-only. Document settings, number reservation, and master-data maintenance are the intentional, scoped Firestore write workflows.

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
6. Ensure Firestore rules allow the signed-in user to read their own data and write their own `documentSettings`, `companies`, and `categories` documents.

Example development rule shape:

```firestore
match /users/{uid}/businesses/{businessId}/{document=**} {
  allow read, write: if request.auth != null && request.auth.uid == uid;
}
```

Do not change the shared rule to `allow write: if false` solely for desktop: that would also prevent the Android app from writing. Dashboard reporting modules are read-only; document settings, atomic sequence reservation, and Companies/Categories master data are the limited write operations added so far.

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

Categories render as an expandable tree. Before deletion, the client checks whether a `products` document has a matching `categoryId`, and blocks the delete with a warning. It also blocks deletion of a category that still has subcategories to prevent orphaned hierarchy data.

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
