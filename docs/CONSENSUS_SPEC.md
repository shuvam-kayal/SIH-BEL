# Consensus Specification

**Status: Protocol decisions frozen for the current research/implementation baseline.**
This document records the resolved consensus design and the remaining explicitly open production items. Person 4 owns the consensus implementation.

## Frozen boundary

Every implementation must expose the same conceptual inputs and outputs:
- Input: active validator set, block height, proposal, round/timeout metadata.
- Output: selected leader, deterministic committee for the height/round, validator votes, quorum result, and finality status.
- Every honest node must derive the same committee for the same finalized selection seed.
- No application-level Solidity function may claim to change the underlying consensus protocol.

## 1. Validator pool and initial deployment

The chain is permissioned and uses an authorized validator population.
- N is the number of eligible validators in the authoritative consensus validator set.
- **Initial deployment requirement: N_initial >= 70.**
- The minimum committee size is 70, so deployments below 70 validators are outside the normal protocol operating assumptions.
- Committee membership does not itself add or remove a validator from the authorized consensus validator set.
- Validator admission/removal is a separate validator-set lifecycle concern and remains an explicit open integration item (see §10).

## 2. Leader selection

Leader selection is randomized and deterministic from protocol inputs.
For block height h and round r:
1. derive the round-selection input from the finalized selection seed and round context;
2. eligible validators evaluate the configured VRF;
3. the protocol deterministically maps the verified VRF result to a leader.

A failed leader does not cause a safety-rule change. The QBFT round-change mechanism advances to another round, whose leader is independently derived from the round-specific selection input.

No coordinator is required.

## 3. Randomness and selection seed

The current protocol uses the **previous finalized block hash plus frozen protocol context** as the public selection seed.

Conceptually:
    seed_h = H(H_(h-1)^final || context_h)

The seed is then used as input to the VRF-based committee and leader-selection procedures.

**Security limitation:** the previous finalized block hash is deterministic public entropy; it is **not claimed to be an unbiased, unpredictable, or bias-resistant randomness beacon**. A production deployment must evaluate the resulting grinding/bias assumptions and, if required, replace or augment this source with a stronger randomness mechanism.

The protocol design therefore separates:
- the randomness input/seed derivation (resolved for the current baseline), and
- the production cryptographic VRF backend (not yet production-complete).

The current implementation includes a deterministic/test VRF provider for reproducible testing. It must not be represented as a production RFC 9381 ECVRF implementation.

## 4. Committee selection

Committee selection occurs **for every block**.

Each eligible validator computes a VRF ticket from the block selection seed. The same validator set, seed, and protocol parameters therefore produce the same committee at every honest node.

Let:
    p_N = min(1, max(70/N, 0.0132))

and:
    K_raw ~ Binomial(N, p_N)

If K_raw < 70, the protocol selects the **70 smallest valid VRF tickets**. The normal deployment assumption is N >= 70.

The committee is a subset of the authoritative validator population. Committee selection does not modify that population.

## 5. Committee role

The selected committee participates in validation and BFT voting for the block. The protocol retains the existing QBFT safety/finality machinery rather than replacing BFT voting with application-level logic.

## 6. Quorum

For committee size K:
    Q = floor(2K/3) + 1

The corresponding Byzantine tolerance is:
    f = floor((K-1)/3)

and therefore:
    Q >= 2f + 1

The inequality is intentional; Q is not universally equal to 2f+1.

No quorum weakening is performed to compensate for offline or Byzantine validators.

## 7. Failure handling

### 7.1 Leader failure

If the selected leader is offline, times out, or fails to produce a valid proposal:
1. the round-change mechanism is triggered;
2. the protocol advances to the next round;
3. a new leader is selected using the round-specific randomized selection rule;
4. any previously prepared value required by QBFT round-change rules is preserved.

Leader failure does not alter the quorum threshold.

### 7.2 Validator failure

An offline validator contributes no vote. Byzantine validators may send invalid or conflicting messages, but the existing QBFT validation/evidence machinery rejects messages that violate the protocol rules.

The protocol retains safety as long as the committee remains within its Byzantine fault threshold and the underlying QBFT assumptions hold. Liveness may be affected when insufficient honest committee members are available to reach quorum.

### 7.3 Network partition

The protocol is safety-first: if a partition prevents the required quorum from forming, finality does not occur merely to preserve availability. The chain may temporarily halt rather than finalize conflicting blocks.

## 8. Finality

A block becomes final when the QBFT commit/finality conditions are satisfied by the required quorum:
    votes >= Q

with:
    Q = floor(2K/3) + 1

Finality is deterministic under the protocol assumptions; there is no probabilistic confirmation/reorganization window after the required finality evidence has been accepted.

## 9. Actual blockchain-client feasibility

The protocol is implemented against **Hyperledger Besu**, using its QBFT consensus architecture rather than attempting to implement a blockchain client from scratch.

The current integration has demonstrated:
- BEL-specific validator/committee provider plumbing;
- integration with the existing QBFT consensus machinery;
- bel_getCommittee exposure from the consensus-layer source of truth;
- compilation and relevant consensus tests;
- Byzantine evidence validation testing;
- a 4-node WSL infrastructure/P2P/RPC smoke environment.

The 4-node smoke environment is an infrastructure test; it does **not** by itself constitute proof of live multi-node finality for the complete dynamic committee protocol.

The implementation therefore establishes **blockchain-client feasibility**, while production completeness remains subject to the open items below.

## 10. Explicitly open production items

The following are intentionally not claimed as fully resolved:
1. **Validator admission/removal:** define the authoritative transaction/proposal mechanism, activation height, and removal semantics for changing the consensus validator population.
2. **Production VRF backend:** integrate and validate a production-grade RFC 9381-compatible ECVRF implementation; the deterministic test provider is not sufficient.
3. **Randomness robustness:** formally evaluate the bias/grinding properties of previous-block-hash-derived entropy and determine whether a stronger beacon is required.
4. **Large-scale evaluation:** benchmark full-validator QBFT versus committee-based QBFT and measure committee security, latency, communication, and failure recovery at larger N.
5. **Comprehensive live failure testing:** exercise leader timeout, equivocation, validator outage, network delay/partition, round changes, and finality recovery in a multi-node deployment.

## 11. Research positioning

This work should be described as an implementation/design of a **permissioned QBFT-based blockchain with VRF-based dynamic committee selection and randomized per-round leadership**, not as the invention of a new BFT primitive.

The principal engineering contribution is integrating the dynamic committee mechanism into a real blockchain client while retaining QBFT's established safety/finality machinery.