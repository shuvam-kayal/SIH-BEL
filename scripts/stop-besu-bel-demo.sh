#!/usr/bin/env bash
set -euo pipefail

RUN_ROOT="${1:-}"
if [[ -z "${RUN_ROOT}" ]]; then
  echo "No Besu run root was established; nothing to stop." >&2
  exit 1
fi
if [[ ! -d "${RUN_ROOT}" ]]; then
  echo "Run root does not exist: ${RUN_ROOT}" >&2
  exit 0
fi

if [[ -f "${RUN_ROOT}/pids" ]]; then
  while IFS= read -r pid; do
    [[ -n "${pid}" ]] && kill "${pid}" 2>/dev/null || true
  done < "${RUN_ROOT}/pids"
fi

echo "Stopped Besu processes recorded in ${RUN_ROOT}"
