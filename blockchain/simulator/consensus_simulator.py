"""
Illustrative consensus simulator ONLY — not the spec.

This exists to unblock Person 4's Phase 8 feasibility/benchmarking work
before docs/CONSENSUS_SPEC.md is finalized. Leader selection is
`random.choice`, which is a placeholder, not a chosen algorithm — see
the "Leader selection" and "Randomness" TODOs in CONSENSUS_SPEC.md.
Do not treat any parameter here as frozen.

Usage:
    python consensus_simulator.py --validators 1000 --committee-pct 0.02 --rounds 20
    python consensus_simulator.py --bench   # runs 1%, 1.5%, 2% back to back
"""

import argparse
import random
import statistics
import time


def run_round(validators, committee_size, round_latency_s):
    committee = random.sample(validators, committee_size)
    leader = random.choice(committee)
    # Simulated network/voting latency for this round. Real latency
    # modeling (message counts, per-hop delay, dropped votes) belongs
    # in the real node prototype, not here.
    time.sleep(round_latency_s)
    return {"leader": leader, "committee_size": len(committee)}


def simulate(validator_count, committee_pct, rounds, round_latency_s=0.01, quiet=False):
    validators = [f"val_{i}" for i in range(validator_count)]
    committee_size = max(1, int(validator_count * committee_pct))

    latencies = []
    for i in range(rounds):
        start = time.perf_counter()
        result = run_round(validators, committee_size, round_latency_s)
        elapsed = time.perf_counter() - start
        latencies.append(elapsed)
        if not quiet:
            print(
                f"round={i} leader={result['leader']} "
                f"committee_size={result['committee_size']} "
                f"elapsed_ms={elapsed * 1000:.2f}"
            )

    return {
        "validator_count": validator_count,
        "committee_pct": committee_pct,
        "committee_size": committee_size,
        "rounds": rounds,
        "avg_latency_ms": statistics.mean(latencies) * 1000,
        "p95_latency_ms": (
            statistics.quantiles(latencies, n=20)[18] * 1000 if rounds >= 20 else max(latencies) * 1000
        ),
    }


def benchmark(validator_count, rounds):
    """Phase 8: compare committee 1% / 1.5% / 2% as called for in the plan."""
    print(f"Benchmarking with {validator_count} validators, {rounds} rounds per config...\n")
    for pct in (0.01, 0.015, 0.02):
        stats = simulate(validator_count, pct, rounds, round_latency_s=0.005, quiet=True)
        print(
            f"committee_pct={pct:>5} committee_size={stats['committee_size']:>5} "
            f"avg_latency_ms={stats['avg_latency_ms']:.3f} "
            f"p95_latency_ms={stats['p95_latency_ms']:.3f}"
        )
        # TODO(Person 4): also record message count, CPU, network bytes,
        # and induced-failure rate per docs/CONSENSUS_SPEC.md's Phase 8
        # requirements once the real messaging model exists.


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--validators", type=int, default=1000)
    parser.add_argument("--committee-pct", type=float, default=0.02)
    parser.add_argument("--rounds", type=int, default=20)
    parser.add_argument("--bench", action="store_true", help="run the 1%/1.5%/2% comparison")
    args = parser.parse_args()

    if args.bench:
        benchmark(args.validators, args.rounds)
    else:
        simulate(args.validators, args.committee_pct, args.rounds)
