#!/usr/bin/env bash
set -u

RUN_ROOT="${1:?usage: check-besu-bel-demo.sh <run-root> [count] [base-rpc-port]}"
COUNT="${2:-4}"
BASE_RPC="${3:-8645}"

for ((i=0; i<COUNT; i++)); do
  port=$((BASE_RPC + i))
  result="$(curl -s --max-time 5 -H 'Content-Type: application/json' \
    --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
    "http://127.0.0.1:${port}" || true)"
  printf 'rpc=%s %s\n' "${port}" "${result:-UNAVAILABLE}"
  client="$(curl -s --max-time 5 -H 'Content-Type: application/json' \
    --data '{"jsonrpc":"2.0","method":"web3_clientVersion","params":[],"id":3}' \
    "http://127.0.0.1:${port}" || true)"
  printf 'rpc=%s client=%s\n' "${port}" "${client:-UNAVAILABLE}"
done

printf '\nNode 001 log tail:\n'
tail -n 40 "${RUN_ROOT}/nodes/node-001/besu.log" 2>/dev/null || true

printf '\nPeer counts:\n'
for ((i=0; i<COUNT; i++)); do
  port=$((BASE_RPC + i))
  peers="$(curl -s --max-time 5 -H 'Content-Type: application/json' \
    --data '{"jsonrpc":"2.0","method":"net_peerCount","params":[],"id":2}' \
    "http://127.0.0.1:${port}" || true)"
  printf 'rpc=%s peers=%s\n' "${port}" "${peers:-UNAVAILABLE}"
done
