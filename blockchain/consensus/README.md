# consensus/

Owner: Person 4.

The production consensus boundary is a customized Hyperledger Besu/QBFT implementation. The Python simulator under `blockchain/simulator/` is for research, probability checks and benchmarking; it is not the source of consensus behavior.

## Frozen consensus baseline

### Validator population

- `N) is the authorized permissioned validator population.
- Normal deployment requires `N >= 70`.
- Validator admission/removal remains an explicit operational/configuration concern; committee membership is not validator admission.

### Committee selection

Every block derives a new committee from the active validator population.

```text
p_N = min(1, max(70/N, 0.0132))
K_raw ~ Binomial(N, p_N)
```

If `K_raw < 70`, the protocol selects the 70 smallest valid VRF tickets. Ordering is canonical by `(vrfOutput, validatorId)`. The selected committee is fixed for all QBFT rounds of that block.

The selection seed is derived from the previous finalized block hash plus frozen context. It is deterministic and publicly reconstructable, but it is not documented as a bias-resistant randomness beacon; production randomness quality is a remaining research/security gate.

### Leadership and QBFT

- Each round uses the frozen randomized `BEL-LEADER` rule.
- A failed/offline leader triggers the existing QBFT round-change path.
- Round change does not reselect the committee.
- A valid prepared value is preserved across round change according to QBFT rules.
- Finality requires a valid commit quorum.
- For committee size `K`:

```text
Q = floor(2K/3) + 1
f = floor((K-1)/3)
Q >= 2f + 1
```

The equality is not universal; the quorum formula is the authoritative rule.

Offline validators do not count toward quorum. Invalid, conflicting or malformed Byzantine evidence is rejected through the existing QBFT validation path rather than by weakening the threshold.

## Besu integration evidence

The current Besu work includes:

- `bel_getCommittee` wired through the consensus context to the actual BEL validator provider.
- Dedicated consensus tests.
- Byzantine evidence validation coverage.
- Successful Besu compile/test/installDist checks on JDK 21.
- A 4-node WSL smoke deployment proving process startup, RPC and P2P peer connectivity.

The 4-node smoke test did **not** prove live dynamic committee finality: the nodes remained at genesis height during that smoke run. Do not describe it as a finality proof.

## Production gates

The remaining gates are:

1. Integrate a production RFC 9381-compatible ECVRF backend; the deterministic provider is test-only.
2. Define and enforce authoritative validator admission/removal.
3. Validate randomness robustness and grinding/bias resistance of the selection beacon.
4. Run larger-scale committee/security/latency/message-volume experiments.
5. Exercise live leader failure, offline validators, equivocation and round-change/finality behavior on a running multi-node deployment.
6. Freeze the validator public-key/identity registry used by backend validator metadata; application wallet keys are a separate trust domain.

Changes to the Besu consensus implementation must preserve QBFT safety, quorum and finality semantics.
