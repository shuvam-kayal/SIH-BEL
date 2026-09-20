# Architecture Decision Records (ADRs)

One entry per major decision. Existing historical ADRs remain as recorded; new consensus decisions are appended here.

---

### ADR-001: Permissioned blockchain
**Decision:** The chain uses an authorized validator set, not open/public participation.
**Why:** BEL participants are known and managed identities.

### ADR-002: Single managed BEL workstation
**Decision:** Users access the system only from BEL-managed workstations.
**Why:** Device/network trust is a foundational security assumption.

### ADR-003: Wallet belongs to device, identity persists
**Decision:** Roles and history attach to `Identity`, not to `Wallet`.
**Why:** Devices and keys can change without changing the employee anchor.

### ADR-004: NFT represents asset identity
**Decision:** Every tracked Asset has a corresponding on-chain NFT.
**Why:** This gives the asset a unique, tamper-evident on-chain identity.

### ADR-005: Sensitive data remains off-chain
**Decision:** The blockchain stores hashes/references, not sensitive document content.
**Why:** Chain data is persistent and broadly readable by participants.

### ADR-006: Randomized verification committee
**Decision:** Blocks are validated by a randomly selected committee, not by every validator every round.
**Why:** A committee bounds communication while retaining probabilistic Byzantine security.
**Resolved details:** Committee selection is VRF-based, recomputed every block, with `p_N = min(1, max(70/N, 0.0132))) and a deterministic 70-validator minimum fallback.

### ADR-007: Adapter pattern for parallel development
**Decision:** Backend and frontend depend on interfaces such as `BlockchainService`, with mock implementations for parallel development.
**Why:** Workstreams can proceed without coupling to unfinished implementations.

### ADR-008: RBAC enforced independently in backend and contracts
**Decision:** Permission checks live in backend middleware and smart contracts.
**Why:** Defense in depth prevents a backend compromise from bypassing on-chain authorization.

---

## Repository and toolchain decisions

### ADR-009: npm workspaces for the monorepo
Shared TypeScript packages use npm workspaces so the repository has one dependency tree and shared type resolution.

### ADR-010: The RBAC matrix is code, not just a document
The human-readable RBAC matrix and shared enforcement table are kept aligned across backend, frontend and contracts.

### ADR-011: Unimplemented services return HTTP 501
Unfinished service methods map to `501 NOT_IMPLEMENTED` so integration tests can distinguish missing work from server faults.

### ADR-012: Foundry for the Solidity toolchain
Foundry is used for Solidity build/test/deployment work.

### ADR-013: Development authentication uses bearer sessions
Bearer sessions provide the development compatibility path; production device proof remains the target.

### ADR-014: LICENSE is unresolved
The repository's current license declarations remain an explicit unresolved decision.

### ADR-015: Employee self-initialization
Employees submit basic details and device-generated public wallet information; administrators verify and authorize the pending registration.

### ADR-016: Identity persists independently of wallet
Identity is the persistent employee anchor; devices and wallets are replaceable credentials.

### ADR-017: Private key remains on the managed device
The device wallet component generates and retains the private key; backend services receive public material and proof only.

### ADR-018: Challenge-response authentication
Production login uses a short-lived backend challenge signed by the managed-device wallet component.

### ADR-019: Device attestation abstraction
Eligibility is decided through `DeviceAttestationAdapter`; client-supplied device/network flags are not trust anchors.

### ADR-020: Pending registration is verified before activation
Initialization creates a `PENDING` registration; administrative verification precedes activation. There is no separate `VERIFIED` identity status.

### ADR-021: Wallet replacement preserves identity
Wallet replacement revokes the old wallet and registers a new pending wallet against the same identity.

### ADR-022: PostgreSQL plus blockchain integrity anchor
**Decision:** PostgreSQL stores mutable operational state while SHA-256 commitments can be anchored through `IntegrityAdapter`.
**Why:** Operational queries need a database while lifecycle history needs tamper-evident evidence.

### ADR-023: QBFT with VRF-based dynamic committees
**Decision:** The permissioned chain uses customized Hyperledger Besu/QBFT with a fresh VRF-selected committee for every block.
**Why:** QBFT supplies Byzantine finality while committee selection bounds participation and message overhead.
**Constraint:** Committee selection must not weaken QBFT's existing safety or finality rules.

### ADR-024: Public selection seed from previous finalized block
**Decision:** Committee selection derives its public deterministic seed from the previous finalized block hash plus frozen context.
**Why:** All validators can reconstruct the same selection without an external coordinator.
**Limitation:** The previous block hash is public and is not claimed to be an unbiased or bias-resistant randomness beacon.

### ADR-025: Besu is the consensus implementation boundary
**Decision:** Consensus behavior is implemented in the Besu/QBFT consensus layer, not in Solidity or backend application code.
**Why:** Leader selection, committee membership, validation, voting and finality are protocol-layer concerns.

### ADR-026: QBFT quorum and round-change semantics
**Decision:** For committee size `K`, quorum is `Q = floor(2K/3)+1`, with `f=floor((K-1)/3)` and `Q>=2f+1`. Leader failure triggers QBFT round change without committee reselection.
**Why:** This preserves the existing Byzantine safety boundary while allowing progress after leader failure.
**Constraint:** Offline validators do not count; quorum is never reduced to preserve liveness.

### ADR-027: Test-only deterministic VRF provider
**Decision:** The deterministic VRF provider is allowed only for tests and local deterministic validation.
**Why:** A deterministic test provider makes consensus tests reproducible without representing production cryptographic security. Production requires an RFC 9381-compatible VRF backend.

### ADR-028: Validator identity and consensus key separation
**Decision:** Besu validator identity/public-key metadata is a consensus-layer concern and must not be populated from application wallet keys.
**Why:** Device/application wallets and node/consensus keys are separate trust domains. Backend validator metadata must use an authoritative consensus/node-key registry.
