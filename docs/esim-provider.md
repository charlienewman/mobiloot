# eSIM provider integration

The API talks to telecom providers through one interface,
[`MobileProvider`](../api/src/provider/types.ts). There are two implementations,
and the provider is chosen **per wallet**:

| Mode | Class | Who gets it |
| --- | --- | --- |
| `mock` | `MockProvider` | Everyone by default. Deterministic, credential-free, used by tests and anyone cloning the repo. |
| `shaka_live` | `ShakaLiveProvider` | Wallets listed in `LIVE_ESIM_WALLETS`, when `SHAKA_API_KEY` is set. Real eSIMs on Shaka's UK network. |

The app is on devnet, where SOL is free, so real lines are invitation-only. Add a
wallet to the allowlist to give it a real eSIM.

## Live lines (`api/src/provider/shaka.ts`)

Shaka's Nexus API v1.3 (`Authorization: Api-Key …`). The flow:

1. **Subscriber**, one per wallet, with the reference `mobiloot-<cluster>-wallet-<address>`.
   Wallets have no name or email, so the subscriber gets a placeholder name and a
   non-delivering `@users.mobiloot.com` address.
2. **New-subscription journey** on the configured plan, with the reference
   `mobiloot-<cluster>-line-<uuid>`. Shaka answers with a journey ID; the eSIM is
   ready once the subscription is `active`, its SIM is an `active` eSIM, and
   installation data exists.
3. **Install.** `POST /v1/esim/reveal` fetches `esim_data` on demand (Mobiloot never
   stores activation codes for live lines). It returns the LPA string, its parts, and
   Google's install link
   (`https://esimsetup.android.com/esim_qrcode_provisioning?carddata=…`). The app's
   **Install on this phone** button opens that link, so Android's own eSIM installer
   starts with the code filled in.
4. **Coverage.** A wallet keeps one line across periods. The line is suspended
   (`suspend-sim` journey) while the wallet's lootSOL doesn't cover the plan, or when
   it hasn't unlocked the current period, and unsuspended once it does.

Reliability rules:

- Idempotency keys and references are saved before each request. Accepted IDs are
  saved as soon as they come back.
- A timeout, 429 or 5xx is retried with the **same** key, with backoff. Recovery
  looks up the subscriber and subscription by their exact reference, walking every
  page, and falls back to the subscription's `journeys.created_by`. More than one
  match stops the line for review, and it never adopts the "newest" line.
- 401, 403, 400 and 422 during provisioning stop the line (`needs_review`) rather
  than retrying. A line that is already working stays usable through API errors.
- Each line runs one step at a time. A 15-second reconciler moves lines along;
  webhooks only make that happen sooner.

The single-step design and the in-process lock assume **one API instance**, which is
how it runs on Railway. Scaling out would need a database lock.

### Webhooks

`POST /v1/webhooks/shaka`: verifies `Shaka-Signature: t=…,v1=…` (HMAC-SHA256 of
`t.` plus the raw body) and accepts delayed retries for up to 3 days. It dedupes on
`idempotency_id` and stores no payloads. An event only schedules a re-read of a line
Mobiloot owns, because the key is shared with other apps on the same Shaka account.
Journeys carry `webhook_url` only when `SHAKA_WEBHOOK_URL` is set, so the
account-wide callback is never changed.

## Configuration (API host only, never the app)

```bash
SHAKA_API_KEY=…                # secret
SHAKA_WEBHOOK_SECRET=…         # secret
SHAKA_BASE_URL=https://nexus.shaka.tel/api/v0-0-0   # default
SHAKA_PLAN_ID=58               # Shaka plan behind Mobiloot Unlimited (default)
SHAKA_WEBHOOK_URL=https://<api host>/v1/webhooks/shaka   # optional
SHAKA_REFERENCE_PREFIX=mobiloot-devnet                   # default: mobiloot-<cluster>
LIVE_ESIM_WALLETS=<wallet>,<wallet>
TEST_GRANT_WALLETS=<wallet>    # optional: may order without staking, for testing
SHAKA_ADULT_SERVICES=true      # optional: match Shaka's pre-activated eSIMs (fast activation)
```

With `SHAKA_API_KEY` unset, everyone gets the mock. A `TEST_GRANT_WALLETS` wallet skips
the entitlement and stake checks, and its line is never suspended for low stake. Use it
to test provisioning on its own, then remove it. `npm test` uses an in-memory fake
Shaka (`api/test/shaka.test.ts`) and never touches real stock.

## Operations

- **A line stuck in `needs_review`.** Read `last_error` and `last_request_id` in
  `shaka_lines`, then fix the cause in Shaka. Setting `state='provisioning'` lets it
  resume with the same keys.
- **Don't delete `shaka_lines` rows.** They hold the idempotency identity. Recreating
  a row would order a second eSIM.
