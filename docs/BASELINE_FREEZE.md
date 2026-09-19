# Base-v1 Freeze Rules

## Consensus implementation status

The Besu consensus demonstration may proceed behind `VrfProvider` using
`DeterministicTestVrfProvider`. This provider is test-only, not RFC 9381
cryptography, and not production-grade. The unresolved RFC backend must remain
isolated until it passes the complete Appendix B.2 interoperability gate.

This repository is the shared starting point for the six independent workstreams.
All six people clone the same `main` commit/tag and implement only within their owned paths.

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
- Production authentication/device attestation.
- Production backend persistence.
- Real blockchain networking/node implementation.
- Exact consensus algorithm/client choice for Person 4's research spike.

The interfaces around those modules are frozen. Replace implementations behind those seams; do not redesign the seams branch-by-branch.

## Dependency installation

Direct JavaScript dependencies are pinned in the package manifests. This base intentionally uses `npm install` rather than `npm ci` because the prepared archive has no committed lockfile; after the first successful install on the development machine, commit the generated `package-lock.json` as the next repository hardening step.

## Clean-clone rule

The repository must contain source/config/specification only. Never commit `node_modules`, local build output, caches, secrets, or generated editor files.
