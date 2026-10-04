# Documentation consistency audit

This matrix records the repository-wide documentation/setup audit. The
implementation and checked-in scripts are the evidence; frozen specifications
remain normative where they define an interface or invariant.

| Area | Source of truth | Implementation checked | Documentation status |
| --- | --- | --- | --- |
| HTTP API | `docs/API_SPEC.yaml` | `backend/src/routes/*`, `frontend/src/api/client.ts` | Consistent for the documented application endpoints, including the read-only current-user grant lookup. `/health`, `/docs`, and device-signing `/prepare` routes are implementation/support endpoints rather than standalone frontend business operations. |
| Authentication | `docs/IDENTITY_AUTH_SPEC.md`, `docs/FRONTEND_AUTH_FLOW.md` | `backend/src/auth`, `backend/src/routes/users.routes.ts`, frontend API client/device wallet | Consistent: provisioning/login challenges, device proof, bearer session, and fresh-auth proof are distinct steps. |
| RBAC | `docs/RBAC_MATRIX.md` | backend RBAC middleware/services and contract role checks | Consistent; backend rejects early and contracts enforce the on-chain boundary. |
| Database | `docs/DATA_MODEL.md`, Prisma schema/migrations | `backend/prisma`, Prisma repositories, `DATABASE_URL` | Consistent: PostgreSQL is backend-only operational state. |
| Smart contracts | `docs/CONTRACT_SPEC.md` | `contracts/src`, deployment script, ABIs | Consistent; deployment addresses are runtime artifacts for a specific chain. |
| Besu | `docs/BESU_IMPLEMENTATION.md` and `.gitmodules` | `besu` gitlink, `scripts/run-besu-smoke.sh`, `scripts/start-besu-prototype.sh` | Consistent: the real integration uses the pinned customized Besu submodule, four prototype QBFT validators, RPC 8645–8648, and chain ID 20260920. |
| Contract deployment | deployment script and Besu integration workflow | `contracts/script/Deploy.s.sol`, `scripts/deploy-besu-prototype.sh`, `.github/workflows/ci.yml` | Consistent: contracts are deployed to the Besu run being tested, then bytecode is checked over that RPC. |
| Frontend API boundary | `docs/TEAM_INTEGRATION_CONTRACT.md`, API spec | `frontend/src/api/client.ts`, `VITE_API_BASE_URL` | Consistent: frontend calls HTTP API and does not connect to Besu, PostgreSQL, or Kubo directly. |
| Evidence | API spec and evidence service | `backend/src/evidence`, `backend/src/routes/evidence.routes.ts`, Kubo configuration | Consistent: Browser → backend API → private Kubo/IPFS; PostgreSQL stores metadata and SHA-256; authenticated backend authorizes retrieval and verifies bytes before serving. CID is a content identifier, not authorization. Completion may reference evidenceId and the backend resolves its stored hash. |
| Jobs/assets/audit | API spec and services | `backend/src/jobs`, `assets`, `audit`, route files and E2E tests | Consistent with the current workflow and E2E coverage. |
| Validators | API spec, `docs/CONSENSUS_SPEC.md`, `docs/DATA_MODEL.md` | validator service/routes and `BesuConsensusSource` | Consistent: application validator registrations govern ADD/REMOVE/RESTORE/CANCEL lifecycle in PostgreSQL, while `bel_getValidators`/`bel_getCommittee` expose live customized Besu/QBFT runtime state. Neither is treated as automatic proof of the other. |
| Component operations | API spec and frontend matrix | `backend/src/routes/assets.routes.ts`, `backend/src/assets/assets.service.ts`, `frontend/src/assets/AssetDetailPage.tsx` | Consistent: attach/detach have REST routes, require backend RBAC and fresh auth, validate existing component assets, and use the real blockchain-backed workflow. |
| Transfer grants | API spec and RBAC matrix | `backend/src/routes/users.routes.ts`, `backend/src/users/users.service.ts`, `frontend/src/assets/AssetDetailPage.tsx` | Consistent: grants are resource-scoped, expirable, revocable authorization state; `GET /users/me/grants` is read-only and a grant never transfers ownership/custody. |
| Unit/mock mode | package scripts and test files | `scripts/run-backend-unit-tests.mjs`, `mocks/*`, injected test adapters | Explicitly classified as isolated unit/development coverage, not real-chain evidence. |
| Docker Compose | `docker-compose.yml` | `evm-node` and `evm-deploy` services | Intentionally legacy/lightweight: it runs Anvil chain 31337 and is not the canonical Besu integration environment. |
| Local real integration | `docs/BESU_IMPLEMENTATION.md`, package scripts | Besu build/start/export/deploy/E2E scripts | Consistent: WSL/Linux prototype workflow is the supported local deployment-realism path. |
| CI | `.github/workflows/ci.yml` | checkout/submodule, Besu build, PostgreSQL, Kubo, deployment, EVM tests, E2E | Consistent: `besu-integration` is the mandatory real-Besu gate; consensus simulator is separate model coverage. |
| Environment variables | `.env.example`, `backend/.env.example`, source/config scripts | backend config, launcher/exporter, CI | Consistent after this audit. Private keys remain generated/ephemeral and are not documented as reusable values. |

## Deliberate limitations

- The four-validator prototype is a computationally reduced network, not a
  production-scale performance or finality claim.
- The Compose Anvil stack remains available for lightweight local development;
  changing it to Besu is an infrastructure decision outside this documentation
  audit.
- Mock attestation and mock blockchain adapters remain necessary for isolated
  unit tests. They are not used as the blockchain in the mandatory Besu E2E.
- The Besu BEL implementation currently documents the deterministic test VRF
  provider boundary and its unresolved RFC 9381 production provider; this is a
  documented implementation limitation, not silently upgraded by setup text.
- Validator registrations and live Besu/QBFT validator or committee state remain
  separate concepts. The four-validator customized-Besu prototype is not a
  production-scale network.
- The browser never connects directly to Kubo/IPFS; evidence retrieval and
  integrity verification remain backend responsibilities.
