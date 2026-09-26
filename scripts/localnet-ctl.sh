#!/usr/bin/env bash
# localnet-ctl.sh stop   - stop the local validator and wait for its ports to free
# localnet-ctl.sh wait   - block until the local validator is voting
set -euo pipefail
case "${1:-}" in
  stop)
    pkill -x solana-test-val 2>/dev/null || true
    for _ in $(seq 1 60); do
      pgrep -x solana-test-val >/dev/null || ss -ltn | grep -qE ':(9900|8899) ' || exit 0
      sleep 0.5
    done
    echo "validator did not stop" >&2; exit 1 ;;
  wait)
    for _ in $(seq 1 120); do
      solana -ul validators 2>/dev/null | grep -q "1 current" && exit 0
      sleep 0.5
    done
    echo "validator not ready" >&2; exit 1 ;;
  *) echo "usage: $0 stop|wait" >&2; exit 1 ;;
esac
