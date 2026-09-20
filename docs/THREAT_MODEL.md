# Threat Model (v1 integration baseline)

This document expands `SYSTEM_SPEC.md` security assumptions into concrete threats and mitigations for the current prototype. It is a security baseline, not a claim of production security certification. Items explicitly marked open or future work remain integration gates.

## Assets to protect

- Wallet private keys (never leave the managed device)
- Identity/role assignments (who can act as whom)
- Asset custody/ownership records
- Job/maintenance history (integrity of "who verified what")
- Off-chain sensitive documents referenced by on-chain hashes
- Consensus liveness/safety (no forked or stalled chain)
- Authentication sessions and the lifecycle state that makes them valid

## Threats and mitigations

| # | Threat | Current mitigation / remaining gap | Owner |
|---|---|---|---|
| T1 | Private key exfiltrated from a managed workstation | The backend accepts/stores public key material and signatures only; the private key remains on the device. Hardware-backed storage is future device-side work. | Person 1 + Person 6 + infra |
| T2 | Wallet stolen/compromised but Identity not revoked | Wallet lifecycle is decoupled from Identity. A wallet can be revoked/replaced while the persistent Identity remains. Authentication also validates current wallet/device/identity state. | Person 1 |
| T3 | Backend compromised, attempts unauthorized on-chain action | Smart contracts independently enforce RBAC; backend compromise alone must not force an unauthorized contract state transition. | Person 5 |
| T4 | Role escalation via a bug in RBAC middleware | Backend authorization uses the shared RBAC matrix, while contracts enforce their own authorization. Tests cover the backend Role × Action matrix; contract tests must remain aligned with the documented matrix. | Person 1 + Person 5 |
| T5 | Malicious or offline leader disrupts block production | Consensus failure handling remains an open research/integration item owned by Person 4. | Person 4 |
| T6 | Predictable committee selection lets an attacker pre-position validators | Committee randomness and anti-grinding properties remain an open consensus-design item. | Person 4 |
| T7 | Sensitive document content leaked via on-chain data | Only hashes/references belong on-chain; off-chain storage access control remains an open architecture/integration item. | Unowned — needs assignment |
| T8 | Replay of a valid transaction (e.g. re-submitting a JOB_APPROVE) | Backend job state transitions reject replay before submission; the EVM adapter and JobManager also enforce transaction/account nonces and on-chain state transitions. | Person 3 + Person 5 |
| T9 | Audit log tampering (rewriting history of who did what) | On-chain integrity/audit evidence is intended to be append-only. Backend operational rows must not be treated as the authoritative immutable audit history. | Person 2/3 + Person 5 |
| T10 | Device/network trust assumption violated (e.g. unmanaged device gains access) | `DeviceAttestationAdapter` is the server-side trust boundary. Client-supplied managed/network flags are evidence only; rejecting and mock adapters cannot provide production trust. The remaining integration requirement is the authoritative BEL device-management/MDM and, if required, network/VPN provider. | Person 1 + infra |
| T11 | Stolen/reused bearer session remains usable after credential lifecycle changes | Protected requests resolve the bearer token against server-side session state and re-check current Identity, Device, and Wallet status. Revocation/suspension therefore invalidates the session path without relying on client headers. | Person 1 |
| T12 | Provisioning proof is replayed or forged | Provisioning uses a short-lived challenge plus device public key/signature verification; challenge consumption prevents reuse. Expiry, wrong-device, invalid-signature, and replay cases must remain covered by tests. | Person 1 |
| T13 | Wallet address does not correspond to submitted public key | For EVM, the backend cryptographically derives/validates the wallet address from the canonical secp256k1 public key and rejects malformed or mismatched pairs before activation and relevant authentication flows. Other future wallet/signature schemes require their own binding rules. | Person 1 + Person 5 integration |

## Explicitly out of scope for v1

- Protection against a fully malicious managed device beyond the trust assumptions stated in `SYSTEM_SPEC.md`.
- Formal verification of smart contracts before the internal prototype/pilot.
- DDoS protection on the API layer (infra concern, not application-level authorization).
- An authoritative BEL device-management/MDM and network/VPN attestation provider, if required by the final deployment model.

## Open questions / integration gates

- Who owns off-chain document storage and its access control (T7)?
- What nonce/replay-protection scheme will be enforced by the on-chain transaction layer (T8)?
- The EVM deployment implements the canonical `walletAddress` ↔ `publicKey` binding and rejects malformed or mismatched values. Other wallet/signature schemes remain integration gates.
- Does the selected blockchain client provide any T5/T6 mitigations out of the box, or does Person 4's feasibility work need to define them?
- Which authoritative BEL device-management/MDM and network/VPN provider will be injected behind the production attestation seam before deployment?

## Development-only shortcuts that must not reach a deployed environment

Tracked here so they are found deliberately rather than by accident.

| Shortcut | Where | Risk if shipped | Removal / hardening condition |
| :--- | :--- | :--- | :--- |
| Development credential login / compatibility path | `backend/src/auth/auth.service.ts` and related configuration | A non-device authentication path could weaken the production trust model if enabled outside local development | Keep the compatibility path disabled in production; production login uses device challenge-response proof |
| Development CORS configuration allows broad origins | `backend/src/app.ts` | Cross-origin calls from an unintended site | Restrict allowed origins before shared deployment |
| Mock chain accepts every transaction and returns SUCCESS | `mocks/mock-blockchain/index.ts` | Writes appear to succeed while nothing is recorded on a real chain | Replace the adapter before blockchain-backed deployment/integration |
| External BEL device-trust provider is not configured | Production deployment configuration | Onboarding remains unavailable rather than trusting client metadata | Inject the authoritative provider and set `BEL_DEVICE_ATTESTATION_PROVIDER=managed`; keep the rejecting adapter as the fail-closed default |
| Transfer authorization remains fail-closed until per-asset grants are wired | `backend/src/routes/assets.routes.ts` | Authorized transfer can be rejected even though this is not an authorization bypass | Person 2 implements resource-level grant lookup and tests `AUTH` semantics |

## Authentication/lifecycle invariants for testing

The following must hold before the Identity/Auth/RBAC baseline is considered validated:

1. A private key is never accepted as an initialization or login field.
2. A provisioning challenge is bound to the intended device and cannot be reused after consumption or expiry.
3. Invalid provisioning/authentication signatures are rejected.
4. `PENDING` identities cannot authenticate or call protected business APIs.
5. Only an authorized active administrator can verify/activate a pending registration or assign its role.
6. A protected request requires a valid server-issued bearer session.
7. The session is invalid if the Identity, Device, or Wallet is no longer in the required active state.
8. The actor's role and action must pass the shared RBAC matrix; `AUTH` and `OWN` actions additionally require their resource-level authorization semantics.
9. Job maintenance operations are resource-scoped: only the assigned technician may start or complete a job, and only an independent permitted verifier may approve or reject it. These checks run before blockchain submission and are enforced again by `JobManager`.
10. Wallet replacement preserves the persistent Identity while revoking the old wallet and preserving historical ownership/actor references.
11. Activation cannot bypass the EVM `walletAddress` ↔ `publicKey` cryptographic binding requirement.
