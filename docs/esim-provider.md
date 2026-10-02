# eSIM provider integration

The API talks to telecom providers through one interface,
[`MobileProvider`](../api/src/provider/types.ts). Two implementations exist:

| Mode | Class | Status |
| --- | --- | --- |
| `mock` (default) | `MockProvider` | Complete. Deterministic, credential-free, used by tests and judges. |
| `shaka_sandbox` | `ShakaSandboxProvider` | Skeleton. Every method throws until it is wired to the sandbox API. |

The first real adapter targets Shaka's wholesale eSIM API, which any developer
can use. It is deliberately unimplemented. Endpoint paths, the auth
scheme and payload fields have to come from Shaka's sandbox documentation, not
from guesses.

## What the adapter must do

| Method | Contract |
| --- | --- |
| `createOrder({ planCode, idempotencyKey })` | Order one eSIM for the plan. **Must be idempotent** on `idempotencyKey` (`<wallet>:<period>`): a retry returns the same order and never creates a second one. Use the provider's idempotency header if it has one; otherwise look up by a client reference before creating. |
| `getOrder(providerOrderId)` | Current status mapped to `pending` / `ready` / `failed`, the ICCID, and the LPA activation string (`LPA:1$<SM-DP+>$<matching id>`) once ready. |
| `getUsage(providerOrderId, dataTotalMb)` | Data used (MB), minutes and texts for the current period. |

Map provider payloads to these shapes inside the adapter; nothing Shaka-specific
should leak into `app.ts`. Activation codes are secrets: never log them (the
Fastify logger already redacts `activationCode`).

## Configuration

```bash
PROVIDER_MODE=shaka_sandbox
SHAKA_SANDBOX_BASE_URL=...   # server-side only
SHAKA_SANDBOX_API_KEY=...    # server-side only, never in the app or repo
```

`shaka_live` is rejected at startup on purpose.

## Checklist before switching the demo to the sandbox

- [ ] Sandbox docs and credentials obtained; credentials stored only in the API host's secret store.
- [ ] Adapter implemented from the docs; contract tests added using **sanitised** real sandbox responses.
- [ ] Confirmed the plan name, allowances and cost used in `api/src/plans.ts` are OK to show publicly.
- [ ] `npm test` still passes in mock mode (cloneability).
