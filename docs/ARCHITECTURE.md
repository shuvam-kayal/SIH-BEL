# Architecture

## Consensus backend status

The Besu consensus layer depends only on the `VrfProvider` interface.
`DeterministicTestVrfProvider` is an isolated test-only provider for the
hackathon demonstration; it is not RFC 9381 cryptography and not
production-grade. The RFC 9381 provider remains unresolved and must pass the
official Appendix B.2 vectors before it can determine committee membership.

High-level shape of the system. Detail on any one piece belongs in its
own frozen doc (RBAC_MATRIX.md, API_SPEC.yaml, CONTRACT_SPEC.md,
CONSENSUS_SPEC.md, DATA_MODEL.md) — this file is the map connecting them.

## Layers

```text
┌─────────────────────────────────────────────────────────┐
│ Frontend (React)                                         │
│  - Talks ONLY to the backend API, never to smart          │
│    contracts or the chain directly.                       │
│  - Built against mocks/mock-api during development        │
│    (see docs/API_SPEC.yaml for the frozen surface).        │
└───────────────────────┬─────────────────────────────────┘
                         │ REST (docs/API_SPEC.yaml)
┌───────────────────────▼─────────────────────────────────┐
│ Backend (Node)                                            │
│  - auth/, users/, assets/, jobs/, audit/, blockchain/      │
│  - Owns business logic + RBAC enforcement                  │
│    (docs/RBAC_MATRIX.md).                                  │
│  - Talks to the chain ONLY through the BlockchainService    │
│    interface (backend/src/adapters) — mock during dev,      │
│    real node after Phase 12 integration.                   │
└───────────────────────┬─────────────────────────────────┘
                         │ BlockchainService interface
┌───────────────────────▼─────────────────────────────────┐
│ Smart Contracts (Solidity)                                 │
│  - IdentityRegistry, RoleRegistry, AssetRegistry,           │
│    JobManager, AuditRegistry (docs/CONTRACT_SPEC.md).       │
│  - Second, independent enforcement of RBAC_MATRIX.md —      │
│    the backend and the contracts must never disagree on     │
│    who can do what.                                         │
└───────────────────────┬─────────────────────────────────┘
                         │
┌───────────────────────▼─────────────────────────────────┐
│ Blockchain / Consensus (Permissioned)                      │
│  - Customized Besu QBFT integration: authorized validator   │
│    set, committee/leader selection, PREPARE/COMMIT, and      │
│    quorum finality (docs/CONSENSUS_SPEC.md).                 │
└─────────────────────────────────────────────────────────┘
```

## Operational persistence and integrity

The backend is the only application-layer component that accesses BEL's
internal PostgreSQL instance. PostgreSQL is the mutable operational state
store for identities, devices, credentials, wallets, sessions, and grants;
it is never exposed directly to the frontend and is not treated as immutable.

Prisma schema and migration SQL are repository artifacts and must be committed;
`*.sql` must not be ignored. Other workstreams depend on shared types, API
contracts, and service interfaces rather than reading Person 1's Prisma tables
directly.

The backend services depend on repository interfaces. The normal container
selects Prisma repositories when `DATABASE_URL` is configured, while unit
tests explicitly inject in-memory repositories. Security-critical mutations
also pass a minimum canonical state through `IntegrityAdapter`, which emits
a deterministic SHA-256 commitment for an external permissioned-blockchain
anchor. The adapter is intentionally injectable while the blockchain team
provides the durable chain implementation.

## Current Person 1 data and trust paths

```text
Frontend
    ↓ REST
Person 1 Auth/API
    ↓
Identity / Device / Wallet services
    ↓
Repository interfaces
    ↓
Prisma
    ↓
PostgreSQL
```

The managed-device wallet path is separate:

```text
Managed-device wallet component
    ↓ private key remains local
Public key + address + signature/proof
    ↓
Person 1 backend
```

Critical lifecycle mutations follow:

```text
Critical lifecycle mutation
    ↓
SHA-256 integrity commitment
    ↓
IntegrityAdapter
    ↓
Permissioned blockchain integration
```

PostgreSQL is mutable operational state. The blockchain is the tamper-evident historical/integrity layer. The device private key never leaves the managed device. The current `ManagedDeviceAttestationProvider`/`DeviceAttestationAdapter` seam has mock and rejecting implementations; it is not proof that production hardware attestation or secure-enclave storage exists. The EVM deployment enforces the canonical wallet/public-key binding during provisioning, activation, login, and session validation. Fresh authentication is a separate, configurable proof layer for high-impact operations.

## Why this shape

- **Frontend never touches contracts directly.** The frontend invokes the
  backend API and the managed-device wallet interface; the device wallet
  component handles private-key operations locally. The frontend's chain
  integration surface remains the REST contract, not a chain client version.
- **Backend depends on an interface, not an implementation.** The
  `BlockchainService` interface (`backend/src/adapters`) is the seam
  that lets Persons 1–3 build and test against a mock chain
  (`mocks/mock-blockchain`) while Person 4 is still building the real
  one. Swapping the implementation at integration time should not
  require changing any service code, only the wiring/bootstrap file.
- **RBAC is enforced twice, deliberately.** Once in the backend
  (fast rejection, good UX) and once in the smart contracts (the actual
  trust boundary — a compromised or buggy backend must not be able to
  bypass on-chain authorization). Both read from the same frozen
  `docs/RBAC_MATRIX.md` so they can't silently diverge.
- **Sensitive data stays off-chain.** Evidence bytes are stored in the
  private Kubo IPFS service. PostgreSQL stores the job relationship, CID,
  uploader, filename, content type, size, and SHA-256. Every download goes
  through the authenticated backend, which applies the existing
  `VIEW_AUDIT_HISTORY` RBAC semantics and verifies the retrieved bytes before
  serving them. The blockchain receives only the SHA-256 as `evidenceHash`.
- **CID is not authorization.** A CID identifies content; it does not grant
  access. IPFS is not RBAC, and clients never receive unrestricted access to
  the private IPFS API.

## Cross-cutting concerns not yet owned

These don't map cleanly to one person and should get an explicit owner
early rather than falling through the cracks:

- **Evidence retention and orphan reconciliation.** IPFS objects are not
  deleted when metadata is removed. An upload whose database write fails can
  leave a pinned object requiring operator reconciliation.
- **Observability** (logging, tracing across backend + chain + frontend
  for debugging a failed transaction end-to-end).
- **Key management on the managed workstation** (how a Wallet's private
  key is generated/stored/rotated on-device — touches Person 1's auth
  work and Person 4/5's chain work). The backend protocol is defined, but
  hardware-backed secure storage remains future device-side work.


## Consensus implementation boundary

The current consensus baseline is the customized Hyperledger Besu/QBFT
implementation in `besu/`. The authorized validator population is normally
(N \ge 70). For each block height, committee selection is performed once and
the resulting committee remains fixed across all consensus rounds at that
height.

The resolved protocol decisions are:

- Committee selection uses RFC 9381 ECVRF-P256-SHA256-SSWU as the production
  target with (p_N=\min(1,\max(70/N,0.0132))).
- If fewer than 70 valid VRF tickets are selected, the 70 smallest valid
  tickets in canonical ((vrfOutput, validatorId)) order form the committee.
- The previous finalized block hash is part of the public selection seed; it is
  deterministic and verifiable, but is not claimed to be a bias-resistant
  randomness beacon.
- The leader is selected deterministically from the ordered committee for each
  round by the frozen `BEL-LEADER` hash-index rule; there is no separate leader
  VRF ticket set.
- PREPARE/COMMIT use QBFT-style quorum (Q=\lfloor2K/3\rfloor+1), with
  finality after a valid commit certificate.
- A failed/offline leader causes round change and randomized replacement; the
  committee does not change during round changes.
- Invalid/conflicting Byzantine messages are rejected by consensus validation;
  safety is preserved during network faults and liveness depends on eventual
  synchrony and sufficient participating honest committee members.

The consensus layer is the source of truth for validator and committee
membership. Application wallet keys are not consensus validator keys.

The implementation currently demonstrates Besu/QBFT integration, committee
plumbing, `bel_getCommittee`, compilation/tests, and Byzantine evidence
validation. The 4-node WSL smoke network is an infrastructure/P2P/RPC test and
does not by itself prove live dynamic-committee finality.

Open production items are the RFC-compatible VRF backend, validator
admission/removal, randomness robustness, large-scale performance/security
evaluation, and comprehensive live failure/finality testing.

