#!/usr/bin/env bash
set -euo pipefail
command -v setsid >/dev/null 2>&1 || { echo "This launcher requires a Linux environment with setsid (use WSL or native Linux)." >&2; exit 1; }

# Explicit runtime profile. The prototype profile changes only the generated
# QBFT genesis fixture; it does not change BEL's application validator
# governance or ValidatorRegistry.minimumPopulation(), which remain 70.
PROFILE="${BEL_EXECUTION_PROFILE:-prototype}"
KEEP_RUNNING="${BEL_SMOKE_KEEP_RUNNING:-false}"
if [[ "${PROFILE}" == "prototype" ]]; then
  VALIDATOR_COUNT="${BEL_PROTOTYPE_QBFT_VALIDATOR_COUNT:-4}"
  ACTIVE_COUNT="${BEL_SMOKE_INITIAL_NODES:-4}"
elif [[ "${PROFILE}" == "production" ]]; then
  VALIDATOR_COUNT="${BEL_PROTOCOL_VALIDATOR_COUNT:-70}"
  ACTIVE_COUNT="${BEL_SMOKE_INITIAL_NODES:-70}"
else
  echo "BEL_EXECUTION_PROFILE must be production or prototype." >&2
  exit 1
fi
BASE_P2P="${P2P_PORT:-31303}"
BASE_RPC="${RPC_PORT:-8645}"
P2P_HOST="${P2P_HOST:-${NODE_IP:-127.0.0.1}}"
RPC_HOST="${RPC_HOST:-127.0.0.1}"
BOOTNODE_HOST="${BOOTNODE_HOST:-${P2P_HOST}}"
BOOTNODE_PORT="${BOOTNODE_PORT:-${BASE_P2P}}"
MIN_PEERS="${BEL_SMOKE_MIN_PEERS:-1}"
BLOCK_WAIT_SECONDS="${BEL_SMOKE_BLOCK_WAIT_SECONDS:-45}"
if [[ "${PROFILE}" == "production" && ${VALIDATOR_COUNT} -lt 70 ]]; then echo "Production profile requires the unchanged 70-validator protocol configuration." >&2; exit 1; fi
if [[ "${PROFILE}" == "prototype" && ${VALIDATOR_COUNT} -ne 4 ]]; then echo "Prototype profile requires exactly four QBFT validators." >&2; exit 1; fi
if (( ACTIVE_COUNT != VALIDATOR_COUNT )); then echo "Active Besu validators must equal the profile genesis validator count (${VALIDATOR_COUNT})." >&2; exit 1; fi
if ! [[ "${MIN_PEERS}" =~ ^[0-9]+$ ]] || (( MIN_PEERS < 1 )); then echo "BEL_SMOKE_MIN_PEERS must be a positive integer." >&2; exit 1; fi
if ! [[ "${BLOCK_WAIT_SECONDS}" =~ ^[0-9]+$ ]] || (( BLOCK_WAIT_SECONDS < 2 )); then echo "BEL_SMOKE_BLOCK_WAIT_SECONDS must be at least 2 seconds." >&2; exit 1; fi
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BESU="${ROOT}/besu/build/install/besu/bin/besu-untuned"
RUN_ROOT="${BEL_BESU_RUN_ROOT:-${ROOT}/.bel-demo/smoke-$(date +%Y%m%d-%H%M%S)}"
CONFIG="${RUN_ROOT}/config"
GENERATED="${RUN_ROOT}/generated"
NODES="${RUN_ROOT}/nodes"
mkdir -p "${CONFIG}" "${GENERATED}" "${NODES}"

if [[ ! -x "${BESU}" ]]; then
  echo "Besu distribution not found: ${BESU}. Build it with JDK 21 and installDist first." >&2
  exit 1
fi

# Integration callers set BEL_TEST_ACCOUNT_KEYS_FILE to an ephemeral file of
# private keys. The prototype launcher owns the file and keeps it below the
# ignored .bel-demo runtime directory; it is never printed or committed.
TEST_ACCOUNT_KEYS_FILE="${BEL_TEST_ACCOUNT_KEYS_FILE:-${RUN_ROOT}/test-account-keys}"
if [[ "${BEL_REQUIRE_TEST_ACCOUNTS:-false}" == "true" && ! -s "${TEST_ACCOUNT_KEYS_FILE}" ]]; then
  command -v node >/dev/null 2>&1 || { echo "Node.js is required to generate ephemeral Besu test accounts." >&2; exit 1; }
  node -e 'const fs=require("node:fs"); const {Wallet}=require("ethers"); fs.writeFileSync(process.argv[1], Array.from({length:20},()=>Wallet.createRandom().privateKey).join("\n"), {mode:0o600});' "${TEST_ACCOUNT_KEYS_FILE}"
fi
if [[ -s "${TEST_ACCOUNT_KEYS_FILE}" ]]; then
  chmod 600 "${TEST_ACCOUNT_KEYS_FILE}" 2>/dev/null || true
fi

cat > "${CONFIG}/network-config.json" <<EOF
{
  "genesis": {
    "config": {
      "chainId": 20260920,
      "berlinBlock": 0,
      "londonBlock": 0,
      "zeroBaseFee": true,
      "qbft": {
        "blockperiodseconds": 2,
        "epochlength": 30000,
        "requesttimeoutseconds": 4
      }
    },
    "nonce": "0x0",
    "timestamp": "0x$(printf '%x' "$(date +%s)")",
    "gasLimit": "0x1fffffffffffff",
    "difficulty": "0x1",
    "mixHash": "0x63746963616c2062797a616e74696e65206661756c7420746f6c6572616e6365",
    "coinbase": "0x0000000000000000000000000000000000000000"
  },
  "blockchain": { "nodes": { "generate": true, "count": ${VALIDATOR_COUNT} } }
}
EOF

if [[ -s "${TEST_ACCOUNT_KEYS_FILE}" ]]; then
  # Besu has no Anvil-only setBalance RPC. Fund only the ephemeral accounts
  # used by this run in genesis, before the chain is started.
  node -e '
    const fs=require("node:fs");
    const {Wallet}=require("ethers");
    const configPath=process.argv[1], keysPath=process.argv[2];
    const config=JSON.parse(fs.readFileSync(configPath,"utf8"));
    const keys=fs.readFileSync(keysPath,"utf8").split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    config.genesis.alloc=Object.fromEntries(keys.map(key=>[new Wallet(key).address.slice(2).toLowerCase(),{balance:"0x3635C9ADC5DEA0000000"}]));
    fs.writeFileSync(configPath, JSON.stringify(config,null,2)+"\n");
  ' "${CONFIG}/network-config.json" "${TEST_ACCOUNT_KEYS_FILE}"
fi

"${BESU}" operator generate-blockchain-config \
  --config-file="${CONFIG}/network-config.json" \
  --to="${GENERATED}" \
  --genesis-file-name=genesis.json

mapfile -t KEYS < <(find "${GENERATED}/keys" -mindepth 2 -maxdepth 2 -name key.priv | sort)
if (( ${#KEYS[@]} != VALIDATOR_COUNT )); then
  echo "Expected ${VALIDATOR_COUNT} generated Besu validator keys, found ${#KEYS[@]}" >&2
  exit 1
fi
VALIDATOR_METADATA_FILE="${CONFIG}/validator-public-keys.json"
PUB_FILES=()
for key in "${KEYS[@]}"; do PUB_FILES+=("$(dirname "${key}")/key.pub"); done
node -e '
  const fs = require("node:fs");
  const { computeAddress } = require("ethers");
  const output = process.argv[1];
  const keyFiles = process.argv.slice(2);
  const validators = Object.fromEntries(keyFiles.map((file) => {
    const publicKey = fs.readFileSync(file, "utf8").trim();
    return [computeAddress(`0x04${publicKey.replace(/^0x/, "")}`), publicKey];
  }));
  fs.writeFileSync(output, `${JSON.stringify({ validators }, null, 2)}\n`);
' "${VALIDATOR_METADATA_FILE}" "${PUB_FILES[@]}"
export BEL_VALIDATOR_PUBLIC_KEYS_FILE="${VALIDATOR_METADATA_FILE}"
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
  MINER_COINBASE="$(basename "$(dirname "${KEYS[$i]}")")"
  JAVA_OPTS="-Xms64m -Xmx128m -XX:MaxMetaspaceSize=64m -Dbel.execution.profile=${PROFILE}" setsid nohup "${BESU}" \
    --genesis-file="${GENERATED}/genesis.json" \
    --data-path="${node}" \
    --node-private-key-file="${KEYS[$i]}" \
    --p2p-host="${P2P_HOST}" --p2p-port=$((BASE_P2P + i)) \
    --nat-method=NONE --bootnodes="${BOOTNODE}" --sync-mode=FAST --sync-min-peers=0 \
    --rpc-http-enabled --rpc-http-host="${RPC_HOST}" \
    --rpc-http-port=$((BASE_RPC + i)) \
    --rpc-http-api=ETH,NET,WEB3,ADMIN,QBFT --host-allowlist='*' \
    --min-gas-price=0 --miner-enabled --miner-coinbase="${MINER_COINBASE}" \
    --logging=INFO > "${node}/besu.log" 2>&1 < /dev/null &
  PIDS+=("$!")
  sleep 2
done
printf '%s\n' "${PIDS[@]}" > "${RUN_ROOT}/pids"

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
minimum_block=""
maximum_block=0
block_deadline=$((SECONDS + BLOCK_WAIT_SECONDS))
while (( SECONDS < block_deadline )); do
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
  if (( minimum_block > initial_block )); then break; fi
  sleep 2
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
echo "Execution profile: ${PROFILE}"
echo "QBFT fixture: ${VALIDATOR_COUNT} generated validator keys; active nodes: ${ACTIVE_COUNT}"
echo "RPC endpoints: http://${RPC_HOST}:${BASE_RPC} through http://${RPC_HOST}:$((BASE_RPC + ACTIVE_COUNT - 1))"
echo "P2P host: ${P2P_HOST}; bootnode: ${BOOTNODE}"
echo "Prototype/production QBFT block production and synchronization verified."
cat > "${RUN_ROOT}/run.json" <<EOF
{
  "runRoot": "${RUN_ROOT}",
  "genesis": "${GENERATED}/genesis.json",
  "generatedKeys": "${GENERATED}/keys",
  "validatorCount": ${VALIDATOR_COUNT},
  "baseP2pPort": ${BASE_P2P},
  "baseRpcPort": ${BASE_RPC},
  "profile": "${PROFILE}",
  "owner": "${BEL_RUN_OWNER:-manual}",
  "orchestrator": "${BEL_ORCHESTRATOR_NAME:-}",
  "chainId": 20260920,
  "testAccountKeys": "${TEST_ACCOUNT_KEYS_FILE}",
  "pids": [$(IFS=,; echo "${PIDS[*]}")]
}
EOF
if [[ "${KEEP_RUNNING}" == "true" ]]; then
  trap - EXIT INT TERM
  echo "Besu prototype left running; stop it with scripts/stop-besu-bel-demo.sh ${RUN_ROOT}"
fi
exit 0
