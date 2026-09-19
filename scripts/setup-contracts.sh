#!/usr/bin/env bash
# scripts/setup-contracts.sh
# Installs the pinned Solidity dependencies. Required before `forge build`:
# the registries use OpenZeppelin ERC-721 and the tests use forge-std.
# OpenZeppelin stays on 4.9.x because 5.x requires solc >= 0.8.20 and
# foundry.toml pins 0.8.19. CI installs the same versions.
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v forge >/dev/null 2>&1; then
  echo "forge not found. Install Foundry first:"
  echo "  curl -L https://foundry.paradigm.xyz | bash && foundryup"
  exit 1
fi

cd contracts
[ -d lib/forge-std ] || forge install foundry-rs/forge-std@v1.9.4 --no-git
[ -d lib/openzeppelin-contracts ] || forge install OpenZeppelin/openzeppelin-contracts@v4.9.6 --no-git

echo "Done. remappings.txt maps forge-std/ and @openzeppelin/ into lib/."
