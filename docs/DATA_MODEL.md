# Data Model

This is the frozen definition of every core object in `docs/SYSTEM_SPEC.md`.
It maps 1:1 to `shared/types/index.ts` — that file is the executable
source of truth; this document is the annotated, human-readable version.
Changing either requires the change to be mirrored in the other, and
requires team approval per Phase 2 of the project plan.

---

## Identity

Represents a person, independent of any device or wallet. Roles and
employment status belong here, not to the wallet.

| Field | Type | Notes |
|---|---|---|
| identityId | string | Primary key. e.g. `DID:BEL:001` |
| employeeId | string \| null | HR/employee reference number; may be assigned during admin verification |
| fullName | string | |
| role | Role \| null | Assigned by an administrator; unavailable while pending |
| department | string \| null | May be assigned during verification |
| status | `PENDING` \| `ACTIVE` \| `SUSPENDED` \| `REVOKED` | Identity-level status |
| createdAt | string (ISO 8601) | |

## User

The application-facing account tied to an Identity. In v1 this is
effectively Identity + login/session concerns; kept separate so auth
mechanics (SSO, device binding, MFA) don't leak into the Identity model.

| Field | Type | Notes |
|---|---|---|
| employeeId | string | |
| identityId | string | FK -> Identity.identityId |
| walletAddress | string | FK -> Wallet.address |
| role | Role | Denormalized copy for fast permission checks |
| department | string | |
| status | `ACTIVE` \| `SUSPENDED` \| `REVOKED` | |

## Device

A BEL-managed endpoint authorized to hold a signing wallet for an Identity. Devices are independently revocable.

| Field | Type | Notes |
|---|---|---|
| deviceId | string | Managed-device identifier |
| identityId | string | FK -> Identity.identityId |
| status | `PENDING` \| `ACTIVE` \| `REVOKED` | Registration and trust lifecycle |
| registeredAt | string (ISO 8601) | |
| activatedAt | string (ISO 8601) \| null | Set after administrator activation |
| revokedAt | string (ISO 8601) \| null | |
| publicKey | string \| null | Device-generated public key; never a private key |
| metadata | object \| null | Non-secret evidence/attestation metadata |

## Wallet

The on-chain signing key, bound to a managed device. A Wallet can be
revoked and a new one issued without changing the underlying Identity.

| Field | Type | Notes |
|---|---|---|
| address | string | Primary key. On-chain address |
| identityId | string | FK -> Identity.identityId (owner) |
| deviceId | string | The managed workstation this key lives on |
| status | `PENDING` \| `ACTIVE` \| `REVOKED` | |
| activatedAt | string (ISO 8601) \| null | |
| revokedAt | string (ISO 8601) \| null | |
| revokedReason | string \| null | |
| publicKey | string \| null | Public key only; the backend never stores a private key |

Wallet address binding: in the implemented EVM scheme, `walletAddress` must
equal the address derived from the canonical secp256k1 `publicKey` (X || Y,
without the SEC1 prefix). Provisioning, wallet registration/activation, login,
session validation, and replacement activation enforce this invariant. Other
future wallet/signature schemes may use a different derivation and are not
silently treated as equivalent. This is cryptographically validated by the wallet/blockchain integration adapter before activation.

## ProvisioningChallenge

A short-lived, single-use challenge bound to a device and purpose. It is
used for wallet initialization or authentication proof. A challenge does
not contain private-key material.

| Field | Type | Notes |
|---|---|---|
| challengeId | string | Primary key |
| deviceId | string | Bound device reference |
| challenge | string | Unique nonce |
| purpose | `WALLET_INITIALIZATION` \| `AUTHENTICATION` \| `FRESH_AUTHENTICATION` | Protocol purpose |
| expiresAt | string (ISO 8601) | Short TTL |
| usedAt | string (ISO 8601) \| null | Replay protection |
| metadata | object \| null | Attestation result/evidence, not trust from raw client flags |

## AuthorizationGrant

A resource-scoped authorization used for `AUTH` RBAC cells. Ownership alone does not create a grant. The grant may be represented off-chain and referenced by ID in the signed transaction payload; the final contract implementation must verify the authorization proof before changing state.

| Field | Type | Notes |
|---|---|---|
| authorizationGrantId | string | Unique grant id |
| actorIdentityId | string | Identity receiving permission |
| resourceType | `ASSET` \| `JOB` | Target type |
| resourceId | string | Target resource id |
| action | Action | RBAC action being granted |
| grantedByIdentityId | string | Identity that issued the grant |
| issuedAt | string (ISO 8601) | |
| expiresAt | string (ISO 8601) \| null | Optional expiry |
| status | `ACTIVE` \| `REVOKED` \| `EXPIRED` | |

## Asset

A physical or logical item tracked on-chain via an NFT identity.

| Field | Type | Notes |
|---|---|---|
| assetId | string | Primary key (off-chain reference) |
| nftId | string | On-chain token id |
| assetType | string | e.g. `AIRCRAFT_PART`, `TOOL`, `VEHICLE` |
| ownerId | string | FK -> Identity.identityId |
| custodianId | string | FK -> Identity.identityId (current physical holder) |
| parentAssetId | string \| null | For component hierarchies |
| status | AssetStatus | See enum below |

## Component

A sub-part of an Asset. Modeled as an Asset with a non-null
`parentAssetId`, plus attach/detach history.

| Field | Type | Notes |
|---|---|---|
| componentId | string | Primary key, same space as assetId |
| parentAssetId | string | FK -> Asset.assetId (required) |
| attachedAt | string (ISO 8601) | |
| detachedAt | string (ISO 8601) \| null | |
| attachedBy | string | FK -> Identity.identityId |

## Job

A unit of work performed against an Asset (maintenance, inspection, etc.).

| Field | Type | Notes |
|---|---|---|
| jobId | string | Primary key |
| assetId | string | FK -> Asset.assetId |
| createdBy | string | FK -> Identity.identityId |
| assignedTo | string | FK -> Identity.identityId |
| verifierId | string \| null | FK -> Identity.identityId |
| status | JobStatus | See enum below |
| priority | `LOW` \| `MEDIUM` \| `HIGH` \| `CRITICAL` | |
| createdAt | string (ISO 8601) | |
| completedAt | string (ISO 8601) \| null | |

## AuditEvent

An immutable record of a state-changing action, referencing the
originating blockchain transaction.

| Field | Type | Notes |
|---|---|---|
| eventId | string | Primary key |
| txId | string | FK -> on-chain transaction |
| entityType | `ASSET` \| `JOB` \| `IDENTITY` \| `WALLET` | |
| entityId | string | Id of the affected object |
| action | string | Matches a CONTRACT_SPEC.md transaction type |
| actorIdentityId | string | FK -> Identity.identityId |
| timestamp | string (ISO 8601) | |

## Validator

A node authorized to participate in consensus.

| Field | Type | Notes |
|---|---|---|
| validatorId | string | Primary key |
| publicKey | string | |
| status | `ACTIVE` \| `INACTIVE` \| `SLASHED` | |
| joinedAt | string (ISO 8601) | |

## Block

A finalized unit of the ledger.

| Field | Type | Notes |
|---|---|---|
| height | number | Primary key |
| leaderId | string | FK -> Validator.validatorId |
| committee | string[] | Validator ids that voted |
| transactions | string[] | Ordered list of txIds |
| finalizedAt | string (ISO 8601) | |

---

## Enums

```text
AssetStatus:  ACTIVE | IN_MAINTENANCE | DECOMMISSIONED
JobStatus:    CREATED | ASSIGNED | IN_PROGRESS | COMPLETED | VERIFIED | REJECTED
Role:         ADMIN | MANAGER | ENGINEER | TECHNICIAN | AUDITOR | ISSUER | VERIFIER
```

## Relationships

```text
Identity  1---N  Device        (managed endpoints; revoked devices remain historical)
Identity  1---N  Wallet        (one current active wallet; historical wallets remain revoked)
Device    1---N  Wallet        (wallet rotations may occur on one managed device)
Identity  1---N  Asset         (as owner)
Identity  1---N  Asset         (as custodian)
Asset     1---N  Component     (via parentAssetId)
Asset     1---N  Job
Identity  1---N  Job           (as creator / assignee / verifier)
Job       1---N  AuditEvent
Asset     1---N  AuditEvent
Validator N---N  Block         (via committee)
```
