# BEL Decentralized Platform

Monorepo for the permissioned-blockchain asset and maintenance platform.
Six workstreams develop in parallel against frozen interfaces and mock
adapters, then integrate in the order set out in the project plan's
Phase 12.

## Read this first

Before writing any code, read `docs/SYSTEM_SPEC.md`. Then the document
for your area. These are frozen contracts — changing one is a team
decision, not an individual one:

| Document | What it fixes |
| :--- | :--- |
| `docs/SYSTEM_SPEC.md` | Actors, core objects, workflows, security assumptions |
| `docs/DATA_MODEL.md` | Every shared entity's fields |
| `docs/RBAC_MATRIX.md` | Who may do what |
| `docs/API_SPEC.yaml` | The REST surface |
| `docs/CONTRACT_SPEC.md` | Transaction types and contract interfaces |
| `docs/CONSENSUS_SPEC.md` | Frozen BEL committee/QBFT consensus protocol |
| `docs/DECISIONS.md` | Why things are the way they are |
| `docs/THREAT_MODEL.md` | Including dev shortcuts that must not ship |

## Quickstart

Requires Node 20+. The BEL consensus prototype is implemented in the nested Besu repository and uses JDK 21. Foundry is optional for
contracts — both optional depending on what you own.

```bash
npm ci                      # installs every workspace from the lockfile
npm run verify              # Prisma, typechecks, PostgreSQL, EVM, Solidity
npm run dev                # backend on :4000, frontend on :3000
```
| Command                            | What it does                                                          |
| :--------------------------------- | :-------------------------------------------------------------------- |
| `npm run dev`                      | Backend and frontend together                                         |
| `npm test`                         | All TypeScript tests                                                  |
| `npm run typecheck`                | All workspaces                                                        |
| `npm run test:contracts:validator` | Validator management / `bel-contracts` tests                          |
| `npm run test:contracts:workflow`  | Existing contract workflow tests                                      |
| `npm run test:contracts`           | Runs both contract test suites                                        |
| `npm run test:consensus`           | Person 4's simulator tests (pytest)                                   |
| `npm run verify`                   | Checks PostgreSQL and Anvil, then runs the complete integration suite |
| `docker compose up`                | Everything behind nginx on `:8080`                                    |

The frontend renders from `mocks/mock-api` and needs no backend. The
backend runs against `mocks/mock-blockchain` and needs no chain. Both
are real, working programs today.

### Calling the API before authentication exists

Dev sessions are header-based until Person 1 replaces them:

```bash
curl localhost:4000/users/me \
  -H 'x-bel-employee-id: EMP001' -H 'x-bel-role: ENGINEER'
```

Endpoints whose owning module is unfinished return **501
NOT_IMPLEMENTED** with the method name — that is expected, not a bug.

## Layout

```text
docs/        Frozen specifications. Start here.
shared/      Types, enums, validators, RBAC matrix. Imported by everyone.
contracts/   Solidity interfaces, tests, deploy script (Foundry).
blockchain/  BEL consensus landing page and protocol-owned support material.
besu/        Nested Besu repository containing the BEL QBFT integration.
backend/     REST API implementing docs/API_SPEC.yaml.
frontend/    Role-based operator console.
mocks/       mock-api (for the frontend), mock-blockchain (for the backend).
infra/       Dockerfiles and nginx config.
scripts/     bootstrap, contract setup, ABI generation, and Besu demo launchers.
```

## BEL consensus demo

The submitted consensus implementation is the Java/Besu integration in the
nested `besu/` repository. The default launcher generates 70 validators and
stores generated keys, configuration, logs, and runtime data only under the
ignored `.bel-demo/` directory. The four-node launcher is an infrastructure
smoke test with a 70-validator generated configuration; it does not prove BEL
committee finality or Byzantine behavior.

```bash
cd besu
./gradlew :consensus:bel:test :consensus:qbft:test :besu:compileJava installDist
cd ..
./scripts/run-besu-smoke.sh
# In another shell, use the printed run root:
./scripts/check-besu-bel-demo.sh .bel-demo/smoke-<timestamp> 4 8645
./scripts/stop-besu-bel-demo.sh .bel-demo/smoke-<timestamp>
```

For the lightweight four-validator application prototype (using the already
installed Besu distribution), run from WSL/Linux:

```bash
./scripts/start-besu-prototype.sh
./scripts/deploy-besu-prototype.sh .bel-demo/smoke-<timestamp>
npm run db:migrate
npm run test:e2e:besu --workspace=bel-backend
./scripts/stop-besu-bel-demo.sh .bel-demo/smoke-<timestamp>
```

The prototype deployment is written to `contracts/deployments/besu-prototype.json`.
It uses the isolated `prototype` profile and a four-validator application
registry minimum; the normal deployment path and production validator rule
remain 70 validators.

For the 70-validator generator on Windows:

```powershell
$env:JAVA_HOME = 'C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot'
cd besu
.\gradlew.bat :consensus:bel:test :consensus:qbft:test :besu:compileJava installDist
cd ..
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-besu-bel-demo.ps1 -ValidatorCount 70
```

Resolved protocol decisions implemented/documented here are: an initial active validator population of N >= 70; per-block VRF-based committee selection with p_N = min(1, max(70/N, 0.0132)) and a deterministic 70-ticket minimum fallback; a committee fixed for all rounds of a block; deterministic hash-based randomized leader selection per round; QBFT PREPARE/COMMIT finality with Q = floor(2K/3)+1; round-change with the committee unchanged; and safety-first handling of invalid, conflicting, offline, or failed validators. The previous finalized block hash is the public selection input, but is explicitly not claimed to be a bias-resistant randomness beacon. The production RFC 9381 VRF backend, validator admission/removal, large-scale evaluation, and live Byzantine/finality demonstrations remain open production items.
## Ownership

| Person | Area | Primary directories |
| :--- | :--- | :--- |
| 1 | Identity, auth, RBAC | `backend/src/{auth,users,middleware}`, `shared/rbac` |
| 2 | Assets, NFT lifecycle | `backend/src/assets`, `contracts/src/IAssetRegistry.sol` |
| 3 | Jobs, maintenance | `backend/src/jobs`, `contracts/src/IJobManager.sol` |
| 4 | Consensus | `blockchain/`, `docs/CONSENSUS_SPEC.md` |
| 5 | Smart contracts | `contracts/` |
| 6 | Frontend | `frontend/`, `mocks/mock-api` |

`.github/CODEOWNERS` routes reviews accordingly — replace the
placeholder handles with real ones.

## How the plug-and-play swap works

Backend services depend on the `BlockchainService` interface, never on a
concrete chain. `backend/src/container.ts` is the only file that names an
implementation. At Phase 12, one line there changes from
`MockBlockchainAdapter` to the real adapter, and nothing else moves.

The frontend has the same arrangement: every page imports from
`src/api/mockApi.ts`, and only that file changes when the real HTTP
client arrives.

## Contributing

Branch from `dev`, never push to `main`. One teammate review, CI green,
then merge. `.github/pull_request_template.md` has the checklist. If a PR
touches `shared/` or any frozen document, say so explicitly and add an
ADR to `docs/DECISIONS.md`.

## Base-v1 team workflow

Clone the repository, create your own feature branch, and install dependencies from the root:

```bash
npm ci
```

Then run the workstream-appropriate checks:

```bash
npm run typecheck
npm test --workspace=bel-backend
npm run test --workspace=bel-frontend
npm run test:contracts
npm run verify
```

See `docs/BASELINE_FREEZE.md` before changing shared contracts. No teammate should require another teammate's feature branch to start work.
