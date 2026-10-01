# Quantum Leap Search-2 — website UI and canonical navigation

Base: `407db63384d41b0bc72d3ddd530487009bf9713f` (Search-1).
Local branch: `ql/search-2-web-ui-navigation`.
Status: implementation and local application verification complete; commit/push blocked by the required non-root recovery check. No new commit or remote branch has been created.

## User-visible behavior

Search Studio is in the existing Studio menu. The page provides a labeled native search form, Enter submission, Clear, All/11 type filters, loading/initial/no-results/error/retry states, ordered result cards, Load more, and the 1,000-result narrowing message. Input length uses native 2–120-character constraints; the API validates the complete eight-unique-term/literal-text contract. API errors display bounded friendly text, not backend details.

Cards render only type, title and excerpt using textContent. IDs are opaque navigation locators, never displayed as record content. No snippets render as HTML. Known Test Tile locks remove tile cards and their metadata and label the filter unavailable. Filtered responses do not accidentally clear a previously known tile lock.

Search state lives only in memory. It is cleared at login replacement, logout, token refresh, 401, storage changes and account/session mismatch. Abort controllers plus request serials, account/token/storage identity and session epochs reject late results and canonical reads, including transports that ignore abort. There is no cross-account result cache.

## Canonical navigation coverage

All result routes use `#studioSearch/<type>/<encoded-id>`; opening or restoring one reauthorizes through the existing API. Search payloads never supply detail data. Back to Search, modal close and browser Back clear selected detail; Forward performs a new read. Search results remain available only within the same session while opening a result.

| Type | Fresh owner-authorized read | Viewer |
| --- | --- | --- |
| Piece | `/api/pieces/:id` | Existing Piece detail; Search Back and active-request guard |
| Clay | `/api/clay-bodies/:id` | Existing Clay modal, read-only |
| Glaze | `/api/glazes`, then exact ID | Existing Glaze modal, read-only |
| Raw Material | `/api/glaze-chemicals`, then exact ID | Minimal read-only detail: source, cost/unit, notes |
| Test Tile | `/api/test-tiles/:id` | Existing Test Tile viewer, read-only; current entitlement enforced |
| Firing | `/api/firing-logs/:id` | Existing Firing viewer, read-only |
| Pricing | `/api/pricing-calculations/:id` | Standalone read-only shell using existing numeric pricing breakdown |
| Sale | `/api/sales`, then exact ID | Existing Sale details, read-only |
| Project | `/api/projects/:id` | Minimal read-only detail: description, status, due date, notes |
| Contact | `/api/contacts/:id` | Minimal read-only detail: role, contact fields, notes |
| Event | `/api/events`, then exact ID | Minimal read-only detail: description, date/time, location |

Canonical gaps: Raw Materials, Projects, Contacts and Events had list/editor experiences, but no suitable standalone read-only viewer. Pricing had a linked-Piece breakdown and an editable calculator, but no independent read-only route. Those five receive small compatible read-only shells; existing editors are unchanged. Glazes, Raw Materials, Sales and Events lack a standalone owner-detail GET, so Search uses their existing fresh owner-scoped collection reads. No new backend endpoints or schema changes.

Canonical responses are checked for matching ID and owner before rendering. Pricing deliberately excludes user_id in its existing serialized response: its server endpoint already scopes both ID and authenticated owner. Search accepts that precise existing contract, without changing the serializer or treating a Search result as authorization. Server/ownership/entitlement failures clear stale detail and display unavailable/retry text.

## Verification

Node 22.23.3; dependencies installed with unchanged lockfile and npm ci. Synthetic disposable data only.

- New automated regressions: **86/86** — 60 DOM/session/UI checks and 26 actual HTTP integration checks.
- Search-1: **24/24**, source and API regressions unchanged.
- Complete backend/QL: **1,563 passing** (1,326 Node test executions + 237 individual script checks; aggregate summaries excluded). Failures/cancellations/skips/TODOs: **0/0/0/0**.
- Strict Phase 1 gate: **37/37**.
- Relevant website/API/navigation regressions: included and passing. Existing asset-version assertions updated for the new script/style versions.
- Chromium: **2/2** desktop and 390px iPhone-width engineering smoke checks, covering Enter submission, literal HTML text, focus, 44px targets, no horizontal overflow, fresh detail read and Back. Both screenshots visually inspected. This is not physical iOS/Safari acceptance.
- Recovery: **114 PASS, 0 FAIL, 1 BLOCKED, 0 cancellations/skips/TODOs**. The unchanged `nonroot permission failures preserve data` check reports `Nonroot process unavailable locally: EINVAL; must execute on nonroot CI runner`. The runtime also rejects `runuser` with `cannot set groups: Operation not permitted`. No permission test was skipped, weakened or marked passing. Fresh startup, exact restore, three restored cycles, Calendar/iCal, media, billing, isolation and the other rehearsal checks pass.

An initial run exhausted disk space from retained disposable synthetic rehearsals. Those known synthetic copies were removed, and the final rehearsal completed all checks with only the non-root runtime block above. Earlier development failures were corrected before the reported application suite passed.

## Exact changed files

- `.github/workflows/ql-phase1-verify.yml`
- `public/app.js`
- `public/index.html`
- `public/studio-search.js`
- `public/style.css`
- `ql/verify-phase1.cjs`
- `ql/SEARCH-2-WEB.md`
- `tests/ql-studio-search-dom.cjs`
- `tests/ql-studio-search-http.cjs`
- `tests/ql-studio-search-browser.cjs`
- `tests/website-api.cjs`
- `tests/website-dom.cjs`

## Resume / closure gate

The user's instruction requires every check to pass before committing or pushing. Therefore this work is **uncommitted and unpushed**, and Search-2 is not claimed closed. To finish, either provide a supported non-root local runtime or obtain explicit approval to commit and push only this verification branch so existing GitHub Actions can execute the unchanged full regression, strict and non-root recovery workflow. Verify exact-head Actions before declaring the checkpoint complete. Do not merge or deploy.

Commands:

```sh
node --require ./ql/rehearsal/suite-isolate.cjs --test tests/ql-studio-search-dom.cjs tests/ql-studio-search-http.cjs
node --require ./ql/rehearsal/suite-isolate.cjs ql/verify-phase1.cjs
QL_READINESS_STRICT=1 node --require ./ql/rehearsal/suite-isolate.cjs --test tests/ql-readiness-blockers.cjs tests/ql-safety-migrations.cjs
node ql/rehearsal/run.cjs
```

Recovery requires the existing `.rehearsal-checkout` synthetic marker and a supported non-root runner. Browser smoke is a separate explicit command, with no skip fallback:

```sh
PLAYWRIGHT_MODULE=/path/to/playwright CHROMIUM_PATH=/path/to/chromium node tests/ql-studio-search-browser.cjs
```

Production, isolated Render deployment/configuration, mobile source, TestFlight 49, stores, OTA, Photo Lookup and `/api/pieces/photo-search` scoring remain untouched. No mobile integration started. No full Porcelain redesign, AI/semantic/fuzzy behavior, new media behavior, schema or index work.
