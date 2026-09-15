# Architecture

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
│  - Authorized validator set, leader + committee selection,  │
│    BFT quorum finality (docs/CONSENSUS_SPEC.md — still       │
│    draft, owned by Person 4).                                │
└─────────────────────────────────────────────────────────┘
```

## Operational persistence and integrity

The backend is the only application-layer component that accesses BEL's
internal PostgreSQL instance. PostgreSQL is the mutable operational state
store for identities, devices, credentials, wallets, sessions, and grants;
it is never exposed directly to the frontend and is not treated as immutable.

The backend services depend on repository interfaces. The normal container
selects Prisma repositories when `DATABASE_URL` is configured, while unit
tests explicitly inject in-memory repositories. Security-critical mutations
also pass a minimum canonical state through `IntegrityAdapter`, which emits
a deterministic SHA-256 commitment for an external permissioned-blockchain
anchor. The adapter is intentionally injectable while the blockchain team
provides the durable chain implementation.

## Why this shape

- **Frontend never touches contracts directly.** This keeps wallet/key
  handling and transaction construction in one place (the backend), and
  means the frontend's only integration risk is a REST contract, not a
  chain client version.
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
- **Sensitive data stays off-chain.** Per `SYSTEM_SPEC.md`'s security
  assumptions, the chain only stores hashes/references. Where the
  underlying documents/files live is out of scope for this file —
  raise it in `docs/DECISIONS.md` as an ADR once decided.

## Cross-cutting concerns not yet owned

These don't map cleanly to one person and should get an explicit owner
early rather than falling through the cracks:

- **Off-chain document storage** (where hashed documents actually live,
  who can read them, retention).
- **Observability** (logging, tracing across backend + chain + frontend
  for debugging a failed transaction end-to-end).
- **Key management on the managed workstation** (how a Wallet's private
  key is generated/stored/rotated on-device — touches Person 1's auth
  work and Person 4/5's chain work).
