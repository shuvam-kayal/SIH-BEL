# SIH-BEL decentralized platform

SIH-BEL is a permissioned-blockchain asset and maintenance platform. The
repository contains the React operator console, Node/Express backend,
PostgreSQL persistence, Kubo evidence storage, Solidity contracts, and the
customized Besu/QBFT implementation used by the real integration workflow.

## Current architecture

```text
React frontend
    ↓ HTTP/REST (Bearer session)
BEL backend API
    ├── PostgreSQL (identities, devices, sessions, jobs, assets, metadata)
    ├── Kubo/IPFS (private evidence bytes)
    └── EVM blockchain adapter
            ↓ JSON-RPC
        customized Besu, 4-node prototype QBFT network
            ↓
        deployed BEL contracts
```

The frontend does not talk directly to Besu, contracts, PostgreSQL, or the
IPFS API. It calls the backend. Device private keys stay in the device-side
wallet/authenticator boundary; they are never sent to the backend or browser
API as private key material.

The mandatory integration path uses the real customized Besu submodule,
real contracts, real PostgreSQL, real Kubo, and the real backend adapter. The
four-validator `prototype` profile is the permitted local/CI reduction from
the production-scale validator population. It is not production-ready and
does not demonstrate production-scale performance.

## Read before changing interfaces

These documents define the frozen contracts and system boundaries:

| Document | Scope |
| --- | --- |
| [SYSTEM_SPEC.md](docs/SYSTEM_SPEC.md) | Actors, objects, workflows, security assumptions |
| [API_SPEC.yaml](docs/API_SPEC.yaml) | HTTP API surface |
| [IDENTITY_AUTH_SPEC.md](docs/IDENTITY_AUTH_SPEC.md) | Identity, device, wallet, and authentication lifecycle |
| [RBAC_MATRIX.md](docs/RBAC_MATRIX.md) | Roles and permissions |
| [DATA_MODEL.md](docs/DATA_MODEL.md) | Shared data model |
| [CONTRACT_SPEC.md](docs/CONTRACT_SPEC.md) | Contract interfaces and transaction types |
| [BESU_IMPLEMENTATION.md](docs/BESU_IMPLEMENTATION.md) | Customized Besu build and real integration workflow |
| [FRONTEND_AUTH_FLOW.md](docs/FRONTEND_AUTH_FLOW.md) | Frontend/device authentication boundary |
| [DOCUMENTATION_CONSISTENCY.md](docs/DOCUMENTATION_CONSISTENCY.md) | Audit evidence and known boundaries |

## Development modes

There are two intentionally different modes:

1. **Unit/mock mode.** Ordinary backend unit tests inject
   `mocks/mock-blockchain` and in-memory repositories. The frontend test
   harness may use `mocks/mock-api`. These modes are for isolated component
   development; they are not evidence that the deployed workflow works.
2. **Real Besu integration mode.** `BEL_BLOCKCHAIN=evm` points the backend at
   the Besu JSON-RPC endpoint and loads addresses from the deployment file.
   This is the canonical EVM integration and E2E path.

`docker-compose.yml` is a lightweight legacy development stack. Its
`evm-node` service is Anvil on chain 31337 and its deployment is named
`local`; it is not the canonical Besu integration environment. Replacing
that stack requires a separate infrastructure decision. Use the Besu workflow
below when validating the real application.

## Install and fast checks

Requirements: Node 20+, Docker, a Linux/WSL shell for Besu, JDK 21 for the
Besu build, and Foundry for Solidity deployment/tests.

```bash
npm ci
npm run typecheck
npm test
npm run test:contracts:validator
npm run test:contracts:workflow
npm run test:consensus       # Python model/simulator coverage only
```

The backend unit suite intentionally does not require Besu or EVM credentials.
The Python consensus suite is model-level coverage and is not a substitute for
the Java consensus code running inside Besu.

## Real Besu prototype workflow

Run this from Linux or WSL. The submodule must be initialized recursively and
must remain at the gitlink commit recorded by this repository.

```bash
git submodule update --init --recursive
npm ci
npm run besu:build
```

Start the real four-node prototype and capture the printed run root:

```bash
run_output="$(BEL_EXECUTION_PROFILE=prototype BEL_REQUIRE_TEST_ACCOUNTS=true bash scripts/start-besu-prototype.sh)"
printf '%s\n' "$run_output"
run_root="$(printf '%s\n' "$run_output" | sed -n 's/^Besu smoke network started: //p' | tail -n 1)"
source <(bash scripts/export-besu-test-env.sh "$run_root")
```

The launcher generates four Besu validator nodes on RPC ports 8645–8648,
generates ephemeral funded application test accounts, and records runtime data
under the ignored `.bel-demo/` directory. It does not print or commit private
keys.

Start PostgreSQL and Kubo, then deploy and test against the same Besu RPC:

```bash
docker compose up -d postgres ipfs
export DATABASE_URL=postgresql://bel:bel@127.0.0.1:5432/bel
export IPFS_API_URL=http://127.0.0.1:5001
npm run db:migrate
bash scripts/deploy-besu-prototype.sh "$run_root"
npm run test:evm
npx vitest run backend/test/users.evm.integration.test.ts --testTimeout=180000
npm run test:e2e:workflow
```

The environment export sets the three application RPC names,
`BEL_EVM_RPC_URL`, `BEL_CHAIN_RPC_URL`, and `BEL_E2E_RPC_URL`, to the same
Besu endpoint and supplies the actual chain ID, deployment name, validator
addresses, and ephemeral test keys. The deployment file is regenerated for
the current chain; do not reuse one from another RPC.

Always stop the network and remove disposable services:

```bash
bash scripts/check-besu-bel-demo.sh "$run_root" 4 8645
bash scripts/stop-besu-bel-demo.sh "$run_root"
docker compose rm -sf postgres ipfs
```

For the CI-equivalent sequence, see
[docs/BESU_IMPLEMENTATION.md](docs/BESU_IMPLEMENTATION.md). CI checks out the
submodule, builds Besu with JDK 21, starts the same prototype profile, starts
PostgreSQL and Kubo, deploys contracts, runs EVM integration tests, bootstraps
the PostgreSQL admin, and runs the complete cross-person E2E.

## Frontend handoff

The Vite frontend uses `VITE_API_BASE_URL` and the HTTP client in
`frontend/src/api/client.ts`; a local backend normally listens on
`http://localhost:4000`. In the Compose/nginx stack the configured base is
`http://localhost:8080/api`.

The normal authentication flow is:

```text
/auth/provisioning-challenge → /auth/initialize-account
administrator verifies/assigns role/activates
/auth/login-challenge → local device signature → /auth/login
Bearer session → protected API operations
```

High-impact operations obtain `/auth/fresh-challenge` and send the resulting
device proof in `X-BEL-Fresh-Auth`. Consult [docs/API_SPEC.yaml](docs/API_SPEC.yaml),
[docs/FRONTEND_AUTH_FLOW.md](docs/FRONTEND_AUTH_FLOW.md),
[docs/TEAM_INTEGRATION_CONTRACT.md](docs/TEAM_INTEGRATION_CONTRACT.md), and
[docs/RBAC_MATRIX.md](docs/RBAC_MATRIX.md) before integrating a page.

## Repository layout

```text
backend/    Express API, services, EVM adapter, Prisma repositories
frontend/   React/Vite operator console and API client
contracts/  Solidity contracts, ABIs, deployment script, tests
besu/       customized Besu Git submodule
shared/     shared types, schemas, enums, and RBAC data
mocks/      isolated mock API and mock blockchain packages
scripts/    Besu, deployment, bootstrap, verification, and test orchestration
docs/       frozen specifications and implementation/setup documentation
```

## Verification terminology

`npm test` and contract/Python tests answer component or model-level questions.
The Besu integration workflow answers the deployment-realism question. A green
unit or simulator test must not be presented as proof that the backend works
against a real chain.

Do not commit generated validator keys, application test keys, Besu data,
runtime logs, deployment secrets, or wallet private keys.
