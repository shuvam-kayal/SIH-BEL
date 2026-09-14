# node/

Owner: Person 4.

The node process: block production loop, mempool, state storage, RPC
surface consumed by `backend/src/adapters/BlockchainService.ts`.

Blocked on the Phase 8 client decision — a node built on a framework
that doesn't expose its consensus layer would have to be thrown away.
