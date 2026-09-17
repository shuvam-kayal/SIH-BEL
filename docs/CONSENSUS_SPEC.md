# BEL Permissioned Blockchain
## VRF-Based Committee BFT Consensus Specification

**Document:** `docs/CONSENSUS_SPEC.md`  
**Status:** Protocol Design Specification  
**Version:** 1.0  
**Scope:** Consensus, committee selection, block verification, voting, finality, and round change  
**Primary implementation target:** Hyperledger Besu-based permissioned network

---

## Abstract

This document specifies a Byzantine fault-tolerant consensus protocol for the BEL permissioned blockchain. The protocol separates **validator eligibility**, **committee selection**, **leader selection**, **block validation**, **voting**, and **finality** into explicit protocol stages.

For each block height, the active validator population performs VRF-based cryptographic sortition to derive a verification committee. Committee membership is probabilistic and therefore varies between blocks. A target expected committee size is configured rather than a fixed committee size. A deterministic minimum committee rule prevents the protocol from operating with an undersized committee.

Within a committee, a leader is selected pseudorandomly for each consensus round using a domain-separated VRF. The selected leader proposes a block. Committee members independently verify the proposal and participate in a two-phase voting process consisting of PREPARE and COMMIT. A block is final once a strict two-thirds quorum of distinct committee members produces valid COMMIT signatures. When progress fails, the protocol enters a round-change procedure; the committee remains unchanged for the current block height while the leader is replaced.

The protocol is intended to provide safety against Byzantine behavior under the standard \(n \ge 3f+1\) committee model, subject to the explicit assumptions stated in this document. It also explicitly identifies an important limitation: deriving the VRF input solely from the previous finalized block hash does not constitute a bias-resistant distributed randomness beacon. The current mechanism is therefore specified as deterministic, verifiable, and pseudorandom, but not as cryptographically unbiased against a block-grinding adversary.

---

# 1. Protocol Objectives

The consensus protocol has five primary objectives:

1. **Safety:** honest nodes must not finalize conflicting blocks at the same height under the stated fault assumptions.
2. **Liveness:** under eventual network synchrony and an adequately participating committee, a valid block should eventually become final.
3. **Verifiability:** committee membership, leader eligibility, proposals, votes, and finality certificates must be independently verifiable.
4. **Committee efficiency:** only a committee, rather than the full validator set, participates in block-level consensus voting.
5. **Deterministic state transition:** all honest nodes must derive the same committee, leader, quorum threshold, and finality result from the same protocol state.

The protocol does **not** assume that VRF selection alone provides consensus or finality. VRF-based selection is the eligibility layer; BFT voting is the agreement layer.

---

# 2. System Model

## 2.1 Validator population

For block height \(h\), let the active validator set be

\[
V_h = \{v_1,v_2,\ldots,v_N\},
\]

where \(N = |V_h|\).

Each validator \(v_i\) possesses:

- a consensus identity,
- a public verification key,
- a private signing key,
- a registered VRF public key \(pk_i^{\mathrm{VRF}}\),
- a corresponding VRF secret key \(sk_i^{\mathrm{VRF}}\),
- a network identity.

Validator-set membership is permissioned. A validator is eligible for consensus only if it belongs to the active validator set for the current block height.

### Validator-set transition rule

The validator set used to finalize block \(h\) is the set determined at the end of block \(h-1\). A validator-set update included in block \(h\) therefore becomes effective beginning with block \(h+1\).

This avoids circular dependence between the block being finalized and the validator set used to finalize that block.

---

# 3. Fault Model

The committee protocol assumes a Byzantine adversary.

A Byzantine validator may behave arbitrarily, including:

- remaining silent,
- sending malformed messages,
- sending conflicting messages,
- sending an invalid proposal,
- sending delayed messages,
- selectively withholding messages,
- issuing conflicting votes.

The adversary is assumed **not** to be able to:

- forge another validator's digital signature,
- forge another validator's VRF proof,
- obtain another validator's private signing or VRF key,
- alter a finalized block without invalidating its cryptographic commitments.

The protocol does not attempt to prevent denial-of-service attacks at the network layer; it only specifies consensus behavior when such failures occur.

---

# 4. Byzantine Fault Threshold

Let the committee for height \(h\) be \(C_h\), with

\[
K_h = |C_h|.
\]

The protocol uses the standard BFT resilience bound

\[
f_h = \left\lfloor \frac{K_h-1}{3} \right\rfloor.
\]

Consequently, a committee provides the standard \(3f+1\) resilience only when

\[
K_h \ge 3f_h+1.
\]

The protocol defines a minimum committee size

\[
K_{\min}=4,
\]

so that the smallest normal committee tolerates at least one Byzantine member.

For example:

| \(K\) | \(f=\lfloor(K-1)/3\rfloor\) | Quorum \(Q\) |
|---:|---:|---:|
| 4 | 1 | 3 |
| 5 | 1 | 4 |
| 6 | 1 | 5 |
| 7 | 2 | 5 |
| 8 | 2 | 6 |
| 10 | 3 | 7 |
| 13 | 4 | 9 |

---

# 5. Network Model

The protocol assumes a **partially synchronous** network.

Before an unknown stabilization time, communication may exhibit arbitrary but finite delays, message loss, duplication, reordering, or node unavailability.

After stabilization, there exists a finite bound \(\Delta\) such that messages between honest nodes are eventually delivered within a bounded time and honest validators process messages within bounded time.

Safety must remain valid during periods of arbitrary delay.

Liveness is guaranteed only after the network satisfies the eventual-synchrony assumption and the committee contains sufficient honest, participating validators.

---

# 6. Cryptographic Primitives

The protocol requires:

- a collision-resistant cryptographic hash function \(H\),
- a secure digital-signature scheme,
- a verifiable random function (VRF).

A VRF is modeled as

\[
\operatorname{VRF.Prove}(sk,\alpha)
    \rightarrow (\beta,\pi),
\]

where:

- \(sk\) is the secret key,
- \(\alpha\) is the public input,
- \(\beta\) is the pseudorandom output,
- \(\pi\) is the proof.

Verification is represented as

\[
\operatorname{VRF.Verify}(pk,\alpha,\beta,\pi)
    \rightarrow \{0,1\}.
\]

The implementation should use a standardized and well-tested ECVRF construction, preferably one conforming to RFC 9381.

The exact VRF ciphersuite, byte encoding, output length, and proof encoding must be fixed as network protocol parameters before interoperability testing.

The protocol does not define a novel cryptographic primitive.

---

# 7. Protocol Notation

| Symbol | Meaning |
|---|---|
| \(h\) | Block height |
| \(r\) | Consensus round |
| \(V_h\) | Active validator set at height \(h\) |
| \(N\) | \(|V_h|\) |
| \(C_h\) | Committee at height \(h\) |
| \(K_h\) | \(|C_h|\) |
| \(K_{\mathrm{target}}\) | Target expected committee size |
| \(K_{\min}\) | Minimum committee size |
| \(f_h\) | Byzantine tolerance of \(C_h\) |
| \(Q_h\) | Quorum threshold |
| \(B_h\) | Candidate block at height \(h\) |
| \(H(B_h)\) | Hash of \(B_h\) |
| \(S_h\) | VRF seed for height \(h\) |
| \(L_{h,r}\) | Leader for height \(h\), round \(r\) |

---

# 8. Seed Derivation

For every block height \(h>0\), the protocol derives a deterministic seed from the previous finalized block:

\[
S_h =
H\left(
\texttt{"BEL-COMMITTEE-SEED"}
\parallel
H(B_{h-1})
\parallel
\operatorname{enc}(h)
\parallel
\operatorname{enc}(\mathrm{chainID})
\right).
\]

The domain-separation string is protocol-defined and prevents this input from being accidentally reused by another cryptographic role.

All honest nodes therefore derive the same \(S_h\) from the same finalized chain prefix.

## 8.1 Security limitation of the seed

The previous finalized block hash is **not assumed to be an unbiased randomness beacon**.

If an adversarial proposer can evaluate multiple candidate blocks and influence which valid candidate becomes finalized, the resulting block hash may be partially manipulable. Therefore:

\[
S_h = H(B_{h-1})
\]

provides deterministic and publicly reproducible pseudorandomness, but does not by itself prove unpredictability or bias resistance.

The protocol therefore makes the following distinction:

\[
\boxed{
\text{VRF verification} \neq \text{bias-resistant randomness beacon}
}
\]

A future production version may replace the seed source with a threshold-randomness or distributed-randomness construction without changing the remainder of the committee-selection interface.

---

# 9. Variable-Size VRF Committee Selection

## 9.1 Design goal

The protocol does not require exactly \(K\) committee members.

Instead, a target expected committee size \(K_{\mathrm{target}}\) is configured. Every validator independently performs VRF-based sortition.

The resulting committee size is therefore a random variable.

Let

\[
p_h =
\min\left(1,\frac{K_{\mathrm{target}}}{N}\right).
\]

For validator \(v_i\), define the domain-separated VRF input

\[
\alpha_{i,h}^{\mathrm{com}}
=
H\left(
\texttt{"BEL-COMMITTEE-VRF"}
\parallel
S_h
\parallel
\operatorname{enc}(h)
\parallel
\operatorname{enc}(v_i)
\right).
\]

The validator computes

\[
(\beta_{i,h},\pi_{i,h})
=
\operatorname{VRF.Prove}(sk_i^{\mathrm{VRF}},\alpha_{i,h}^{\mathrm{com}}).
\]

The output \(\beta_{i,h}\) is interpreted as a uniformly distributed \(L\)-bit integer

\[
x_{i,h}\in\{0,\ldots,2^L-1\}.
\]

Normalize it as

\[
u_{i,h}=\frac{x_{i,h}}{2^L},
\]

so that \(u_{i,h}\in[0,1)\).

Validator \(v_i\) is a primary committee candidate iff

\[
u_{i,h}<p_h.
\]

---

# 10. Committee-Size Distribution

Assuming independent, unbiased VRF outputs, the number of primary-selected validators satisfies approximately

\[
K_h^{\mathrm{raw}}
\sim
\operatorname{Binomial}(N,p_h).
\]

Its expectation is

\[
\mathbb{E}[K_h^{\mathrm{raw}}]
=
Np_h.
\]

When \(K_{\mathrm{target}}\le N\),

\[
\mathbb{E}[K_h^{\mathrm{raw}}]
=
K_{\mathrm{target}}.
\]

The variance is

\[
\operatorname{Var}(K_h^{\mathrm{raw}})
=
Np_h(1-p_h).
\]

Therefore the committee size varies naturally between block heights.

---

# 11. Minimum Committee Rule

The BFT layer requires a committee large enough to support the stated fault model.

Let

\[
K_{\min}=4.
\]

If

\[
K_h^{\mathrm{raw}} \ge K_{\min},
\]

then

\[
C_h=C_h^{\mathrm{raw}}.
\]

If

\[
K_h^{\mathrm{raw}} < K_{\min},
\]

the protocol activates the deterministic fallback:

1. All valid VRF outputs for the active validator set are ordered lexicographically by \((\beta_{i,h},v_i)\).
2. The first \(K_{\min}\) validators are selected.
3. Their VRF proofs constitute the membership evidence for the committee.

Thus

\[
K_h \ge K_{\min}.
\]

The fallback is deterministic and does not depend on proposer preference.

## 11.1 Implementation implication

For this MVP design, the complete set of validator VRF tickets must be available, directly or through a protocol-level equivalent, so that every node can independently verify both:

- threshold eligibility, and
- the minimum-size fallback.

This introduces communication overhead at committee-selection time even though only committee members participate in BFT voting. An optimized implementation may later replace full ticket dissemination with a more compact cryptographic selection certificate.

---

# 12. Optional Maximum Committee Size

A deployment may define

\[
K_{\max}.
\]

If

\[
K_h^{\mathrm{raw}}>K_{\max},
\]

the committee may be truncated to the \(K_{\max}\) smallest valid VRF outputs under the ordering

\[
(\beta_{i,h},v_i).
\]

No \(K_{\max}\) is mandated for the first implementation. It should be introduced only after empirical communication measurements show that large committees are problematic.

---

# 13. Committee Determinism

For fixed:

- validator set \(V_h\),
- seed \(S_h\),
- target probability \(p_h\),
- VRF ciphersuite,
- validator identities,
- VRF records,

all honest nodes MUST compute the same ordered committee:

\[
C_h = \operatorname{Committee}(V_h,S_h).
\]

Committee-member ordering is part of the protocol state.

Any discrepancy between two honest nodes' committee derivations is a protocol-implementation error.

---

# 14. Committee Rotation

Committee selection occurs **once per block height**.

The committee \(C_h\) is fixed for all rounds

\[
r=0,1,2,\ldots
\]

of height \(h\).

A round change changes the leader but **does not change the committee**.

After block \(h\) is finalized, the protocol advances to height \(h+1\) and derives

\[
C_{h+1}
\]

from the newly finalized block.

This distinction is critical:

\[
\boxed{
\text{new block} \Rightarrow \text{new committee}
}
\]

whereas

\[
\boxed{
\text{new round} \Rightarrow \text{same committee, new leader}
}
\]

---

# 15. Random Leader Selection

For every round \(r\), leader selection uses a second, domain-separated VRF process.

For committee member \(v_i\in C_h\), define

\[
\alpha_{i,h,r}^{\mathrm{leader}}
=
H\left(
\texttt{"BEL-LEADER-VRF"}
\parallel
S_h
\parallel
\operatorname{enc}(h)
\parallel
\operatorname{enc}(r)
\parallel
\operatorname{enc}(v_i)
\right).
\]

Each committee member evaluates

\[
(\gamma_{i,h,r},\rho_{i,h,r})
=
\operatorname{VRF.Prove}(sk_i^{\mathrm{VRF}},
\alpha_{i,h,r}^{\mathrm{leader}}).
\]

The leader is defined as

\[
L_{h,r}
=
\arg\min_{v_i\in C_h}
\left(\gamma_{i,h,r},v_i\right),
\]

using lexicographic ordering to resolve ties.

Thus all honest committee members derive the same leader.

The leader MUST provide a valid leader-selection proof with its proposal.

---

# 16. Properties of Leader Selection

The leader-selection function is:

- deterministic given protocol state,
- pseudorandom with respect to the VRF,
- restricted to current committee members.

A round change therefore produces a new candidate leader without changing committee membership.

---

# 17. Consensus State

Each consensus participant maintains the following logical state:

```text
height
round
validator_set
committee
leader
proposal
prepared_round
prepared_block_hash
prepare_certificate
commit_certificate
round_change_certificate
finalized
```

The local state transition is deterministic with respect to accepted protocol messages.

---

# 18. Consensus Phases

Consensus for \((h,r)\) proceeds through the following logical phases:

\[
\text{PROPOSE}
\rightarrow
\text{PREPARE}
\rightarrow
\text{COMMIT}
\rightarrow
\text{FINALIZE}.
\]

If progress fails:

\[
\text{current round}
\rightarrow
\text{ROUND\_CHANGE}
\rightarrow
\text{next round}.
\]

The protocol permits only the currently selected leader to issue the proposal for a given \((h,r)\).

---

# 19. Proposal Construction

The leader \(L_{h,r}\) constructs candidate block \(B_h\).

The proposal must contain, directly or by canonical reference:

- block header,
- block body or transaction commitments,
- parent block hash,
- block height,
- round,
- proposer identity,
- proposer signature,
- leader VRF proof,
- sufficient committee-selection evidence,
- round-change evidence if \(r>0\).

The exact block serialization is delegated to the underlying blockchain implementation, but all consensus-significant fields must have a canonical representation.

---

# 20. Block Verification

A committee validator MUST verify a proposal before issuing PREPARE.

Verification is partitioned into four categories.

## 20.1 Structural verification

The validator checks:

\[
\operatorname{height}(B_h)=h
\]

and


\[
\operatorname{parentHash}(B_h)=H(B_{h-1}).
\]

It also checks canonical encoding and required block-header invariants.

## 20.2 Leader verification

The validator checks:

1. the proposer belongs to \(C_h\);
2. the proposer equals \(L_{h,r}\);
3. the leader VRF proof is valid;
4. the leader-selection output is the expected minimum;
5. the proposal signature is valid.

## 20.3 Committee verification

The validator checks:

1. \(C_h\) is derived from the active validator set;
2. every committee member has valid selection evidence;
3. the committee-size rule is satisfied;
4. the committee is ordered deterministically;
5. no validator occurs twice.

## 20.4 Execution/block validity

The underlying execution layer verifies all applicable blockchain rules, including transaction validity and state-transition correctness.

A consensus vote does not override an execution-layer failure.

---

# 21. PREPARE Phase

If a validator accepts a proposal, it MAY broadcast

\[
\operatorname{PREPARE}(h,r,H(B_h)).
\]

A PREPARE message contains:

```text
type
height
round
block_hash
validator_id
signature
```

An honest validator MUST NOT issue two different PREPARE votes for the same \((h,r)\).

For block hashes \(X\neq Y\),

\[
\operatorname{PREPARE}(h,r,X)
\land
\operatorname{PREPARE}(h,r,Y)
\]

constitutes equivocation.

---

# 22. Prepare Certificate

A PREPARE certificate is a tuple

\[
PC(h,r,X)
\]

consisting of at least \(Q_h\) distinct valid PREPARE signatures for block hash \(X\).

The protocol defines:

\[
f_h=
\left\lfloor \frac{K_h-1}{3}\right\rfloor
\]

and

\[
Q_h=
\left\lfloor\frac{2K_h}{3}\right\rfloor+1.
\]

A validator becomes **prepared** only after possessing a valid PREPARE certificate.

It records:

\[
preparedRound=r
\]

and

\[
preparedBlockHash=X.
\]

---

# 23. Commit Phase

Once prepared, the validator broadcasts

\[
\operatorname{COMMIT}(h,r,X).
\]

A COMMIT message contains:

```text
type
height
round
block_hash
validator_id
signature
```

An honest validator MUST NOT commit conflicting block hashes at the same height in a way that would violate the protocol's safety state machine.

---

# 24. Quorum Definition

For committee size \(K_h\), quorum is

\[
Q_h=
\left\lfloor\frac{2K_h}{3}\right\rfloor+1.
\]

Equivalently, quorum is the smallest integer strictly greater than \(2K_h/3\).

The following are required for a vote to count:

1. the signature is valid;
2. the signer belongs to \(C_h\);
3. the vote has the expected height;
4. the vote has the expected round;
5. the vote refers to the expected block hash;
6. the signer has not already been counted in that certificate.

Duplicate signatures from one validator count once.

---

# 25. Quorum Intersection and Safety

For a committee satisfying the standard BFT bound, any two quorums have a non-empty honest intersection.

For the canonical case

\[
K_h=3f_h+1,
\]

and

\[
Q_h=2f_h+1,
\]

two quorums intersect in at least

\[
(2f_h+1)+(2f_h+1)-(3f_h+1)
=
f_h+1
\]

validators.

At most \(f_h\) of these can be Byzantine, so at least one intersection member is honest.

Because an honest validator does not support conflicting decisions in the same protocol instance, two conflicting commit certificates cannot both exist under the stated assumptions.

For committee sizes where the implementation's integer quorum differs from exactly \(2f+1\), the implementation MUST validate the corresponding quorum-intersection property explicitly rather than assuming it from the notation.

---

# 26. Finality

A block \(B_h\) is **finalized** when a valid COMMIT certificate

\[
CC(h,r,H(B_h))
\]

contains at least \(Q_h\) distinct valid COMMIT signatures.

Formally,

\[
\operatorname{Finalize}(B_h)
\iff
\left|
\operatorname{ValidCommitSigners}(h,r,H(B_h))
\right|
\ge Q_h.
\]

Finality is deterministic rather than probabilistic.

A node possessing a valid finality certificate may advance to height \(h+1\), subject to normal block-state processing.

---

# 27. Finality Certificate

A finality certificate contains at least:

```text
height
round
block_hash
committee derivation context
distinct commit signatures
```

A non-committee node can independently verify:

1. the block;
2. the validator set;
3. the committee derivation;
4. every signer;
5. every signature;
6. the quorum count.

Consequently, finality is externally verifiable and does not require a non-committee node to blindly trust the committee.

---

# 28. Round Change

Round change provides liveness when the current round does not progress.

A node enters ROUND_CHANGE when any of the following occurs:

- proposal timeout,
- invalid leader proposal,
- prepare timeout,
- commit timeout,
- leader unavailability,
- persistent failure to reach quorum.

The round changes from \(r\) to \(r+1\).

The committee remains \(C_h\).

Only the leader changes.

---

# 29. Timeout Function

The initial implementation may use a capped exponential timeout:

\[
T_r =
\min(T_{\max},
T_0 2^r).
\]

Here:

- \(T_0\) is the base timeout,
- \(T_{\max}\) is the upper bound.

These are deployment parameters, not protocol constants.

They should be calibrated experimentally against observed network latency and block-execution time.

---

# 30. ROUND_CHANGE Message

A round-change message contains:

```text
type = ROUND_CHANGE
height
new_round
validator_id
prepared_round (nullable)
prepared_block_hash (nullable)
prepared_certificate (nullable)
signature
```

If the sender has no prepared block, the prepared fields are absent.

If the sender has a prepared block, sufficient evidence to verify that prepared state is included or referenced.

---

# 31. Round-Change Certificate

For round \(r+1\), a node may enter the new round after obtaining at least

\[
Q_h
\]

valid ROUND_CHANGE messages for that new round.

These messages form a round-change certificate:

\[
RC(h,r+1).
\]

The certificate proves that a quorum of the current committee has abandoned progress in the old round and is prepared to enter the new round.

---

# 32. Prepared-Value Preservation

Round change must preserve safety.

Suppose a quorum of validators had already prepared block \(X\) at round \(r\).

A higher-round leader MUST NOT simply propose an arbitrary different block \(Y\).

After collecting a quorum of ROUND_CHANGE messages, the new leader finds the maximum prepared round represented in the certificate.

If at least one valid prepared certificate exists for the highest prepared round, the leader MUST re-propose that block.

If no prepared certificate is represented, the new leader may propose a fresh valid block.

Thus, for a valid prepared certificate \(PC(h,r_p,X)\), a higher-round proposal must preserve \(X\) according to the protocol's round-change evidence rules.

---

# 33. Round-Change Example

Consider

\[
C_h=\{A,B,C,D,E,F,G\}
\]

so that

\[
K_h=7,\qquad
f_h=2,\qquad
Q_h=5.
\]

Assume

\[
L_{h,0}=C.
\]

If \(C\) fails to produce a valid proposal before timeout, validators broadcast

\[
ROUND\_CHANGE(h,1).
\]

After five valid round-change messages have been collected,

\[
|RC(h,1)|=5=Q_h,
\]

the committee enters round 1.

The leader is recalculated as

\[
L_{h,1}.
\]

If no block was prepared in round 0, the new leader may propose a fresh block.

If block \(X\) had already obtained a valid prepare certificate in round 0, the new leader must carry \(X\) forward.

---

# 34. Consensus Safety Invariant

The central safety invariant is:

> For a fixed block height \(h\), there cannot exist two valid finality certificates for two different block hashes, assuming the active committee satisfies the Byzantine fault bound and honest validators follow the protocol.

Formally, for honest nodes \(A\) and \(B\),

\[
Finalize_A(h,X)
\land
Finalize_B(h,Y)
\Rightarrow
X=Y.
\]

This invariant must be tested explicitly in the simulator and in the Besu integration test network.

---

# 35. Consensus Liveness Property

The intended liveness property is:

> If the network eventually satisfies the assumed synchrony bound, at most \(f_h\) committee members are Byzantine/non-participating, and protocol messages continue to be delivered, repeated round changes eventually reach a round with a functioning honest leader and produce a finality certificate.

Liveness is not claimed under permanent network partition or when more than the assumed number of committee members fail.

---

# 36. Committee-Level Security

The BFT bound applies to the **selected committee**, not automatically to the entire validator population.

Suppose:

- \(N\) total validators,
- \(M\) Byzantine validators,
- committee size \(K\).

The dangerous event is

\[
X > f
\]

where \(X\) is the number of Byzantine validators selected.

For exact-size sampling without replacement, the probability is described by the hypergeometric distribution:

\[
P(X=j)
=
\frac{
\binom{M}{j}
\binom{N-M}{K-j}
}{
\binom{N}{K}
}.
\]

The unsafe-committee probability is

\[
P_{\mathrm{unsafe}}
=
P(X>f).
\]

For the variable-size VRF design, committee size itself is random, so the complete safety analysis conditions on committee size:

\[
P_{\mathrm{unsafe}}
=
\sum_{k}
P(K_h=k)
P\left(X>\left\lfloor\frac{k-1}{3}\right\rfloor\middle|K_h=k\right).
\]

This quantity must be measured for realistic validator populations and Byzantine fractions.

---

# 37. Important Consequence of Variable Committee Size

The variable-size design creates a trade-off.

A smaller committee reduces:

- consensus messages,
- signature verification work,
- bandwidth,
- expected consensus latency.

However, a smaller committee generally increases the probability that the committee contains too many Byzantine validators.

Therefore \(K_{\mathrm{target}}\) MUST NOT be selected solely from a performance perspective.

The target committee size must be justified jointly by

\[
\text{security probability}
\quad+
\text{latency}
\quad+
\text{communication cost}
\quad+
\text{validator population}.
\]

---

# 38. VRF Security and Seed Security Are Separate

The protocol relies on two distinct properties.

### VRF correctness

Given a fixed input, an honest verifier can determine whether an output/proof pair was legitimately produced by a validator's VRF key.

### Seed quality

The input seed should ideally be difficult for an adversary to predict or bias before the selection is determined.

These are different requirements:

\[
\boxed{
\text{secure VRF}
\not\Rightarrow
\text{secure randomness beacon}
}
\]

The current protocol provides the former and only a limited form of the latter.

This distinction is mandatory in security analysis and project presentations.

---

# 39. Equivocation Handling

If validator \(v_i\) produces

\[
PREPARE(h,r,X)
\]

and

\[
PREPARE(h,r,Y)
\quad (X\neq Y),
\]

the pair of signed messages constitutes cryptographic evidence of equivocation.

The same applies to conflicting COMMIT messages.

The consensus layer MUST:

- detect the evidence,
- retain the signed messages,
- prevent conflicting messages from being counted toward the same honest certificate.

The protocol does not define slashing or economic penalties.

---

# 40. Replay Protection

Every consensus message is bound to:

- block height,
- round,
- message type,
- block hash where applicable,
- validator identity.

Therefore a valid message from height \(h\) or round \(r\) cannot be reused as a vote for a different protocol instance.

Messages with stale heights or rounds MUST be ignored.

---

# 41. Deterministic Ordering

Whenever multiple valid records must be ordered, the protocol uses a canonical tuple.

For committee selection:

\[
(\beta_{i,h},v_i).
\]

For leader selection:

\[
(\gamma_{i,h,r},v_i).
\]

The validator identifier acts as a deterministic tie breaker.

This avoids implementation-dependent ordering caused by:

- network arrival order,
- hash-map iteration order,
- thread scheduling,
- locale-specific sorting.

---

# 42. Consensus Message Set

The initial protocol defines five logical message classes.

## 42.1 COMMITTEE_TICKET

```text
type
height
validator_id
vrf_output
vrf_proof
signature
```

## 42.2 PROPOSAL

```text
type
height
round
block
proposer_id
leader_vrf_output
leader_vrf_proof
committee_evidence
round_change_certificate (optional)
signature
```

## 42.3 PREPARE

```text
type
height
round
block_hash
validator_id
signature
```

## 42.4 COMMIT

```text
type
height
round
block_hash
validator_id
signature
```

## 42.5 ROUND_CHANGE

```text
type
height
new_round
validator_id
prepared_round (optional)
prepared_block_hash (optional)
prepared_certificate (optional)
signature
```

All messages require canonical serialization before signing and verification.

---

# 43. Verification Rules for Consensus Messages

For any received consensus message, a node MUST verify:

1. message syntax;
2. protocol version;
3. height;
4. round semantics;
5. sender identity;
6. sender signature;
7. sender committee membership where required;
8. referenced block hash;
9. referenced certificate;
10. VRF proof where applicable;
11. duplicate/conflicting-vote state.

Invalid messages are not counted.

Repeated malformed or invalid messages SHOULD be logged for monitoring.

---

# 44. Non-Committee Validators

A validator outside \(C_h\) does not participate in the PREPARE/COMMIT vote for height \(h\).

However, it remains capable of independently verifying:

- the proposed block,
- the committee derivation,
- the leader derivation,
- the finality certificate,
- the finalized chain.

This creates a distinction between

\[
\text{consensus participation}
\]

and

\[
\text{chain validation}.
\]

The protocol does not require non-committee validators to blindly trust the selected committee.

---

# 45. Consensus State Machine

```text
             +----------------------+
             |  LOAD VALIDATOR SET  |
             +----------+-----------+
                        |
                        v
             +----------------------+
             |   DERIVE SEED S_h    |
             +----------+-----------+
                        |
                        v
             +----------------------+
             | SELECT COMMITTEE C_h |
             +----------+-----------+
                        |
                        v
             +----------------------+
             | SELECT LEADER L_h,r  |
             +----------+-----------+
                        |
                        v
                 WAIT / PROPOSE
                        |
             +----------+-----------+
             |                      |
          timeout                 valid
             |                      |
             v                      v
       ROUND_CHANGE               PREPARE
             |                      |
             |              prepare quorum
             |                      |
             |                      v
             |                  PREPARED
             |                      |
             |                      v
             |                    COMMIT
             |                      |
             |                commit quorum
             |                      |
             |                      v
             |                  FINALIZED
             |                      |
             |                      v
             |                 HEIGHT + 1
             |
             +----> NEW ROUND ----+
                     same C_h
                     new L_h,r
```

---

# 46. Performance Model

The protocol should be evaluated in terms of:

- committee-selection latency,
- VRF proof-generation time,
- VRF proof-verification time,
- proposal propagation latency,
- PREPARE communication,
- COMMIT communication,
- finalization latency,
- round-change frequency,
- bytes transferred,
- signature-verification count,
- CPU utilization,
- memory utilization,
- throughput.

The central empirical comparison is between:

1. a full-validator consensus configuration, and
2. the VRF committee configuration.

No performance advantage should be claimed before measurement.

---

# 47. Experimental Parameters

The initial simulator SHOULD evaluate multiple validator populations:

\[
N\in\{10,20,30,50,100\}.
\]

Suggested target committee sizes:

\[
K_{\mathrm{target}}
\in
\{4,7,10,13\}.
\]

Suggested Byzantine fractions:

\[
\frac{M}{N}
\in
\{0,0.1,0.2,0.25,0.33\}.
\]

For each configuration, measure:

\[
P_{\mathrm{unsafe}},
\]

average finalization latency, 95th/99th percentile latency, message count, byte count, round changes, and failure rate.

---

# 48. Fault-Injection Requirements

The simulator and integration environment MUST be able to model:

### Crash failures

- leader offline,
- committee member offline,
- validator restart.

### Byzantine failures

- equivocation,
- invalid proposal,
- conflicting votes,
- missing votes,
- forged/invalid VRF proof,
- stale messages.

### Network failures

- message delay,
- dropped message,
- duplicated message,
- out-of-order message,
- temporary partition.

Each test must record whether:

- safety was preserved,
- liveness was eventually restored,
- the relevant round change occurred,
- an invalid certificate was accepted.

---

# 49. Required Invariants for Testing

The following MUST be tested automatically.

### I1 — Deterministic committee

For a fixed protocol state, every honest node computes the same committee.

### I2 — Deterministic leader

For a fixed \((h,r)\), every honest node computes the same leader.

### I3 — Valid membership

Every selected validator possesses valid committee-selection evidence.

### I4 — No duplicate vote counting

One validator contributes at most one vote to a certificate.

### I5 — Quorum correctness

A certificate is valid iff it contains at least \(Q_h\) distinct valid committee signatures.

### I6 — Proposal validity

No invalid block can become prepared through honest votes.

### I7 — Finality safety

Two conflicting blocks cannot both obtain valid finality certificates under the protocol assumptions.

### I8 — Prepared-value preservation

A higher round does not discard a block that was already prepared without a protocol-valid justification.

### I9 — Leader replacement

A failed leader eventually causes a higher-round leader to be selected when a round-change quorum is reached.

---

# 50. Simulator Architecture

The initial reference implementation SHOULD be written in Python because the simulator is primarily a research and validation tool.

Suggested modules:

```text
simulator/
├── validator.py
├── vrf.py
├── committee.py
├── leader.py
├── block.py
├── message.py
├── consensus.py
├── network.py
├── faults.py
├── certificates.py
├── metrics.py
└── experiments/
```

The simulator should model logical distributed nodes rather than a centralized sequence of function calls.

At minimum, it should support:

- asynchronous message scheduling,
- validator state,
- timers,
- signatures,
- VRF records,
- Byzantine behavior,
- certificate construction,
- finality detection.

---

# 51. Besu Integration Boundary

The final implementation is intended to run as a customized Besu consensus implementation.

The conceptual integration boundary is:

```text
Active Validator Set
        |
        v
VRF Committee Selection
        |
        v
Committee
        |
        v
Random Leader Selection
        |
        v
Proposal / Validation
        |
        v
PREPARE
        |
        v
COMMIT
        |
        v
Quorum
        |
        v
Finality
        |
        v
Next Block
```

The exact Java classes, interfaces, and extension points are implementation-specific and must be mapped against the exact Besu version pinned by the project.

The protocol MUST NOT be implemented as a Solidity smart contract. Smart contracts operate at the execution/application layer and do not replace the underlying blockchain consensus mechanism.

---

# 52. Besu Implementation Strategy

The implementation should progress in the following order:

1. Run and inspect an unmodified Besu QBFT private network.
2. Trace block proposal, validation, vote handling, round changes, and finalization.
3. Map the reference simulator state machine onto the Besu consensus architecture.
4. Implement VRF committee selection.
5. Implement per-round leader selection.
6. Implement the voting state machine.
7. Implement finality certificates.
8. Implement round changes and prepared-value preservation.
9. Integrate validator/VRF-key management.
10. Run a multi-node custom network.
11. Run Byzantine and network-fault tests.
12. Benchmark against stock QBFT.

The Besu version used for development MUST be pinned so that the protocol implementation remains reproducible.

---

# 53. Key Design Trade-offs

The protocol deliberately introduces a trade-off between committee size and security.

Increasing \(K_{\mathrm{target}}\):

- increases committee participation,
- increases communication,
- increases signature-verification work,
- generally decreases the probability of an unsafe Byzantine committee.

Decreasing \(K_{\mathrm{target}}\):

- decreases voting communication,
- decreases per-block consensus work,
- potentially reduces latency,
- generally increases the probability that a random committee contains too many Byzantine validators.

Therefore

\[
K_{\mathrm{target}}
\]

is a security-performance parameter, not merely a performance parameter.

---

# 54. Known Limitations of Version 1.0

The following limitations are acknowledged explicitly.

## 54.1 Seed bias

The previous finalized block hash is not treated as a fully bias-resistant randomness beacon.

## 54.2 Variable committee variance

VRF threshold sortition produces a random committee size. It therefore requires a minimum-size fallback and statistical security analysis.

## 54.3 Ticket dissemination

The simplest fully verifiable implementation requires broad dissemination of VRF tickets, partially offsetting the communication benefit obtained from smaller BFT committees.

## 54.4 Implementation complexity

Replacing or substantially modifying a production consensus engine is significantly more complex than implementing application-level smart contracts.

## 54.5 Security claims

The protocol does not claim security against:

- compromised cryptographic primitives,
- stolen validator private keys,
- majority control of the validator population,
- indefinite network partition,
- failures outside the stated Byzantine model.

---

# 55. Future Extensions

Potential future extensions include:

1. Bias-resistant distributed randomness.
2. Threshold VRF or distributed VRF.
3. Compact committee-selection proofs.
4. Aggregated signatures.
5. Dynamic target committee sizing based on validator population and measured risk.
6. Validator availability statistics.
7. Slashing/evidence mechanisms.
8. Formal verification of the consensus state machine.
9. Model checking for safety and round-change transitions.

These are outside the mandatory Version 1.0 implementation.

---

# 56. Formal Protocol Summary

For each block height \(h\):

### Step 1 — Seed

\[
S_h =
H(
\texttt{"BEL-COMMITTEE-SEED"}
\parallel H(B_{h-1})
\parallel h
\parallel chainID
).
\]

### Step 2 — VRF sortition

Each validator \(v_i\) computes

\[
(\beta_{i,h},\pi_{i,h})
=
VRF_{sk_i}
\left(
H(
\texttt{"BEL-COMMITTEE-VRF"}
\parallel S_h
\parallel h
\parallel v_i
)
\right).
\]

With

\[
p=\min(1,K_{\mathrm{target}}/N),
\]

validator \(v_i\) is selected when

\[
u_{i,h}<p.
\]

If the resulting committee has fewer than \(K_{\min}\) members, choose the \(K_{\min}\) smallest valid VRF outputs.

### Step 3 — Leader

For round \(r\), every committee member evaluates a domain-separated leader VRF. The leader is

\[
L_{h,r}
=
\arg\min_{v_i\in C_h}
(\gamma_{i,h,r},v_i).
\]

### Step 4 — Proposal

\(L_{h,r}\) broadcasts a valid proposal for \(B_h\).

### Step 5 — Prepare

Committee members verify the proposal and issue PREPARE.

### Step 6 — Prepare quorum

Once

\[
Q_h=
\left\lfloor \frac{2K_h}{3}\right\rfloor+1
\]

distinct valid PREPARE signatures are collected, the block becomes prepared.

### Step 7 — Commit

Prepared validators issue COMMIT.

### Step 8 — Finality

Once \(Q_h\) distinct valid COMMIT signatures are collected, the block becomes final.

### Step 9 — Round change

If progress fails:

\[
r\rightarrow r+1.
\]

A quorum of ROUND_CHANGE messages is required.

The committee remains \(C_h\); only the leader changes.

### Step 10 — Next height

After finality:

\[
h\rightarrow h+1
\]

and a new VRF committee is selected.

---

# 57. Acceptance Criteria

Version 1.0 is considered functionally complete only when all of the following are demonstrated:

- deterministic committee derivation,
- variable committee size,
- valid VRF proof generation and verification,
- deterministic random leader selection,
- valid block proposal,
- PREPARE quorum formation,
- COMMIT quorum formation,
- deterministic finality,
- leader failure recovery,
- round-change quorum,
- prepared-value preservation,
- detection of invalid and conflicting votes,
- no conflicting finality in safety tests,
- eventual finality in liveness tests under the stated assumptions,
- measurable communication and latency characteristics,
- reproducible results across multiple nodes.

---

# 58. References

1. **RFC 9381**, *Verifiable Random Functions (VRFs)*, IETF/IRTF, 2023.  
   https://www.rfc-editor.org/rfc/rfc9381

2. **Enterprise Ethereum Alliance**, *QBFT Consensus Protocol Specification*.  
   https://entethalliance.org/specs/

3. **Hyperledger Besu Documentation**, *QBFT / Proof-of-Authority networks*.  
   https://besu.hyperledger.org/

4. **Micali, Rabin, Vadhan**, *Verifiable Random Functions*, FOCS, 1999.

5. **Gilad et al.**, *Algorand: Scaling Byzantine Agreements for Cryptocurrencies*, SOSP, 2017.
