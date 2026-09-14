#!/usr/bin/env bash
# scripts/generate-abis.sh
# Phase 6: "Generate and commit contracts/abis once stable."
# Extracts the ABI from each compiled artifact into contracts/abis/ so
# the backend can consume a stable, reviewable interface instead of
# reaching into Foundry's out/ directory.
set -euo pipefail

cd "$(dirname "$0")/../contracts"

command -v jq >/dev/null 2>&1 || { echo "jq is required"; exit 1; }

forge build

mkdir -p abis
count=0
for artifact in out/*.sol/*.json; do
  [ -e "$artifact" ] || continue
  name="$(basename "$artifact")"
  jq '.abi' "$artifact" > "abis/$name"
  count=$((count + 1))
done

echo "Wrote $count ABIs to contracts/abis/. Commit them when the interface is stable."
