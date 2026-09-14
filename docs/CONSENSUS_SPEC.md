
**Status: Person 4-owned research module. The shared boundary is frozen for base-v1; exact algorithm/client parameters remain deliberately open until the feasibility spike. This does not block Persons 1, 2, 3, 5, or 6.**

## Frozen boundary

Every implementation must expose the same conceptual inputs and outputs:

- Input: active validator set, block height, proposal, round/timeout metadata.
- Output: selected leader, deterministic committee for the height/round, validator votes, quorum result, and finality status.
- Every honest node must derive the same committee for the same finalized selection seed.
- No application-level Solidity function may claim to change the underlying consensus protocol.

The items below are research decisions for Person 4 rather than missing shared interfaces.
# Consensus Specification (DRAFT)

**Status: incomplete draft.** The values and mechanisms below are
placeholders to unblock parallel work (e.g. `blockchain/simulator/`).
Per Phase 7/8 of the project plan, **Person 4 must finalize every
section below — and complete the blockchain-client feasibility spike —
before writing real (non-simulated) consensus/node code.** The
simulator is fine to keep evolving in the meantime; it is explicitly a
throwaway model, not the implementation.

## Validator pool
- `N` = number of eligible validators, drawn from the authorized
  validator set (permissioned — no open validator join).
- OPEN(Person 4): initial target N for the pilot network, and the
  process for adding/removing a validator from the authorized set.

## Leader selection
- OPEN(Person 4): exact selection function. Candidates to evaluate:
  round-robin over the authorized set, weighted-random by stake/tenure,
  or VRF-based selection. Must be independently computable by every
  validator without a coordinator.

## Randomness
- OPEN(Person 4): source of the unpredictable seed used for leader and
  committee selection (e.g. hash of previous block + validator
  signatures / VRF output / distributed randomness beacon). Must not be
  predictable or grindable by a leader ahead of their own turn.

## Committee
- `K` = committee size, planned as a percentage of `N` (feasibility
  spike is benchmarking 1% / 1.5% / 2% — see `blockchain/simulator/`).
- Committee's job: independently validate the leader's proposed block
  before quorum voting.

## Committee selection
- OPEN(Person 4): the function that, given the round's random seed,
  deterministically selects K validators from N such that every honest
  validator computes the identical committee without communication.

## Quorum
- OPEN(Person 4): exact vote threshold required to finalize a block
  (e.g. `> 2/3 of K`, adjustable per BFT-fault-tolerance target).

## Failure handling
| Scenario | Behavior |
|---|---|
| Leader offline | OPEN: timeout + next-leader fallback rule |
| Committee member offline | OPEN: whether absence counts as a no-vote and whether quorum threshold adjusts |
| Malicious leader (equivocation) | OPEN: detection + slashing/removal from authorized set |
| Conflicting proposal | OPEN: tie-break rule (e.g. lowest hash, earliest timestamp) |
| Insufficient votes | OPEN: retry with new leader vs. round abort |
| Network partition | OPEN: safety-over-liveness behavior — chain halts rather than forks |

## Finality
- OPEN(Person 4): the precise condition under which a block is
  considered final and irreversible (e.g. "immediately upon quorum,
  permissioned BFT has no reorg window" — confirm this is actually true
  for the chosen client before writing it down as fact).

## Feasibility spike (Phase 8 — must happen before the above is frozen)
The blockchain client is **not yet locked**. Before finalizing this
document, Person 4 must confirm the chosen permissioned-chain framework
actually exposes hooks to override:
- leader selection
- validator/committee selection
- voting / finality rules

The selection criterion is not "which chain is popular" — it's "which
one gives practical access to the consensus layer we need to modify."
If a candidate framework only allows adding smart-contract logic on top
of its existing consensus (e.g. plain Solidity on unmodified PoA), it
does **not** satisfy this requirement, because that would not actually
change consensus — only application logic sitting on top of it.
