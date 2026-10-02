#!/usr/bin/env bash
# One-shot devnet deployment: mobiloot program, lootSOL pool, program config.
# Needs ~4 devnet SOL in the CLI wallet (solana address; fund at https://faucet.solana.com).
# Re-runnable: each step skips work that is already done.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export CLUSTER=devnet
URL=https://api.devnet.solana.com
PROGRAM_KEYPAIR="$ROOT/keys/program/mobiloot-keypair.json"
PROGRAM_ID=$(solana address -k "$PROGRAM_KEYPAIR")

echo "payer $(solana address) has $(solana balance -u $URL)"

# 1. Program. Build if needed; deploy only if the account doesn't exist yet.
[[ -f anchor/target/deploy/mobiloot.so ]] || (cd anchor && anchor build)
if ! solana program show -u $URL "$PROGRAM_ID" >/dev/null 2>&1; then
  solana program deploy -u $URL anchor/target/deploy/mobiloot.so --program-id "$PROGRAM_KEYPAIR" --with-compute-unit-price 10000
else
  echo "program $PROGRAM_ID already deployed"
fi

# 2. Pick a healthy, low-commission validator unless VOTES is given.
if [[ -z "${VOTES:-}" ]]; then
  VOTES=$(curl -s $URL -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getVoteAccounts"}' | python3 -c '
import json,sys
v=[a for a in json.load(sys.stdin)["result"]["current"] if a["commission"]<=10 and a["epochVoteAccount"]]
v.sort(key=lambda a:-a["activatedStake"]); print(v[0]["votePubkey"])')
  echo "delegating to $VOTES"
fi
export VOTES SEED_SOL="${SEED_SOL:-1.35}" RESERVE_BUFFER_SOL="${RESERVE_BUFFER_SOL:-0.25}"

# 3. Pool, then program config pointing at it.
npm run -s pool:setup
npm -s -w ops run setup:program
echo
echo "Done. Public addresses are in config/devnet.json (commit it)."
echo "Run the API with CLUSTER=devnet, and build the app with EXPO_PUBLIC_API_URL pointing at it."
