# Cross-Team Identity, Wallet, and Authentication Contract

This contract describes the current Person 1 prototype boundary. It does not claim that production hardware attestation or hardware-backed key storage is implemented.

## Person 4 — consensus

- A transaction has both `actorIdentity` (persistent employee identity) and `actorWallet` (replaceable public signing wallet).
- A wallet may be revoked and replaced without changing identity.
- Historical transactions preserve the wallet that actually signed/performed them.
- Consensus and validators see public transaction/signature information only; private keys, seeds, mnemonics, and private wallet secrets never enter consensus state.

## Person 5 — smart contracts

- Identity is persistent and independent of wallet.
- Wallet lifecycle is `PENDING → ACTIVE → REVOKED`; device lifecycle is `PENDING → ACTIVE → REVOKED`.
- Registration, activation, revocation, role assignment, and replacement must preserve historical records.
- Contract transaction envelopes distinguish `actorIdentity` from `actorWallet`.
- No private key or seed material may appear in contract payloads.
- The current backend may provide public state and SHA-256 integrity commitments through adapters; smart-contract implementation remains Person 5's responsibility.

## Person 6 — frontend and device wallet integration

- The user-facing flow is: device eligibility → Initialize Account → employee details → local key generation → public proof submission → Pending Verification → admin activation.
- The browser must never receive, paste, or store the private key. The device-side wallet/security interface owns key generation and signing.
- `managedDevice`, `onBelNetwork`, hostname, MAC, IP, and VPN fields are evidence only. The backend's `DeviceAttestationAdapter` result controls eligibility.
- Login is a transparent device protocol: the user clicks Sign In; the device requests a challenge, signs locally, and submits proof. The user does not manually enter challenge IDs, signatures, or public keys.
- The active dashboard is available only after identity, device, and wallet are ACTIVE.

## Persons 2 and 3 — assets and jobs

- Identity is the persistent employee anchor.
- Do not equate employee ID with wallet address.
- Consume active identity/wallet information through shared API/domain contracts and session context.
- Wallet replacement must not change asset/job ownership references that point to identity.

## Current prototype boundary

The backend has a mock/rejecting attestation seam and cryptographic proof verification. A real BEL device-management/VPN integration and secure hardware-backed key storage are future deployment work.
