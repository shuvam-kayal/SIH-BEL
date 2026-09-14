# consensus/

Owner: Person 4.

The real consensus implementation lives here — leader selection,
randomness beacon, committee selection, vote collection, finality.

**Do not start writing code in this directory until
`docs/CONSENSUS_SPEC.md` is finalized and the Phase 8 feasibility spike
has picked a blockchain client.** Everything in `../simulator/` is a
throwaway model; nothing from it should be copied here unmodified.

Expected modules once the spec is frozen:

- `leader.*` — deterministic leader selection from the round seed
- `randomness.*` — seed derivation, non-grindable by the leader
- `committee.*` — K-of-N selection every validator computes identically
- `voting.*` — vote collection and quorum evaluation
- `finality.*` — the precise irreversibility condition
