# Feature Test and Issue Log

Updated: 2026-10-05

This log tracks issues found while testing features. When an issue is fixed, move it to **Resolved** with the verification performed. Recheck open items during later feature-test rounds.

## Open Issues

| ID | Area | Issue | Status / next check |
| --- | --- | --- | --- |
| AUTH-01 | Sign-up | Firebase previously returned `auth/identity-toolkit-api-has-not-been-used-in-project-or-it-is-disabled` (403). Enable Identity Toolkit API for project `843668522089`, then test actual account creation; a local build cannot verify Cloud Console settings. | Awaiting Firebase project change and live sign-up test. |
| DATA-05 | Admin order visibility verification | The admin listener is now gated on Firebase Auth, but an authenticated live admin read has not been tested after deployment. | Deploy the updated static `public/app.js`, open Orders while signed in, and confirm Firestore orders appear; if denied, inspect the displayed error code and deployed rules. |
| ADMIN-02 | Admin section deployment check | Local Vite testing now bypasses admin sign-in against the test Firebase project only; production static files still require admin authentication and use the production project. Live deployed sections have not been browser-verified. | Test at `http://127.0.0.1:5175/admin/` locally; when deployment is requested, publish static `public/` files and verify admin-authenticated Customers, Billing, and Orders. |
| ORDER-01 | Firestore order creation | Secure rules are deployed to `shopportal-f6630` / `(default)`: verified customers may create orders whose customer email matches their Firebase account; only authenticated `admin@shop.com` can read/update orders. Anonymous reads are denied as intended. A signed-in customer order and admin approval still need a live browser test. | Place an order while signed in with a verified customer account; confirm it appears as `new`, then approve it in admin and confirm the same document changes to `accepted`. |
| SEC-01 | Firestore policy deployment | Least-privilege rules are deployed to `shopportal-f6630`; an anonymous read of `/orders` returns `permission-denied` as intended. Emulator validation remains unavailable because installed Java is below 21. | Verify signed-in customer create and admin read/update through the deployed apps. |
| SEC-02 | Admin credential rotation | The hard-coded admin password was removed from current login code, but it was previously exposed in public JavaScript. | Reset the Firebase Auth password for `admin@shop.com` before deploying the updated admin. |
| STOCK-02 | Pending-order stock reservations | Inventory is now deducted transactionally when an order is accepted. Pending orders are not reserved, so two pending orders may request the same remaining stock before either is accepted. | If pending orders must reserve stock, add a minimal reservation feed or server-side stock control without exposing order PII. |

## Resolved Issues

| ID | Area | Fix | Verification |
| --- | --- | --- | --- |
| AUTH-02 | Sign-out / profile state | Explicit Firebase sign-out now clears the saved customer profile and form, prevents the auth listener from repopulating it, and invalidates pending customer lookups. A new checkout resets the sign-out guard. | `npm run build` passed on 2026-10-04. Live browser/Firebase sign-out still needs a manual check. |
| AUTH-03 | New account registration | Try account creation first, then sign in only when Firebase reports that the email already exists. This avoids relying on `auth/user-not-found`, which can be hidden as `auth/invalid-credential`. Auth API failures now get actionable messages. | `npm run build` passed on 2026-10-04. Live signup remains blocked until AUTH-01 is resolved. |
| DATA-03 | Admin order diagnostics | The admin Orders page now displays Firestore subscription error codes in its tables instead of showing an indistinguishable empty state. | `node --check public/app.js` passed on 2026-10-04. Live permission/error display still needs a browser check. |
| DATA-01 | Reservation listener permissions | Removed the storefront's global read of full `orders` documents to comply with admin-only order reads and prevent PII access. | Storefront build passed on 2026-10-05; cross-customer reservation is intentionally disabled and tracked as STOCK-02. |
| DATA-02 | Admin order listener authentication | The admin no longer subscribes to `orders` before Firebase restores auth. It displays a sign-in state for signed-out users, attaches the Firestore listener when signed in, and removes the listener on auth changes/page exit. | Live anonymous read-only query returned `permission-denied`; source inspection confirmed the former admin listener ran immediately before auth restoration; `node --check public/app.js` passed on 2026-10-05. Authenticated live verification is tracked as DATA-05. |
| ADMIN-01 | Customer and billing visibility | Customer and billing listeners now wait for the authorized admin session, surface read errors, and clean up on auth changes. Customers page links to Orders. | Admin `node --check public/app.js` passed on 2026-10-05. Live deployment check is tracked under ADMIN-02. |
| PROFILE-01 | Customer name/address persistence | Storefront name/contact/email/address drafts persist across reloads without storing passwords; explicit sign-out clears them. Pending order documents retain customer details for admin review. The reusable `/customers` profile is created/updated only in the same Firestore batch that marks the order `accepted`; manual customer creation was removed. | Admin `node --check public/app.js` passed on 2026-10-05. A live acceptance transaction still needs browser verification. |
| INV-01 | Admin inventory deduction | Admin acceptance now checks live inventory and atomically decrements each product, stores the customer profile, and sets `orderStatus: "accepted"` with `inventoryDeducted: true`. Repeated acceptance of an already-deducted accepted order does not deduct again; insufficient stock aborts the transaction. | `node --check public/app.js` passed on 2026-10-06. Live acceptance/stock verification remains pending. |

## Test Run: 2026-10-05

- Sign-out flow: reviewed the handler, Firebase auth-state listener, and session-storage persistence; fixed the local state restoration race.
- Signup flow: updated account creation to handle Firebase user-enumeration behavior and mapped the Identity Toolkit disabled error to a direct instruction.
- Order flow: storefront still awaits `addDoc(collection(db, 'orders'), ...)` and returns failure if that Firestore write rejects. Both apps currently configure project `shopportal-f6630`, the default database, and the `orders` collection; admin maps `new` to pending. Source inspection does not prove a live order document exists, so DATA-02 remains open.
- Admin order diagnostics: verified the listener error callback now writes Firestore error codes into the order tables; `node --check public/app.js` passed on 2026-10-04. No live browser subscription was available in this run.
- Storefront build: `npm run build` passed. Vite emitted its existing large-chunk warning.
- Admin build: not applicable to the intended static-HTML admin. `public/` is the configured publish directory; the failed Vite build is not tracked as an issue.
- Live Firebase order creation/read, sign-out, signup, and reservation permissions: not verified in this run; these require a browser session and live Firebase project/rules.

## Test Run: 2026-10-05 (local admin auth bypass)

- Added ignored admin `.env.local` with the test Firebase project and `VITE_ADMIN_LOCAL_TEST=true`.
- Vite dev injection enables bypass only on `localhost` and `127.0.0.1`; static admin source keeps the production project and `localAdminAuthBypass=false`.
- Smoke test against the actual admin Vite server on port 5175 confirmed test project and local-only bypass in dev, with production config/bypass-off in static source.
- Admin `app.js` and `vite.config.js` syntax checks passed; storefront production build passed.

## Test Run: 2026-10-05 (DATA-01)

- Live anonymous read-only query against `shopportal-f6630` / `(default)` / `orders`: returned `permission-denied` without reading or printing order contents.
- Reservation listener: changed to subscribe only after Firebase Auth reports a signed-in user; it unsubscribes and clears reservations on sign-out and clears stale reservation state on listener errors.
- Storefront `npm run build`: passed; Vite emitted the existing large-chunk warning.
- Remaining verification: deploy the change and test the listener with a signed-in browser session. The anonymous denial does not establish whether deployed rules permit authenticated reads.

## Test Run: 2026-10-05 (DATA-02)

- Rechecked storefront/admin Firebase project, default database, `orders` collection, and `new` to Pending mapping; they match.
- Confirmed admin previously subscribed to `orders` immediately during page initialization, before Firebase Auth restoration. Live anonymous read-only test against the collection returned `permission-denied`.
- Updated the static admin listener to wait for an authenticated user, show a sign-in message when signed out, and clean up listeners on auth changes/page exit.
- `node --check public/app.js`: passed after correcting a syntax issue caught on the first run.
- Authenticated live admin query remains unverified until the updated static admin is deployed and opened while signed in (DATA-05).

## Test Run: 2026-10-05 (DATA-01 follow-up)

- Confirmed the auth-gated listener change remains in the working tree.
- Fresh storefront `npm run build`: passed; Vite emitted the existing large-chunk warning.
- No signed-in test credentials/browser session were available, so authenticated deployed-rule access remains unverified under DATA-04.

## Test Run: 2026-10-05 (STOCK-01)

- Confirmed the admin acceptance handler sets `orderStatus: "accepted"` and `inventoryDeducted: false` without updating inventory stock.
- Updated storefront reservations to include active accepted orders when inventory was not deducted, and to stop reserving terminal statuses or orders already deducted from inventory.
- Storefront `npm run build`: passed; Vite emitted the existing large-chunk warning.
- Live customer checkout followed by admin accept/reject was not run; verify after deployment under STOCK-02.

## Test Run: 2026-10-05 (ORDER-01)

- Traced the checkout failure to the Firestore `addDoc(collection(db, 'orders'), ...)` catch; the prior toast incorrectly said inventory changed.
- Updated customer-facing errors for `permission-denied`, `unauthenticated`, `unavailable`, and other Firestore failures. Failed writes leave the cart available.
- Storefront `npm run build`: passed; Vite emitted the existing large-chunk warning.
- Authenticated live order write was not available to test. A previous anonymous query returned `permission-denied`; checked-in rules allow all access, indicating deployed rules differ. ORDER-01 remains open pending deployed-rule configuration and a real order test.

## Test Run: 2026-10-05 (ORDER-01 deployment check)

- Confirmed the screenshot's old inventory-error toast no longer exists in `src` or built `dist`; the current bundle contains the Firestore-specific error handling.
- Confirmed Netlify builds and publishes `dist`.
- Started local Vite server at `http://127.0.0.1:5173/` for retrying checkout against current code.
- Build had passed immediately before this check. Live authenticated order creation remains unverified until checkout is retried against the updated bundle.

## Test Run: 2026-10-05 (ORDER-01 permission result)

- The current checkout toast explicitly reports Firestore denied the order write, confirming `permission-denied` at `addDoc()` rather than an inventory check failure.
- Compared local rules/config: local `firestore.rules` allows all writes; Firebase app config targets `shopportal-f6630`; `firebase.json` targets `(default)`. A prior live anonymous read was denied, so deployed rules differ from the checked-in rules or the console selection differs.
- Did not deploy the local rules because they grant unrestricted read/write access to all documents and customer data.
- ORDER-01 remains open until secure rules are applied to the correct live project/database and an order successfully appears in admin.

## Test Run: 2026-10-05 (ORDER-01 confirmed)

## Test Run: 2026-10-05 (ORDER-01 secure order flow)

- Added verified-customer order creation rules requiring matching Firebase UID and email; restricted full order reads/updates to the authenticated admin email; added deny-by-default rules and admin-only writes for management collections.
- Added authenticated UID/email to new order documents, removed the storefront's full orders read, scoped customer profile lookup to the signed-in email, and gated the React Orders page on the admin session.
- Changed static admin login to use its email/password form and gated customer cache reads on a verified admin session.
- Storefront `npm run build`: passed. Admin `node --check public/app.js`: passed.
- Firebase CLI project listing failed because the CLI is not authenticated. Firestore emulator validation is unavailable because installed Java is older than required 21. No rules were deployed; ORDER-01 remains open pending deployment and live order test.
- Firebase CLI project listing failed because the CLI is not authenticated. Firestore emulator validation is unavailable because installed Java is older than required 21. No rules were deployed; ORDER-01 remains open pending deployment and live order test.

## Test Run: 2026-10-05 (test database reference)

- Read-only test project query found 8 `orders` documents; schema summaries showed initial `new`, `accepted`, and `rejected` statuses. No customer values or order contents were printed.
- Test orders use customer fields `name`, `contact`, `email`, and `deliveryAddress`; the create rule and payload now match this tested shape and bind `customer.email` to the verified Firebase Auth email.
- Confirmed admin orders listener supports status updates and watches the same `orders` collection.
- Storefront `npm run build`: passed. Admin `node --check public/app.js`: passed.
- Main-project rules are not deployed because the Firebase CLI session lacks project access. ORDER-01 remains open until deployment and live checkout/admin approval are verified.
- Main-project rules are not deployed because the Firebase CLI session lacks project access. ORDER-01 remains open until deployment and live checkout/admin approval are verified.

## Test Run: 2026-10-05 (production rules deploy)

- Read-only test database query found 8 orders using the expected `new`, `accepted`, and `rejected` statuses; only schema keys/statuses were inspected.
- `firebase login` reported an existing CLI account; explicit rules deployment to `shopportal-f6630` failed with HTTP 401 invalid OAuth credentials.
- Started `firebase login --reauth`; it is waiting for Google authentication in the browser. No production rules were deployed.
- ORDER-01 remains open until reauthentication completes, rules deploy succeeds, and a live order is visible in admin.

## Test Run: 2026-10-05 (rollback)

- Reverted the latest admin-only rules and customer-ownership redesign in both `firestore.rules` files.
- Restored storefront reservation reads/status handling, customer profile lookup, order payload fields, the original React Orders page behavior, and the prior admin login implementation. Earlier auth-gated listeners and admin order error diagnostics were preserved.
- Storefront `npm run build`: passed; Vite emitted the existing large-chunk warning.
- Admin `node --check public/app.js`: passed.
- ORDER-01 remains open; reverting local rules does not change the rules currently deployed to Firebase.

## Test Run: 2026-10-05 (production deployment completed)

- Reauthenticated Firebase CLI as `bharatkumara999@gmail.com`; project listing confirmed access to `shopportal-f6630`.
- `firebase deploy --only firestore:rules --project shopportal-f6630` completed successfully and released the checked-in rules.
- Read-only anonymous query against production `/orders` returned `permission-denied`, confirming admin-only order reads are active.
- Storefront build and admin JavaScript syntax check passed. The test database has 8 reference orders with `new`, `accepted`, and `rejected` statuses.
- Final end-to-end check remains: place an order with a verified customer account, confirm the admin shows it as `new`, then approve it and confirm the same document becomes `accepted`.

## Test Run: 2026-10-05 (admin sections and customer details)

- Confirmed billing and customer listeners previously attempted restricted reads before admin auth was restored; inventory remains public-readable.
- Gated billing/customer listeners on `admin@shop.com`, added error/unauthorized messages and cleanup; added Orders navigation to Customers.
- Customers form now requires and saves both name and delivery address in Firestore.
- Storefront customer drafts persist name/contact/email/address across reloads in localStorage; passwords are excluded and explicit sign-out clears the draft.
- Storefront `npm run build`: passed. Admin `node --check public/app.js`: passed.
- Live admin deployment and browser behavior remain to be verified under ADMIN-02.

## Test Run: 2026-10-06 (inventory deduction)

- Admin acceptance now performs live stock checks and atomically decrements inventory, creates/updates the customer profile, and changes the order to accepted.
- The transaction sets `inventoryDeducted: true`; a repeated acceptance does not deduct twice, and insufficient stock leaves the order/customer/inventory unchanged.
- Admin `node --check public/app.js`: passed.
- Local admin bundle smoke test confirmed the test project, localhost-only auth bypass, transaction, and `inventoryDeducted: true` code are served at `http://127.0.0.1:5175/admin/app.js`.
- No live acceptance transaction or inventory mutation was run. Test in the local admin against the test project before deploying.
- Admin server on port 5175 was already occupied; restarted test server at `http://127.0.0.1:5176/admin/`. Smoke check passed for test project, localhost-only auth bypass, and transactional inventory deduction code.