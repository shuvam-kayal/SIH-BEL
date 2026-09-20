# Architecture

High-level shape of the system. Detail on any one piece belongs in its own frozen document (RBAC_MATRIX.md, API_SPEC.yaml, CONTRACT_SPEC.md, CONSENSUS_SPEC.md, DATA_MODEL.md).

## Layers

```text
┌─────────────────────────────────────────────────────────┐
│ Frontend (React)                                        │
│  - Talks ONLY to the backend API.                       │
│  - Uses mocks/mock-api during development.              │
└───────────────────────┬─────────────────────────────────┘
                        │ REST (docs/API_SPEC.yaml)
┌───────────────────────▼─────────────────────────────────┐
│ Backend (Node)                                          │
│  - Owns business logic + RBAC enforcement.              │
│  - Talks to the chain through BlockchainService.        │
└───────────────────────┬─────────────────────────────────┘
                        │ BlockchainService
┌───────────────────────▼─────────────────────────────────┐
│ Smart Contracts (Solidity)                              │
│  - Identity, role, asset, job and audit interfaces.     │
└───────────────────────┬─────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────┐
│ Blockchain / Consensus                                  │
│  - Customized Hyperledger Besu/QBFT.                    │
│  - VRF-selected committee per block.                    │
│  - Randomized leader per QBFT round.                    │
│  - Byzantine quorum finality.                            │
└─────────────────────────────────────────────────────────┘
```

## Operational persistence and integrity

The backend is the application-layer owner of PostgreSQL. PostgreSQL stores mutable operational state for identities, devices, credentials, wallets, sessions and grants. It is not the immutable historical source.

Security-critical lifecycle mutations can produce deterministic SHA-256 commitments through `IntegrityAdapter` for permissioned-blockchain anchoring. The device private key remains local to the managed device.

## Blockchain integration seam

The backend `BlockchainService` remains the integration boundary. With the EVM implementation enabled, the adapter can delegate consensus reads to a Besu consensus source:

```text
Besu consensus
    ├── validator population
    └── BEL committee at height
             ↓
EvmBlockchainAdapter / BlockchainService
             ↓
Backend REST API
             ↓
Frontend
```

The implemented BEL committee RPC is `bel_getCommittee`. It exposes the committee selected by the consensus layer. Validator metadata is a separate concern: the canonical validator identifier is the Besu/QBFT validator address, and any validator public key must come from an authoritative consensus/node-key registry. An application wallet public key must never be substituted for the Besu consensus key.

## Consensus implementation boundary

The consensus implementation is not a Solidity application feature. It lives in the Besu/QBFT consensus layer.

The frozen protocol is:

- Permissioned validator population with normal `N >= 70`.
- Per-block VRF committee selection using `p_N = min(1, max(70/N, 0.0132))`.
- Deterministic 70-validator fallback when fewer than 70 valid tickets exist.
- Committee fixed across rounds.
- Previous finalized block hash plus frozen context as the public selection seed; no claim that this is an unbiased randomness beacon.
- Per-round randomized `BEL-LEADER` selection.
- QBFT quorum `floor(2K/3)+1`, with `f=floor((K-1)/3)` and `Q>=2f+1`.
- Existing QBFT round-change, prepare/commit validation and finality semantics remain authoritative.

The current evidence supports compilation/tests and the committee RPC. The 4-node WSL smoke test established P2P/RPC connectivity but not live finality. Production RFC 9381 VRF integration, validator lifecycle, randomness robustness and large-scale/live failure testing remain open gates.

## Cross-cutting concerns

- Off-chain document storage and retention.
- Observability across backend and blockchain.
- Hardware-backed managed-device key storage and production device attestation.
- Authoritative validator identity/public-key registry for consensus metadata.
