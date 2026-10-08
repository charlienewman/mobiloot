# Threat model

Scope: the lootSOL stake pool, the `mobiloot` program, the API and the app.
Test clusters only; no mainnet funds are involved.

## Assets

- Users' SOL in the stake pool (represented by lootSOL in their wallets).
- Staking rewards owed to the Mobiloot treasury.
- eSIM activation codes (whoever holds one can install the line).
- API sessions.

## Trust boundaries and controls

| Threat | Control |
| --- | --- |
| **Custody.** Mobiloot steals or freezes deposits. | Deposits go to a widely used, unmodified SPL stake pool program (Sanctum's deployment of the SPL codebase), not a custom vault. lootSOL sits in the user's wallet. The pool manager can change fees and validators but cannot move user funds. Withdrawal fees are 0. |
| **Fee change rug.** Manager raises fees. | Epoch and withdrawal fee changes only take effect after an epoch delay in the stake pool program, which gives holders time to exit. Deposit fee changes are immediate but only affect new deposits. Production should put the manager key behind a multisig. |
| **Fake entitlement.** A user gets service without holding lootSOL. | The program checks the token account's mint and owner, and values it at the pool's live exchange rate read from the pool account, which is pinned to the configured address and owner program. |
| **Stake relay.** A wallet activates and provisions, then passes its lootSOL to another wallet to do the same (or borrows it briefly). | Holdings are enforced continuously, not just at activation. Every `/v1/me`, `/reveal` and `/usage` call re-checks the wallet's lootSOL (across all its token accounts), and a background sweep re-checks every active line each minute. A line whose wallet drops below the threshold is suspended (`provider.suspend`) and resumes when it is covered again, so one stake backs at most one active line at a time. Residual risk: the window between sweeps (up to a minute) and provider suspension latency. Each period also needs a new on-chain activation. |
| **Double activation** in one period. | The entitlement PDA is seeded by `(owner, period)`, so a second `init` fails. |
| **Stale exchange rate.** Valuing lootSOL from a pool not yet updated this epoch. | `activate` requires the pool's `last_update_epoch` to equal the current epoch. The app prepends the permissionless update instructions. |
| **Wrong period.** Pre-activating future periods while funded. | `period` must equal the period computed from the on-chain clock. |
| **Config takeover.** Someone front-runs `initialize`. | `initialize` requires the signer to be the program's upgrade authority (checked through ProgramData). |
| **Session replay.** Reusing a signed sign-in message. | Nonces are single-use and consumed atomically and expire after 5 minutes. The signed message must carry the API's domain, URI and chain ID. The signature is verified over the exact signed bytes. |
| **Brute force / abuse.** | Per-IP rate limits: 240 req/min overall, 20/min on sign-in, provisioning and code reveal. |
| **Session theft.** | Tokens are random 256-bit values stored hashed on the server, and in the OS keystore via `expo-secure-store` on the device. 7-day expiry, revoked on logout. |
| **Double provisioning.** | `UNIQUE(address, period, provider_mode)` in the database plus provider-side idempotency keys. Concurrent requests share one order (tested). |
| **Activation code leak.** | Codes are never logged, are masked in all API responses except an explicit authenticated reveal, and are hidden again after 60 seconds in the app. Nothing telecom-related goes on-chain. |
| **Stale pool DoS.** Deposits fail because nobody cranked the epoch update. | The API cranks every epoch, and the app adds the permissionless update instructions to the user's own transaction when the pool is stale. |
| **Misleading economics.** | Test-network and mock-provider chips are always visible. Yield is labelled measured or reference. Price source is shown. Estimates are called estimates. |

## Known limitations (demo)

- The admin and pool manager are single keys.
- The API is a single process with SQLite. Set `TRUST_PROXY=true` behind a reverse proxy so rate limits see real client IPs.
- The mock provider keeps its orders in memory; a real provider must be idempotent on its side.
- The admin can change `period_origin`/`period_seconds`, which re-maps period IDs. Treat these as fixed after launch.
- Live eSIMs share a Shaka API key with other apps on the account; every reference is namespaced and every webhook is checked against Mobiloot's own lines (see `esim-provider.md`).
- Localnet yield does not annualise meaningfully, so a reference APY is shown there.
