# Phase 4G — navigation coverage acceptance follow-up

Base: `976cd07b654e8bb2b14feb2ba847263cdd91cc7c`, the exact live staging
build including the already-deployed speech retry fix. Speech implementation
unchanged in this slice. Real-iPhone navigation results supplied by Christina
are the acceptance input; a new real-iPhone pass remains pending.

## Implementation

Expanded the existing deterministic intent mapping and browser route allowlist.
32 destinations and 85 aliases. All normal navigation-menu destinations are covered, plus Raw Materials,
Notifications, Messages and Photo Lookup. Admin, record detail routes without
an authenticated selected record, arbitrary URLs and write operations remain
excluded. New navigation destinations do not become new searchable record types.
Existing core contracts, account checks, feature gates, record viewer, forms,
search queries, media privacy and entitlement checks are retained.

`Show me`, `Open`, `Take me to`, `Go to`, optional `my`/`the`, and `please`
resolve to the same canonical destination. Navigation calls the existing
website `navigate()` function and its current loader.

| Reported command | Audited destination |
| --- | --- |
| Casualties | `casualties` |
| Community | `community` (Community Glaze Library) |
| Shop | `shop` (separate from My Store) |
| Ask a Potter | `aiChat` (opens legacy interface; sends no chat message) |
| Glaze Library | `community` (Community Glaze Library; Glazes remains personal) |
| Photo Lookup | `visualSearch` (existing Find by Photo; uploads remain manual) |
| Kiln Share | No route, page, or loader in this website build |

Kiln Share gets a specific unavailable response and stays in the assistant.
Do not invent a route, open Firings, or redirect to a third-party service.
The only current server mention is an informational reference to kilnshare.com
in the legacy AI prompt; it is not a website destination.

Additional navigation: Dashboard/Home, My Store, Shopping List, Goals, Studio
Notes, Members, Find a Potter, Forum, Reviews, Blog, Help, Plans, Profile,
Notifications and Messages. Previously supported studio features remain intact.

Open Firings is hidden initially and for each new request, unrelated errors,
unsupported commands, unavailable destinations, navigation and session changes.
It is shown only for successful firing-date/latest-firing responses. Generic
error text now refers to the normal menu. Script version bumped for Safari.

## Verification

Focused core, HTTP, DOM, voice and Studio Search suite: 429 passing before the
final additional explicit six-destination acceptance regression. The new
regression checks each reported destination against independently specified
canonical routes for all four requested verb forms.
Complete regression runner now includes the existing expansion test file.
Full existing regression runner: exit 0, 1796 TAP tests passed, zero failures;
all standalone batches passed. Final explicit destination regression file: 113/113
passed. Node 22.23.3 matches staging; all test servers were loopback-only and
used disposable synthetic data. `git diff --check` clean. Git/Render history
records final publication and deployment identifiers.

## Staging and acceptance

Only existing isolated service `srv-davicepsrm7s73c4ga0g`, workspace
`tea-d6it8hcr85hc73c5rtog`, auto-deploy OFF.
https://potters-ql-phase4f-safari.onrender.com/#qlAssistant

Test the six available previously-failed commands with typed input, alternate
one or two verb forms, then an unrelated unsupported command. Verify actual
page opening and absence of a misleading Firings shortcut. Check existing
Pieces/Glazes/Clay/Test Tiles/Firings and opening the last firing record.
Kiln Share should explicitly report unavailable in this website build.
Safari microphone reliability remains a separate task. Production, main,
TestFlight, native apps, schema, dependencies and production data untouched.
