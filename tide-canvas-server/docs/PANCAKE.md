# Framelyn — Waffo Pancake one-time credit purchases

The shared Go API owns users, USD plans, immutable purchase snapshots, orders
and the precise credit ledger. `tide-canvas-payments` is a stateless, loopback-only
Node service using the requested `@waffo/pancake-ts` SDK (pinned to 0.26.0).
The EN frontend has no payment secrets and no separate ledger.

The existing store is `STO_5sCh2znmw67eD0IDcdYF7r`, merchant
`MER_2HQcr4GpEfaaTxdlz2EhR4`. The test one-time product is
`PROD_1MtsJWKNihc87buXVcS4WE`. The new private key has not been supplied.
No production channel, product or payment has been enabled remotely.

## Local test setup

1. Copy `tide-canvas-payments/.env.example` to `.env` in that directory (ignored).
   Enter the existing **one-time** product ID, and `WAFFO_PRIVATE_KEY_FILE` pointing
   to a newly generated test private key. Do not use the key pasted into chat.
   Alternatively, set `WAFFO_PRIVATE_KEY`; the SDK accepts PEM, raw base64, or escaped
   newlines. Never copy a key into the frontend, repository, build args or image.
2. Generate `PAYMENTS_INTERNAL_TOKEN` using the command in the template. Use this
   same token in the backend config below. It authenticates Go → SDK calls; it is
   **not** the Waffo private key or webhook public key.
3. In `tide-canvas-payments`, run `npm ci`, `npm run build`, then
   `node --env-file=.env dist/server.js`. It listens on `127.0.0.1:8083`.
4. Supply the Go process with these variables **in its process environment**.
   The Go server does not automatically load a shell `.env` file:

   ```dotenv
   TIDECANVAS_ENV=test
   TIDECANVAS_PANCAKE_ENABLED=true
   TIDECANVAS_PANCAKE_ADAPTERURL=http://127.0.0.1:8083
   TIDECANVAS_PANCAKE_INTERNALTOKEN=<same-random-internal-token>
   TIDECANVAS_PANCAKE_STOREID=STO_5sCh2znmw67eD0IDcdYF7r
   TIDECANVAS_PANCAKE_PRODUCTID=PROD_1MtsJWKNihc87buXVcS4WE
   TIDECANVAS_PANCAKE_SITEURL=http://localhost:3100
   ```

   Use an isolated TEST database and backend. An English local dev server pointing
   at `https://flowlight.tcmzhan.com` still uses production accounts and credits;
   change EN `BACKEND_URL` to the local test backend, e.g. `http://127.0.0.1:8081`.
   Restart the backend and the EN dev server after changing runtime settings.
5. FlowLight admin → payment channels: type **`pancake`**, name **Waffo Pancake**,
   enabled. Keep existing CNY channels intact. Pricing → EN · USD: maintain and
   publish actual pack prices and credit allowances; no default paid packs are seeded.
6. Register a TEST HTTP webhook on the existing Pancake store. For local development,
   run `ngrok http 8081` and register:

   `https://<your-ngrok-host>/api/billing/pancake/webhook`

   Subscribe to `order.completed` and `refund.succeeded`. The adapter verifies the
   **raw** body with the SDK and explicitly pins the test or prod verification key.
   SDK environment-specific public-key rotation overrides remain supported.
   Do not put JWT login, CAPTCHA or body rewriting on this endpoint.
7. Buy from the EN site while signed in. The invoice page opens hosted checkout in
   a **new tab**. Use Waffo's TEST Visa `4576750000000110`, any future expiry and CVC.
   Return to the invoice and check payment status. For a refusal use
   `4576750000000220`. Never enter real card details for this test.

## Pricing, ownership and delivery

- A single Waffo one-time product is the base product; the Go backend computes each
  pack's authoritative amount and the SDK sends a **display string** (e.g. `12.50`)
  as `priceSnapshot.amount`. The SDK checks the product belongs to the configured
  store and is a one-time product before creating a session.
- SDK 0.26.0 defaults to **tax-exclusive** prices and no longer accepts the skill's
  old `taxIncluded` or `productType` fields. The EN confirmation explicitly says
  taxes may be added. Local `amount` is the pack subtotal, `taxTotal` and
  `chargedTotal` are recorded separately from provider data. Admin subtotal revenue
  excludes customer tax collected by the MoR and is not a net payout report.
- The backend commits the order before contacting Waffo. It supplies an immutable
  random nonce, buyer ID, local order ID and stable idempotency key. API errors reuse
  the original order; a switch between Stripe/Pancake also reuses an unpaid pack.
- A verified event is a notification, not sufficient evidence to grant credits:
  the backend re-reads Waffo's canonical order/payments using the SDK's GraphQL client,
  verifies store, environment, product, USD amount, nonce, owner and local reference,
  and atomically updates order + ledger. It never matches purchases by email alone.
- Callback acknowledgment follows the database commit. The skill's immediate-200
  example is not used: this project has no durable asynchronous webhook queue.
  Failures return non-2xx so the provider can retry. Duplicate deliveries and manual
  verification race safely against the same order transaction.
- Full/partial successful refunds synchronize cumulative returned cash and recover
  the proportional whole-credit allowance once, preserving held/fractional balances.
  A full refund received before the purchase notification grants no credits or VIP.
  Already consumed credits cannot be recovered; debits stop at available balance.
  Refunds do not downgrade membership, matching the shared account's upgrade-only rule.
  Initiate cash refunds in **Pancake**, not the old admin accounting-refund button.

## Recovery limits requiring Sandbox verification

- Waffo can consume checkout sessions and create replacement sessions when buyers
  press Back. Never mint another local order automatically or guess ownership when
  metadata disappears. Unmatched callbacks return 422 for manual reconciliation.
- There is no documented API to revoke an unconsumed checkout session. Once creation
  has been attempted, the EN site does not offer a misleading local Cancel button.
  Expired/uncertain sessions remain visible; contact support to reconcile provider
  state before another same-pack purchase. Pending provider orders are shown as
  awaiting provider confirmation, not evidence of a completed charge.
- Multiple paid provider orders for one local reference require manual reconciliation;
  they never cause a second automatic credit grant. Do not blindly resubmit payment.
- RSA API keys are opaque: `WAFFO_ENV` controls verification and customer-session
  scope, but merchant API mode is determined by the issued key. Use a **test key**
  for local tests. A configured string is not proof that a key was issued in test mode.
- Provider GraphQL examples are not perfectly consistent across documentation versions.
  Run `npm run check:waffo` after credentials are supplied to validate the live schema,
  merchant/store/product access and webhook list before enabling checkout.

## Deployment

Pushes to `flowingLight` also build `ghcr.io/vit4ss/tide-canvas-payments:latest`.
Merge `deploy/compose.pancake.yml` into the existing shared-backend Compose file:

```sh
docker compose -f docker-compose.yml -f compose.pancake.yml pull backend frontend payments
docker compose -f docker-compose.yml -f compose.pancake.yml up -d backend frontend payments
```

Enter private values in the host's ignored `.env` or secret manager. This overlay
does not change the backend's `TIDECANVAS_ENV`: it must equal adapter `WAFFO_ENV`.
Use `test` + test credentials + `https://test-framelyn.tcmzhan.com` for test; use
`prod` + production credentials + `https://framelyn.tcmzhan.com` for production.
Keep databases isolated. Publish the one-time product and complete merchant review
before production; this implementation does not automatically publish anything.
Update the EN image from `flowlight-en` as well.

The existing Nginx `/api/` → backend proxy serves
`/api/billing/pancake/webhook`; do **not** expose port 8083 publicly.
The public webhook only verifies signatures and reconciles owned orders; internal
adapter operations require the separate token and run over loopback.

## Validation

`tide-canvas-payments`: `npm test` (SDK requests, signatures, scope, tax, refunds,
timeouts and internal authentication). Go: `go test ./internal/handler/billing
./internal/config`, plus the existing payment admin tests. EN: `npm test`,
`npm run test:pancake`, `npm run test:stripe`, lint and production build.

These fixtures do not make real provider transactions. Live test checkout, key mode,
actual schema, webhook delivery and payout eligibility still require account access.

Sources: [official skill](https://docs.waffo.ai/zh/integrate/skill),
[SDK](https://github.com/waffo-com/waffo-pancake-sdk-ts),
[orders queries](https://docs.waffo.ai/api-reference/endpoints/graphql/orders-and-payments).
