# Threat model

Scope: the zeroSOL stake pool, the `zero_mobile` program, the API and the app.
Test clusters only; no mainnet funds are involved.

## Assets

- Users' SOL in the stake pool (represented by zeroSOL in their wallets).
- Staking rewards owed to the Shaka treasury.
- eSIM activation codes (whoever holds one can install the line).
- API sessions.

## Trust boundaries and controls

| Threat | Control |
| --- | --- |
| **Custody.** Zero steals or freezes deposits. | Deposits go to a widely used, unmodified SPL stake pool program (Sanctum's deployment of the SPL codebase), not a custom vault. zeroSOL sits in the user's wallet. The pool manager can change fees and validators but cannot move user funds. Withdrawal fees are 0. |
| **Fee change rug.** Manager raises fees. | Epoch and withdrawal fee changes only take effect after an epoch delay in the stake pool program, which gives holders time to exit. Deposit fee changes are immediate but only affect new deposits. Production should put the manager key behind a multisig. |
| **Fake entitlement.** A user gets service without holding zeroSOL. | The program checks the token account's mint and owner, and values it at the pool's live exchange rate read from the pool account, which is pinned to the configured address and owner program. |
| **Flash stake.** A user borrows zeroSOL, activates, then returns it. | Activation proves holdings at one instant. The API re-checks holdings before provisioning, and each period needs a new activation, so the exposure is at most one period of service. Production mitigations: time-weighted checks, or activating at period end (pay in arrears). |
| **Double activation** in one period. | The entitlement PDA is seeded by `(owner, period)`, so a second `init` fails. |
| **Wrong period.** Pre-activating future periods while funded. | `period` must equal the period computed from the on-chain clock. |
| **Config takeover.** Someone front-runs `initialize`. | `initialize` requires the signer to be the program's upgrade authority (checked through ProgramData). |
| **Session replay.** Reusing a signed sign-in message. | Nonces are single-use and consumed atomically, expire after 5 minutes, and the message is bound to the API's domain and chain. The signature is verified over the exact signed bytes. |
| **Session theft.** | Tokens are random 256-bit values stored hashed on the server, and in the OS keystore via `expo-secure-store` on the device. 7-day expiry, revoked on logout. |
| **Double provisioning.** | `UNIQUE(address, period, provider_mode)` in the database plus provider-side idempotency keys. Concurrent requests share one order (tested). |
| **Activation code leak.** | Codes are never logged, are masked in all API responses except an explicit authenticated reveal, and are hidden again after 60 seconds in the app. Nothing telecom-related goes on-chain. |
| **Stale pool DoS.** Deposits fail because nobody cranked the epoch update. | The API cranks every epoch, and the app adds the permissionless update instructions to the user's own transaction when the pool is stale. |
| **Misleading economics.** | Test-network and mock-provider chips are always visible. Yield is labelled measured or reference. Price source is shown. Estimates are called estimates. |

## Known limitations (demo)

- The admin and pool manager are single keys.
- The API is a single process with SQLite.
- The Shaka sandbox adapter is not wired yet (see `shaka-sandbox.md`).
- Localnet yield does not annualise meaningfully, so a reference APY is shown there.
