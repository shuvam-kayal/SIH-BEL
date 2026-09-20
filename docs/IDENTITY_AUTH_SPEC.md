# BEL Identity and Authentication Specification

This is the Person 1 cross-team contract for identity, device, wallet, onboarding, and authentication. It describes the current prototype and the target BEL deployment without claiming that hardware-backed key storage or a production device-attestation integration already exists.

## Identity

`Identity` is the persistent employee anchor. It is not a wallet and does not change when a device or wallet is replaced.

Identity states are `PENDING`, `ACTIVE`, `SUSPENDED`, and `REVOKED`. A pending identity is not an authenticated employee and cannot use protected business functionality. Employee ID, department, and role may be unavailable until administrator verification.

## Device

A `Device` is a managed endpoint associated with an identity. Device states are `PENDING`, `ACTIVE`, and `REVOKED`. Device registration and device trust are separate: registration records the association, while attestation and later administrator activation establish trust.

Device metadata such as hostname, MAC, IP, VPN information, and operating-system data is evidence/telemetry only. It is never a cryptographic identity by itself.

## Wallet

A `Wallet` is a revocable public-key credential associated with one identity and one device. Wallet states are `PENDING`, `ACTIVE`, and `REVOKED`.

The backend never generates or receives an employee private key. The device-side wallet component generates and retains the private key locally. The backend stores only public address, public key, proof, and lifecycle metadata. Private keys, mnemonics, seeds, and backups are never stored, logged, returned, or placed on-chain.

## Employee initialization

```text
BEL-managed device + BEL internal network/approved VPN
        ↓
Employee clicks Initialize Account
        ↓
Employee enters basic details
        ↓
Device wallet component generates a key pair locally
        ↓
Public key/address + challenge proof + metadata are submitted
        ↓
PENDING identity + PENDING device + PENDING wallet
        ↓
Administrator verifies and assigns authoritative fields
        ↓
ACTIVE identity + ACTIVE device + ACTIVE wallet
```

The current API is `POST /auth/provisioning-challenge` followed by `POST /auth/initialize-account`. The endpoint rejects a private-key field and accepts only public-key material and a signature. Initialization never activates the account.

## Device attestation

The backend uses the `ManagedDeviceAttestationProvider`/`DeviceAttestationAdapter` abstraction. Its result, not client flags, determines whether initialization is eligible. The current prototype provides an explicit rejecting `NotConfiguredManagedDeviceAttestationProvider` and a deterministic `MockDeviceAttestationAdapter` for tests. Production rejects the mock adapter and requires an injected provider. A future BEL deployment will connect this seam to trusted device-management and network/VPN attestation.

Client values such as `managedDevice`, `onBelNetwork`, hostname, MAC, IP, and VPN metadata may be retained as evidence, but cannot by themselves authorize initialization.

## Administrator verification and activation

An administrator lists pending registrations, inspects employee/device/public-wallet information, verifies the employee, assigns or confirms employee ID and department, assigns a role, and activates the registration. Employees cannot assign their own role, privilege, administrator authority, clearance, or validator authority.

Activation requires verified identity data and an existing pending device/wallet. It does not create a wallet or address. `POST /admin/users/{id}/activate` transitions the verified registration to active; the existing wallet lifecycle endpoint activates an already registered public address.

## Authentication

Challenge-response login is a device protocol, not a manual user interaction:

```text
User clicks Sign In
        ↓
Device requests POST /auth/login-challenge
        ↓
Device wallet signs the challenge locally
        ↓
Device submits the proof to POST /auth/login
        ↓
Backend verifies the stored public-key signature
        ↓
Backend creates a bearer session
```

The employee does not manually enter `challengeId`, `signature`, `publicKey`, or a private key. The frontend/device wallet integration handles those fields transparently. Every request revalidates identity, device, wallet, status, and session expiry; revocation invalidates access.

These are two distinct trust boundaries:

- Local device verification answers: “Is the person currently operating the managed device authorized to use the device-held credential?” The managed authenticator/platform decides this using its approved modality, such as a device PIN, Windows Hello, fingerprint, face, security key, or another approved mechanism.
- BEL backend authentication answers: “Can the backend cryptographically verify that the registered device credential signed this server-issued challenge?” The backend verifies the public-key proof and creates the bearer application session.

The local verification result is not a BEL application PIN and is not submitted to the backend. PINs, biometric data, private keys, seeds, and mnemonics never cross the frontend/backend boundary.

For EVM, `walletAddress` must equal the address derived from the canonical secp256k1 public key (`X || Y`, without the SEC1 prefix). The backend rejects malformed or mismatched pairs during initialization, activation, login, and session validation; this is cryptographically validated by the wallet/blockchain integration adapter before activation. Other future wallet/signature schemes require their own binding rules.

Development-only legacy credential login may remain for bootstrap and compatibility. It is explicitly disabled when `BEL_ENV=production`; production authentication uses cryptographic device proof.

## Replacement

```text
Identity A
 ├─ Device A ─ Wallet A (REVOKED)
 └─ Device B ─ Wallet B (ACTIVE)
```

Identity A remains the same. Historical device and wallet records remain available for audit. Replacement revokes the old credential/session path where applicable and activates the new device/wallet only after the required verification.

## Current prototype versus target deployment

The current implementation has repository-backed lifecycle state, public-key challenge verification, an EVM wallet/public-key binding, single-use authentication challenges, configurable fresh authentication for high-impact operations, and an explicit fail-closed production attestation boundary. The mock/rejecting adapter is not proof of BEL hardware trust. Secure hardware-backed private-key storage, the authoritative BEL device-management/MDM provider, and production network/VPN attestation remain external deployment work.

## Platform user verification and fresh authentication

The backend never receives a PIN, biometric, or private key. A client-side
platform authenticator must perform local user verification and return only a
signature and public key. The web client exposes an explicit
`PlatformAuthenticator` seam and refuses a fake production fallback; a real
Windows Hello/WebAuthn adapter remains integration work. WebAuthn credential
keys are distinct from the BEL EVM wallet key until a protocol adapter is
specified.

Bearer sessions remain the normal request mechanism. Configured high-impact
routes can require a short-lived, single-use proof from `/auth/fresh-challenge`.
The frontend/device flow is: protected operation → fresh challenge → device-local
user verification → device signs the operation/resource/session-bound proof →
backend verifies the one-time proof → operation proceeds. An existing bearer
session is not necessarily sufficient. The frontend does not know how the
private key is stored or how local PIN/biometric processing occurs.
