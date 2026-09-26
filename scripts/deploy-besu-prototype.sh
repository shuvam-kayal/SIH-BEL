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

export BEL_EXECUTION_PROFILE=prototype
export BEL_BOOTSTRAP_VALIDATOR_COUNT=4
export BEL_NETWORK=besu-prototype
export BEL_BOOTSTRAP_ADMIN_WALLET="${BEL_BOOTSTRAP_ADMIN_WALLET:-0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266}"
export BEL_BOOTSTRAP_ADMIN_DID="${BEL_BOOTSTRAP_ADMIN_DID:-DID:BEL:ADMIN}"
export BEL_RPC_URL="${BEL_RPC_URL:-http://127.0.0.1:8645}"

DEPLOYMENT_FILE="${ROOT}/contracts/deployments/besu-prototype.json"
# Use the standard local-only Foundry/Anvil fixture without committing its
# secret-looking private-key literal. BEL_DEPLOYER_PRIVATE_KEY remains the
# explicit override for any other local chain.
if [[ -z "${BEL_DEPLOYER_PRIVATE_KEY:-}" ]]; then
  BEL_DEPLOYER_MNEMONIC="${BEL_DEPLOYER_MNEMONIC:-test test test test test test test test test test test junk}"
  BEL_DEPLOYER_PRIVATE_KEY="$(node -e 'const { HDNodeWallet } = require("ethers"); console.log(HDNodeWallet.fromPhrase(process.argv[1]).privateKey)' "${BEL_DEPLOYER_MNEMONIC}")"
fi
export BEL_DEPLOYER_PRIVATE_KEY

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
