# BEL Decentralized Platform

Monorepo for the permissioned-blockchain asset and maintenance platform.

## Read this first

Before writing code, read the frozen system and integration documents:

| Document | What it fixes |
| :--- | :--- |
| `docs/SYSTEM_SPEC.md` | Actors, core objects, workflows, security assumptions |
| `docs/DATA_MODEL.md` | Every shared entity's fields |
| `docs/RBAC_MATRIX.md` | Who may do what |
| `docs/API_SPEC.yaml` | The REST surface |
| `docs/CONTRACT_SPEC.md` | Transaction types and contract interfaces |
| `docs/CONSENSUS_SPEC.md` | Frozen BEL VRF-committee + QBFT consensus protocol |
| `docs/DECISIONS.md` | Why the consensus and platform decisions are the way they are |
| `docs/THREAT_MODEL.md` | Security assumptions and development shortcuts that must not ship |

## Quickstart

Requires Node 20+ and Docker Desktop for the full application verification flow. Python 3.11+ is additionally required for the consensus simulator.

```bash
npm ci
npm run verify
npm run dev
```

| Command | What it does |
| :--- | :--- |
| `npm run dev` | Backend and frontend together |
| `npm test` | All TypeScript tests |
| `npm run typecheck` | All workspaces |
| `npm run test:consensus` | Person 4's simulator tests |
| `npm run test:contracts` | Solidity build/tests |
| `npm run verify` | Complete application integration checks |
| `docker compose up` | Everything behind nginx on :8080 |

The frontend can run against `mocks/mock-api`, and backend development can use `mocks/mock-blockchain`. The real blockchain integration is implemented behind the `BlockchainService` seam.

## Layout

```text
docs/        Frozen specifications and architecture decisions.
shared/      Types, enums, validators and RBAC contracts.
contracts/   Solidity interfaces, tests and deployment scripts.
blockchain/  Besu/QBFT consensus integration and research simulator.
backend/     REST API implementing docs/API_SPEC.yaml.
frontend/    Role-based operator console.
mocks/       Mock API and mock blockchain adapters.
infra/       Dockerfiles and nginx configuration.
scripts/     Bootstrap, contract setup and benchmark helpers.
```

## Consensus integration baseline

Person 4's consensus work is implemented against a customized Hyperledger Besu/QBFT source tree. The frozen design is:

- Permissioned validator population with normal deployment requirement `N >= 70`.
- A fresh VRF-selected committee is derived for every block.
- Selection probability is `p_N = min(1, max(70/N, 0.0132))`.
- If fewer than 70 valid VRF tickets are available, the 70 smallest valid tickets are selected in canonical `(vrfOutput, validatorId)` order.
- The committee remains fixed across QBFT rounds for that block.
- The selection seed uses the previous finalized block hash plus frozen context. This is deterministic and public, but is not claimed to be an unbiased or bias-resistant randomness beacon.
- Leadership is randomized per QBFT round with the frozen `BEL-LEADER` rule.
- QBFT finality uses `Q = floor(2K/3) + 1`; with `f = floor((K-1)/3)`, the required relation is `Q >= 2f+1`.
- Leader failure causes round change without changing the committee. Offline validators do not count toward quorum.
- Existing QBFT validation rejects invalid/conflicting prepare/commit evidence; safety is not weakened to preserve liveness.

The Besu integration currently includes the BEL committee RPC `bel_getCommittee`, consensus tests, and Byzantine evidence validation. The 4-node WSL smoke deployment established node startup, RPC and P2P connectivity, but did not establish live dynamic committee finality; that remains a validation gate.

The deterministic VRF provider used in tests is test-only and must not be represented as the production RFC 9381 VRF implementation.

## Ownership

| Person | Area | Primary directories |
| :--- | :--- | :--- |
| 1 | Identity, auth, RBAC | `backend/src/{auth,users,middleware}`, `shared/rbac` |
| 2 | Assets, NFT lifecycle | `backend/src/assets`, `contracts/src/IAssetRegistry.sol` |
| 3 | Jobs, maintenance | `backend/src/jobs`, `contracts/src/IJobManager.sol` |
| 4 | Consensus | `blockchain/`, `docs/CONSENSUS_SPEC.md` |
| 5 | Smart contracts / blockchain integration | `contracts/`, backend blockchain seam |
| 6 | Frontend | `frontend/`, `mocks/mock-api` |

## How the plug-and-play swap works

Backend services depend on the `BlockchainService` interface, never on a concrete chain. The EVM adapter can delegate validator and committee reads to the Besu consensus source. The frontend consumes the backend API and does not talk to Besu directly.

Consensus-specific application reads currently include `bel_getCommittee`; validator metadata must come from an authoritative Besu consensus source and must not be fabricated from application-wallet data.

## Contributing

Work on the agreed feature/integration branch for the task. Do not push directly to `main`. If a change touches `shared/` or a frozen document, record the decision in `docs/DECISIONS.md`.

## Base-v1 workflow

```bash
npm ci
npm run typecheck
npm test --workspace=bel-backend
npm run test --workspace=bel-frontend
npm run test:consensus
npm run test:contracts
npm run verify
```

See `docs/BASELINE_FREEZE.md` before changing shared contracts.
