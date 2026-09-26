#!/usr/bin/env bash
set -euo pipefail

# Starts the already-installed Besu distribution and leaves the four-node
# prototype running for contract deployment/application tests.
BEL_EXECUTION_PROFILE=prototype \
BEL_PROTOTYPE_QBFT_VALIDATOR_COUNT=4 \
BEL_SMOKE_KEEP_RUNNING=true \
"$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/run-besu-smoke.sh" "$@"
