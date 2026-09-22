#!/usr/bin/env bash
set -euo pipefail
command -v setsid >/dev/null 2>&1 || { echo "This launcher requires a Linux environment with setsid (use WSL or native Linux)." >&2; exit 1; }

# Infrastructure-only smoke test. This intentionally does not exercise BEL
# committee selection: BEL's protocol minimum remains N >= 70.
VALIDATOR_COUNT="${BEL_PROTOCOL_VALIDATOR_COUNT:-70}"
ACTIVE_COUNT="${BEL_SMOKE_INITIAL_NODES:-4}"
BASE_P2P="${P2P_PORT:-31303}"
BASE_RPC="${RPC_PORT:-8645}"
P2P_HOST="${P2P_HOST:-${NODE_IP:-127.0.0.1}}"
RPC_HOST="${RPC_HOST:-127.0.0.1}"
BOOTNODE_HOST="${BOOTNODE_HOST:-${P2P_HOST}}"
BOOTNODE_PORT="${BOOTNODE_PORT:-${BASE_P2P}}"
MIN_PEERS="${BEL_SMOKE_MIN_PEERS:-1}"
BLOCK_WAIT_SECONDS="${BEL_SMOKE_BLOCK_WAIT_SECONDS:-12}"
if (( VALIDATOR_COUNT < 70 )); then echo "BEL smoke fixture requires the unchanged 70-validator protocol configuration." >&2; exit 1; fi
if (( ACTIVE_COUNT != 4 )); then echo "BEL smoke fixture starts exactly four initial logical nodes." >&2; exit 1; fi
if ! [[ "${MIN_PEERS}" =~ ^[0-9]+$ ]] || (( MIN_PEERS < 1 )); then echo "BEL_SMOKE_MIN_PEERS must be a positive integer." >&2; exit 1; fi
if ! [[ "${BLOCK_WAIT_SECONDS}" =~ ^[0-9]+$ ]] || (( BLOCK_WAIT_SECONDS < 2 )); then echo "BEL_SMOKE_BLOCK_WAIT_SECONDS must be at least 2 seconds." >&2; exit 1; fi
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BESU="${ROOT}/besu/build/install/besu/bin/besu-untuned"
RUN_ROOT="${ROOT}/.bel-demo/smoke-$(date +%Y%m%d-%H%M%S)"
CONFIG="${RUN_ROOT}/config"
GENERATED="${RUN_ROOT}/generated"
NODES="${RUN_ROOT}/nodes"
mkdir -p "${CONFIG}" "${GENERATED}" "${NODES}"

cat > "${CONFIG}/network-config.json" <<EOF
{
  "genesis": {
    "config": {
      "chainId": 20260920,
      "berlinBlock": 0,
      "qbft": {
        "blockperiodseconds": 2,
        "epochlength": 30000,
        "requesttimeoutseconds": 4
      }
    },
    "nonce": "0x0",
    "timestamp": "0x$(date +%s)",
    "gasLimit": "0x1fffffffffffff",
    "difficulty": "0x1",
    "mixHash": "0x63746963616c2062797a616e74696e65206661756c7420746f6c6572616e6365",
    "coinbase": "0x0000000000000000000000000000000000000000"
  },
  "blockchain": { "nodes": { "generate": true, "count": ${VALIDATOR_COUNT} } }
}
EOF

"${BESU}" operator generate-blockchain-config \
  --config-file="${CONFIG}/network-config.json" \
  --to="${GENERATED}" \
  --genesis-file-name=genesis.json

mapfile -t KEYS < <(find "${GENERATED}/keys" -mindepth 2 -maxdepth 2 -name key.priv | sort)
PUB="$(tr -d '\r\n' < "$(dirname "${KEYS[0]}")/key.pub" | sed 's/^0x//')"
BOOTNODE="enode://${PUB}@${BOOTNODE_HOST}:${BOOTNODE_PORT}"
PIDS=()

cleanup() {
  for pid in "${PIDS[@]}"; do kill "${pid}" 2>/dev/null || true; done
}
trap cleanup EXIT INT TERM

for ((i=0; i<ACTIVE_COUNT; i++)); do
  node="${NODES}/node-$(printf '%03d' $((i + 1)))"
  mkdir -p "${node}"
  JAVA_OPTS='-Xms64m -Xmx128m -XX:MaxMetaspaceSize=64m' setsid nohup "${BESU}" \
    --genesis-file="${GENERATED}/genesis.json" \
    --data-path="${node}" \
    --node-private-key-file="${KEYS[$i]}" \
    --p2p-host="${P2P_HOST}" --p2p-port=$((BASE_P2P + i)) \
    --nat-method=NONE --bootnodes="${BOOTNODE}" \
    --rpc-http-enabled --rpc-http-host="${RPC_HOST}" \
    --rpc-http-port=$((BASE_RPC + i)) \
    --rpc-http-api=ETH,NET,WEB3,ADMIN --host-allowlist='*' \
    --min-gas-price=0 --logging=INFO > "${node}/besu.log" 2>&1 < /dev/null &
  PIDS+=("$!")
  sleep 2
done

for ((i=0; i<ACTIVE_COUNT; i++)); do
  port=$((BASE_RPC + i))
  for attempt in {1..30}; do
    if curl -fsS --max-time 2 -H 'Content-Type: application/json' --data '{"jsonrpc":"2.0","method":"net_peerCount","params":[],"id":1}' "http://${RPC_HOST}:${port}" >/dev/null 2>&1; then break; fi
    if (( attempt == 30 )); then echo "RPC health check failed for ${RPC_HOST}:${port}" >&2; exit 1; fi
    sleep 1
  done
done

initial_block=""
for ((i=0; i<ACTIVE_COUNT; i++)); do
  port=$((BASE_RPC + i))
  response="$(curl -fsS --max-time 2 -H 'Content-Type: application/json' --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' "http://${RPC_HOST}:${port}")" || { echo "Block-production RPC failed for ${RPC_HOST}:${port}" >&2; exit 1; }
  block_hex="$(sed -nE 's/.*"result"[[:space:]]*:[[:space:]]*"(0x[0-9a-fA-F]+)".*/\1/p' <<<"${response}")"
  if [[ -z "${block_hex}" ]]; then echo "Block-production check returned no eth_blockNumber result for ${RPC_HOST}:${port}: ${response}" >&2; exit 1; fi
  block_digits="${block_hex#0x}"
  block_number=$((16#${block_digits}))
  if [[ -z "${initial_block}" || block_number -lt initial_block ]]; then initial_block="${block_number}"; fi
done
sleep "${BLOCK_WAIT_SECONDS}"
minimum_block=""
maximum_block=0
for ((i=0; i<ACTIVE_COUNT; i++)); do
  port=$((BASE_RPC + i))
  response="$(curl -fsS --max-time 2 -H 'Content-Type: application/json' --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' "http://${RPC_HOST}:${port}")" || { echo "Block synchronization RPC failed for ${RPC_HOST}:${port}" >&2; exit 1; }
  block_hex="$(sed -nE 's/.*"result"[[:space:]]*:[[:space:]]*"(0x[0-9a-fA-F]+)".*/\1/p' <<<"${response}")"
  if [[ -z "${block_hex}" ]]; then echo "Block synchronization check returned no eth_blockNumber result for ${RPC_HOST}:${port}: ${response}" >&2; exit 1; fi
  block_digits="${block_hex#0x}"
  block_number=$((16#${block_digits}))
  if [[ -z "${minimum_block}" || block_number -lt minimum_block ]]; then minimum_block="${block_number}"; fi
  if (( block_number > maximum_block )); then maximum_block="${block_number}"; fi
done
if (( minimum_block <= initial_block )); then echo "Block production check failed: height remained at ${initial_block}." >&2; exit 1; fi
if (( maximum_block - minimum_block > 1 )); then echo "Block synchronization check failed: node heights ranged from ${minimum_block} to ${maximum_block}." >&2; exit 1; fi
echo "Block production and synchronization verified: ${minimum_block}-${maximum_block}"

for ((i=0; i<ACTIVE_COUNT; i++)); do
  port=$((BASE_RPC + i))
  response="$(curl -fsS --max-time 2 -H 'Content-Type: application/json' --data '{"jsonrpc":"2.0","method":"net_peerCount","params":[],"id":1}' "http://${RPC_HOST}:${port}")" || { echo "Peer connectivity RPC failed for ${RPC_HOST}:${port}" >&2; exit 1; }
  peer_hex="$(sed -nE 's/.*"result"[[:space:]]*:[[:space:]]*"(0x[0-9a-fA-F]+)".*/\1/p' <<<"${response}")"
  if [[ -z "${peer_hex}" ]]; then echo "Peer connectivity check returned no net_peerCount result for ${RPC_HOST}:${port}: ${response}" >&2; exit 1; fi
  peer_digits="${peer_hex#0x}"
  peer_count=$((16#${peer_digits}))
  if (( peer_count < MIN_PEERS )); then echo "Peer connectivity check failed for ${RPC_HOST}:${port}: ${peer_count} peers, expected at least ${MIN_PEERS}." >&2; exit 1; fi
  echo "Peer connectivity verified for ${RPC_HOST}:${port}: ${peer_count} peers"
done

echo "Besu smoke network started: ${RUN_ROOT}"
echo "Protocol fixture: ${VALIDATOR_COUNT} generated validator keys; active smoke nodes: ${ACTIVE_COUNT}"
echo "RPC endpoints: http://${RPC_HOST}:${BASE_RPC} through http://${RPC_HOST}:$((BASE_RPC + ACTIVE_COUNT - 1))"
echo "P2P host: ${P2P_HOST}; bootnode: ${BOOTNODE}"
echo "This launcher validates RPC startup and actual peer connectivity only; custom BEL QBFT lifecycle requires the external Besu runtime."
wait
