# Phase 2S — Merchant / Shop media

Base backend: `65bbc8099a8d6394afde2cd4597a76e9b8f27593`; mobile: `af1dca1daa928698b337f9fec7dad3c7654f524e`. Both base workflow runs (36669017218 / 36669038054) were confirmed successful against those exact heads. Phase branch: `ql/phase-2s-shop-media` in both repositories.

## Repository-derived inventory

| Surface | Storage and behavior |
| --- | --- |
| Product list / website Shop and guest Shop Preview | `merchant_products.image_filename`: one cover image per product, not an image/gallery child table. Website card is the storefront. Public list selects `is_active=1`. |
| Shared iOS/Android ShopScreen / ProductDetailScreen | Same single image on list and detail; product passed via navigation. Public sample button; checkout opens Stripe. Both image consumers now use shared ShopImage. |
| Public sample | Checked-in `public/shop/mud-log-preview.pdf`, generated independently by `generate-preview.js`, explicitly watermarked/sample pages. Shared public sample for PDF product cards, not a paid-original entitlement. No sample field/table. |
| Paid original | Nullable `merchant_products.download_filename`. Baseline delivery ignored this field and always served generated `public/shop/the-potters-mud-log.pdf`, even for physical products. `generate-pdf.js` writes that original; it is not present in the checked-in Shop directory. No product ID or seed proves which historical unbound product owns it. |
| Admin create/edit | POST/PUT `/api/shop/products[/id]`, one multipart `image`. Comment/schema define Christina's single shop; no merchant/user owner column, multi-merchant table, original upload/replacement UI, dedicated product delete route, or admin product editor found. Baseline incorrectly allowed any authenticated user to create/edit. |
| Purchase/order metadata | `merchant_orders.id,user_id,product_id,price_paid,status,stripe_session_id,created_at`. `/api/shop/my-purchases` is authenticated and lists completed orders with order-scoped download URLs. Admin orders view joins products/users. No downloadable assets table, license/expiry table, or order snapshot of a file. |
| Receipts and downloads | Signed Stripe webhook inserts orders and sends 30-day signed order/user email grant. No guest checkout: checkout requires account auth. Email grant intentionally allows download without an interactive login but is limited to that account/order. No current website/mobile My Purchases renderer or download button found despite receipt copy promising Profile access. Existing download surface is the email/API route. |
| Other public/external surfaces | No additional product landing page/gallery/share-image generator or Shop media renderer in external-store links found. Profile store links are external URLs, not merchant assets. No media in receipts/order list beyond product text/download link. |
| Legacy | Six checked-in Expo web bundles and already-released native clients retain static catalog image URLs. No compiled asset rebuild. Old bookmarks/public cached files cannot be recalled. |

## Exact access and publication contract

- **Public catalog:** product row exists and `is_active === 1`. Anonymous listing/detail/image delivery. `is_active=0` is nonpublic/inactive; no separate draft/published/storefront flag exists. Null/other historical states remain legacy-ambiguous; no backfill or classification writes.
- **Public preview:** only the explicitly implemented Mud Log sample. Its public route is retained. A preview never becomes an original via client filename/order/product parameters.
- **Merchant-private:** the existing documented single merchant is the current authenticated `users.email === ADMIN_EMAIL` account. No ownership is inferred from caller-supplied IDs, `is_admin`, filename, extension or possession. An order-scoped email token cannot act as a Shop editing credential. Admin can inspect inactive/ambiguous/existing product image by exact product ID. Ordinary members receive generic missing behavior. No multi-merchant ownership scheme is invented.
- **Purchased originals:** current user exists; verified auth bearer or exact-order signed email grant; exact `merchant_orders.id/user_id/product_id`; `status='completed'`; current product exists with `is_digital===1`; explicit `download_filename`; isolated file relationship; safe file resolution. Email signature/expiry are rechecked. A supplied signed-in bearer takes precedence over an email grant, preventing cross-account substitution.
- **Original storage:** flat safe stored filenames resolve in uploads, consistent with the existing deletion reference model. The one explicitly generated bundled original has an exact manifest mapping to its existing public/shop disk path; it requires an explicit stored relationship, and duplicate physical upload candidates fail closed. The explicit sample filename is denied as an original. Arbitrary stored paths, symlinks, missing files and cross-record/cross-slot collisions fail closed. No universal-Mud-Log fallback for null/ambiguous product mappings. Historical mapping remediation requires separate authorized work; this phase does not rewrite orders/products.
- **Purchase policy preserved:** inactive product remains downloadable for an otherwise valid existing purchase. Deleted/non-digital/unbound product is unavailable. Multiple purchases/repeat downloads work. Refunded/cancelled/pending/non-completed statuses deny. No new download count limit/license expiry. Email links retain 30-day expiry; normal account entitlement has no new expiry. Existing code has no automatic refund/cancellation webhook synchronization; stored status remains authoritative, a release risk.
- **Payment integrity defect fixed:** merchant checkout completion only grants entitlement for Stripe `paid` or `no_payment_required`; duplicate `stripe_session_id` webhook deliveries do not create repeat orders. No unrelated subscription/payment/pricing behavior changes, no old order rewrite.

## Routes and headers

- `GET/HEAD /api/ql/shop/products/:productId/image/public`: anonymous, eligible current product and isolated image field; safe raster file; `public, max-age=0, must-revalidate`, nosniff. Revalidation avoids an intentional positive freshness window after unpublish.
- `GET/HEAD /api/ql/shop/products/:productId/image`: existing auth plus merchant admin; exact product; safe isolated bytes; private/no-store/nosniff/no-referrer. Foreign/missing are generic; missing authentication follows existing auth middleware.
- `GET/HEAD /api/shop/download/:orderId`: purchase contract above, attachment headers, private/no-store/nosniff/no-referrer. Generic 404 for unavailable/unauthorized, no filesystem path in errors. Client-supplied user/product/file/order query parameters confer no access.
- `/shop/mud-log-preview.pdf`: retained public preview with nosniff and revalidation.
- `/shop/the-potters-mud-log.pdf`: direct access denied before public static middleware, including normalized/encoded spelling. Disk file is not moved/renamed. The old public original path was an actual purchase bypass, distinct from global uploads compatibility.
- Public product JSON no longer discloses `download_filename`; adds derived mediaAccess/image_url without altering stored data.

All stored-file categories participate in collision checks. Even same-owner duplicate product references are conservatively rejected for delivery, while cleanup retains referenced bytes.

## Clients and mutations

Website catalog uses product-scoped anonymous images; sample unchanged; failures hide only the image. Website private loader and purchase-download helper use auth headers, session generation guards, disposable blobs, stale-response rejection and cleanup on login/logout/replacement/expiry. No protected fallback to `/uploads`. No admin editor or purchase UI was added/redesigned: helpers are ready for those consumers but current source has no such UI to wire.

Shared mobile ShopImage renders public product URLs without bearer headers and has a local decode-error placeholder. Shared `loadShopPrivate` supports exact product-private or order-download identity, account/session checks before and after asynchronous operations, disposable web blobs/native cache files, explicit release, partial-download cleanup, logout/replacement cleanup and no bearer URLs. It reauthorizes every request rather than treating cached bytes as a current entitlement. Existing auth lifecycle owns expiry and triggers shared cleanup. No private editor/purchase screen exists; service coverage uses mocked iOS/Android, not a native device/build.

POST/PUT enforce merchant authorization before multipart writes, validate image metadata/decode, reject malformed/interrupted uploads, parse boolean state explicitly, and transact changes. Replacing one cover preserves downloadable original, other products and unrelated fields. Reference-aware cleanup runs after commit; uploaded files surviving response/cleanup failure remain referenced and intact. Unpublish does not delete bytes. No product delete workflow is introduced. Existing shared deletion helper already covers both merchant filename fields and is unchanged. Existing general by-filename editor does not grant Shop ownership and uses copy-on-write for other owned references.

## Remaining blockers and limits

Global `/uploads` is unchanged: known draft/private/original upload filenames are still anonymously retrievable there, verified by a regression. This phase protects new/current consumers, not complete legacy URL revocation. Old native/compiled consumers, saved/copied links and historical ambiguous rows block global restriction. Original files already downloaded or cached cannot be recalled. Missing historical download mappings now fail safely; correct product mapping needs separate review before deployment. No original upload management, refund-status synchronization, purchase-file version snapshot, or missing purchase UI is silently invented. Conservative collisions may hide legitimate duplicates. Device integration remains untested; no new native build/deployment authorized.

## Verification and scope

Focused new backend/web: 60 (49 API/mutation/webhook + 11 executable DOM). Focused mobile: 21 (shared service, simulated iOS/Android, component rendering). Full expected totals: backend/QL 825 (661 TAP plus 164 individual legacy checks); mobile 276; shared JS 137; strict readiness 37. Final committed-head Actions are reported in the completion checkpoint. Zero unexpected failures/skips/TODOs required. Earlier media contracts and Calendar/iCal remain in the full suites.

Only synthetic disposable databases/files were used. No production data access, deployment, OTA, native build/store submission, migration/backfill, historical file rename/path rewrite, pricing change, or global uploads restriction.

**Recommended Phase 2T:** repeat the complete global `/uploads` restriction-readiness audit against both current repositories. Inventory remaining static consumers (especially Piece list/Gallery/search/edit, compiled/released clients and external links), unresolved visibility/entitlement mappings, collision behavior and rollout dependencies; produce a concrete staged closure plan without restricting `/uploads`, changing historical records, accessing production or deploying. Phase 2T is not started.
