# Smart Contract Interfaces

## Contracts

Deploy in this order (later contracts depend on earlier ones' addresses
for access-control checks):

```text
IdentityRegistry.sol   -> contracts/src/IIdentityRegistry.sol
RoleRegistry.sol       -> contracts/src/IRoleRegistry.sol
AssetRegistry.sol      -> contracts/src/IAssetRegistry.sol
JobManager.sol         -> contracts/src/IJobManager.sol
AuditRegistry.sol      -> contracts/src/IAuditRegistry.sol
```

These may be combined later (e.g. folding RoleRegistry into
IdentityRegistry) if that turns out cleaner, but interfaces are frozen
as separate concerns for now so Person 2/3/5 aren't blocked on a single
file. Don't invent new function names on these interfaces without
updating this file first.

## Transaction Envelope

Every blockchain transaction — regardless of which contract emits it —
should carry this shape so `AuditRegistry` and off-chain indexers can
treat them uniformly:

```ts
type Transaction = {
  txId: string;
  type: TransactionType; // one of the Transaction Types below
  actorIdentity: string; // Identity.identityId of the caller
  actorWallet: string;   // msg.sender / signing wallet address
  payload: Record<string, unknown>;
  timestamp: string;     // ISO 8601, block timestamp at inclusion
  signature: string;
};
```

## Transaction Types
- IDENTITY_CREATE
- IDENTITY_REGISTER (pending registration lifecycle event; equivalent identity-create concept for onboarding)
- ROLE_ASSIGN
- ROLE_REVOKE
- WALLET_REGISTER
- WALLET_REVOKE
- WALLET_ACTIVATE
- ASSET_MINT
- ASSET_TRANSFER
- ASSET_STATE_CHANGE
- JOB_CREATE
- JOB_ASSIGN
- JOB_START
- JOB_COMPLETE
- JOB_APPROVE
- JOB_REJECT
- COMPONENT_ATTACH
- COMPONENT_REMOVE

## Function-to-transaction mapping

Every state-changing transaction type below has a canonical contract function/event. Role changes are included so on-chain RBAC changes are auditable. Audit records are derived from emitted events and are not separate user-submitted transactions.

`IDENTITY_REGISTER` is the application/onboarding lifecycle event for creating a pending registration. It is distinct from the backend's internal integrity action name (for example `ACCOUNT_INITIALIZATION`). `ACCOUNT_INITIALIZATION` is not a new blockchain `TransactionType`; the blockchain-facing adapter must map the public onboarding event to the frozen contract transaction vocabulary when blockchain anchoring is introduced.

| Transaction type | Interface | Function | Event |
| :--- | :--- | :--- | :--- |
| IDENTITY_CREATE | IIdentityRegistry | `createIdentity` | `IdentityCreated` |
| IDENTITY_REGISTER | IIdentityRegistry | `createIdentity` / onboarding event | `IdentityCreated` |
| ROLE_ASSIGN | IRoleRegistry | `assignRole` | `RoleAssigned` |
| ROLE_REVOKE | IRoleRegistry | `revokeRole` | `RoleRevoked` |
| WALLET_ACTIVATE | IIdentityRegistry | `activateWallet` | `WalletActivated` |
| WALLET_REVOKE | IIdentityRegistry | `revokeWallet` | `WalletRevoked` |
| ASSET_MINT | IAssetRegistry | `mintAsset` | `AssetMinted` |
| ASSET_TRANSFER | IAssetRegistry | `transferAsset` | `AssetTransferred` |
| GRANT_CREATE / GRANT_REVOKE | IAssetRegistry | `setTransferGrant` | `TransferGrantSet` |
| ASSET_STATE_CHANGE | IAssetRegistry | `changeAssetState` | `AssetStateChanged` |
| COMPONENT_ATTACH | IAssetRegistry | `attachComponent` | `ComponentAttached` |
| COMPONENT_REMOVE | IAssetRegistry | `removeComponent` | `ComponentRemoved` |
| JOB_CREATE | IJobManager | `createJob` | `JobCreated` |
| JOB_ASSIGN | IJobManager | `assignJob` | `JobAssigned` |
| JOB_START | IJobManager | `startJob` | `JobStarted` |
| JOB_COMPLETE | IJobManager | `completeJob` | `JobCompleted` |
| JOB_APPROVE | IJobManager | `approveJob` | `JobApproved` |
| JOB_REJECT | IJobManager | `rejectJob` | `JobRejected` |

## Asset transfer semantics

`ASSET_TRANSFER` transfers ownership and custody together by default. The request always supplies `newOwnerId` and may supply a different `newCustodianId`. The NFT owner is authoritative for ownership; custody is associated asset state.

For the RBAC matrix's ENGINEER `AUTH` cell, an ADMIN registers or revokes a
resource-scoped transfer grant through `GRANT_CREATE` / `GRANT_REVOKE` before
the corresponding PostgreSQL AuthorizationGrant state is committed. The
AssetRegistry checks the active actor wallet, asset NFT, and optional expiry
again during `ASSET_TRANSFER`; ownership alone never creates this grant.

## Job rejection semantics

`REJECTED` is non-terminal. A rejected job returns to `ASSIGNED` only through the normal `assignJob` function. There is no separate `reopenJob` in v1.

## Device and wallet semantics

A Device is a managed BEL endpoint. Wallets are device-bound signing identities. Revoking a wallet/device does not revoke the underlying Identity or erase history. A replacement wallet is a new wallet linked to the same persistent identity.

## Identity and wallet lifecycle contract

The application lifecycle for an Identity registration is:

```text
PENDING --(admin verification + role/data completion)--> ACTIVE
```

There is no separate `VERIFIED` identity status in the shared enum. Verification is represented by verification metadata and completed required identity fields while the registration remains `PENDING` until activation.

Device and Wallet lifecycles are independently represented as:

```text
PENDING → ACTIVE → REVOKED
```

Identity registration, device registration, wallet registration, administrator verification, role assignment, wallet activation, wallet revocation, and device revocation are independently auditable lifecycle events.

The backend may emit SHA-256 integrity commitments for these lifecycle events through its `IntegrityAdapter`. These integrity action names are backend/adaptor implementation details and are not automatically new blockchain `TransactionType` values. A production blockchain adapter is responsible for mapping the public lifecycle event to the frozen blockchain transaction envelope and transaction types.

`actorIdentity` is the persistent identity responsible for an operation. `actorWallet` is the replaceable public wallet that actually signs it. Every historical transaction preserves both values; replacing a wallet never changes the identity. A pending or revoked wallet cannot authenticate or authorize protected operations.

The blockchain-facing payload may contain public identity data, public wallet/address data, signatures, and hashes/proofs. It must never contain a private key, seed phrase, mnemonic, backup, or other private wallet secret.

Public-key/address binding is an integration invariant: `walletAddress` must correspond to the submitted `publicKey` under the eventual wallet/signature scheme. The binding must be cryptographically validated by the wallet/blockchain integration adapter before activation; this contract intentionally does not invent a blockchain-specific derivation algorithm.

For replacement, the old wallet transitions to REVOKED and the new device-generated public wallet transitions from PENDING to ACTIVE after administrator verification. The identity remains unchanged.

## Base-v1 interface corrections (frozen)

The following interface corrections are part of the base-v1 contract and are already reflected in the Solidity interfaces and shared types. Any later change requires an ADR plus synchronized mock/test updates.

1. `IJobManager.startJob(jobId)` — added. `JOB_START` was a frozen
   transaction type with no corresponding function.
2. `IAssetRegistry.attachComponent` / `removeComponent` — added, same
   reason (`COMPONENT_ATTACH` / `COMPONENT_REMOVE`).
3. `revokeWallet(wallet, reason)` — gained a `reason` parameter. A
   revocation with no recorded cause is not auditable.
4. `completeJob(jobId, evidenceHash)` — gained an evidence hash, so the
   off-chain maintenance record is anchored on-chain without putting
   sensitive content there (SYSTEM_SPEC.md).
5. `rejectJob(jobId, reason)` — gained a reason, same argument as (3).
6. View functions added for access-control use by other contracts:
   `isActiveWallet`, `identityOf`, `parentOf`, `componentsOf`,
   `ownerOfAsset`, `custodianOf`. A revoked wallet cannot be blocked
   from transacting unless other contracts can ask whether it is active.
7. Events added to `IIdentityRegistry`, `IAssetRegistry` and
   `IJobManager`, one per transaction type, so `IAuditRegistry` and any
   off-chain indexer have something to consume.
8. `ROLE_ASSIGN` / `ROLE_REVOKE` are explicit transaction types.
9. Asset transfer semantics are ownership + custody together by default.
10. Job rejection is non-terminal; re-assignment uses `assignJob`.
