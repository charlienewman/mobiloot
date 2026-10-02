# Architecture

```
 Android app (Expo / React Native)
   │  Mobile Wallet Adapter 2.0: authorize + Sign In With Solana, sign transactions
   │
   ├──► Solana ────────────────────────────────────────────────────────────┐
   │     • SPL stake pool (Sanctum SP12t…): DepositSol / WithdrawSol       │
   │       lootSOL mint, 100% epoch fee → Mobiloot treasury                   │
   │     • mobiloot program: activate(period) → Entitlement PDA         │
   │                                                                       │
   └──► Mobiloot API (Fastify, SQLite) ◄──── reads program + pool accounts ────┘
          • SIWS sessions
          • verifies entitlement + holdings → orders eSIM (idempotent)
          • pool stats, Pyth SOL price, epoch crank
          └──► MobileProvider: MockProvider | ShakaSandboxProvider
```

## Repository

| Path | What |
| --- | --- |
| `app/` | Android app. Screens in `app/app`, data/transactions in `app/features`. |
| `anchor/` | `mobiloot` Anchor program; committed IDL in `anchor/idl`. |
| `shared/` | Dependency-light TypeScript used by the app, API and scripts: a program-id-aware stake pool client and the `mobiloot` client. |
| `api/` | Backend. `src/app.ts` routes, `src/auth.ts` SIWS, `src/provider/` telecom adapters. |
| `ops/` | Pool setup, program config setup, epoch crank, status. |
| `config/` | Public per-cluster addresses written by the setup scripts. |
| `scripts/` | Local validator helpers. |

## Decisions

- **No custody code.** Deposits and withdrawals use the SPL stake pool program
  as-is. Mobiloot's own program only reads balances and records entitlements, which
  keeps the audit surface small.
- **Sanctum's SPL deployment, not SPoo1, on devnet.** The official SPoo1
  deployment on devnet predates the 1 SOL minimum delegation and can no longer
  add validators. The instruction set is the same, so the client takes the
  program id as a parameter.
- **Hand-written clients.** `shared/` builds instructions directly, with no
  Anchor TS runtime or stake pool SDK, so it bundles cleanly in React Native. A
  test checks the discriminators against the committed IDL.
- **Pool freshness.** Deposits fail on a pool not yet updated this epoch. The
  API cranks automatically, and the app prepends the permissionless update
  instructions to user transactions when needed.
- **One wallet handoff to connect.** The app sends the server's SIWS fields in
  MWA `authorize`, so connecting also signs the user in.
- **Simulate before signing.** Transactions are simulated before the wallet
  opens, so program errors ("not enough lootSOL") show in-app rather than as a
  failed wallet prompt.
- **Honesty as UI.** Network and provider chips are permanent, and yield and
  price sources are labelled.
