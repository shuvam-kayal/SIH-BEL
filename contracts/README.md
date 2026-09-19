# contracts/

Owner: Person 5. Solidity implementations of the frozen interfaces in
`docs/CONTRACT_SPEC.md`, Foundry toolchain, solc 0.8.19.

## Setup, test, deploy

```bash
npm run setup --workspace=bel-contracts    # forge-std v1.9.4 + OpenZeppelin v4.9.6 into lib/
npm run test:contracts                     # forge build && forge test
npm run abis --workspace=bel-contracts     # regenerate abis/ (commit the result)

# Local chain
anvil
BEL_BOOTSTRAP_ADMIN_WALLET=0x... BEL_BOOTSTRAP_ADMIN_DID=DID:BEL:ADMIN BEL_NETWORK=local \
  forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --private-key <key>
```

OpenZeppelin is pinned to 4.9.x because 5.x needs solc >= 0.8.20.
`deployments/local.json` matches a fresh `anvil` with its default dev
account #0 as deployer and bootstrap admin (addresses are deterministic).

## Contracts

| Contract | Implements | Notes |
| :--- | :--- | :--- |
| `IdentityRegistry` | `IIdentityRegistry` | DID ↔ wallets. Wallet: PENDING → ACTIVE → REVOKED (terminal, address never reusable). Constructor creates the ACTIVE bootstrap admin wallet. |
| `RoleRegistry` | `IRoleRegistry` | Roles stored per identity (keccak256 of DID), so every wallet of an identity shares them. The last ADMIN cannot be removed. |
| `AssetRegistry` | `IAssetRegistry` + ERC-721 | Token ids start at 1. Direct ERC-721 transfers/approvals revert; ownership moves only via `transferAsset`. States: ACTIVE ↔ IN_MAINTENANCE → DECOMMISSIONED (terminal). Cycle-checked component hierarchy; attached components must be detached before transfer. |
| `JobManager` | `IJobManager` | Same state machine as `backend/src/jobs/jobs.service.ts`. Assignment is by identity, so a replacement wallet can continue a job. Only the assigned technician starts/completes; the technician cannot verify their own job. |
| `AuditRegistry` | `IAuditRegistry` | Append-only. Writers: the four registries (fixed at construction) via `recordAuditFor`, and ACTIVE ADMIN wallets via `recordAudit`. Wallet entity ids are lowercase `0x` addresses. |
| `BelAccess` / `BelRoles` | — | Shared modifier: wired → ACTIVE wallet → role in mask. `BelRoles` mirrors `shared/rbac`; `test/AccessControl.t.sol` checks it against an independent copy of `docs/RBAC_MATRIX.md`. |

Deploy order and one-time wiring are in `script/Deploy.s.sol`; after
`wire()` the deployer keeps no privileges.

## Decisions that need team confirmation (no frozen file was changed)

1. **Actions with no matrix row.** Role assign/revoke = ADMIN. Asset state
   change and component attach/remove reuse the "Register asset" row.
2. **`auth` cell (Engineer transfer) fails closed.** The frozen interfaces
   have no grant-verification input; adding one needs a CONTRACT_SPEC change.
3. **Separate custodian is not expressible.** `transferAsset(nftId,
   newOwner)` sets owner and custodian together; the backend adapter
   rejects a differing `newCustodianId` rather than silently dropping it.
4. **`WALLET_REGISTER` / `IDENTITY_REGISTER` map to `createIdentity`**,
   which creates the identity if new and links a PENDING wallet either way
   (the spec's table only lists `IDENTITY_CREATE`). Suggest an ADR.
5. **Extra view functions** beyond the interfaces (`getWallet`, `walletsOf`,
   `rolesOf`, `nftIdOf`, `stateOf`, `getAsset`, `getJob`, `jobExists`,
   `getAuditRecord`, ...) exist for the backend adapter. No new
   state-changing functions were added to the frozen interfaces; the only
   extra writer is `AuditRegistry.recordAuditFor`, restricted to registries.
6. **Replay (THREAT_MODEL T8)** is covered by EVM account nonces plus the
   state machines (e.g. a second `approveJob` reverts `InvalidTransition`).
