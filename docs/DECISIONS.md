# Architecture Decision Records (ADRs)

One entry per major decision, so the team never hits "I thought we
were using X." New ADRs append to the bottom; existing ones are not
edited after the fact — if a decision changes, add a new ADR that
supersedes it and say so.

---

### ADR-001: Permissioned blockchain
**Decision:** The chain uses an authorized validator set, not open/public
participation.
**Why:** No public signup exists in this system (SYSTEM_SPEC.md);
participants are known, managed identities, so permissionless consensus
buys nothing and adds cost/complexity.

### ADR-002: Single managed BEL workstation
**Decision:** Users access the system only from BEL-managed workstations.
**Why:** Device/network trust is a foundational security assumption —
it lets later decisions (e.g. ADR-003) hold without needing a mobile /
BYOD key-management story from day one.

### ADR-003: Wallet belongs to device, identity persists
**Decision:** Roles and history attach to `Identity`, not to `Wallet`.
A `Wallet` can be revoked and replaced without losing role or history.
**Why:** Devices get lost, keys get rotated, but a person's employment
and role shouldn't need to be re-established every time. See
DATA_MODEL.md for the Identity/Wallet split.

### ADR-004: NFT represents asset identity
**Decision:** Every tracked physical/logical Asset has a corresponding
on-chain NFT (`nftId` in DATA_MODEL.md).
**Why:** Gives each asset a unique, transferable, tamper-evident
identity without needing a separate custom token standard.

### ADR-005: Sensitive data remains off-chain
**Decision:** The blockchain stores only hashes/references, never
classified or sensitive document content.
**Why:** Chain data is effectively permanent and broadly readable by
participants; off-chain storage keeps access control possible and
avoids putting sensitive content somewhere it can never be deleted.
**Open follow-up:** where off-chain documents actually live and who
controls access to them is not yet decided — see THREAT_MODEL.md (T7).

### ADR-006: Randomized verification committee
**Decision:** Blocks are validated by a randomly-selected committee
(a subset of the full validator set), not by every validator every
round.
**Why:** Full-validator-set voting doesn't scale with N; a random
committee gives probabilistic security while keeping message/vote
overhead bounded. Exact committee size and selection mechanism are
still being benchmarked — see CONSENSUS_SPEC.md and
docs/CONSENSUS_SPEC.md and the Besu BEL module.

### ADR-007: Adapter pattern for parallel development
**Decision:** Backend and frontend depend on interfaces
(`BlockchainService`, the mock API surface) rather than concrete
implementations, backed by swappable packages in `mocks/`.
**Why:** This is what actually lets all six people work in parallel —
Person 6 doesn't wait on Person 1/2/3's backend, and Persons 1–3 don't
wait on Person 4's real chain. The interface is frozen in
CONTRACT_SPEC.md / API_SPEC.yaml; only the implementation behind it
changes at integration time (Phase 12).

### ADR-008: RBAC enforced independently in both backend and contracts
**Decision:** Permission checks live in backend middleware AND in
smart-contract access-control modifiers — not only one or the other.
**Why:** The backend is a convenience/UX layer; the contracts are the
actual trust boundary. A backend bug or compromise must not be able to
force an unauthorized on-chain state change. See THREAT_MODEL.md (T3, T4).

---

## Repository and toolchain decisions

These were made while making the skeleton buildable. They are tooling
choices, not architecture — change them if they get in the way, but
change them deliberately.

### ADR-008: npm workspaces for the monorepo
The six workstreams share `shared/` as TypeScript source. Workspaces let
one `npm install` at the root set up every package and let `@bel/*`
imports resolve without publishing anything. Alternative considered:
separate installs per package (rejected — duplicate dependency trees and
no shared type resolution).

### ADR-009: The RBAC matrix is code, not just a document
`docs/RBAC_MATRIX.md` is the human-readable source of truth, but the
backend middleware and the frontend navigation both import the same
table from `shared/rbac/index.ts`. Two enforcement points reading one
table cannot silently drift. The smart contracts remain a third,
independent enforcement point by design — defence in depth — and
`contracts/test/AccessControl.t.sol` exists to prove they agree.

### ADR-010: Unimplemented services return HTTP 501
Service methods whose owner hasn't written them throw
`NotImplementedError`, which the error handler maps to 501
NOT_IMPLEMENTED. An unfinished module is then visible in the API
response instead of looking like a server fault. Integration testers can
tell "not built yet" from "broken".

### ADR-011: Foundry for the Solidity toolchain
`forge build` and `forge test` work on a clean clone with no dependency
install, because the current sources are interfaces plus a
dependency-free test skeleton. `forge-std` is installed on demand via
`scripts/setup-contracts.sh` when tests need cheatcodes.

### ADR-012: Development authentication uses bearer sessions
Protected requests are authenticated only with a server-issued bearer
session created by `/auth/login`. Development credentials are hashed and
verified through the same device/identity/wallet checks as future managed
device credentials. This compatibility path is development-only and is
disabled when `BEL_ENV=production`; production uses device proof. Client-
supplied `x-bel-*` identity headers are ignored.

### ADR-013: LICENSE is unresolved
The root LICENSE asserts internal-use-only while the Solidity files
carry MIT SPDX headers. This contradiction is deliberately left visible
rather than silently resolved. Decide before first release.

### ADR-014: Employee self-initialization
**Decision:** Employees submit basic details and device-generated public wallet information; administrators verify and authorize the pending registration.
**Why:** Employees should not depend on an administrator to re-enter basic details, while BEL retains authorization control.
**Consequences:** Initialization creates PENDING identity/device/wallet records and cannot self-assign a role or become active.

### ADR-015: Identity persists independently of wallet
**Decision:** Identity is the persistent employee anchor; devices and wallets are replaceable credentials.
**Why:** Device loss, rotation, or compromise must not erase employment or role history.
**Consequences:** Historical wallet/device records remain auditable and replacement preserves identity.

### ADR-016: Private key remains on the managed device
**Decision:** The device wallet component generates and retains the private key; the backend handles only public material and proof.
**Why:** The backend and blockchain are not employee key vaults.
**Consequences:** Hardware-backed secure storage is future device-side work and is not claimed by the prototype.

### ADR-017: Challenge-response authentication
**Decision:** Production login uses a short-lived backend challenge signed automatically by the managed-device wallet component.
**Why:** Public-key proof avoids transmitting private credentials and binds login to the registered device/wallet.
**Consequences:** The user only clicks Sign In; the device handles challenge, signature, and proof fields. Bearer sessions remain the application session mechanism.

### ADR-018: Device attestation abstraction
**Decision:** Eligibility is decided through `DeviceAttestationAdapter`, not client-supplied managed/network flags.
**Why:** MAC, IP, hostname, and VPN fields are spoofable evidence rather than trust anchors.
**Consequences:** The prototype uses mock/rejecting adapters; trusted BEL device-management/VPN integration remains future work.

### ADR-019: PENDING → VERIFIED → ACTIVE lifecycle
**Decision:** Initialization remains pending until an administrator verifies identity data, assigns role, and activates identity/device/wallet.
**Why:** A submitted registration must not equal an authenticated employee.
**Consequences:** Pending records cannot log in or access protected business operations.

### ADR-020: Wallet replacement preserves identity
**Decision:** Wallet replacement revokes the old wallet and registers a new pending wallet against the same identity.
**Why:** Keys and devices can change without changing the employee anchor.
**Consequences:** Historical transactions retain the old actor wallet while new transactions use the replacement wallet.

### ADR-021: PostgreSQL plus blockchain integrity anchor
**Decision:** PostgreSQL stores mutable operational state; SHA-256 commitments are sent through `IntegrityAdapter` for permissioned-blockchain anchoring.
**Why:** Operational queries need a durable database while lifecycle history needs tamper-evident evidence.
**Consequences:** Other workstreams consume repository/API contracts and do not couple directly to Prisma tables.

### ADR-022: Final BEL consensus protocol and Besu implementation
**Status:** Accepted — supersedes ADR-006's open committee parameters and the
earlier leader-VRF draft in `CONSENSUS_SPEC.md`.

**Decision:** The production consensus target is a customized Hyperledger Besu
24.8.0 implementation. For an active validator population (N), committee
sortition uses RFC 9381 ECVRF-P256-SHA256-SSWU with

`p_N = min(1, max(70/N, 0.0132))`.

If fewer than 70 valid tickets are selected, the first 70 tickets in canonical
`(vrfOutput, validatorId)` order are used. The committee remains fixed for a
block height. The round leader is derived by hashing the seed, height, round,
and canonical committee encoding with `BEL-LEADER`, then indexing the ordered
committee; no leader VRF ticket set is used.

PREPARE/COMMIT quorum remains `floor(2K/3)+1`; safety takes precedence over
liveness; round changes preserve the highest valid prepared value. VRF keys
are separate validator consensus credentials and are never application wallet
keys or stored in blocks.

**Consequences:** The Java/Besu implementation is the actual consensus implementation.
The previous-block-hash seed is deterministic and verifiable but is not a
bias-resistant randomness beacon. The ECVRF backend must be an RFC-compatible
implementation; an unaudited or custom cryptographic implementation cannot be
claimed production-ready.

### ADR-023: Hackathon VRF backend gate and test provider
**Status:** Accepted for the remaining hackathon implementation.

**Decision:** No unvalidated VRF implementation may determine a live
committee. The bounded `vrf-rfc9381` investigation found that 0.0.5 fails to
build with the resolved `hash2curve` API, while 0.0.6 and 0.0.7 fail RFC
Appendix B.2 public-key derivation and proof-generation interoperability.
Besu consensus work therefore proceeds behind `VrfProvider` with
`DeterministicTestVrfProvider` only for deterministic protocol demonstrations.

**Consequences:** The test provider is explicitly test-only, not RFC 9381
cryptography, and not production-grade. The RFC backend
remains isolated and cannot be enabled until all required official-vector and
negative tests pass.
