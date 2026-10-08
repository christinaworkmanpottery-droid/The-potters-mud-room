# Phase 2R — Forum post/reply images and videos

Base backend `ac77e949d440ea5cc148766830844d47594ebd78`; base mobile `9738bfd1dc78ddcff8eb96a7c5b9d67ba8fae80a`. Both branches `ql/phase-2r-forum-media`. No production access, deploy, migration, backfill, historical rename/rewrite, OTA, native build or store submission.

## Model and audited surfaces

`forum_posts.id/user_id` owns a post. `forum_replies.id/post_id/user_id` owns a reply independently of the post owner. Both images and videos use `forum_photos.id/post_id/reply_id/filename/original_name/created_at`. No separate video table, publication field, persisted MIME, transcoding or video pipeline exists. New post media has post_id only; new reply media has reply_id only. Historical dual references are valid only when post_id equals the reply's thread. Reply media is never selected as post media. Orphan/conflicting linkage is legacy-ambiguous, not newly published or rewritten.

| Surface | Repository behavior and Phase 2R treatment |
| --- | --- |
| Categories, feed/list, detail/thread | All API routes require auth. Feed shows media count, not thumbnails. Detail renders post/reply images and videos. Metadata adds mediaAccess/mediaType derived from valid relationships; stored rows unchanged. |
| Website edit | Existing post media uses the same protected renderer. New local files stay local until upload. Single attachment deletion no longer throws on an undefined DOM variable. |
| Create/add/edit/reply upload | Existing field `photos`: up to five per post request, one per reply request; reply attachments require exact existing `starter` tier. No new tier gate for community viewing. Post add/edit appends attachments. New targeted PUT replaces one media ID. |
| Shared iOS/Android | ForumPost detail and post/reply edit images use ForumMedia, with owner edits routed by media ID. Initials avatars unchanged. CreatePost and reply picker remain image-only as before; server and website support video uploads. Previously mobile treated video filenames as Images; videos now play in existing react-native-webview with no new native dependency/build. |
| Moderation | Owner edits/replaces; owner or the existing ADMIN_EMAIL user can delete media/reply/post. `is_admin` and x-admin-key do not gain new Forum mutation rights. Existing report/block flows remain; protected bytes apply bidirectional blocks to post/reply authors. |
| Account deletion | Self/admin account deletion gathers Forum cascade filenames within the existing transaction; checks inconsistent dual parents before deletion; cleanup after commit, reference-aware. |
| Notifications/push/messages | Forum notification payloads contain text/title/post ID/navigation links, not stored Forum image/video previews. Notifications navigate to the protected thread. No additional Forum attachment renderer in Messages. |
| Anonymous/shared | No anonymous Forum content/media endpoint found. Guest Forum is signup preview copy, not anonymous stored posts. No anonymous media access was added. |
| Legacy compiled clients | Six checked-in Expo web bundles under public/app/_expo and public/_expo retain static consumers. Existing released clients and copied static URLs remain compatible. No bundle rebuild. |

## Viewing contract and routes

A registered authenticated community member may view valid Forum post/reply media without owning it. Owner mutation rights are separate. Exact post, reply and media identity is resolved server-side. Any other Forum row sharing the filename, even same-owner, blocks protected delivery. Any reference from another stored-media category also blocks delivery. This avoids first-match/cross-account/thread substitution. Blocking is checked bidirectionally; this is intentionally stricter than the legacy direct-thread JSON route, which does not enforce the feed's author-block filter.

- `GET /api/ql/forum/posts/:postId/media/:mediaId`
- `GET /api/ql/forum/posts/:postId/replies/:replyId/media/:mediaId`

Both require the existing bearer auth plus a current users row; safe flat regular-file resolution, symlink rejection, supported extension/MIME mapping, generic 404, `private, no-store`, `nosniff`, `no-referrer`. No filesystem paths or bearer tokens are returned in media URLs. Known protected failures never retry static uploads. Valid old rows are authenticated by the existing Forum contract, not filename shape or a fabricated public/private flag. Explicitly ambiguous relationships retain only existing compatibility behavior.

### Streaming video

`sendFile` preserves streamed bodies, HEAD, byte/suffix ranges, 206 and 416 with Content-Range, without full-video blobs. MP4/M4V = video/mp4; MOV = video/quicktime; WebM = video/webm. Browser/device codec support is unchanged; there is no transcoding. Images accept JPEG, PNG, GIF, WebP, HEIC/HEIF and AVIF extensions; render/decode failure is local.

HTML video cannot set bearer headers on range requests. `POST /api/ql/forum/sessions/:session` requires bearer auth and issues a random HttpOnly, SameSite=Strict cookie scoped to `/api/ql/forum/streams/:session/`; HTTPS sets Secure. The URL session nonce is **not a credential**. Server memory retains the secret/account, bounded by 15 minutes or original JWT expiry, whichever is sooner. No disk/token URL persistence. Stream routes repeat the full relationship/collision/block/user checks on every request:

- `GET /api/ql/forum/streams/:session/posts/:postId/media/:mediaId`
- `GET /api/ql/forum/streams/:session/posts/:postId/replies/:replyId/media/:mediaId`

`DELETE /api/ql/forum/sessions/:session` revokes only the authenticated account's grant and leaves a bounded tombstone to reject late bootstrap requests. Grants expire and restart fails closed. A 10,000-entry cap limits memory. Native WebView opens the equivalent `/api/ql/forum/player/:session/posts/.../media/...` with an in-memory Authorization header. The server returns a minimal same-origin HTML video player plus the scoped cookie. It has no JS, external navigation or embedded token. Incognito/cache-disabled WebViews unmount on session changes. Website video uses POST bootstrap then the stream URL. No credentials are appended to persistent URLs.

## Client lifecycle

Website images use fetch auth + disposable blobs; videos keep controls, inline playback and metadata preload. Per-node abort/identity/generation guards prevent stale completions; removed images revoke blobs, removed videos pause and drop src. Logout/account replacement/401 clears Forum state and revokes video grant using the original credentials. Forum metadata requests also reject session-generation changes. Upload loops capture credentials, preventing an old request from continuing under a replacement account. Failures stay local to media.

Mobile image cache keys include session/account/post/reply/media ID/filename; cache filenames include session nonce. Late files/blobs are discarded; partial native downloads cleaned. The shared existing session lifecycle clears Forum images and revokes video grants. Hooks reject stale results and hide immediately on account/session changes. The thread screen cannot remount stale attachments under a replacement session. Local preparation, token lookup and API completion are guarded for creates/edits/replies/replacements. Existing avatar loaders are reused unchanged; Forum initials unchanged.

## Mutation safety

All Forum multipart operations validate type/size and use a transaction. Image limit 20 MiB; video limit 25 MiB; existing per-request attachment counts preserved. Images are validated with existing Sharp. Video validation inspects containers without decoding: MP4/MOV top-level box bounds and required nonempty moov/mdat; WebM EBML signature, DocType/Segment header. This detects truncated MP4 and malformed headers; it is not full codec verification or malware scanning. Malformed/incomplete multipart and rejected uploads are safely removed. Playback decoding errors remain local.

`PUT /api/forum/photos/:id` accepts one `photos` file and replaces only the referenced row; owners only. Parent/thread/text/sibling metadata do not change. Existing filename-based JPEG editor remains reference-safe copy-on-write, and new mobile Forum image edits use the targeted route. Post-only multipart edits preserve omitted title/body/category. Replacements/deletes commit before cleanup; reference checks cover all existing stored categories. Cleanup/response failure cannot delete a committed replacement. Post deletion keeps the intended reply cascade; reply deletion cannot remove parent photos. Inconsistent dual-parent cascades fail with 409 before any changes. Shared files remain on disk while any reference exists.

## Remaining risks and explicit limits

Global `/uploads` is unchanged and still anonymously serves known filenames, including old Forum URLs. Protected delivery is not global revocation. Already-downloaded bytes cannot be recalled. Compiled/released clients retain static delivery. Legacy-ambiguous/broken relationships are not repaired or reclassified. Conservative collision rejection can hide legitimate duplicates. Video grant revocation on offline logout is best-effort; the stopped player remains cleared locally and any unreached server grant expires within 15 minutes/JWT expiry. An already-open range response may finish; further requests are rechecked. Grants are process-local: restart requires reopening, and multi-instance routing would require sticky routing or a shared grant store before deployment. Cookie-based web playback expects the same-origin deployment used by the repository; a separately hosted cross-origin Expo web client requires explicit integration validation. Native iOS/Android cookie/codec playback still needs device testing before release; no native build is authorized in this phase.

## Verification

Disposable HTTP/database tests cover community access, identity/collision/path safety, video bytes/HEAD/ranges, stream grant/revocation races, owner/moderator rights, transactional rollback, failure-safe cleanup, shared references and account cascade. Executable DOM and mocked shared-native component/service tests exercise loading, cleanup, stale responses and video configuration. Existing Phase 2Q and earlier suites, calendar/iCal, complete QL/mobile verification, JS parsing and strict readiness gate must all pass. Old Phase 2F readiness assertions were corrected where they accidentally matched the removed Forum static markup; global static compatibility assertions remain.

Recommended Phase 2S: **audit and protect merchant/shop media only**, explicitly separating intentionally public catalog images/previews from purchase-authorized digital downloads; preserve ownership/moderation/reference cleanup, purchase entitlements and legacy-client compatibility. Keep global `/uploads` restriction deferred. Do not begin Phase 2S here.

Local final verification: new backend/web 55 (43 HTTP/mutation + 12 DOM); complete backend/QL 765 (601 TAP + 164 individual legacy checks); new mobile 27; complete mobile 255/255; shared JavaScript 135/135; strict readiness 37/37. Zero unexpected failures/skips/TODOs/cancellations. Exact-head GitHub Actions are checked after commit/push and reported in the final checkpoint.
