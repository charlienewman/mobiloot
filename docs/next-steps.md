# Next steps (need a human)

Everything below needs Charlie's accounts, keys or judgement. The code side is ready.

## 1. Deploy to devnet (about 20 minutes)

The devnet faucet was rate-limited for this machine when the build was done.

1. Fund the CLI wallet with about 4 devnet SOL: `solana address`, then
   <https://faucet.solana.com> (GitHub login allows larger airdrops).
2. `./scripts/deploy-devnet.sh`. This deploys the program (about 2.2 SOL of
   rent), creates the lootSOL pool delegated to a healthy low-commission
   validator, and initialises the program config.
3. Commit `config/devnet.json`. Back up `keys/` somewhere safe (it holds the
   program upgrade key, pool keys and the treasury key; it is git-ignored).

## 2. Host the API

`docker build -f api/Dockerfile -t mobiloot-api .`, then run with:

```
CLUSTER=devnet
SIGN_IN_DOMAIN=mobiloot.com     # must match the app identity domain
CRANK_KEYPAIR=/secrets/crank.json # any funded devnet keypair; pays epoch updates
```

Mount a volume at `/data` for the SQLite database. Any HTTPS host works
(Fly.io, Railway, a VM).

## 3. Make the wallet show "verified" instead of "unverified"

Wallets verify the app identity `https://mobiloot.com` using Android Digital
Asset Links. Serve `https://mobiloot.com/.well-known/assetlinks.json` with the
release signing certificate's SHA-256 (from `apksigner verify --print-certs`):

```json
[{ "relation": ["delegate_permission/common.handle_all_urls"],
   "target": { "namespace": "android_app", "package_name": "com.mobiloot.app",
               "sha256_cert_fingerprints": ["<SHA-256>"] } }]
```

If `mobiloot.com` isn't wanted, change `APP_IDENTITY.uri` in
`app/constants/env.ts` and `SIGN_IN_DOMAIN` together.

## 4. Build the submission APK

```bash
MOBILOOT_KEYSTORE_PASSWORD=... EXPO_PUBLIC_API_URL=https://<api-host> ./scripts/build-apk.sh
```

This creates `keys/release.keystore` on first run. **Back it up**: the dApp
Store requires every update to be signed with the same key. The script prints
the certificate and APK SHA-256.

Test on a physical phone with a real MWA wallet (Seed Vault, Phantom or
Solflare, set to devnet) before recording.

## 5. eSIM provider

- [x] Live Shaka eSIMs for allowlisted wallets (`ShakaLiveProvider`,
  [esim-provider.md](esim-provider.md)).
- [x] Price the plan at the real retail price: £10/month unlimited.
- [ ] Part-funded plans: pay the remainder in USDC or by card ([economics.md](economics.md)).

## 6. Competition admin

- [x] Registered on Align as an individual (2 Oct 2026).
- [ ] Optional but recommended: email `hackathon@radiant.nexus` with a one-line
  disclosure (independent personal entry, unfunded; Charlie is a minority
  shareholder in Shaka, whose public eSIM API is the planned provider). Keep
  the reply.
- [ ] Push the repo to GitHub, public or accessible to judges. Commit history
  starts 26 Sep 2026.
- [ ] Record the demo from [demo-script.md](demo-script.md), make the deck,
  and submit by **7 October** (the hard close is 8 Oct 23:59 in an unstated
  time zone).

## Ideas not built (in priority order)

1. An Android home-screen widget showing data left, funding % and days to renewal (stickiness).
2. A renewal reminder notification a day before the period ends.
3. An SKR angle for the $10k SKR prize, e.g. an SKR-staked tier or helper
   rewards. Only claim it with a real SKR integration.
4. Community support (help-to-earn) from the original spec.
