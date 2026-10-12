#!/usr/bin/env bash
# Local Solana validator for Mobiloot development.
#  - 64-slot epochs (~25 s), so staking rewards land within a minute
#  - the same stake pool and token metadata programs as devnet, dumped once
#    into .localnet/programs so later starts work offline
#  - the mobiloot program, if it has been built
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LEDGER="$ROOT/.localnet/ledger"
PROGRAMS="$ROOT/.localnet/programs"
# Sanctum's SPL stake pool fork: the official SPoo1 build on devnet predates the
# 1 SOL minimum delegation and can no longer add validators.
STAKE_POOL_PROGRAM=SP12tWFxD9oJsVWNavTTBZvMbA6gkAmxtVgxdqvyvhY
TOKEN_METADATA_PROGRAM=metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s

mkdir -p "$PROGRAMS"
for p in $STAKE_POOL_PROGRAM $TOKEN_METADATA_PROGRAM; do
  [[ -s "$PROGRAMS/$p.so" ]] || solana program dump -u devnet "$p" "$PROGRAMS/$p.so" >/dev/null
done

ARGS=(
  --bpf-program $STAKE_POOL_PROGRAM "$PROGRAMS/$STAKE_POOL_PROGRAM.so"
  --bpf-program $TOKEN_METADATA_PROGRAM "$PROGRAMS/$TOKEN_METADATA_PROGRAM.so"
)
if [[ -f "$ROOT/anchor/target/deploy/mobiloot.so" ]]; then
  # The declared id, so a fresh clone works without the program's keypair.
  PROGRAM_ID=$(sed -n 's/^declare_id!("\(.*\)");/\1/p' "$ROOT/anchor/programs/mobiloot/src/lib.rs")
  ARGS+=(--upgradeable-program "$PROGRAM_ID" "$ROOT/anchor/target/deploy/mobiloot.so" "$HOME/.config/solana/id.json")
fi
exec solana-test-validator --ledger "$LEDGER" --slots-per-epoch 64 "${ARGS[@]}" "$@"
