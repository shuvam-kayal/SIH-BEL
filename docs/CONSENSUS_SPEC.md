# Consensus Specification

**Status: Frozen protocol baseline; production hardening and evaluation gates remain explicitly listed at the end.**

## 1. Scope

This specification defines the permissioned BEL consensus architecture implemented at the Besu/QBFT boundary. It does not move consensus logic into Solidity or application services.

Inputs include the authorized validator population, block height, previous finalized block context, proposal and QBFT round state. Outputs include the block committee, round leader, prepare/commit votes, quorum status and finality.

## 2. Validator population

- `N` is the number of eligible validators in the authorized permissioned validator set.
- Normal deployment requires `N >= 70`.
- Validator admission/removal is an authorized-set operation and is distinct from committee membership.

## 3. Committee selection

A fresh committee is selected for every block.

```text
p_N = min(1, max(70/N, 0.0132))
K_raw ~ Binomial(N, p_N)
```

Each eligible validator evaluates the selection procedure independently.

If `K_raw >= 70`, the valid VRF-selected tickets determine the committee.

If fewer than 70 valid VRF tickets are available, the protocol selects the 70 smallest valid tickets in canonical `(vrfOutput, validatorId)` order. Normal deployment assumes enough eligible validators to satisfy the `N >= 70` requirement.

The resulting committee size is `K`. The committee is fixed across all QBFT rounds for the block.

## 4. Selection seed and randomness limitation

The selection seed is derived from the previous finalized block hash together with frozen protocol context.

This provides deterministic reconstruction by validators, but the previous-block hash is public and must **not** be described as a bias-resistant randomness beacon. The security argument therefore includes an explicit production gate for stronger randomness/VRF integration.

The production cryptographic requirement is an RFC 9381-compatible ECVRF backend. The deterministic provider used by tests is test-only.

## 5. Leader selection

Leader selection is randomized per QBFT round using the frozen `BEL-LEADER` rule. A separate leader VRF is not required by the frozen protocol.

The committee does not change merely because the round changes.

## 6. QBFT voting, quorum and finality

The committee participates in the normal QBFT proposal/prepare/commit lifecycle.

For committee size `K`:

```text
Q = floor(2K/3) + 1
f = floor((K-1)/3)
Q >= 2f + 1
```

`Q = 2f+1` is not asserted as a universal equality; the quorum formula above is authoritative.

A block becomes final only after valid commit evidence reaches the QBFT quorum. No application layer or RPC is permitted to weaken this threshold.

## 7. Failure and Byzantine handling

| Scenario | Behavior |
|---|---|
| Leader offline/fails | QBFT timeout and round change; committee remains unchanged |
| Committee member offline | No vote is counted; quorum does not adjust downward |
| Malicious/equivocating leader | Conflicting/invalid evidence is rejected by QBFT validation; normal safety rules apply |
| Conflicting prepare/commit | Invalid/conflicting evidence is rejected |
| Insufficient votes | Block does not finalize; protocol proceeds through QBFT round change |
| Network partition | Safety is preserved; a partition without quorum cannot finalize a conflicting block |

A valid prepared value is preserved across round change according to QBFT rules.

## 8. Implementation boundary

The implementation is a customized Hyperledger Besu/QBFT source tree.

The current integration includes:

- BEL committee provider wired into the Besu consensus context.
- `bel_getCommittee` RPC exposing the selected committee.
- QBFT validation and finality paths retained as the safety boundary.
- Dedicated Byzantine evidence validation tests.
- Successful Besu compilation/test/installDist validation.

The application backend consumes consensus data through its blockchain service seam; it must not reimplement committee selection.

## 9. Current validation status

A 4-node WSL deployment established node startup, RPC availability and P2P peer connectivity. That smoke run did not demonstrate live dynamic committee finality because block height remained at genesis. It is therefore infrastructure evidence, not finality evidence.

## 10. Production/research gates

1. Integrate and validate a production RFC 9381-compatible ECVRF implementation.
2. Define authoritative validator admission/removal and its synchronization with Besu.
3. Evaluate selection-beacon bias/grinding resistance.
4. Benchmark full-validator QBFT against committee-QBFT at larger `N`.
5. Run live leader-failure, offline-validator, equivocation and round-change/finality scenarios.
6. Freeze the authoritative validator address/public-key registry used by backend validator metadata. Application wallet public keys are not consensus validator keys.

## 11. Safety invariant

No integration change may reduce the QBFT quorum, bypass prepare/commit validation, or treat committee membership as equivalent to validator admission.
