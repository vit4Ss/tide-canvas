# Framelyn — Waffo Pancake one-time credit purchases

The shared Go API owns users, USD plans, immutable purchase snapshots, orders
and the precise credit ledger. `tide-canvas-payments` is a stateless, loopback-only
Node service using the requested `@waffo/pancake-ts` SDK (pinned to 0.26.0).
The EN frontend has no payment secrets and no separate ledger.

The existing store is `STO_5sCh2znmw67eD0IDcdYF7r`, merchant
`MER_2HQcr4GpEfaaTxdlz2EhR4`. The test one-time product is
`PROD_1MtsJWKNihc87buXVcS4WE`. Private keys are supplied only through ignored
local configuration or the deployment secret store.
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

For the established **production** site, use the production-specific overlay
`deploy/compose.pancake.prod.yml` and `deploy/pancake.prod.env.example`. The overlay
pins both services to `prod` and `https://framelyn.tcmzhan.com`; copy it next to
the server's existing Compose file and append the environment settings to its
existing private `.env`. Do not replace existing JWT, database or storage settings.

1. Complete store review in Pancake and publish the existing one-time product to
   production. The product ID remains the same.
2. In **production mode**, generate a production API key. Place its private key
   in the server's `.env` as `WAFFO_PRIVATE_KEY`. A test key cannot enable live billing.
3. Generate `PAYMENTS_INTERNAL_TOKEN` on the server with `openssl rand -hex 32`.
   Protect the existing `.env` with `chmod 600 .env`.
4. After both branches' image builds succeed, pull and recreate with the overlay:

   ```sh
   docker compose -f docker-compose.yml -f compose.pancake.prod.yml pull
   docker compose -f docker-compose.yml -f compose.pancake.prod.yml up -d
   ```

   If the EN frontend has its own Compose project, update it using its existing
   Compose file as well. Production still uses the same backend on port 8081.
5. In Pancake **production mode**, register an HTTP Webhook for
   `https://framelyn.tcmzhan.com/api/billing/pancake/webhook`, with
   `order.completed` and `refund.succeeded`. The existing Nginx `/api/` proxy is
   sufficient; no ngrok is needed. Configure this endpoint after the new backend
   and adapter are deployed, not by changing a test endpoint's environment.
6. Add/enable the `pancake` channel in FlowLight admin; publish the actual EN USD
   packs. Set `TIDECANVAS_PANCAKE_ENABLED=true` only after the above steps, then run
   the same `docker compose ... up -d` command to apply it. Restart alone does not
   inject changed environment variables.

Readiness checks: `curl http://127.0.0.1:8083/healthz` should report
`ready: true, mode: prod`; the public `/api/billing/en/channels` should include
`pancake` only after it is enabled. Readiness means configuration is present; it
does not prove the opaque RSA key was issued in production—check that in Pancake.
Test cards are for Sandbox only; do not use them for production transactions.

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

These fixtures do not make real provider transactions. A separate hosted Sandbox
check on 2026-10-13 verified merchant/store/product access and the live financial
GraphQL schema. The account had only a test API key. A USD 10.00 test-card purchase
was confirmed through the shared billing handlers and credited an isolated SQLite
ledger with 600 credits; repeated verification left one recharge record.

That check exposed two hosted-API differences now covered by regression tests:
checkout links can use `pancake.waffo.ai` as well as `checkout.waffo.ai`, and GraphQL
can serialize order `metadata` as a JSON string. Both forms are validated without
weakening origin or order-ownership checks.

The public Webhook delivery path is not yet verified: the local MySQL configuration
returned authentication error 1045 and no authenticated ngrok tunnel was available.
The live test used an isolated billing-only SQLite harness, not the production site
or production database. Payout eligibility and production activation remain untested.

Sources: [official skill](https://docs.waffo.ai/zh/integrate/skill),
[SDK](https://github.com/waffo-com/waffo-pancake-sdk-ts),
[orders queries](https://docs.waffo.ai/api-reference/endpoints/graphql/orders-and-payments).


## Prompt screening and public pricing (2026-10-14)

- Set `TIDECANVAS_PANCAKE_PROMPTSCREENING=true` on the **backend** after updating the backend, payments and EN frontend images. Deploy the matching backend before the EN frontend. The Compose overlays pass this variable through. Recreate the containers with the same Compose files/environment arguments used for deployment; a plain restart does not reload environment variables.
- Screening uses the adapter's existing merchant private key through `@waffo/pancake-ts` `contentSafety.scanPrompt`, with `semantic=enforce`. Backend and adapter environments must match. Payment checkout can remain disabled while prompt screening is enabled. The existing adapter IDs, site URL and internal token must still be configured.
- Screening is scoped to Framelyn: JWT submissions at `/api/en/ai/generate` and API-key submissions at `/api/en/open/v1/generations`. Existing FlowLight `/api/ai/generate`, `/api/open/v1/generations`, internal generation facades and text chat do not call Pancake. The route assigns the policy server-side; a request body or Origin/header cannot turn screening off within an EN route. User text and supported aliases (including nested lyrics/instructions) are checked before any task or generation debit is created. Only `allow` proceeds. Block, review, malformed response, network error, timeout, rate limiting or failed audit persistence rejects the request without generation charges. The user can retry later; a review result does not promise an automatic review queue.
- Maximum combined screened text is 10,000 UTF-16 code units. Text is never silently truncated. Successful idempotent task replays return the existing task instead of generating again.
- Decision receipts are stored in `prompt_safety_checks`: user/model, action/reason, provider request ID, creation time and keyed HMAC digest. No separate prompt copy or API credential is stored in this table. `PS-<id>` in the rejection message identifies the receipt. Existing task/input retention is unchanged.
- `GET /api/en/ai/safety-config` publicly reports whether Framelyn screening is enabled. The legacy `/api/ai/safety-config` reports false for FlowLight. The EN terms/AUP/privacy pages use this actual state; a disabled or unavailable configuration never claims screening is active.
- This integration checks **text only**. It does not screen uploaded media or generated image/video outputs. Those stages remain unimplemented and are disclosed as such; prompt screening alone is not a guarantee of full AIGC review approval.
- Official reference: https://docs.waffo.ai/api-reference/endpoints/content-safety/scan-prompt . At implementation time the beta is free, with a shared merchant limit of 100 requests per 60 seconds per endpoint. Provider availability and limits can change.

### Publish actual USD prices before reapplying

Production `/api/billing/en/plans` returned an empty array during the 2026-10-14 review. The owner then approved **Creator, USD 10, 600 credits, one-time, no automatic renewal**. On first start of the updated backend, `SeedEnglishCreator` inserts and publishes this pack (`en_creator`) and records a durable bootstrap marker in the same transaction. No larger pack or VIP entitlement is enabled. Later edits, renaming, unpublishing or deletion are preserved across restarts; an existing `en_creator` record is not overwritten. This does not enable payment channels. In FlowLight admin `/admin/pricing`, choose **English site / USD**, enter the actual English pack names, standard one-time USD price, standard credits, optional 12x pack total price (0 disables it), and benefits; then set the pack **on sale**. New packs are off sale by default. Publish policies such as credit validity separately; do not substitute test prices or invented promises.

Framelyn `/pricing` now renders on-sale USD packs directly in the initial HTML without authentication or JavaScript, fetches the plan list without caching, and includes current model credit examples with concrete settings. An empty catalogue remains explicitly unpublished; a failed catalogue request is an error, never a free or fabricated pack. Checkout remains unavailable until its payment channel and provider are enabled. Updating frontend code alone cannot publish a plan in the production database; deploy the backend as well to apply the approved initialization.


### Diagnose a failed prompt check

`ready:true` in `/healthz` means configuration is present; it is not an upstream connectivity or production-key test. If generation reports `The safety check could not be completed` with a `PS-...` reference, use the following on the server after deploying the updated payments image:

```sh
docker exec tidecanvas-payments node dist/check-screening.js
```

This submits one fixed landscape prompt to the safety service without generating content or creating an order. Output is restricted to action, safe reason codes, HTTP status, provider reference and elapsed time. It never prints the private key, internal token, SDK error message or user prompt.

Backend logs now correlate the `PS-...` reference with a sanitized reason and persist it in `prompt_safety_checks.reason`. `adapter_auth_failed` means the two services' internal tokens differ; `adapter_route_missing` can mean the payments image is old; `environment_mismatch` means backend/adapter environments differ. `upstream_unauthorized`/`upstream_forbidden` indicate Waffo authentication/access rejection; `upstream_timeout`, `upstream_dns_error`, `upstream_tls_error` and `upstream_network_error` identify transport problems. `upstream_rate_limited` indicates Waffo throttling; `upstream_invalid_response` indicates an incompatible response. Unknown errors stay `service_unavailable` or `upstream_unavailable` rather than exposing raw details.

These diagnostics do not disable screening, extend payment timeouts or bypass a failed check. The actual cause of an already-issued reference requires server output; it cannot be inferred from the public error alone. Only the dedicated EN generation routes use the screening setting.

For `upstream_unauthorized` (HTTP 401), check the host clock as well as the merchant/private-key configuration. Waffo's [API-key authentication](https://docs.waffo.ai/api-reference/authentication) accepts request timestamps at most five minutes behind or one minute ahead of its server time. A correctly configured key can therefore fail when the host clock runs fast; `ready:true` does not test this. Containers use the host clock.

Keep a network time service enabled on the host. With Chrony, inspect `chronyc tracking`: require a valid reference and `Leap status: Normal`, and check the remaining `System time` correction rather than `Last offset`. An initial all-zero report with `Not synchronised` does not prove the clock is accurate. Prefer gradual correction on an active shared server, then rerun the diagnostic and confirm `allow`; a healthy clock alone does not verify credentials, checkout or webhook settlement.


### Isolate Framelyn screening from the existing FlowLight service

If an older deployment is interrupting the Chinese site due to Pancake failures, immediately set `TIDECANVAS_PANCAKE_PROMPTSCREENING=false` and apply only the backend change:

```sh
docker compose -f docker-compose.yml up -d --no-deps backend
```

This temporarily disables the older deployment's global check. It does not change payment enablement, credentials, the ledger or model configuration. Applying the setting recreates the backend process; it is not a zero-restart operation.

After deploying the fixed shared backend and the EN frontend together, the same flag controls **only Framelyn's `/api/en/...` generation routes**. Enable it once the production Waffo credential works. The CN frontend, old API namespace, MCP and in-process generation facades remain independent of Pancake. The approved one-hour upscale timeout is unchanged. EN docs and playground now use `/api/en/open/v1`; do not fall back to the legacy CN route on 401/404/503 or safety-check rejection.

The EN API aliases keep the existing JWT/API-key authentication, account balance, task ownership and ledger. This is endpoint-policy isolation, not a separate account or API-key system. The backend includes the trusted EN policy in generation fingerprints, so reusing a CN request ID on EN conflicts instead of replaying an unscreened request as if it were checked; it never creates a duplicate task. For submissions accepted by the older frontend, recover the existing task via its ID/history before making a new request.

No Nginx change is needed when the existing `/api/` location already forwards to the shared backend. Do not add a backend `depends_on: payments` requirement to an existing single Compose deployment: the Chinese service does not need the payments container to start. The supplied overlays do not introduce that dependency.
