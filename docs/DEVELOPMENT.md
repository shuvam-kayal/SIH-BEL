# BEL development workflows

This is a development/test workflow. It is not the production device-wallet or device-attestation implementation.

## Full local environment

Prerequisites are Node.js/npm, Docker Compose, Foundry (`forge`), and bash or WSL. Install dependencies, then run:

```sh
npm ci
npm run dev:bootstrap
```

The orchestrator starts/reuses PostgreSQL and Kubo through the existing `docker-compose.yml`, starts the existing four-validator Besu prototype in a fresh `.bel-demo/orchestrated-*` directory, checks RPC health/chain ID/block production, uses the existing deployment/bootstrap mechanisms, starts the encrypted development wallet, backend, and frontend, and waits for HTTP readiness. It never sources `scripts/export-besu-test-env.sh`.

Each run is explicitly marked `bel-dev-bootstrap` in `run.json`. A later `npm run dev:bootstrap` stops only live Besu processes positively matched to that metadata and their run directory, waits for shutdown, checks ports `8645`–`8648`, and then starts exactly one fresh network. If a later stage fails, the invocation-owned Besu run is stopped while its logs and diagnostic metadata remain available.

The orchestrator keeps its wallet keystores under `.bel-demo/orchestrator/devices` by default, separate from manually started wallet services. Set `BEL_DEV_WALLET_DIR` explicitly when you intentionally want to reuse another development wallet store.

Use `npm run dev:stop` to stop recorded processes. It does not delete database volumes, wallet keystores, Besu run directories, deployments, or logs. Reset state only after an explicit decision: stop services, remove the disposable `.bel-demo/orchestrated-*` directory and/or Docker volumes, then recreate the environment.

Every fresh Besu run deploys contracts against that exact run before admin bootstrap. The deployment metadata is then checked for chain ID `20260920` and non-empty bytecode at every configured contract address. The existing `--deploy` flag remains accepted for compatibility but is no longer needed to force deployment.

## Development devices

The wallet service runs outside the browser. Set a secret and select a device before starting it:

```powershell
$env:BEL_DEV_WALLET_SECRET = "at-least-16-local-development-characters"
$env:BEL_DEV_DEVICE_ID = "BEL-DEV-ADMIN-001"
node frontend/dev-wallet/server.mjs
```

For an employee, use a separate local service process, wallet directory, port, and ID, for example `BEL-DEV-EMPLOYEE-001` on port `8788`. Each ID gets a separate encrypted keypair. The browser receives only the ID, public key, address, and signed challenge. Private keys never enter React, API payloads, browser storage, logs, or Git. The frontend needs only `VITE_BEL_DEV_WALLET_URL`; it calls `/identity` without a device selector and uses the wallet service's returned device ID for signing. See `frontend/dev-wallet/README.md` for the keystore and import details.

Development attestation is explicit: configure `BEL_DEVICE_ATTESTATION=mock` and `BEL_MOCK_APPROVED_DEVICE_IDS` with only the local IDs being tested, for example `BEL-DEV-ADMIN-001,BEL-DEV-EMPLOYEE-001`. The dev bootstrap preserves an explicitly supplied allowlist and otherwise approves only its admin wallet device. Production rejects the mock adapter and requires the managed provider configuration.

## Remote employee testing

Developer A runs Besu, PostgreSQL, Kubo, the backend, and the frontend, exposing only the frontend and backend through tunnels. Developer B does not run the frontend. Developer B runs only a local dev-wallet service configured with `BEL_DEV_DEVICE_ID=BEL-DEV-EMPLOYEE-001` and `BEL_DEV_WALLET_ALLOWED_ORIGIN=<exact frontend tunnel origin>`, then opens Developer A's frontend tunnel. The shared frontend uses its configured backend tunnel and local `http://127.0.0.1:<wallet-port>` wallet URL; it never embeds Developer B's device ID. The employee initializes a pending account; Developer A verifies, assigns a role, and activates it before employee login.

The backend uses an explicit development allowlist, for example:

```text
BEL_CORS_ORIGINS=http://192.168.1.10:3000,http://localhost:3000
```

The Vite server binds to LAN interfaces, but host-header validation remains explicit. Set `BEL_VITE_ALLOWED_HOSTS=192.168.1.10,localhost` for the actual development host. Do not use `allowedHosts: true`. WSL2 may require a Windows port-forward/firewall rule; binding Vite to `0.0.0.0` alone does not guarantee reachability from another physical device.

Never expose PostgreSQL, the Kubo API, Besu RPC, the wallet service, private keys, development secrets, or the mock-attestation configuration publicly. The wallet stays bound to `127.0.0.1`; `BEL_DEV_WALLET_ALLOWED_ORIGIN` is an explicit browser-origin allowlist, not a tunnel or public bind. Restrict firewall rules to the intended LAN and use a real managed device-attestation deployment for anything beyond isolated development.

## Network status and Besu boundary

The Network page reports chain RPC, block production, finalization, committee data, and validator data separately. It does not invent validator or committee records when `bel_getCommittee` or `bel_getValidators` fail.

The backend expects those custom BEL RPC methods from the Besu consensus integration (`BesuConsensusSource`). The current launcher enables only `ETH,NET,WEB3,ADMIN`, and `EvmBlockchainAdapter` therefore reports committee/validator reads as unavailable unless Person 4's custom RPC provider is wired into the running Besu distribution. This is an integration boundary, not a frontend data problem.
