# Account preservation release — October 16, 2026

Production target: `the-potters-mud-room`, service `srv-d6it9vpdrdic73emsvjg`, existing main branch. Preview services and native releases are outside this change.

## Policy and implementation

- Subscription transitions update a separate entitlement ledger. They never delete studio records, account identities, media files, or relationships.
- Verified paid history distinguishes lapsed paid memberships from Free and unverified legacy memberships. Free, administrator and complimentary access is preserved. Unverified legacy memberships stay accessible for review.
- Shared authentication blocks suspended-member reads and writes with HTTP 402 / MEMBERSHIP_INACTIVE. Recovery authentication returns only minimal account information. Billing, password recovery, explicit account deletion and native purchase verification/restore stay available.
- Owned media URLs (including encoded paths) and calendar subscription feeds cannot expose suspended-member records. Media responses no longer permit caching; the website service worker discards its prior cache.
- Stripe renewal failures receive 14 days from the signed first failure event. Historical failures without an event start conservatively when first observed. Suspension requires a successful post-grace reconciliation; transient provider errors preserve last verified access. Existing reconciliation runs hourly and on billing webhooks and explicit billing refresh.
- Cancellation schedules `cancel_at_period_end` on the original linked subscription; it does not immediately downgrade, cancel unrelated subscriptions or delete history.
- Checkout retains account identity, directs existing subscriptions to the billing portal, reuses open sessions, serializes concurrent requests and uses durable Stripe idempotency keys. Successful paid reconciliation restores the original records and can replace a canceled subscription link.
- Current administrator-verified identity/enrollment at an accredited school enables the approved 25% student rate on standard Monthly/Annual reactivation. No unverified student status is invented. Verification is stored through the authenticated admin endpoint; a student application/verification UI is not part of this release.
- Grace/suspension notices use the existing durable email delivery system, with eligibility rechecks and stable delivery keys.
- Native notification processing now verifies Apple signatures using Apple's official server library and pinned Root CA G3; Google notifications trigger authoritative Google Play v2 purchase lookup. Receipt ownership cannot transfer between accounts. Store grace rules remain store-managed. No store subscription settings were changed.
- Emergency maintenance no longer removes uploaded media or live SQLite journal files.

## Validation

15 account-protection acceptance groups cover Free/legacy/gift/admin, Annual access, paid-through cancellation, suspended web/iOS/Android HTTP requests, reads/writes/exports/photos/feeds, minimal recovery authentication, 14-day grace/stale evidence, 20-year inactivity, provider outages, existing-subscription reuse, concurrent checkout, verified student pricing, original-account Monthly reactivation, native ownership/restore/revoke, forged Apple notifications, safe maintenance and admin audit.

Existing suites passed: 14 billing safety checks, 4 signed-webhook HTTP checks, membership welcome, administrator membership email, bounce suppression, email reliability, website API including record/photo preservation across restart, and website DOM. Payment admin and new reactivation UI each passed at 390px and 1440px.

All automated payments/notifications use isolated synthetic fixtures; no real customer was charged, canceled, or used as a test account. Native cryptographic rejection was tested; valid live store renewals and installed device behavior still require store/device verification.

## Mobile limits

The native repository's master source points to the same production backend. It also contains a local offline SQLite cache, a stored-user login path, and a diagnostic native-purchase fallback. Repository source is not proof of the exact binaries currently installed from either store. A native update is required to display a full renewal-only screen, respect the structured 402 response throughout navigation, and gate previously downloaded/offline records without deleting them. Backend rules cannot erase or hide previously downloaded content inside unchanged app binaries. TestFlight 49 and Quantum Leap are unchanged.

## Operational review

Use Admin > Account Protection for every current account's access classification and studio-table inventory. Admin > Payments & Revenue retains Stripe reconciliation details. The server version endpoint reports the deployed Git commit. Unknown legacy evidence is reviewed rather than automatically suspended.
