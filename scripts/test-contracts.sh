#!/usr/bin/env bash
# scripts/test-contracts.sh
# Runs the Solidity tests, but skips cleanly when Foundry isn't
# installed, so `npm test` at the repo root still works for people who
# don't own the contracts. CI installs Foundry and runs forge directly,
# so nothing is silently skipped on a pull request.
set -euo pipefail

cd "$(dirname "$0")/../contracts"

if ! command -v forge >/dev/null 2>&1; then
  echo "SKIP: forge not installed. Install Foundry to run contract tests:"
  echo "  curl -L https://foundry.paradigm.xyz | bash && foundryup"
  exit 0
fi

[ -d lib/openzeppelin-contracts ] && [ -d lib/forge-std ] || bash ../scripts/setup-contracts.sh

forge build
forge test -vv
