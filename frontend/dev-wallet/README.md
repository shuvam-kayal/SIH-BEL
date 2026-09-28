# Development device wallet

This is a development-only local wallet service for exercising the existing BEL challenge protocol on one computer. It is not Windows Hello, a TPM, a secure enclave, a managed-device attestation provider, or production key storage.

## Start three isolated devices

From the repository root, set a development keystore secret and run one service process at a time with a different device selector:

```powershell
$env:BEL_DEV_WALLET_SECRET = "use-a-local-development-secret-of-16-or-more-characters"
$env:BEL_DEV_DEVICE_ID = "admin-device"
node frontend/dev-wallet/server.mjs
```

Use `employee-001-device` and `employee-002-device` in separate runs when provisioning the two employees. The browser selects the active service through Vite-only variables:

```text
VITE_BEL_DEV_WALLET_URL=http://127.0.0.1:8787
VITE_BEL_DEV_DEVICE_ID=admin-device
```

Restart the service and Vite dev server when switching devices. The service creates one encrypted keystore per device under `frontend/dev-wallet/.bel-dev/devices/<device-id>/wallet.json` (or `BEL_DEV_WALLET_DIR`). That directory is ignored by the dev-wallet package. Each device has an independent secp256k1 key, public key, and wallet address.

To make the development admin wallet correspond to the Besu/bootstrap wallet, set `BEL_DEV_DEVICE_IMPORT_KEY_FILE` once when creating `admin-device`, pointing to the ephemeral Besu test-account key file. The key is read by the local service only and is never sent to the browser or backend. Do not place it in `.env` or source control.

## Security boundary

The service uses `ethers` to generate or load secp256k1 keys, derives the ADR-024 `X || Y` public-key wire format and wallet address, signs the exact backend challenge using EIP-191 personal-sign semantics, and converts the signature to BEL compact `yParity || r || s` format. Private keys are encrypted with AES-256-GCM using a secret supplied to the local process and the keystore is written with restrictive file permissions where supported.

The browser receives only `deviceId`, public key, wallet address, and signatures. There is no private-key export endpoint, arbitrary filesystem endpoint, PIN field, biometric field, or credential-storage path in the frontend. The service binds to `127.0.0.1` only, validates device/challenge/operation inputs, and is blocked when `BEL_ENV=production`.

The development service returns an explicit `developmentUserVerification` marker. It does not return or claim `userVerified: true`; therefore it does not represent Windows Hello or local human verification. The Vite development bridge accepts that marker only in development builds. Production builds require the real managed bridge to report actual local user verification.

Development filesystem/OS-protected wallet storage is not equivalent to a production secure hardware wallet. The future BEL-managed device-wallet implementation can replace `window.belDeviceWallet` without changing backend challenge or signature semantics. The backend's existing `MockDeviceAttestationAdapter` remains the only development attestation adapter; production continues to fail closed unless the managed provider is configured.

## Complete flow

1. Start Besu, deploy the existing contracts, run PostgreSQL migrations, and configure the backend with `BEL_BLOCKCHAIN=evm`, the Besu RPC, `BEL_CHAIN_DEPLOYMENT=besu-prototype`, `BEL_RUN_INTEGRATION=true`, `BEL_DEVICE_ATTESTATION=mock`, and the approved development device IDs.
2. Start the wallet service for `employee-001-device`, run the frontend with its Vite variables, and submit employee self-provisioning. The backend must return PENDING identity/device/wallet.
3. Repeat for `employee-002-device`.
4. Start the wallet service for the configured bootstrap `admin-device`, log in, then use the existing pending-registration, verify, role, and activate screens.
5. Switch to each employee device and log in. The backend resolves different identities and wallets. Fresh-auth operations still request operation/resource-bound challenges and send `X-BEL-Fresh-Auth`; development signing does not weaken those backend checks.

Real device attestation, Windows Hello, and production deployment validation remain external deployment work.
