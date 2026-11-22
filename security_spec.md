# Security Specification — STANLEY BUSINESS MANAGER

## 1. Data Invariants
1. Every workspace `/workspaces/{workspaceId}` is strictly owned by `ownerId == request.auth.uid` with `email_verified == true`.
2. Every subcollection document (`products`, `customers`, `orders`, `sales`, `expenses`) must include `ownerId == request.auth.uid`, match parent ownership via `get()` on single-document operations, and match `resource.data.ownerId == request.auth.uid` on `list` queries.
3. All document IDs and `clientSyncId` values must match `^[a-zA-Z0-9_\-]+$` (max 128 chars) to block path-poisoning attacks.
4. `ownerId`, `clientSyncId`, and `createdAt` are immutable once created. `createdAt` and `updatedAt` must equal `request.time`.
5. No shadow/ghost fields are allowed (`keys().hasOnly(...)` on create and `affectedKeys().hasOnly(...)` on update).
6. Completed or Cancelled orders cannot regress unless explicitly updated via allowed fields, and Sale amounts (`total_amount >= 0`, `amount_paid >= 0`, `balance_due >= 0`) are strictly numeric.

## 2. Dirty Dozen Attack Payloads (Expected: PERMISSION_DENIED)
1. Unauthenticated read of `/workspaces/uid1/sales/sale1`.
2. Unverified email (`email_verified == false`) attempting to create `/workspaces/uid1`.
3. Cross-tenant read: User B (`uid2`) reading `/workspaces/uid1/customers/cust1`.
4. Cross-tenant write: User B (`uid2`) writing `/workspaces/uid1/expenses/exp1` with `ownerId: "uid2"`.
5. Identity spoofing: User A (`uid1`) creating a sale with `ownerId: "uid2"`.
6. Ghost/shadow field injection: Creating a product with extra field `{ isAdmin: true }`.
7. ID poisoning: Creating `/workspaces/uid1/sales/${'a'.repeat(300)}`.
8. Oversized string DoW attack: Customer notes > 1000 chars.
9. Client timestamp forgery: Setting `createdAt` to a client `Date` instead of `request.time`.
10. Immutable field tampering: Updating `ownerId` or `createdAt` on an existing `Sale`.
11. Unbounded array injection: Sale `items` list with > 50 items or empty `items: []`.
12. Blanket list scrape without `ownerId == request.auth.uid` filter.
