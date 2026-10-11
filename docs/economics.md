# Economics

## The mechanism

lootSOL is an SPL stake pool token with a **100% epoch fee**:

1. A user deposits SOL and receives lootSOL at the pool's exchange rate (~1:1).
2. The pool delegates the SOL to validators.
3. At each epoch boundary the pool is updated. The rewards it earned are
   captured as the epoch fee and minted as lootSOL to the **Mobiloot treasury**.
4. Because all rewards go to the fee, the exchange rate stays at ~1 SOL per
   lootSOL. Depositors keep their principal; the Mobiloot treasury receives the yield.
5. Withdrawal fees are 0, so users can leave at any time.

Verified on localnet (`npm run pool:status` after a few epochs):

```
total staked      20.0017 SOL
lootSOL supply    20.0017  (1 lootSOL = 1.000000000 SOL)
epoch fee         100/100 → Mobiloot treasury
treasury earned   0.0017 lootSOL ≈ 0.0017 SOL
```

## Sizing a plan

Mobiloot Unlimited is **£10 a month** (unlimited UK data, calls and texts on a live UK
MVNO). For a monthly price `C` in pounds, pool yield `Y`, SOL price `P` in dollars and
`F` dollars per pound:

```
stake needed (SOL) = 12 · C · F / (Y · P)
```

In pounds the target is fixed, about **£1,765 of staked SOL at 6.8%**; only the yield
changes it. SOL's price changes how many coins that is.

The app computes this live from the pool's measured yield (the last epoch's
inflation rewards on the pool's validator stake accounts, annualised) and SOL's
price from Pyth's on-chain SOL/USD account. On test clusters it uses the 6.8%
mainnet reference instead, because devnet and localnet rewards say nothing about
mainnet.

| Yield | SOL at $110 | SOL at $150 | SOL at $200 |
| ---: | ---: | ---: | ---: |
| 6.8% | 21.3 SOL | 15.6 SOL | 11.7 SOL |
| 7.5% (with MEV) | 19.3 SOL | 14.2 SOL | 10.6 SOL |

(£1 = $1.33.) That is real capital, so the plan is designed for partial funding:
the stake's yield covers what it can and the user pays the rest.

| You stake (6.8%, $110) | Yield pays | You pay |
| ---: | ---: | ---: |
| 5 SOL | £2.34 | £7.66 |
| 10 SOL | £4.69 | £5.31 |
| 15 SOL | £7.03 | £2.97 |
| 21 SOL | £10.00 | £0 |

## Part-funded plans (next)

At each renewal, if the stake covers less than 100%, the user pays the difference
in USDC (Solana Pay) or by card, or opts in to an SPL token allowance that lets
Mobiloot redeem just enough lootSOL each month. Unpaid, the line pauses after a
short grace period and resumes as soon as it's paid; the suspend and resume
machinery already exists (`api/src/coverage.ts`). Today the plan is all or
nothing at the on-chain threshold.

**VAT:** Mobiloot is below the UK VAT registration threshold today, so the full £10 is
revenue. Wholesale pricing improves with volume, which offsets VAT once registered.

## Where the thresholds live

- **On-chain unlock threshold**: `min_stake_lamports` in the program config.
  On mainnet this would be set to the stake that fully funds the plan (plus a
  buffer). On devnet it is 0.5 SOL so anyone can try the flow; the app says so.
- **Plan price**: `monthlyPriceGbp` in `api/src/plans.ts`; the dollar rate is
  `GBP_USD` (default 1.33).

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

- Launch lootSOL on mainnet through Sanctum so it gets liquidity
  (instant exits via Infinity) and wallet support.
- Put the manager and admin keys behind a multisig.
- Consider a lower epoch fee, with the surplus above plan cost shared back to
  the holder.
- Option A for maximum self-custody: a Mobiloot validator at 100% commission.
  Users delegate their own stake accounts, and the program verifies the
  delegation instead of lootSOL holdings.
