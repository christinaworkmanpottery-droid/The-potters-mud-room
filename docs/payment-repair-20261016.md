# Production payment repair — October 16, 2026

The persistent users table retained the original CHECK constraint even after the
CREATE TABLE definition added `starter`. Successful subscription checkout events
therefore failed to update member access. A previous startup routine bypassed
constraints and granted three hard-coded accounts access on every restart.

This repair:

- Takes and reopens SQLite snapshots, checks structural integrity and every table's
  row count, then transactionally rebuilds only the legacy users constraints.
  Preserves columns, rows, indexes, triggers and foreign-key relationships.
- Removes hard-coded startup membership grants. Existing access is preserved.
- Reconciles live Stripe checkouts with exact application user IDs, matching
  customer identity, recognized subscription products, successful non-refunded
  payment evidence, active status and a future period end. Only verified paid
  access is restored. Conflicts and unpaid existing access are flagged for review.
- Saves a verified database snapshot and before/after audit before entitlement
  corrections. Does not charge, refund, cancel subscriptions or send repair emails.
- Stores signed webhook event IDs before acknowledgement, retries failed work
  with backoff, deduplicates fulfillment, and reconciles hourly and at startup.
- Adds authenticated, no-store revenue/history endpoints and mobile admin cards.
  Payment fees and account-level payout adjustments are deliberately separate.
- Keeps native receipt-only evidence under review until payment status is verified.
  Does not alter native builds, purchase verification, or TestFlight configuration.
- Filters admin/identifiable test users from content-activity summaries. Raw
  historical data remains intact; metrics explicitly describe saved content,
  rolling windows and UTC daily buckets rather than claiming session activity.

## Verification

Run with the repository's compatible Node runtime:

```
node tests/billing-repair.cjs
node tests/billing-http.cjs
npm run test:website
node tests/billing-browser.cjs
```

Browser checks require Playwright and Chromium; the test supports an explicit
`BILLING_CHROMIUM_PACKAGE` location for constrained environments. Synthetic
fixtures only; no real customer data or credentials are committed.

## Operations

Private backups: `data/billing-backups/`. Entitlement audit: `billing_audit`.
Durable retries: `billing_events`. Last verified revenue state: `billing_state`.
If a backup or migration fails, the original database is retained and the repair
is deferred. If Stripe fails, existing access/history is retained and verification
is marked stale. Unknown/canceled paid classifications are never silently gifted.

Schema rollback is not required for application rollback: original columns and
legacy tier values remain supported. Restore an actual database snapshot only
under an explicit recovery procedure; blindly restoring would lose new records.

The existing Stripe SDK/API generation is retained for this incident repair.
Webhook event subscriptions must include checkout completion/async success,
invoice paid/failed, subscription changes/deletions, refunds/disputes and payouts.
No customer-specific values belong in this public repository.
