#!/usr/bin/env bash
set -euo pipefail

RUN_ROOT="${1:?usage: export-besu-test-env.sh <besu-run-root>}"
if [[ ! -f "${RUN_ROOT}/run.json" ]]; then
  echo "Besu run metadata not found: ${RUN_ROOT}" >&2
  exit 1
fi

KEY_FILE="$(node -e 'const r=require(process.argv[1]); console.log(r.testAccountKeys || "")' "${RUN_ROOT}/run.json")"
GENERATED="$(node -e 'const r=require(process.argv[1]); console.log(r.generatedKeys)' "${RUN_ROOT}/run.json")"
[[ -s "${KEY_FILE}" ]] || { echo "Besu test account key file is missing" >&2; exit 1; }
mapfile -t TEST_KEYS < "${KEY_FILE}"
KEYS_CSV="$(IFS=,; echo "${TEST_KEYS[*]}")"
ADMIN="$(node -e 'const {Wallet}=require("ethers"); console.log(new Wallet(process.argv[1]).address)' "${TEST_KEYS[0]}")"

printf 'export BEL_BESU_RUN_ROOT=%q\n' "${RUN_ROOT}"
printf 'export BEL_BLOCKCHAIN=evm\n'
printf 'export BEL_EXECUTION_PROFILE=prototype\n'
printf 'export BEL_CHAIN_RPC_URL=http://127.0.0.1:8645\n'
printf 'export BEL_EVM_RPC_URL=http://127.0.0.1:8645\n'
printf 'export BEL_E2E_RPC_URL=http://127.0.0.1:8645\n'
printf 'export BEL_E2E_CHAIN_ID=20260920\n'
printf 'export BEL_CHAIN_DEPLOYMENT=besu-prototype\n'
printf 'export BEL_NETWORK=besu-prototype\n'
printf 'export BEL_RUN_INTEGRATION=true\n'
printf 'export BEL_CHAIN_TX_TIMEOUT_MS=120000\n'
printf 'export BEL_BOOTSTRAP_VALIDATOR_COUNT=4\n'
printf 'export BEL_BOOTSTRAP_ADMIN_WALLET=%q\n' "${ADMIN}"
printf 'export BEL_E2E_PRIVATE_KEYS=%q\n' "${KEYS_CSV}"
printf 'export BEL_CHAIN_DEV_SIGNER_KEYS=%q\n' "${KEYS_CSV}"

node - "${GENERATED}" <<'NODE'
const fs = require('node:fs');
const path = process.argv[2];
const nodes = fs.readdirSync(path).filter(name => /^node-/.test(name)).sort();
for (const [index, name] of nodes.entries()) {
  const key = fs.readFileSync(`${path}/${name}/key.priv`, 'utf8').trim();
  const { Wallet } = require('ethers');
  process.stdout.write(`export BEL_BOOTSTRAP_VALIDATOR_${index}=${new Wallet(key).address}\n`);
}
NODE
