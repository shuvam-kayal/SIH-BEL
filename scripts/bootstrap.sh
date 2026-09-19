#!/usr/bin/env bash
# scripts/bootstrap.sh
# Run once after cloning. Installs every workspace's dependencies so a
# new team member can start on whichever module they own.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Installing Node workspaces (root, shared, backend, frontend, mocks)"
npm install

echo "==> Solidity toolchain"
if command -v forge >/dev/null 2>&1; then
  echo "    forge found: $(forge --version | head -1)"
else
  echo "    forge not found. Person 5 should install Foundry:"
  echo "      curl -L https://foundry.paradigm.xyz | bash && foundryup"
fi

cat <<'NEXT'

Bootstrap complete. Common commands:

  npm run dev              backend (:4000) + frontend (:3000) together
  npm test                 all TypeScript tests
  npm run typecheck        all workspaces
  npm run test:contracts   forge test

Read docs/ before writing code — SYSTEM_SPEC.md first.
NEXT
