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

1. An employee starts on an eligible BEL-managed device and BEL internal network or approved VPN.
2. The device wallet component generates the key pair locally; the private key never leaves the device.
3. The backend receives employee-entered details, public key/address, metadata, and challenge proof.
4. The backend creates PENDING identity, device, and wallet records.
5. A BEL administrator verifies the employee.
6. The administrator assigns or confirms employee ID, department, and role.
7. The administrator activates the identity, device, and wallet. No backend-generated wallet is used.

### Login

1. The device requests an authentication challenge.
2. The device wallet signs it locally.
3. The backend verifies the public-key signature.
4. The backend creates a bearer session.
5. Session validation rechecks identity, device, wallet, status, and expiry.

Challenge fields are handled by the device wallet integration; the employee only clicks **Sign In**. Development-only credential login may remain for compatibility and is disabled in production.

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
