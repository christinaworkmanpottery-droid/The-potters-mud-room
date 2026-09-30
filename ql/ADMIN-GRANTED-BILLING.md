# Explicit Admin-granted access

Parent: `2b30becbfb4986a975b93897ef0956d576812bf6`.
Branch: `ql/pre-release-admin-granted-billing`. Phase 3 closed; production untouched.

One persistent Users field records provenance:
`admin_granted_access INTEGER NOT NULL DEFAULT 0 CHECK(admin_granted_access IN (0,1))`.
Fresh creation and existing safe additive initialization have the same logical constraint.
There is no inferred backfill. Historical billing marker and exact three-account rules remain
separate. Test Tile, promo/beta, IAP, expiration and referral rules are unchanged.

Both Admin writers validate the actual Users tier enum (free/basic/mid/top/starter), require
an existing target, set grant 1 for Starter, and clear it for an explicit Free downgrade.
The member route requires tier. Remote retains its omitted-tier Starter default and password
authentication. Neither toggles CHECK enforcement. A failed single UPDATE is atomic.

The member route accepts explicit monthly/yearly/promo; null, empty, legacy marker and malformed
billing values are rejected. Omission preserves canonical billing, including SQL NULL. Only a
specific updated legacy marker becomes monthly. Explicit valid member billing overrides that
normalization. Remote validates a supplied billingPeriod but retains its interval-preservation
contract. It cannot edit billing intervals or provider fields.

Member Stripe ID omission preserves existing evidence; explicit null clears that one ID.
Nonempty strings update it; other types and empty strings are rejected. Remote never includes
provider columns in its UPDATE. IAP, plan expiry, beta, referral and all unrelated fields remain.

Starter plus grant is premium even with canonical interval storage; Free plus grant alone is
not premium. Independent promo/IAP rules still apply. Admin-granted Starters serialize the
legacy stripe-monthly display marker for existing paid-equivalent web/mobile interpretation,
including when stored interval is yearly or promo. This does not represent a Stripe provider.
Actual Stripe subscription ID and active IAP evidence continue to control provider booleans.
Ungranteds and the special-account serializer retain their existing interpretations.

Tests cover both routes, malformed inputs, auth, missing targets, interval/provider preservation,
real server-connection CHECK failure probes, SQLite integrity, 11th Piece, downgrade/re-upgrade,
two restarts, additive initialization, paid/gifted counts and API consumers. The frozen unmodified
mobile compatibility fixture is src/utils/androidParity.js from potters-mudroom-app commit
`21cb350d6af8d1eadfc1ec0164d9bdd863b0a1dd`; only a backend test copy was added.

Verification: Node 22, npm ci; final billing tests 81/81 (64 new + 17 existing), strict gate 37/37.
Full backend/QL expected 1,453. Recovery expects 115/115; local non-root permission child is
unavailable (EINVAL), so hosted exact-head Actions must pass that check before closure.
The workflow runs complete backend/QL, strict gate and recovery, including Calendar/iCal at
fresh and three restored checkpoints. Final Actions outcome is reported separately.
