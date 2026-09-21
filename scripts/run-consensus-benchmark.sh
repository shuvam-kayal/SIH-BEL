#!/usr/bin/env bash
# scripts/run-consensus-benchmark.sh
# Convenience wrapper for Person 4's Phase 8 feasibility benchmarking.
# Usage: ./scripts/run-consensus-benchmark.sh [validators] [rounds]
set -euo pipefail

VALIDATORS="${1:-1000}"
ROUNDS="${2:-50}"

python3 blockchain/simulator/consensus_simulator.py --bench \
  --validators "$VALIDATORS" \
  --rounds "$ROUNDS"
