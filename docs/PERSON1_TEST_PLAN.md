# Person 1 test plan

PostgreSQL is BEL's internal, mutable operational database. The frontend never connects to it; browser traffic goes to the backend only. Security-critical state transitions also produce SHA-256 commitments through an injectable integrity adapter. The permissioned blockchain is the external tamper-evident history anchor; PostgreSQL itself is not immutable.

## A. Fast unit tests (in-memory repositories)

Run `npm test`. These tests inject the in-memory repository implementations and `MemoryIntegrityAdapter`, so they do not require PostgreSQL. They cover the bearer lifecycle, current-state revalidation, every frozen RBAC role/action cell, grant validation, credential/token exclusion from commitments, deterministic hashes, and mock adapter injection.

## B. PostgreSQL integration tests

Start the BEL-controlled database with `docker compose up -d postgres`, set `DATABASE_URL`, run `npm run db:migrate`, then run `npm run test:integration`. The command fails clearly when PostgreSQL is unavailable and never falls back to memory.

The integration test proves:

CREATE → PostgreSQL → backend/container restart → records still exist

It creates an identity, device, hashed credential, pending wallet, active wallet, and session; logs in before and after the restart; and verifies persisted wallet/device revocation, role changes, grant creation/revocation, and old-credential rejection. The development bootstrap follows this same Prisma repository path and requires `BEL_ENV=development`, `BEL_DEV_BOOTSTRAP=true`, and `DATABASE_URL`.

## C. Swagger manual test

Start the backend after migration, then open `/docs` and use **Authorize** with `Bearer <token>`.

1. Run the development bootstrap and log in the admin.
2. Create an employee, register a device, register a wallet, and activate it.
3. Log in as the employee and call `GET /users/me`.
4. Exercise one allowed and one forbidden operation.
5. Change the role; create, validate, and revoke an authorization grant.
6. Revoke the wallet and verify the old token is rejected.
7. Revoke the device and verify its old credential/token is rejected.
8. Register replacement device and wallet; confirm the identity ID is unchanged.
9. Restart the backend and repeat identity lookup and login.
10. Confirm each relevant security-critical mutation generated an integrity commitment.

There is no public signup, no client-selected actor identity/wallet, and `x-bel-*` headers do not establish identity. Roles and identity come from the authenticated server-side session.

## D. Database integrity verification

Use an isolated test database, never production:

1. Create or mutate an identity, device, wallet, role, or grant.
2. Capture the commitment emitted by the mock/blockchain integrity adapter.
3. Recompute SHA-256 over the same minimum canonical state and verify the hash matches.
4. Modify the PostgreSQL record in a controlled test transaction.
5. Recompute the hash and show `INTEGRITY OK` becomes `TAMPERING DETECTED`.

Commitments contain state hashes and minimum event metadata, not plaintext credentials, session tokens, private keys, or sensitive documents. The check detects divergence from a committed state/event history; it does not identify the attacker and does not replace database access controls, logging, backups, or administrator security. A later implementation should persist the monotonic event sequence with the external chain anchor so rollback to an older valid state is detectable.

## Environment

Required for the real backend: `DATABASE_URL`, `BEL_ENV`, and optionally `BEL_SESSION_TTL_SECONDS`. Development bootstrap additionally requires `BEL_DEV_BOOTSTRAP=true` and optionally `BEL_BOOTSTRAP_CREDENTIAL`. PostgreSQL remains an internal BEL service and must not be exposed through frontend configuration.
