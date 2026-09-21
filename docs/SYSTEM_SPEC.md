# System Specification

## Actors
ADMIN, MANAGER, ENGINEER, TECHNICIAN, AUDITOR, ISSUER, VERIFIER

## Core Objects
User, Identity, Device, Wallet, AuthorizationGrant, Asset, Component, Job, AuditEvent, Validator, Block

## Core Workflows
- Employee provisioning
- Login
- Device registration
- Wallet activation
- Wallet revocation
- Asset creation
- Asset transfer
- Job creation
- Job assignment
- Maintenance completion
- Job verification
- Asset state change
- Audit

## Person 1 identity and authentication workflows

### Employee provisioning

1. An employee starts on a device whose eligibility is approved by the server-side `DeviceAttestationAdapter` backed by the authoritative BEL device-management/network provider; client metadata alone is not trusted.
2. The device wallet component generates the key pair locally; the private key never leaves the device.
3. The backend receives employee-entered details, public key/address, metadata, and challenge proof.
4. The backend creates PENDING identity, device, and wallet records.
5. A BEL administrator verifies the employee.
6. The administrator assigns or confirms employee ID, department, and role.
7. The administrator activates the identity, device, and wallet. No backend-generated wallet is used.

### Login

1. The user clicks **Sign In**.
2. The frontend/device wallet requests an authentication challenge.
3. The managed authenticator performs its device-local user verification, using its approved platform modality; the frontend does not collect a BEL application PIN.
4. The device wallet signs the challenge locally.
5. The frontend/device submits the existing `LoginProofRequest` to `/auth/login`.
6. The backend verifies the public-key signature and creates a bearer session.
7. The frontend uses `Authorization: Bearer <token>`; session validation rechecks identity, device, wallet, status, and expiry.

Local device verification and BEL backend authentication are separate trust boundaries. The device decides whether its credential may be used; BEL verifies that the registered public key signed the server challenge. The backend never receives the local PIN, biometric data, private key, seed, or mnemonic. Development-only credential login may remain for compatibility and is disabled in production.

### High-impact operations

For a configured high-impact operation, an existing bearer session may not be enough:

```text
protected operation
        ↓
backend requires fresh authentication
        ↓
device obtains fresh challenge
        ↓
local authenticator/user verification
        ↓
device signs session + operation + resource-bound proof
        ↓
backend verifies short-lived, single-use proof
        ↓
operation proceeds
```

### Wallet activation and replacement

Wallet activation operates on an already registered device-generated public address. It does not create an address. A replacement wallet is registered as PENDING, the old wallet is REVOKED, and the new wallet becomes ACTIVE only after administrator authorization; the persistent identity remains unchanged.

### Wallet revocation

An administrator can revoke a wallet for loss, compromise, or replacement. Revocation invalidates wallet-bound sessions and leaves the historical wallet record available for audit.

## Blockchain Assumptions
- Permissioned network
- Authorized validator set
- Leader proposes block
- Random verification committee
- Committee validates
- BFT quorum finalizes

## Security Assumptions
- Users access from BEL-managed workstation
- Device/network trust is required
- No public signup
- Private key never leaves managed device
- Wallet can be revoked
- Roles belong to persistent identity, not wallet
- Sensitive documents are OFF-chain
- Blockchain stores hashes/references, not classified content
## Validator governance

Validator add, scheduled removal, and restore are direct ADMIN operations.
Application governance has no validator approval committee. QBFT/Besu consensus
committee selection remains a protocol/runtime concern. Validator lifecycle
history is append-only; RESTORE is a new inverse blockchain transaction.
