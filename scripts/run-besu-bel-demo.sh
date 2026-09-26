#!/usr/bin/env bash
set -euo pipefail
command -v setsid >/dev/null 2>&1 || { echo "This launcher requires a Linux environment with setsid (use WSL or native Linux)." >&2; exit 1; }

VALIDATOR_COUNT="${1:-70}"
BASE_P2P_PORT="${2:-30303}"
BASE_RPC_PORT="${3:-8545}"
VALIDATOR_CONTRACT_ADDRESS="${BEL_VALIDATOR_CONTRACT_ADDRESS:-}"
BESU_DEMO_JAVA_OPTS="${BESU_DEMO_JAVA_OPTS:--Xms128m -Xmx256m}"
VALIDATOR_CONFIG=""
if [[ -n "${VALIDATOR_CONTRACT_ADDRESS}" ]]; then VALIDATOR_CONFIG=$(printf ',\n        "validatorcontractaddress": "%s"' "${VALIDATOR_CONTRACT_ADDRESS}"); fi

if (( VALIDATOR_COUNT < 70 )); then
  echo "BEL requires at least 70 active validators." >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BESU="${REPO_ROOT}/besu/build/install/besu/bin/besu-untuned"
if [[ ! -x "${BESU}" ]]; then
  echo "Besu distribution not found: ${BESU}" >&2
  exit 1
fi

RUNTIME="${REPO_ROOT}/.bel-demo"
RUN_ID="$(date +%Y%m%d-%H%M%S)-linux"
RUN_ROOT="${RUNTIME}/${RUN_ID}"
CONFIG_ROOT="${RUN_ROOT}/config"
GENERATED_ROOT="${RUN_ROOT}/generated"
NODES_ROOT="${RUN_ROOT}/nodes"
mkdir -p "${CONFIG_ROOT}" "${GENERATED_ROOT}" "${NODES_ROOT}"

cat > "${CONFIG_ROOT}/network-config.json" <<EOF
{
  "genesis": {
    "config": {
      "chainId": 20260919,
      "berlinBlock": 0,
      "qbft": {
        "blockperiodseconds": 1,
        "epochlength": 30000,
        "requesttimeoutseconds": 2${VALIDATOR_CONFIG}
      }
    },
    "nonce": "0x0",
    "timestamp": "0x$(date +%s)",
    "gasLimit": "0x1fffffffffffff",
    "difficulty": "0x1",
    "mixHash": "0x63746963616c2062797a616e74696e65206661756c7420746f6c6572616e6365",
    "coinbase": "0x0000000000000000000000000000000000000000"
  },
  "blockchain": {
    "nodes": {
      "generate": true,
      "count": ${VALIDATOR_COUNT}
    }
  }
}
EOF

"${BESU}" operator generate-blockchain-config \
  --config-file="${CONFIG_ROOT}/network-config.json" \
  --to="${GENERATED_ROOT}" \
  --genesis-file-name=genesis.json

GENESIS="${GENERATED_ROOT}/genesis.json"
mapfile -t NODE_KEYS < <(find "${GENERATED_ROOT}/keys" -mindepth 2 -maxdepth 2 -name key.priv | sort)
if (( ${#NODE_KEYS[@]} != VALIDATOR_COUNT )); then
  echo "Expected ${VALIDATOR_COUNT} keys, found ${#NODE_KEYS[@]}" >&2
  exit 1
fi

FIRST_PUB="$(tr -d '\r\n' < "$(dirname "${NODE_KEYS[0]}")/key.pub" | sed 's/^0x//')"
BOOTNODE="enode://${FIRST_PUB}@127.0.0.1:${BASE_P2P_PORT}"
PIDS=()

for ((i=0; i<VALIDATOR_COUNT; i++)); do
  node_index=$((i + 1))
  node_dir="${NODES_ROOT}/node-$(printf '%03d' "${node_index}")"
  mkdir -p "${node_dir}"
  JAVA_OPTS="${BESU_DEMO_JAVA_OPTS}" setsid nohup "${BESU}" \
    --genesis-file="${GENESIS}" \
    --data-path="${node_dir}" \
    --node-private-key-file="${NODE_KEYS[$i]}" \
    --p2p-host=127.0.0.1 \
    --p2p-port=$((BASE_P2P_PORT + i)) \
    --nat-method=NONE \
    --bootnodes="${BOOTNODE}" \
    --rpc-http-enabled \
    --rpc-http-host=127.0.0.1 \
    --rpc-http-port=$((BASE_RPC_PORT + i)) \
    --rpc-http-api=ETH,NET,WEB3,ADMIN \
    --host-allowlist='*' \
    --min-gas-price=0 \
    --logging=INFO > "${node_dir}/besu.log" 2>&1 < /dev/null &
  PIDS+=("$!")
  # Stagger JVM/native-library initialization so a local WSL demo does not
  # exhaust process and file-system startup resources all at once.
  sleep 1
done

printf '%s\n' "${PIDS[@]}" > "${RUN_ROOT}/pids"
cat > "${RUN_ROOT}/run.json" <<EOF
{
  "runRoot": "${RUN_ROOT}",
  "genesis": "${GENESIS}",
  "validatorCount": ${VALIDATOR_COUNT},
  "baseP2pPort": ${BASE_P2P_PORT},
  "baseRpcPort": ${BASE_RPC_PORT},
  "pids": [$(IFS=,; echo "${PIDS[*]}")]
}
EOF

echo "BEL Linux demo started: ${RUN_ROOT}"
echo "Validators: ${VALIDATOR_COUNT}"
echo "Genesis: ${GENESIS}"



