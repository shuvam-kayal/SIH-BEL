# Base-v1 Freeze Rules

## Consensus implementation status

The Besu consensus implementation is the customized QBFT integration in `besu/`.
The resolved protocol baseline is N >= 70 active validators, per-block VRF
committee selection with p_N = min(1, max(70/N, 0.0132)), a deterministic
minimum-70 ticket fallback, per-round deterministic randomized leadership,
PREPARE/COMMIT quorum Q = floor(2K/3)+1, and round changes that keep the same
committee. The previous finalized block hash is part of the selection seed,
but is not treated as a bias-resistant randomness beacon.

`DeterministicTestVrfProvider` is test-only, not RFC 9381 cryptography, and not
production-grade. The production RFC 9381 backend remains isolated until it
passes the complete Appendix B.2 interoperability gate.

This repository is the shared starting point for the six independent workstreams.
All six people work from the agreed project baseline and implement only within their owned paths. Person 4's active consensus implementation branch is `feat/poa`.

## Frozen and shared

The following are contract-level source of truth and must not be changed casually:

- `shared/index.ts`
- `shared/types/` (including `AuthorizationGrant` semantics)
- `shared/enums/`
- `shared/rbac/`
- `shared/schemas/`
- `shared/api.ts`
- `docs/SYSTEM_SPEC.md`
- `docs/DATA_MODEL.md`
- `docs/RBAC_MATRIX.md`
- `docs/API_SPEC.yaml`
- `docs/CONTRACT_SPEC.md`

A change to one of these requires an ADR in `docs/DECISIONS.md` and synchronized changes to the affected mocks/tests.

## Interface seams

`shared/api.ts` contains two frozen interfaces:

- `ApiClient`: frontend <-> backend contract.
- `BlockchainService`: backend <-> blockchain contract.

`mocks/mock-api` and `mocks/mock-blockchain` implement those interfaces. Feature branches must keep the mocks usable so work can continue without another teammate's branch.

## Workstream ownership

| Person | Owned paths | Must not depend on |
|---|---|---|
| 1 Identity/RBAC | `backend/src/auth`, `backend/src/users`, `backend/src/middleware`, `shared/rbac` | Persons 2-6 implementations |
| 2 Assets/NFT | `backend/src/assets`, `contracts/src/IAssetRegistry.sol` implementation/tests | Person 1 implementation |
| 3 Jobs/Maintenance | `backend/src/jobs`, `contracts/src/IJobManager.sol` implementation/tests | Persons 1-2 implementations |
| 4 Consensus | `blockchain/**`, `docs/CONSENSUS_SPEC.md` after feasibility decisions | Persons 1-3/5/6 implementations |
| 5 Smart Contracts | `contracts/src`, `contracts/test`, `contracts/script` | Backend/frontend implementations |
| 6 Frontend | `frontend/**` | Backend/contract implementations |

## Allowed temporary placeholders

The following are deliberately unfinished in base-v1 and do not block cloning:

- Concrete Solidity implementations.
- Authentication protocol and the server-side device-attestation boundary are implemented behind frozen interfaces. The production device-attestation provider is an explicit integration seam; an authoritative BEL device-management/VPN provider remains an external deployment requirement until its interface is available.
- Production backend persistence.
- Live production blockchain networking/deployment validation.
- Production RFC 9381 VRF backend validation.
- Validator admission/removal and large-scale security/performance evaluation.

The interfaces around those modules are frozen. Replace implementations behind those seams; do not redesign the seams branch-by-branch.

## Authentication and lifecycle baseline

The current application contract uses a challenge-response onboarding/authentication model:

1. A device requests a provisioning challenge.
2. The device submits a device-generated public key, wallet address, challenge ID, and signature.
3. The backend creates the Identity, Device, and Wallet in `PENDING` state.
4. An administrator verifies the registration data, assigns/confirm roles and employee data as required, and activates the registration.
5. Authentication uses a backend-issued bearer session after a device signs an authentication challenge.
6. Protected requests validate the server-side session and the current Identity/Device/Wallet lifecycle state.

The authentication contract has two trust boundaries: the managed device authenticator performs local user verification and authorizes use of the device-held private key; the BEL backend verifies the resulting signature against the registered public key and issues the bearer session. The local modality is device-dependent and is not a BEL application PIN. The backend never receives local PIN/biometric data or private-key material. Configured high-impact operations add a short-lived, single-use, session/operation/resource-bound fresh-auth proof.

`PENDING` is a lifecycle status, not a separate `VERIFIED` status. Administrative verification is represented by the verification fields and is a prerequisite to activation. The shared status enums remain the source of truth.

For the implemented EVM scheme, the backend derives the wallet address from the canonical secp256k1 public key and rejects malformed or mismatched pairs before activation and relevant authentication flows. Other wallet/signature schemes require their own binding rules.

## Dependency installation

Direct JavaScript dependencies are pinned in the package manifests, and the repository now contains a committed `package-lock.json`. For a clean clone, use `npm ci` so the installed dependency tree is exactly the committed lockfile. Use `npm install` only when intentionally changing dependencies or regenerating the lockfile.

## Clean-clone rule

The repository must contain source/config/specification only. Never commit `node_modules`, local build output, caches, secrets, or generated editor files.
Validator governance is ADMIN-only and separate from QBFT consensus committee
selection. Lifecycle history is immutable and recovery is represented by an
inverse on-chain RESTORE event.
