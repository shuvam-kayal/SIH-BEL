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
verified through the same device/identity/wallet checks as future managed
device credentials. Client-supplied `x-bel-*` identity headers are ignored.

### ADR-013: LICENSE is unresolved
The root LICENSE asserts internal-use-only while the Solidity files
carry MIT SPDX headers. This contradiction is deliberately left visible
rather than silently resolved. Decide before first release.
