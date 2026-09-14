# RBAC Matrix

This is both the frontend permission-gating source and the reference
that Person 5's smart-contract access-control modifiers must implement.
Every action must resolve to one of: ✅ allowed, ❌ denied, `auth` (allowed
only if explicitly authorized for that specific asset/job), or `own`
(allowed only on records the actor created or is assigned to).

| Action | Admin | Manager | Engineer | Technician | Auditor | Issuer | Verifier |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Create employee | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Revoke wallet | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Activate wallet | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Register asset | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| Create job | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Assign technician | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Perform maintenance | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Verify maintenance | ❌ | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ |
| Transfer asset | ✅ | ✅ | auth | ❌ | ❌ | ❌ | ❌ |
| View audit history | ✅ | ✅ | ✅ | own | ✅ | ❌ | ✅ |
| View validator/committee status | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

## Conditional authorization semantics

`AUTH` is a resource-scoped authorization grant. The grant has a unique `authorizationGrantId`, actor, target resource, action, granter identity, and optional expiry. The backend validates it and the on-chain access layer re-checks it. Ownership alone never implies AUTH.

`OWN` means `actorId` exactly matches `resourceOwnerId`.

## Notes on Issuer / Verifier

`ISSUER` and `VERIFIER` are listed as actors in `SYSTEM_SPEC.md` but were
not populated in the original matrix draft. Interim assignment above:
`ISSUER` covers wallet activation and asset registration (the on/off
ramp for identities and assets entering the system); `VERIFIER` overlaps
with the maintenance-verification step alongside Manager/Engineer/Auditor.
**This mapping is frozen for base-v1. Any change requires an ADR and synchronized changes to shared/rbac plus contract tests.**
