#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"
RUN_ROOT="${1:-}"
if [[ -z "${RUN_ROOT}" ]]; then
  RUN_ROOT="$(find "${ROOT}/.bel-demo" -maxdepth 1 -type d -name 'smoke-*' -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -n1 | cut -d' ' -f2-)"
fi
if [[ -z "${RUN_ROOT}" || ! -f "${RUN_ROOT}/run.json" ]]; then
  echo "Usage: $0 <smoke-run-root> (start the prototype first)" >&2
  exit 1
fi

GENERATED="$(node -e 'const r=require(process.argv[1]); console.log(r.generatedKeys)' "${RUN_ROOT}/run.json")"
mapfile -t KEYS < <(find "${GENERATED}" -mindepth 2 -maxdepth 2 -name key.priv | sort)
if (( ${#KEYS[@]} != 4 )); then echo "Expected four generated Besu validator keys under ${GENERATED}" >&2; exit 1; fi
for i in {0..3}; do
  validator_address="$(node -e 'const { Wallet } = require("ethers"); console.log(new Wallet(process.argv[1]).address)' "$(tr -d '\r\n' < "${KEYS[$i]}")")"
  export "BEL_BOOTSTRAP_VALIDATOR_${i}=${validator_address}"
done

TEST_ACCOUNT_KEYS_FILE="$(node -e 'const r=require(process.argv[1]); console.log(r.testAccountKeys || "")' "${RUN_ROOT}/run.json")"
if [[ ! -s "${TEST_ACCOUNT_KEYS_FILE}" ]]; then
  echo "Besu run metadata does not contain ephemeral test accounts: ${RUN_ROOT}" >&2
  exit 1
fi
mapfile -t TEST_KEYS < "${TEST_ACCOUNT_KEYS_FILE}"
if (( ${#TEST_KEYS[@]} < 1 )); then echo "No ephemeral Besu test account was generated" >&2; exit 1; fi
DEPLOYER_KEY="${TEST_KEYS[0]}"
export BEL_BOOTSTRAP_ADMIN_WALLET="$(node -e 'const {Wallet}=require("ethers"); console.log(new Wallet(process.argv[1]).address)' "${DEPLOYER_KEY}")"

export BEL_EXECUTION_PROFILE=prototype
export BEL_BOOTSTRAP_VALIDATOR_COUNT=4
export BEL_NETWORK=besu-prototype
export BEL_BOOTSTRAP_ADMIN_DID="${BEL_BOOTSTRAP_ADMIN_DID:-DID:BEL:ADMIN}"
export BEL_RPC_URL="${BEL_RPC_URL:-http://127.0.0.1:8645}"

DEPLOYMENT_FILE="${ROOT}/contracts/deployments/besu-prototype.json"
BEL_DEPLOYER_PRIVATE_KEY="${BEL_DEPLOYER_PRIVATE_KEY:-${DEPLOYER_KEY}}"

# Never leave a deployment from an earlier chain run looking valid after a
# failed broadcast. Deploy.s.sol writes this file only after all transactions
# complete successfully; this removes any stale file before starting a retry.
rm -f "${DEPLOYMENT_FILE}"

forge script "${ROOT}/contracts/script/Deploy.s.sol" \
  --root "${ROOT}/contracts" \
  --rpc-url "${BEL_RPC_URL}" \
  --private-key "${BEL_DEPLOYER_PRIVATE_KEY}" \
  --legacy \
  --broadcast

[[ -f "${DEPLOYMENT_FILE}" ]] || { echo "Forge succeeded but did not write ${DEPLOYMENT_FILE}" >&2; exit 1; }
echo "Besu contracts deployed to ${DEPLOYMENT_FILE}"
