#!/usr/bin/env bash
# scripts/generate-abis.sh
# Phase 6: "Generate and commit contracts/abis once stable."
# Extracts the ABI of every contract/interface declared in contracts/src/
# into contracts/abis/<Name>.json so the backend consumes a stable,
# reviewable interface instead of reaching into Foundry's out/ directory.
# Only src/ is exported: forge-std, OpenZeppelin and test artifacts in out/
# are not part of the backend-facing surface. Uses node (already required
# by the repo) instead of jq.
set -euo pipefail

cd "$(dirname "$0")/../contracts"

forge build

mkdir -p abis
count=0
for source in src/*.sol; do
  file="$(basename "$source")"
  for artifact in "out/$file"/*.json; do
    [ -e "$artifact" ] || continue
    name="$(basename "$artifact")"
    node -e '
      const fs = require("fs");
      const abi = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).abi;
      fs.writeFileSync(process.argv[2], JSON.stringify(abi, null, 2) + "\n");
    ' "$artifact" "abis/$name"
    count=$((count + 1))
  done
done

echo "Wrote $count ABIs to contracts/abis/. Commit them when the interface is stable."
