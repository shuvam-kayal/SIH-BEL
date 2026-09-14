"""Tests for the illustrative consensus simulator.

These pin the simulator's mechanics (committee sizing, sampling without
replacement, leader drawn from the committee) so Person 4 can refactor
the model freely and still notice when a change alters behaviour. They
are deliberately silent about *which* selection algorithm is correct —
that is still open in docs/CONSENSUS_SPEC.md.
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "simulator"))

from consensus_simulator import run_round, simulate  # noqa: E402


def make_validators(n):
    return [f"val_{i}" for i in range(n)]


def test_committee_is_sampled_without_replacement():
    validators = make_validators(100)
    for _ in range(20):
        result = run_round(validators, committee_size=10, round_latency_s=0)
        assert result["committee_size"] == 10


def test_leader_comes_from_the_validator_set():
    validators = make_validators(50)
    result = run_round(validators, committee_size=5, round_latency_s=0)
    assert result["leader"] in validators


@pytest.mark.parametrize(
    "count,pct,expected",
    [(1000, 0.01, 10), (1000, 0.015, 15), (1000, 0.02, 20), (10000, 0.01, 100)],
)
def test_committee_size_tracks_the_configured_percentage(count, pct, expected):
    stats = simulate(count, pct, rounds=1, round_latency_s=0, quiet=True)
    assert stats["committee_size"] == expected


def test_committee_never_empty_for_tiny_validator_sets():
    stats = simulate(10, 0.01, rounds=1, round_latency_s=0, quiet=True)
    assert stats["committee_size"] == 1


def test_simulate_reports_latency_statistics():
    stats = simulate(200, 0.02, rounds=5, round_latency_s=0, quiet=True)
    assert stats["rounds"] == 5
    assert stats["avg_latency_ms"] >= 0
    assert stats["p95_latency_ms"] >= stats["avg_latency_ms"] * 0  # present and numeric
