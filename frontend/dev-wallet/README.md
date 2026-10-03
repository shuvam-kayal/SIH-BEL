# Development device wallet

This is a development-only local wallet service for exercising the existing BEL challenge protocol on one computer. It is not Windows Hello, a TPM, a secure enclave, a managed-device attestation provider, or production key storage.

## Start a local device wallet

From the repository root, set a development keystore secret and run one local service process with its device selector:

```powershell
$env:BEL_DEV_WALLET_SECRET = "use-a-local-development-secret-of-16-or-more-characters"
$env:BEL_DEV_DEVICE_ID = "admin-device"
node frontend/dev-wallet/server.mjs
```

The shared frontend needs only the local wallet URL. The wallet service is authoritative for the device ID; do not set `VITE_BEL_DEV_DEVICE_ID`:

```text
VITE_BEL_DEV_WALLET_URL=http://127.0.0.1:8787
```

The browser calls `/identity` without a device selector and uses the returned device ID for `/sign`. The service rejects a mismatched explicit selector, so it cannot be used to enumerate arbitrary local wallet identities. It creates one encrypted keystore per device under `frontend/dev-wallet/.bel-dev/devices/<device-id>/wallet.json` (or `BEL_DEV_WALLET_DIR`). That directory is ignored by the dev-wallet package. Each device has an independent secp256k1 key, public key, and wallet address.

For remote employee testing, Developer A shares only the frontend and backend through their chosen tunnels. Developer B does not run the frontend and runs only a local wallet:

```text
BEL_DEV_WALLET_SECRET=<local secret of >=16 chars>
BEL_DEV_DEVICE_ID=BEL-DEV-EMPLOYEE-001
BEL_DEV_WALLET_PORT=8787
BEL_DEV_WALLET_ALLOWED_ORIGIN=https://<frontend-tunnel>.trycloudflare.com
node frontend/dev-wallet/server.mjs
```

The wallet remains bound to `127.0.0.1` and must never be tunneled or exposed publicly. Developer B opens Developer A's frontend tunnel; the browser reaches Developer A's backend tunnel and Developer B's own `http://127.0.0.1:8787` wallet.

When the backend is connected to the EVM development signer path, the wallet address used by a state-changing actor must be derived from one of that Besu run's disposable `BEL_CHAIN_DEV_SIGNER_KEYS`. A randomly generated employee wallet can authenticate, but it cannot submit backend-signed EVM writes unless its corresponding disposable key is configured locally and in the backend signer set. Never put those keys in the frontend, repository, logs, or tunnels.

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
