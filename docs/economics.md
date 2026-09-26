# Economics

## The mechanism

zeroSOL is an SPL stake pool token with a **100% epoch fee**:

1. A user deposits SOL and receives zeroSOL at the pool's exchange rate (~1:1).
2. The pool delegates the SOL to validators.
3. At each epoch boundary the pool is updated. The rewards it earned are
   captured as the epoch fee and minted as zeroSOL to the **Shaka treasury**.
4. Because all rewards go to the fee, the exchange rate stays at ~1 SOL per
   zeroSOL. Depositors keep their principal; Shaka receives the yield.
5. Withdrawal fees are 0, so users can leave at any time.

Verified on localnet (`npm run pool:status` after a few epochs):

```
total staked      20.0017 SOL
zeroSOL supply    20.0017  (1 zeroSOL = 1.000000000 SOL)
epoch fee         100/100 → Shaka treasury
treasury earned   0.0017 zeroSOL ≈ 0.0017 SOL
```

## Sizing a plan

For a plan with wholesale cost `C` per month, pool yield `Y` and SOL price `P`:

```
stake needed (SOL) = 12 · C / (Y · P)
```

The app computes this live from the pool's measured yield (the last epoch's
inflation rewards on the pool's validator stake accounts, annualised) and SOL's
price from Pyth's on-chain SOL/USD account.

| Plan cost | Yield | SOL price | Stake needed |
| ---: | ---: | ---: | ---: |
| $6/mo | 6.8% | $120 | 8.8 SOL |
| $6/mo | 6.8% | $200 | 5.3 SOL |
| $10/mo | 6.8% | $120 | 14.7 SOL |

That is a real amount of capital, which is why the starting audience is Seeker
owners and SOL holders who already stake, not everyone.

## Where the thresholds live

- **On-chain unlock threshold**: `min_stake_lamports` in the program config.
  On mainnet this would be set to the stake that fully funds the plan (plus a
  buffer). On devnet it is 0.5 SOL so anyone can try the flow; the app says so.
- **Plan cost assumption**: `monthlyCostUsd` in `api/src/plans.ts`
  (illustrative, not Shaka pricing).

## Risks the model has to price in

- **SOL price and yield move.** A stake that covers the plan today may not
  tomorrow. Production needs a buffer above break-even and a policy for
  under-funded periods (a top-up prompt, a smaller plan, or pausing renewal).
- **Paid in arrears.** Rewards arrive after each epoch, but service is delivered
  during the period. The API re-checks holdings before provisioning; each period
  needs a new activation.
- **Validator performance** and commission reduce yield.
- **Regulation.** Taking yield as payment for a telecom service still counts as
  payment. VAT, consumer and financial-promotion rules apply to a real launch.

## Production path

- Launch zeroSOL on mainnet through Sanctum so it gets liquidity
  (instant exits via Infinity) and wallet support.
- Put the manager and admin keys behind a multisig.
- Consider a lower epoch fee, with the surplus above plan cost shared back to
  the holder.
- Option A for maximum self-custody: a Shaka validator at 100% commission.
  Users delegate their own stake accounts, and the program verifies the
  delegation instead of zeroSOL holdings.
