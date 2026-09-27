#!/usr/bin/env bash
set -euo pipefail

RUN_ROOT="${1:?usage: stop-besu-bel-demo.sh <run-root>}"
if [[ ! -d "${RUN_ROOT}" ]]; then
  echo "Run root does not exist: ${RUN_ROOT}" >&2
  exit 1
fi

if [[ -f "${RUN_ROOT}/pids" ]]; then
  while IFS= read -r pid; do
    [[ -n "${pid}" ]] && kill "${pid}" 2>/dev/null || true
  done < "${RUN_ROOT}/pids"
fi

echo "Stopped Besu processes recorded in ${RUN_ROOT}"