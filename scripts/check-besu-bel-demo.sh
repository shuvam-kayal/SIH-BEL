#!/usr/bin/env bash
set -u

RUN_ROOT="${1:-}"
COUNT="${2:-4}"
BASE_RPC="${3:-8645}"

printf 'Besu diagnostics: run_root=%s count=%s base_rpc=%s\n' "${RUN_ROOT:-<unset>}" "${COUNT}" "${BASE_RPC}"

if [[ -z "${RUN_ROOT}" ]]; then
  echo "No Besu run root was established before startup failed."
else
  printf '\nRun-root contents:\n'
  find "${RUN_ROOT}" -maxdepth 3 -type f -printf '%p\n' 2>/dev/null | sort || true
  printf '\nPID file:\n'
  if [[ -f "${RUN_ROOT}/pids" ]]; then
    cat "${RUN_ROOT}/pids"
    while IFS= read -r pid; do
      [[ -n "${pid}" ]] || continue
      printf '\nProcess status for PID %s:\n' "${pid}"
      ps -fp "${pid}" || true
    done < "${RUN_ROOT}/pids"
  else
    echo "PID file unavailable"
  fi
  for file in "${RUN_ROOT}/startup.log" "${RUN_ROOT}/config/network-config.json" "${RUN_ROOT}/generated/genesis.json"; do
    printf '\n===== %s =====\n' "${file}"
    if [[ -f "${file}" ]]; then cat "${file}"; else echo "unavailable"; fi
  done
  for log in "${RUN_ROOT}"/nodes/node-*/besu.log; do
    [[ -f "${log}" ]] || continue
    printf '\n===== %s (tail) =====\n' "${log}"
    tail -n 100 "${log}" || true
  done
fi

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

printf '\nPeer counts:\n'
for ((i=0; i<COUNT; i++)); do
  port=$((BASE_RPC + i))
  peers="$(curl -s --max-time 5 -H 'Content-Type: application/json' \
    --data '{"jsonrpc":"2.0","method":"net_peerCount","params":[],"id":2}' \
    "http://127.0.0.1:${port}" || true)"
  printf 'rpc=%s peers=%s\n' "${port}" "${peers:-UNAVAILABLE}"
done
