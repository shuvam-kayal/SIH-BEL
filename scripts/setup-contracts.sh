#!/usr/bin/env bash
# scripts/setup-contracts.sh
# Installs the Solidity toolchain dependencies Person 5 needs once the
# tests move from skeletons to real assertions.
#
# The repo intentionally compiles WITHOUT these: `forge build` works on
# a clean clone because contracts/src holds interfaces only. Run this
# when you start writing cheatcode-based tests.
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v forge >/dev/null 2>&1; then
  echo "forge not found. Install Foundry first:"
  echo "  curl -L https://foundry.paradigm.xyz | bash && foundryup"
  exit 1
fi

cd contracts
forge install foundry-rs/forge-std --no-git || true
# Uncomment when the registries need ERC-721 for the asset NFT (Person 2/5):
# forge install OpenZeppelin/openzeppelin-contracts --no-git || true

echo "Done. remappings.txt already points forge-std/ at lib/forge-std/src/."
