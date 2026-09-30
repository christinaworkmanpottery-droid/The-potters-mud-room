# Pre-release Shop original asset

Branch: ql/pre-release-shop-original-asset. Baseline: 229e04ab571e8a4ceae120e329adbddc800b5447.
Phase 3 closed; production/mobile unchanged; billing blocker remains unresolved.

## Authoritative source

All fetched branch/tag histories contain only two PDF paths: the original and its preview.
The original was introduced in 54ba9d8, corrected in 66929c0, made ink-friendly in
5252b26, and enhanced with Notes pages in 643cd0f5b5f26949d0d550f009ebe5eb1c2311f0.
The broad web rebuild b475e8d deleted both PDFs. 4086ccc restored only the preview.
This slice restores the exact latest pre-deletion original blob, without regeneration.
The document identifies itself as The Potter's Mud Log, A Printable Pottery Journal.
There is no later or alternative original PDF in fetched repository history.

- Path: public/shop/the-potters-mud-log.pdf
- Size: 91028 bytes
- SHA-256: 760a69c64295bc660fff4f6383494b9f66ed7abc1405c3807ac84a507b7599d1
- PDF 1.3, 113 US Letter pages, unencrypted; application/pdf.
- Preview stays public/shop/mud-log-preview.pdf, 5381 bytes, SHA-256
  aab6145cef3d2479ed18cf856dd83ca97914b33fef4ebe9c0e2a82febc06c2e5.

Existing shopDownloadFile selects this exact original only for explicit digital-product
binding. Preview cannot substitute for it; duplicate upload candidates fail closed.
The public original path remains blocked. Existing purchaser/merchant, active/inactive,
order status, uploaded-original, pricing and product semantics are unchanged.
No server, database, startup, restore transformation or generator implementation changes.

## Verification

Node 22 with npm ci. ql/check-shop-release.cjs runs before startup/install in an exact-head
clean checkout: tracked, not ignored, equal to HEAD bytes and manifest hash, pdfinfo,
text identity, all 113 pages decoded by Poppler, preview distinct. No data restore or
PDF generation is invoked. CI performs the same preflight before full suite/rehearsal.

Five new asset tests plus eight real-original authorization tests: 13 new regressions.
Existing Shop API tests now also exercise the tracked original and preview. Complete
backend/QL target: 1372 (1359 + 13). Strict Phase 1: 37; initialization: 53;
editor preservation: 95; demographics: 45. Phase 2, Phase 3A-H, History,
Contacts/Events and Calendar/iCal are in the existing suite/rehearsal commands.
Rehearsal target: 114 checks (113 + tracked release manifest before startup).
Exact-head CI evidence records actual outcomes; targets here are not test results.
The separate billing conflict continues to make the overall release decision BLOCKED.

## Next isolated recommendation (not implemented)

Audit the special-account startup billing assignment against the existing CHECK and
all billing-period readers/writers. Choose the smallest compatible representation correction
that preserves entitlements and billing interpretation. Test fresh/existing special accounts,
ordinary accounts, repeated startup, writable-handle integrity and recovery classification.
Do not broaden schema or billing semantics without that evidence. No billing fix in this slice.
