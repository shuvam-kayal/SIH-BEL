# BEL consensus

The submitted consensus implementation lives in the nested `besu/` repository.
It is a hackathon prototype that integrates BEL committee and leader selection
with Besu QBFT. The protocol source of truth is [`docs/CONSENSUS_SPEC.md`](../docs/CONSENSUS_SPEC.md),
and the implementation status and reproducible launch workflow are documented in
[`docs/BESU_IMPLEMENTATION.md`](../docs/BESU_IMPLEMENTATION.md).

The outer `blockchain/` directory is intentionally not a runtime consensus
entrypoint. It contains only protocol-owned support and reference material and
is not used by the Besu build or demo.

## Frozen protocol summary

- The active validator population is normally `N >= 70`.
- A new committee is selected for every block from the previous finalized block
  hash, using the frozen probability rule `p_N = min(1, max(70/N, 0.0132))`.
- If fewer than 70 valid tickets are selected, the first 70 canonical tickets
  are used as the deterministic fallback.
- The leader is selected by deterministic hashing of the seed, height, round,
  and canonical committee encoding; no leader VRF is used.
- The voting flow is `PREPARE -> COMMIT -> FINAL` with
  `Q(K) = floor(2K/3) + 1`.
- Round change preserves the highest prepared value and certificate. A network
  partition never reduces quorum or forces finality.
- `DeterministicTestVrfProvider` is test-only. A production RFC 9381 backend is
  still blocked and the current implementation is not production-ready.

For the available commands, use the root README and
`docs/BESU_IMPLEMENTATION.md`. The Java/Besu integration is the submitted consensus implementation.