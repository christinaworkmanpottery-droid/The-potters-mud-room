# Search-1 — saved studio record search

Branch: `ql/search-1-studio-search`.
Backend parent: `ffda5e75bbe2849b4840150e5dc6e86f13075b99`.
Master-roadmap Phase 3 (Search + Photo Lookup 2.0); not engineering Phase 3A–3H.

## Scope and source audit

The current master tracker identifies Search + Photo Lookup 2.0 as unfinished.
Existing backend search is fragmented: Piece title/description/notes filtering,
Community Combo filtering, forum search and image-based Piece matching. There is
no cross-record QL Search endpoint at the parent. Existing Photo Lookup scoring
in `POST /api/pieces/photo-search` remains unchanged; a light/plain-piece upgrade
needs a labeled evaluation set, not speculative scoring changes.

This first slice adds `GET /api/ql/search` and `ql/studio-search.cjs`. It searches
11 owned record categories: Piece, Clay, Glaze, Raw Material, Test Tile, Firing,
Pricing, Sale, Project, Contact and Event. Direct stored text fields are explicitly
allowlisted in the service. No shared/public/community/private-group search,
relationship expansion, recipe ingredient search, AI, voice or media retrieval
is implemented in this slice. No new schema, backfill or persistent index.

## API and boundaries

- Existing Bearer authentication plus a current database account are required.
  Deleted-account JWTs and synthetic admin-key identities do not access search.
- `q`: 2–120 characters after trimming (raw input also capped at 120), at most
  eight unique whitespace-separated terms; literal substring AND matching across
  the direct fields. Case-folded Unicode NFC; no stemming, fuzzy matching,
  accent removal, semantic search or operator interpretation.
- Optional `types`: comma-separated allowlisted type identifiers. Default all.
- `limit`: default 25, 1–50; `offset`: default 0. Window must end at/before 1000.
  At the cap, `capped:true` and `nextOffset:null` tell the client to narrow search.
- Exact title matches rank first, title phrase matches second, remaining field
  matches third. Stable binary normalized-title/type/ID ordering breaks ties.
  Offset pagination is stable for an unchanged dataset; edits between requests
  can change positions. This is not a snapshot cursor.
- Results: `recordType`, canonical `sourceRecordId`, `title`, `matchedFields`,
  and bounded plain-text `excerpt`. No file paths, media URLs, linked foreign IDs,
  raw rows, billing metadata or fabricated provenance. Clients must render text
  safely, never interpret stored snippets as HTML. Reauthorize canonical detail
  reads when opening a result; a search result is not a durable access grant.
- Every source query filters `user_id`; no owner overrides from query parameters.
  Public visibility never adds another owner's private studio records.
- Test Tiles match the existing current-database tier read contract. When locked,
  the table is not searched and `lockedTypes` contains only the static type name,
  with no count/title/excerpt leakage. Client/JWT tier is ignored.
- One read transaction covers current account, entitlement and result queries.
  No cache, remote provider, external call or DB mutation. Rename/delete/access
  changes appear on the next request. Responses (including failures) use
  `Cache-Control: private, no-store`.
- Work is bounded by query length, terms, categories and returned window. Literal
  search scans owned text; production-scale performance is not certified. Each
  category selects at most offset+limit+1 rows before the global merge. Evaluate
  representative scale before designing an additive index, without hiding rows.

## Verification and resume

24 new service/API regressions pass on Node 22 with disposable synthetic DBs and
loopback-only networking. They cover all categories, tenant boundaries, corrupt
cross-owner links, current entitlement changes, auth failures, malformed/structured
input, SQL/wildcard literals, Unicode, ranking/pagination/cap, canonical references,
bounded excerpts, rename/delete freshness and read-only schema/data preservation.
The complete `ql/verify-phase1.cjs` run passed with zero failures, skips,
cancellations or TODOs. The strict Phase 1 gate passed 37/37.
The new tests are included in `ql/verify-phase1.cjs` and the branch is included in
the existing full regression/recovery CI workflow. Final suite results and remote
commit are recorded in the task handoff.

Next bounded slice: website Search UI and result navigation using canonical
authorized record loaders, with safe text rendering, account/session cancellation,
loading/empty/error/locked states, filters and pagination. Then shared mobile
integration and engineering smoke checks before Christina's next product milestone.
Photo Lookup evaluation follows without regressing the working legacy lookup.

Production, mobile source, TestFlight 49, isolated hosted backend configuration,
store submissions and OTA remain unchanged. No physical-device acceptance claimed.
