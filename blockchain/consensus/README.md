# consensus/

Owner: Person 4.

The consensus implementation targets **Hyperledger Besu/QBFT**.

The frozen protocol is documented in docs/CONSENSUS_SPEC.md:

- authorized validator population with initial N >= 70;
- VRF-based committee selection every block;
- variable committee size with a minimum of 70;
- previous-finalized-block-hash-derived public selection seed;
- randomized per-round leader selection;
- QBFT PREPARE/COMMIT voting;
- quorum Q = floor(2K/3)+1;
- round change for leader failure;
- safety-first behavior when quorum cannot be formed;
- deterministic finality after the required commit quorum.

The committee is a subset of the authoritative validator set. Committee selection does not perform validator admission/removal.

The Besu integration has established blockchain-client feasibility through validator/committee provider plumbing, QBFT integration, build/tests, Byzantine evidence validation, and a 4-node infrastructure/P2P/RPC smoke environment.

The following remain explicitly open production items: validator admission/removal semantics, production RFC 9381-compatible VRF backend, randomness/grinding analysis, large-scale performance/security evaluation, and comprehensive live failure/finality testing.

The simulator under blockchain/simulator/ remains a research/benchmarking model and is not the production consensus implementation.