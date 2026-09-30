# Phase 2Q — Profile/avatar media

Base: backend `06ffb44a11084028809b340e2902c17c5b40f1a4`; mobile `7d7d99928b64e5101c6a78df12590a19d6dd1de6`. Both work branches: `ql/phase-2q-profile-media`. Sources checked against GitHub trees; all available baseline source bytes match. Legacy mobile store assets omitted from the local test snapshot are preserved by committing changes onto the exact base tree.

## Stored model and complete consumer audit

`users.id` owns `users.avatar_filename` and `users.profile_photo`. The fields can alias the same file or differ. `/api/profile/avatar` replaces only avatar_filename; `/api/profile/photo` replaces both. Privacy updates do not change either filename. There is no media publication column or independent community-avatar toggle. `is_private` defaults to 0; `findable` defaults to 0. Directory location is `city`, `state_region`, `country`; the separate free-text `location` is not returned by the directory. No user latitude/longitude is read for directory search.

| Surface | Existing behavior and Phase 2Q treatment |
| --- | --- |
| Owner account/profile/edit (`/api/auth/me`, `/api/user/profile`) | Both stored fields belong to the authenticated owner; website preview and mobile Profile use protected delivery. |
| Upload, image editing, replacement, removal | Two existing POST routes preserved; owner-only DELETE aliases clear both fields. Generic filename editor remains reference-safe copy-on-write; mobile avatar editor uses the guarded profile upload instead. Account deletion already checks all references. |
| Find a Potter (`/api/potters/find`) | Authentication for listing; exact SQL eligibility `findable=1 AND is_private=0`. Website avatar uses anonymous directory-aware route. Mobile FindPotter renders text cards, without an image. |
| Forum posts/details/replies | Authenticated APIs join `avatar_filename AS author_avatar`; website uses authenticated community presentation. Mobile Forum/ForumPost render initials, preserved. |
| Community combo comments | Authenticated `/api/community/combos/:id/comments` returns author_avatar; website uses community delivery. Combo image publication itself is unchanged. |
| Member lists and member cards | `/api/community/members` intentionally returns avatar_filename even for private members while suppressing bio/location/website. Website uses authenticated avatar loading. Mobile member list uses initials. |
| Member profile variants | `/api/profile/:id` omits avatar and details for private foreign profiles; `/api/users/:id/profile` intentionally retains avatar but hides private details. Website and shared mobile MemberProfile use community delivery where a filename is actually present; full-profile privacy behavior unchanged. |
| Message lists/conversations | Authenticated participant-scoped metadata includes partner_avatar/from_avatar and partner.avatar_filename. Website uses community delivery. Mobile messages/conversations use initials/name metadata; no stored image renderer added. |
| Navigation/chrome and fallback | No separate stored-avatar chrome consumer found. Existing name initials, pottery emoji and image-placeholder behavior retained; failed image affects only its own image. |
| Approved reviews | Anonymous `/api/reviews` includes avatar_filename only for `reviews.is_approved=1`. Added `review` public context checks this stored state. Current website review presentation does not render its returned avatar. |
| Featured potter | Anonymous `/api/featured-potter` explicitly selects both avatar fields for the latest featured record. Website uses `featured` context. Historical featured rows alone do not publish an avatar. |
| Public Gallery attribution | `/api/gallery` and `/api/gallery/:id` return creatorAvatar for explicitly public Pieces. Added `piece` context requires an existing `pieces.is_public=1` record. No Piece media routes or metadata selection changed. |
| Anonymous Combo share attribution | `/api/combos/public/:shareId` returns author_avatar for `is_public=1`; `combo` avatar context checks that state, not `is_shared` alone. |
| Share/export and old builds | No separate profile-image export or profile share-publication flag found. Public attribution above is the existing publication contract. Checked-in compiled Expo bundles and previously released clients remain legacy static consumers; no rebuild performed. |

## Delivery contract

- Owner: `GET /api/ql/profiles/:userId/photos/:filename`, authenticated, account ID must equal path ID and every matching user reference. Either field is eligible for its owner.
- Community: `GET /api/ql/avatars/community/:filename`, authenticated. Every matching user must reference the filename as `avatar_filename`; a private-only `profile_photo` reference blocks access. This preserves the existing authenticated member-avatar contract even if the full profile is private. It is **not anonymous publication**, and no independent visibility toggle exists.
- Public: `GET /api/ql/avatars/public/:context/:filename`, anonymous, contexts `directory`, `featured`, `review`, `piece`, `combo` only. Directory requires both exact stored flags. Featured requires the current featured record and can publish either selected field; other contexts publish avatar_filename only. Publication of pixels never authorizes full-profile data.
- All routes scan both user fields and every stored-file category. Owner delivery rejects foreign references; public/community delivery rejects references not eligible for that context. Any reference in another media category is conservatively rejected, even if same-owner. No first-match authorization.
- Safe flat stored-file resolution, regular file/symlink checks, image extension allowlist; generic `404 {error:"Photo unavailable"}` for foreign/missing/unsafe references; authentication rejects unauthenticated private requests. Responses are `private, no-store` and `nosniff`. Public-aware routes return only bytes, no profile/location JSON. No token in URLs.

Website images choose context explicitly. Owner/community use authenticated blobs, abort controllers, token/generation checks, stale blob disposal, removed-image cleanup and account/logout/401 cleanup. Public-aware image URLs need no token. Protected failures do not retry `/uploads`. Profile metadata and upload completion reject stale sessions.

Shared iOS/Android `profileMedia`/`ProfilePhoto` reuse the existing private-media session lifecycle. Cache identity includes generation/account/context/profile/filename; native paths include session nonce/context. Late downloads are discarded, files/blobs are removed on session replacement/logout, hooks suppress stale pixels and 401 expires the current session. Public contexts use token-free URLs; absent publication metadata stays legacy-compatible. Guarded upload covers local image preparation, token lookup and response completion; no automatic retry under a replacement account.

## Mutations, transitions, and limitations

Replacement associates only the authenticated row, commits DB changes before reference-aware cleanup, preserves shared files, discards failed uploads, and retains committed replacement bytes after cleanup/response failures. Delete clears both aliases, then cleans unreferenced files. Foreign user IDs in payloads cannot choose a target. Old-profile-only aliases are retained by avatar-only uploads. No bulk rename, migration, backfill or historical reclassification occurs.

Directory eligibility is rechecked on every new image request: private to public+findable enables it; private or findable off disables it. Filenames do not change. Community avatars remain available to authenticated members regardless of profile privacy, matching existing behavior. Review approval, featured selection and explicit Piece/Combo publication are independent stored presentation states.

`directory-search.js` is unchanged: radius is 5 or 10 miles between approximate city centres; output is city/region/country plus optional rounded distance, never precise member coordinates or free-text street location. Avatar routes cannot expand this output.

Known `/uploads/<filename>` URLs still work anonymously, including after privacy changes. Already downloaded bytes cannot be recalled. Old compiled/released clients retain that path. Profile privacy is not an avatar-wide revocation switch: approved reviews, the current feature, and explicitly published work can intentionally publish attribution independently. Existing public featured-potter bio is outside this media-only phase and unchanged. Collision rejection can hide an otherwise valid avatar rather than exposing shared private bytes. These are explicit remaining limitations, not claims of global static revocation.

## Verification and next boundary

New disposable HTTP/mutation tests and executable DOM/mobile tests cover ownership, anonymous/public/community access, alias/cross-account/category collisions, path safety, city output, privacy/findability/publication transitions, session races, replacement/delete failures, reference cleanup and legacy access. All previous protected-category suites, calendar/iCal, shared JS parse and strict readiness gate must pass before closure. Exact counts are recorded in the final checkpoint after execution; exact-head GitHub Actions are required after push.

Production, production data, merchant/shop media, global uploads and previous media contracts remain untouched. No deployment, OTA, native build or store submission. Recommended Phase 2R: **audit and protect Forum post/reply media only**, separating authenticated community image/video delivery from any proven anonymous publication and preserving reply/post ownership and deletion rules. Keep merchant/shop and global static restriction deferred. Phase 2R has not begun.

Local final verification: 39/39 new backend/web (28 HTTP/mutation + 11 DOM); complete backend/QL 710 passing executions (546 TAP + 164 individual legacy checks). Mobile 21/21 new; complete 228/228. Shared JS parse 133/133. Separate strict readiness 37/37. Unexpected failures/skips/TODOs/cancellations 0/0/0/0. Calendar/iCal and all prior categories pass. Exact-head Actions status is checked after the documentation commit and reported in the final checkpoint.
