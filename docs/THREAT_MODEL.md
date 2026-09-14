# Threat Model (DRAFT)

This expands `SYSTEM_SPEC.md`'s Security Assumptions into concrete
threats and mitigations. Like `CONSENSUS_SPEC.md`, this is a starting
draft, not a finished security review — treat it as the checklist to
argue with, not a completed audit.

## Assets to protect

- Wallet private keys (never leave the managed device)
- Identity/role assignments (who can act as whom)
- Asset custody/ownership records
- Job/maintenance history (integrity of "who verified what")
- Off-chain sensitive documents referenced by on-chain hashes
- Consensus liveness/safety (no forked or stalled chain)

## Threats and mitigations

| # | Threat | Mitigation (planned) | Owner |
|---|---|---|---|
| T1 | Private key exfiltrated from a managed workstation | Key never leaves device (SYSTEM_SPEC.md); device-level protections (TBD: HSM/secure enclave vs. plain keystore) | Person 1 + infra |
| T2 | Wallet stolen/compromised but Identity not revoked | Wallet revocation is decoupled from Identity — revoke wallet, keep identity, issue new wallet | Person 1 |
| T3 | Backend compromised, attempts unauthorized on-chain action | Smart contracts independently enforce RBAC_MATRIX.md — backend compromise alone can't force an unauthorized state change through | Person 5 |
| T4 | Role escalation via a bug in the RBAC middleware | Backend and contract RBAC checks must be tested against the same matrix (see contracts/test/AccessControl.t.sol); no single-layer trust | Person 1 + Person 5 |
| T5 | Malicious or offline leader disrupts block production | See CONSENSUS_SPEC.md failure-handling table (currently open research — leader-offline fallback is owned by Person 4) | Person 4 |
| T6 | Predictable committee selection lets an attacker pre-position validators | CONSENSUS_SPEC.md's "Randomness" section must guarantee the seed is not grindable ahead of time — currently unspecified | Person 4 |
| T7 | Sensitive document content leaked via on-chain data | Only hashes/references go on-chain, never content (SYSTEM_SPEC.md) — off-chain storage access control is a gap, see ARCHITECTURE.md | Unowned — needs assignment |
| T8 | Replay of a valid transaction (e.g. re-submitting a JOB_APPROVE) | Transaction envelope should include a nonce/txId uniqueness check (see CONTRACT_SPEC.md's Transaction Envelope) — not yet enforced in interfaces | Person 5 |
| T9 | Audit log tampering (rewriting history of who did what) | AuditRegistry emits are append-only on-chain events, not mutable backend rows — backend audit views should read from-chain, not a database the backend itself can edit | Person 2/3 + Person 5 |
| T10 | Device/network trust assumption violated (e.g. unmanaged device gains access) | Out of scope for application code — network/device policy enforcement is an infra/IT control, not something the app can fully guarantee | Infra |

## Explicitly out of scope for v1

- Protection against a fully malicious managed-device (SYSTEM_SPEC.md
  assumes device/network trust as a given, not something the app
  defends against).
- Formal verification of smart contracts (recommended before mainnet-
  equivalent deployment, not before internal pilot).
- DDoS protection on the API layer (infra concern, not app-level).

## Open questions to resolve before Phase 12 integration

- Who owns off-chain document storage and its access control (T7)?
- What's the nonce/replay-protection scheme for on-chain transactions (T8)?
- Does the chosen blockchain client provide any of T5/T6's mitigations
  out of the box, or does Person 4's feasibility spike need to confirm
  this is buildable at all (see CONSENSUS_SPEC.md Phase 8)?

## Development-only shortcuts that must not reach a deployed environment

Tracked here so they are found deliberately rather than by accident.

| Shortcut | Where | Risk if shipped | Removal condition |
| :--- | :--- | :--- | :--- |
| Header-based dev sessions — any caller can claim any role | `backend/src/middleware/session.ts` | Complete authentication bypass | Person 1 replaces `resolveUser()` with managed-device verification; set `BEL_DEV_SESSIONS=false` in every non-local environment |
| `cors()` allows all origins | `backend/src/app.ts` | Cross-origin calls from any site | Restrict to the workstation origin before any shared deployment |
| Mock chain accepts every transaction and returns SUCCESS | `mocks/mock-blockchain/index.ts` | Writes appear to succeed while nothing is recorded | Swap the adapter in `backend/src/container.ts` at Phase 12 |
| No wallet-status check in the permission path | `requireActiveIdentity` in `backend/src/auth/rbac.middleware.ts` | A revoked wallet could still transact — this is an explicit SYSTEM_SPEC.md requirement | Person 1 wires wallet status once `IIdentityRegistry.isActiveWallet` exists |
| Transfer authorization hardcoded to `false` | `backend/src/routes/assets.routes.ts` | Fails closed, so safe — but an authorized Engineer cannot transfer at all | Person 2 implements the per-asset grant lookup |
