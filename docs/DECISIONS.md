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
blockchain/simulator/.

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
verified through the same device/identity/wallet checks as future managed device credentials. This compatibility path is development-only and is disabled when `BEL_ENV=production`; production uses device proof. Client-supplied `x-bel-*` identity headers are ignored.

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

### ADR-019: Pending registration is verified before activation
**Decision:** Initialization creates a `PENDING` Identity/Device/Wallet registration. An administrator verifies the submitted employee data, assigns or confirms the employee/department information and role, and then activates the registration. There is no separate `VERIFIED` identity status.
**Why:** A submitted registration must not equal an authenticated employee, while the lifecycle enum remains small and unambiguous.
**Consequences:** Verification is represented by the registration's verification metadata (for example `verifiedAt` / `verifiedBy`) and the required verified fields. A registration remains `PENDING` until activation. Pending records cannot log in or access protected business operations.

### ADR-020: Wallet replacement preserves identity
**Decision:** Wallet replacement revokes the old wallet and registers a new pending wallet against the same identity.
**Why:** Keys and devices can change without changing the employee anchor.
**Consequences:** Historical transactions retain the old actor wallet while new transactions use the replacement wallet.

### ADR-021: PostgreSQL plus blockchain integrity anchor
**Decision:** PostgreSQL stores mutable operational state; SHA-256 commitments are sent through `IntegrityAdapter` for permissioned-blockchain anchoring.
**Why:** Operational queries need a durable database while lifecycle history needs tamper-evident evidence.
**Consequences:** Other workstreams consume repository/API contracts and do not couple directly to Prisma tables.


### ADR-022: QBFT with VRF-based dynamic committees
**Decision:** The permissioned chain uses Hyperledger Besu's QBFT consensus machinery with a VRF-based committee selected for every block and randomized per-round leadership. The initial validator population is assumed to satisfy N >= 70. Committee selection does not modify the authoritative validator set.
**Why:** The design reduces the number of validators participating in each block's BFT voting while retaining QBFT's established safety/finality machinery. A minimum committee of 70 is required by the current committee-size rule.
**Consequences:** Quorum is Q = floor(2K/3)+1 with f = floor((K-1)/3), leader failure is handled by QBFT round change, and finality occurs after the required commit quorum. Validator admission/removal remains a separate lifecycle mechanism.

### ADR-023: Public selection seed is derived from the previous finalized block
**Decision:** The current protocol derives the public committee/leader selection seed from the previous finalized block hash plus frozen protocol context, then uses the configured VRF for selection.
**Why:** Every honest validator can independently derive the same selection input without a coordinator.
**Consequences:** This seed is deterministic public entropy, not a claimed bias-resistant randomness beacon. Production deployment requires explicit grinding/bias analysis and may require a stronger randomness source. The current deterministic VRF provider is test-only and is not a production RFC 9381 ECVRF implementation.

### ADR-024: Consensus is implemented in Hyperledger Besu
**Decision:** Hyperledger Besu is the blockchain client for the consensus implementation, using its QBFT consensus architecture rather than application-level Solidity logic to implement consensus.
**Why:** The implementation requires access to validator, committee, voting, round-change, and finality machinery at the consensus layer. The Besu integration has demonstrated the required validator/committee plumbing and QBFT test/build feasibility.
**Consequences:** The 4-node WSL smoke environment is treated as infrastructure/P2P/RPC validation, not as proof of complete live dynamic-committee finality. Production VRF integration, validator lifecycle, large-scale evaluation, and comprehensive live failure testing remain open.

### ADR-025: Quorum formula
**Decision:** For committee size K, quorum is Q = floor(2K/3)+1 and Byzantine tolerance is f = floor((K-1)/3), giving Q >= 2f+1.
**Why:** This is the exact integer threshold used by the protocol and avoids incorrectly asserting Q = 2f+1 for every committee size.
**Consequences:** Quorum is never weakened because of offline or Byzantine validators.
