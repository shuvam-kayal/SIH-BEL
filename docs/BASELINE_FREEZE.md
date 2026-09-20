# Base-v1 Freeze Rules

This repository is the shared starting point for the six workstreams. Feature and integration branches may carry work beyond the original base-v1 skeleton, but shared contracts and frozen protocol decisions must remain explicit and reviewable.

## Frozen and shared

The following are contract-level source of truth and must not be changed casually:

- `shared/index.ts`
- `shared/types/`
- `shared/enums/`
- `shared/rbac/`
- `shared/schemas/`
- `shared/api.ts`
- `docs/SYSTEM_SPEC.md`
- `docs/DATA_MODEL.md`
- `docs/RBAC_MATRIX.md`
- `docs/API_SPEC.yaml`
- `docs/CONTRACT_SPEC.md`
- `docs/CONSENSUS_SPEC.md` for the frozen consensus baseline

A change to a shared contract requires an ADR in `docs/DECISIONS.md` and synchronized changes to affected mocks/tests.

## Interface seams

`shared/api.ts` contains the main application seams:

- `ApiClient`: frontend <-> backend contract.
- `BlockchainService`: backend <-> blockchain contract.

The mock implementations remain usable for parallel development. The EVM implementation is the integration path for the real Besu deployment.

## Workstream ownership

| Person | Owned paths | Integration responsibility |
|---|---|---|
| 1 Identity/RBAC | `backend/src/auth`, `backend/src/users`, `backend/src/middleware`, `shared/rbac` | Identity and authorization lifecycle |
| 2 Assets/NFT | `backend/src/assets`, `contracts/src/IAssetRegistry.sol` | Asset lifecycle |
| 3 Jobs/Maintenance | `backend/src/jobs`, `contracts/src/IJobManager.sol` | Maintenance/job lifecycle |
| 4 Consensus | `blockchain/**`, `docs/CONSENSUS_SPEC.md` | Besu/QBFT consensus and committee source |
| 5 Blockchain/contracts integration | `contracts/**`, backend blockchain seam | EVM adapter and API integration |
| 6 Frontend | `frontend/**`, `mocks/mock-api` | Operator UI |

## Resolved consensus baseline

The following are no longer open research placeholders:

- Besu/QBFT is the implementation boundary.
- Committee selection is VRF-based and recomputed every block.
- Normal deployment requires `N >= 70`.
- `p_N = min(1, max(70/N, 0.0132))`.
- If fewer than 70 valid tickets are available, choose the 70 smallest valid tickets by canonical `(vrfOutput, validatorId)` order.
- The committee is fixed across rounds for a block.
- Selection uses the previous finalized block hash plus frozen context. This is public and deterministic but not claimed to be a bias-resistant beacon.
- `BEL-LEADER` randomizes the leader per QBFT round.
- QBFT quorum is `floor(2K/3)+1`; offline validators do not count.
- Leader failure uses QBFT round change without committee reselection.
- Byzantine prepare/commit evidence is validated by the existing QBFT safety path.
- Finality remains QBFT finality; no threshold weakening is permitted.

## Evidence and remaining gates

Implemented/evidenced:

- Besu/QBFT compilation and tests.
- BEL committee RPC `bel_getCommittee`.
- Byzantine evidence validation test.
- 4-node WSL process/RPC/P2P smoke connectivity.

Not yet sufficient for a production claim:

- RFC 9381-compatible production VRF backend.
- Authoritative validator admission/removal.
- Bias-resistant randomness beacon evaluation.
- Large-scale security/performance evaluation.
- Live multi-node finality and failure/recovery tests under dynamic committees.

## Clean-clone rule

Never commit `node_modules`, local build output, caches, secrets, runtime directories or generated editor files.
