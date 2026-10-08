# Phase 2F — Global `/uploads` rollback plan

No restriction is enabled in Phase 2F. This is the required reversal plan for a future rollout.

## Universal rollback rule

A future restriction must be implemented as a routing/configuration change that can restore the prior static `/uploads` behavior without rewriting filenames or restoring a transformed media corpus. Keep database and file-reference migrations separately reversible.

Trigger rollback for cross-account exposure, supported-client breakage, public/community media loss, unexplained elevated media errors, missing files, or cache/account isolation failure.

## Website

1. Re-enable the previous anonymous static mount/compatibility path.
2. Keep new protected/public endpoints available; reverting the global restriction must not require removing safer routes.
3. Revert only the website loader/routing release that caused breakage if necessary.
4. Purge/revalidate browser/CDN caches for changed publication responses.
5. Confirm private protected routes still return generic foreign/missing behavior even while legacy compatibility is restored.

## iOS

1. Do not depend on emergency store approval for rollback.
2. Keep server compatibility for the oldest supported iOS build until adoption criteria are met.
3. If a new app loader fails, restore compatible server delivery while preparing a corrected build/OTA only if the existing release mechanism safely supports it.
4. Rotate/clear private media cache generation on account changes after rollback as well.

## Android

Same policy as iOS: server-side compatibility must be sufficient to restore supported Android builds. Do not make global restriction irreversible based on store rollout assumptions.

## Public/community media

Restore anonymous delivery immediately for explicitly public Piece Gallery, public Glaze Combo shares, Forum/community media, public catalog images, and explicitly public avatars if their replacement route fails. Public restoration must not expose categories classified private.

## Legacy records

Unresolved legacy records stay in the compatibility bucket. If a migration produced incorrect classification, stop writes, restore the pre-migration database snapshot or reverse only rows with recorded migration provenance, and restore compatibility delivery. Never “fix” rollback by guessing visibility from filename shape.

## Existing direct links

A rollback can restore legacy direct `/uploads/<filename>` links because filenames are not renamed during staged migration. Maintain a measured compatibility window before final retirement. External-link breakage discovered during canary is a rollback/hold signal unless the link is intentionally revoked for privacy/security.

## Data and file safety

- Take verified database + upload-volume backup before any future migration/restriction.
- Do not delete legacy files during route migration.
- Do not rewrite filenames as part of restriction.
- Preserve reference-count/shared-file cleanup safeguards.
- Record migration IDs/timestamps so data writes can be reversed independently from route rollback.

## Verification after rollback

Confirm:
- website private and public media render;
- supported iOS and Android builds render;
- public Gallery/Combo/Forum/shop media render anonymously where intended;
- private owner routes remain owner-scoped;
- legacy unresolved records return to compatibility behavior;
- direct legacy links behave exactly as the selected rollback state specifies;
- no cross-account private cache survives account replacement;
- database integrity and file-reference checks pass.
