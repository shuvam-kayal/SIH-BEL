# Person 1 manual test plan

This is a development-only flow. Start PostgreSQL with `docker compose up -d postgres`, set `BEL_ENV=development`, `BEL_DEV_BOOTSTRAP=true`, and run `npm run bootstrap:dev`. Start the backend, then open [http://localhost:4000/docs](http://localhost:4000/docs).

1. `POST /auth/login` with `{ "deviceCredential": "dev-admin-001" }`; expect `200` and copy `token`.
2. Click Swagger **Authorize** and enter `Bearer <token>`.
3. `POST /admin/users` with `{ "employeeId": "ENG-001", "fullName": "Engineer", "role": "ENGINEER", "department": "MAINTENANCE" }`; expect `201` and server-generated `identityId`.
4. Register a device with `POST /admin/users/ENG-001/devices`, then register and activate its wallet. Expect `201` for each.
5. Repeat provisioning/device/wallet setup for MANAGER and TECHNICIAN identities.
6. Log in with each device credential and verify `GET /users/me` returns the server-side role and identity.
7. Exercise a permitted endpoint and a denied endpoint; expected failures are structured `403` responses.
8. Create an AUTH grant with `POST /admin/users/{id}/grants`; verify the protected resource fails without it and succeeds only when the resource supplies the matching grant context.
9. Revoke the grant and verify it fails again. Expired grants must fail too.
10. Revoke the wallet, reuse its previous bearer token, and verify the request fails. Revoke the device and verify its credential fails.
11. Register/activate a replacement wallet/device. Log in again and confirm the `identityId` is unchanged while the old wallet/device remain revoked.
12. Restart the backend. With the PostgreSQL repository enabled, repeat `GET /users/{id}` and login to verify persistence.

Failure meanings: `401` means missing/invalid/expired authentication, `403` means inactive state or insufficient permission, `404` means an unknown identity/device/wallet/grant, `409` means a duplicate or invalid lifecycle transition, and `400` means malformed input.

The current default test suite uses the in-memory repository and MockBlockchainAdapter. Hardware-backed device attestation and the production Prisma adapter remain deployment work; the repository ports are the integration seam.
