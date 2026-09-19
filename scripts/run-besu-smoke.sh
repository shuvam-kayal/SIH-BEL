#!/usr/bin/env bash
set -euo pipefail
command -v setsid >/dev/null 2>&1 || { echo "This launcher requires a Linux environment with setsid (use WSL or native Linux)." >&2; exit 1; }

# Infrastructure-only smoke test. This intentionally does not exercise BEL
# committee selection: BEL's protocol minimum remains N >= 70.
VALIDATOR_COUNT=70
ACTIVE_COUNT=4
BASE_P2P=31303
BASE_RPC=8645
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
BOOTNODE="enode://${PUB}@127.0.0.1:${BASE_P2P}"
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
    --p2p-host=127.0.0.1 --p2p-port=$((BASE_P2P + i)) \
    --nat-method=NONE --bootnodes="${BOOTNODE}" \
    --rpc-http-enabled --rpc-http-host=127.0.0.1 \
    --rpc-http-port=$((BASE_RPC + i)) \
    --rpc-http-api=ETH,NET,WEB3,ADMIN --host-allowlist='*' \
    --min-gas-price=0 --logging=INFO > "${node}/besu.log" 2>&1 < /dev/null &
  PIDS+=("$!")
  sleep 2
done

echo "Besu smoke network started: ${RUN_ROOT}"
echo "RPC endpoints: http://127.0.0.1:${BASE_RPC} through http://127.0.0.1:$((BASE_RPC + ACTIVE_COUNT - 1))"
echo "This is infrastructure-only QBFT smoke testing, not BEL consensus validation."
wait
