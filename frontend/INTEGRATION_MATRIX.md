# BEL frontend integration matrix

The frontend is an HTTP client. It does not access Besu/EVM JSON-RPC, PostgreSQL, contracts, or Kubo/IPFS. `VITE_API_BASE_URL` selects the backend origin (default `/api`). Bearer sessions are held in `sessionStorage`; a `401` clears the session and returns the user to sign-in.

| Endpoint | Consumer | Auth / RBAC | Fresh auth | Wire handling | Status |
| --- | --- | --- | --- | --- | --- |
| `POST /auth/provisioning-challenge` | Account initialization | None | No | JSON device id + deployment-supplied metadata | Integrated |
| `POST /auth/initialize-account` | Account initialization | None | No | JSON public identity and device signature; no private key | Integrated |
| `POST /auth/login-challenge` | Sign in | None | No | Device bridge signs challenge | Integrated |
| `POST /auth/login` | Sign in | None | No | JSON proof; bearer token saved after success | Integrated |
| `POST /auth/fresh-challenge` | High-impact mutations | Bearer | N/A (creates challenge) | Operation/resource-bound JSON challenge | Integrated |
| `POST /auth/logout` / `GET /users/me` | Session lifecycle | Bearer | No | 204 logout / JSON user | Integrated |
| `/admin/registrations/pending`, verify, activate | Employee administration | Bearer, `CREATE_EMPLOYEE` | Backend-defined | JSON | Integrated; backend remains authority |
| `/admin/users/{id}/devices`, `/admin/devices/{id}/revoke` | Device lifecycle | Bearer, admin permissions | Revoke is backend fresh-auth | JSON | Client methods available; detail controls can be expanded without changing contract |
| `/admin/users/{id}/wallets`, activate/revoke | Wallet lifecycle | Bearer, admin/issuer permissions | Backend-defined | JSON; public wallet data only | Client methods available |
| `/admin/users/{id}/role`, `/grants` | Roles and grants | Bearer, admin permissions | Backend-defined | JSON | Client methods available; grant UI awaits documented request fields |
| `GET/POST /assets`, `GET /assets/{id}` | Asset registry | Bearer; create uses `REGISTER_ASSET` | No | JSON | Integrated |
| `POST /assets/{id}/transfer` | Asset detail | Bearer; RBAC including explicit engineer grant | `ASSET_TRANSFER`, resource id | JSON + `X-BEL-Fresh-Auth` | Integrated |
| `GET/POST /jobs`, `GET /jobs/{id}` | Maintenance list/detail | Bearer; create uses `CREATE_JOB` | No | JSON | Integrated |
| assign/start/complete/approve/reject job routes | Job detail | Bearer; shared RBAC and state machine | Approve/reject use `JOB_VERIFY`; resource id | JSON; completion selects backend evidence id | Integrated |
| `POST /jobs/{jobId}/evidence` | Job evidence | Bearer, `PERFORM_MAINTENANCE` | No | Multipart file; browser does not set boundary | Integrated |
| `GET /jobs/{jobId}/evidence` | Job evidence | Bearer, backend view permission | No | JSON metadata | Integrated |
| `GET /jobs/{jobId}/evidence/{evidenceId}` | Evidence download | Bearer, backend view permission | No | Authorized binary Blob download | Integrated |
| `GET /audit/assets/{id}` | Asset detail → audit | Bearer, `VIEW_AUDIT_HISTORY` | No | JSON; resource id comes from selected asset | Integrated; no hard-coded asset |
| `GET /blockchain/status`, validators, committee | Network status | Status public; validators/committee bearer + `VIEW_VALIDATOR_STATUS` | No | JSON real backend values | Integrated |
| `/admin/validators*` | Validator administration | Bearer, `MANAGE_VALIDATORS` | Add/remove/restore/cancel each use documented operation | JSON + fresh-auth header | Integrated; no prompt or fake keys |

## Explicit seams and limits

- The frozen `shared/api.ts` does not define evidence methods or `evidenceId` completion. The frontend uses a narrow transport adapter in `src/api/client.ts` for the already documented backend routes; it does not change or fork backend semantics.
- Device-wallet and platform-authenticator production adapters are deployment-owned. When no bridge is installed, the UI fails clearly and never falls back to a password, seed phrase, private key, or mock production session.
- No REST boundary is exposed for contract-only component attach/detach operations, so the frontend intentionally does not invent those controls.
- `501 NOT_IMPLEMENTED` responses are surfaced as unavailable backend capability; production code does not substitute mock data.

## Test coverage

The existing Vitest suite covers shell/session and component behavior with isolated fetch/bridge doubles. The client methods are written for a configurable real-backend suite using `BEL_FRONTEND_INTEGRATION_BASE_URL`; that suite should be enabled only when the backend and persistence services are running. Browser verification must use the real frontend/backend and a documented test device adapter where required.
