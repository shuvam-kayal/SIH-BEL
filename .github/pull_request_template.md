## What this changes

<!-- One or two sentences. Link the workflow from SYSTEM_SPEC.md or the
     endpoint from API_SPEC.yaml that this implements. -->

## Checklist

- [ ] Targets `dev`, not `main`
- [ ] Tests added or updated, and `npm test` passes locally
- [ ] `npm run typecheck` passes
- [ ] No change to `shared/`, `docs/API_SPEC.yaml`, `docs/CONTRACT_SPEC.md`,
      or `docs/RBAC_MATRIX.md` — **or** the change is called out below and
      has team agreement (Phase 2/3: these are frozen)
- [ ] New permission boundaries have a matching test that asserts the
      denial, not just the success path
- [ ] Anything sensitive stays off-chain; only hashes/references on-chain

## Frozen-interface changes

<!-- Delete if none. Otherwise: what changed, why it couldn't be avoided,
     and who agreed. Add an entry to docs/DECISIONS.md. -->

## Reviewer notes

<!-- Anything worth looking at closely, or known gaps left for later. -->
