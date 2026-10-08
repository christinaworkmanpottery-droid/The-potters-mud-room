# Phase 2C — public upload privacy remediation plan

Date: 2026-09-29. This is an audit/plan, not a production migration or global delivery rewrite.

## Current exposure

The server mounts the complete persistent upload directory at `/uploads` with unauthenticated
`express.static`. Stored upload names are UUID-based, so casual guessing is difficult, but possession
of a filename is sufficient to fetch its bytes and there is no record-level authentication,
ownership, or visibility check at that route. UUID filenames reduce predictability; they do not
make the files private and there is no authorization boundary preventing direct URL reuse.

This affects records whose file references are stored in the shared upload directory, including
Piece, Clay, Glaze and glaze/clay-test photos; Firing and Project photos; Test Tile photos; Pricing
photos; Sale and Event images; profile/avatar images; Glaze Combo images; forum post/reply media;
and other shared-upload features. Some of these records are intentionally public/community-facing,
while studio/account records are private by default. The single static route does not distinguish
those policies.

Phase 2B Connected History is different: History JSON is authenticated and `private, no-store`;
History Piece photo bytes are fetched from the owner-scoped
`/api/ql/pieces/:pieceId/history/photos/:photoId` route with bearer auth, ownership checks,
safe flat/non-symlink path checks and generic denial. History does not use `/uploads`.

## URL and cache characteristics

Upload filenames are generated as UUID v4 plus the original extension. They are not sequential and
are not practically enumerable by incrementing an ID, but URLs can be copied, logged, retained by a
client, or exposed anywhere a record payload/UI reveals the filename. The static route has no
application-specific private/no-store policy, so normal static/browser/intermediary caching can
extend exposure after a session changes. Protected History explicitly requests `cache: no-store`
and responds `private, no-store`.

## Compatibility constraints

Existing website code constructs `/uploads/<filename>` URLs directly for established photo
surfaces. The current iOS/Android React Native repository also constructs absolute
`.../uploads/<filename>` URLs for Piece, Clay, Firing, Project, Test Tile, Profile, Forum and Photo
Lookup surfaces (and additional API consumers may return the same filename fields). Removing or
auth-gating the static route in one step would therefore break existing clients and stored
references. Existing database values are filenames, not a protected media identifier contract.

Public/community records also need deliberate anonymous delivery. A blanket "all uploads require
auth" change would regress public profiles/community/forum/shop-like surfaces.

## Recommended architecture

1. Keep physical stored filenames internal. Add stable media records/IDs that carry owner,
   record type/record ID, purpose, MIME type and an explicit visibility policy
   (`private`, `authenticated/community`, or `public`).
2. Serve private studio media only through authenticated record-scoped endpoints that re-check the
   requesting user at delivery time. Follow the Phase 2B History route pattern: opaque record IDs,
   safe-path validation, generic denial, `X-Content-Type-Options: nosniff`, and
   `Cache-Control: private, no-store`.
3. Serve intentionally public media through a separate public-media endpoint keyed by an opaque
   media ID and backed by a server-side visibility check. Do not infer public visibility merely
   because a filename is known.
4. Do not put bearer tokens in image URLs. Website may use authenticated fetch + object URLs for
   private media. Native clients should use authenticated requests/caching facilities tied to the
   current account and purge private cached media on logout/account replacement.
5. Keep the old static route during a compatibility window only for references explicitly
   classified as public or for old clients under a bounded release plan. Do not silently convert
   unknown legacy files to public.

## Migration / compatibility strategy

Inventory every live file reference and classify its owning record and intended visibility before
changing delivery. Introduce media IDs alongside existing filename columns; preserve filenames as
storage pointers during migration so bytes do not move unnecessarily. Backfill only after a
production-approved backup/rehearsal and never infer privacy from filename shape.

Update website and mobile clients to consume server-provided protected/public media URLs or media
IDs instead of constructing `/uploads` paths. Ship compatible clients before disabling private
legacy static access. For older mobile builds that cannot understand protected media, choose an
explicit supported-version cutoff/upgrade path rather than exposing private files indefinitely.
After client adoption, make `/uploads` unavailable for private references and eventually remove
direct static delivery once no supported client depends on it.

## Caching

Private media: `private, no-store`; authenticated fetch; revoke website object URLs on navigation,
logout and account replacement; native cache keys must include account identity or be purged on
account changes. Public media may use bounded immutable caching only after the media record is
explicitly public. Visibility changes need URL/version rotation or cache invalidation so a formerly
public URL does not remain a long-lived authorization bypass.

## Required verification

- unauthenticated/private, cross-account, stale-token and direct-ID denial for every private media type;
- public/community media remains anonymously available only when its record is public;
- account switching cannot reuse DOM/object URLs/native cache entries from the prior account;
- missing, symlink, traversal, shared-filename and corrupt-reference cases fail generically;
- website desktop + narrow layouts and supported iOS/Android builds render protected media;
- upload/edit/delete/copy-on-write and account deletion continue to clean the correct bytes;
- migration is idempotent, reversible from paired DB/uploads backup, and preserves existing references;
- cache headers and client caches are inspected, including visibility transitions.

## Rollout gate

The pre-existing static upload route is a privacy exposure for private studio media even though
filenames are high-entropy. It predates Quantum Leap and Phase 2C does not rewrite it. Before any
production rollout that presents Connected History as a private connected-studio feature, complete
the protected-media remediation for the private photo types that History or the Piece detail
surface exposes, and define the compatibility path for supported mobile clients. Public/community
media can remain on a separately authorized public-delivery path.

No production access, migration, deletion, backfill, or deployment was performed in Phase 2C.
