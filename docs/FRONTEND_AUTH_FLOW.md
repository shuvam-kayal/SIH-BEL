# Frontend Authentication Flow

The frontend presents a simple user experience while the managed-device wallet component performs the cryptographic protocol.

```text
Landing
  ↓
Device eligibility
  ↓
Initialize Account
  ↓
Employee details
  ↓
Generate Secure Wallet locally
  ↓
Pending Verification
  ↓
Administrator verification and role assignment
  ↓
Active account
  ↓
Sign In
  ↓
Transparent challenge/signature
  ↓
Dashboard
```

## Initialize Account

1. The device/security integration checks eligibility.
2. The employee enters basic details such as name and any known employee ID or department.
3. The device wallet component generates the key pair locally.
4. The device submits public key/address, device metadata, and a signed provisioning challenge.
5. The backend returns a PENDING registration.
6. The UI displays **Awaiting BEL administrator verification**.

The employee must never manually enter or paste a challenge, signature, private key, seed, mnemonic, or wallet backup. The browser should invoke the device wallet/security interface; private-key material must not be handled by browser application code.

## Sign In

The human interaction is only **Click Sign In**. The device integration calls `POST /auth/login-challenge`, signs the challenge locally, and calls `POST /auth/login` with the proof. The backend verifies the registered public key and returns a bearer session only when identity, device, and wallet are ACTIVE.

The development-only credential login is a compatibility path and is disabled in production.

## Shared API client handoff

The frontend uses the typed `ApiClient` methods `requestProvisioningChallenge`, `initializeAccount`, `getPendingRegistrations`, `verifyRegistration`, `assignRole`, `activateRegistration`, `requestAuthenticationChallenge`, and `login`. Device and wallet administration uses `registerDevice`, `getDevices`, `registerWallet`, `getWallets`, `activateWallet`, `revokeWallet`, and `revokeDevice`. These methods carry public device/wallet information and proofs; they do not expose private-key fields.

## Prototype versus target

The current backend exposes the protocol and a `ManagedDeviceAttestationProvider` seam. The frontend exposes a `PlatformAuthenticator` boundary; production refuses the development mock until a real platform adapter is injected. It does not claim production hardware-backed secure storage, Windows Hello/WebAuthn integration, or a live BEL device-management/VPN attestation provider.

The backend also exposes `/auth/fresh-challenge`. A platform authenticator
must locally verify the user and return the signed proof in the
`X-BEL-Fresh-Auth` header for configured high-impact operations. The proof is
bound to the current session, device, operation, and resource and cannot be
reused.
