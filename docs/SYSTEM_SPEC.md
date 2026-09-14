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
