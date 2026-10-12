# Framelyn — English creative frontend

A standalone English frontend in `D:/mbfczzzz/claude/canvasEN`. It uses the existing shared backend; no Go server, database, model credentials or duplicate billing service is included.

## Repository branch

This frontend is maintained on **`flowlight-en`** in `vit4Ss/tide-canvas`.
The branch root is this standalone frontend, and this checkout tracks
`origin/flowlight-en` for subsequent commits, pulls and pushes.

```text
git clone --branch flowlight-en --single-branch https://github.com/vit4Ss/tide-canvas.git canvasEN
```

## Run locally

Requirements: Node.js 20.9 or newer and the existing backend.

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

Open **http://localhost:3100**. The default proxy connects to the existing backend at **http://localhost:8080**. Change `BACKEND_URL` in `.env.local` if the shared backend runs elsewhere. Keep API credentials out of public environment variables.

This workspace's ignored `.env.local` currently points to the existing deployed shared service from the source project's Nginx configuration. Its public catalog and plans endpoints were verified read-only. Local port 8080 currently belongs to an unrelated Java process, so the preview uses the deployed service instead. No account, generation, payment or email was submitted to the live service during development.

## Included interfaces

| Route | Interface |
| --- | --- |
| `/` | Independent English landing page and live model strip |
| `/studio` | Image, video, audio, 3D and video enhancement; model options, references, estimates, task recovery, polling and previews |
| `/models` | Live catalog, format filters, model search and studio deep links |
| `/explore` | Photographic references and editable prompt starting points |
| `/library` | Uploaded files and completed creations, previews, downloads and upload deletion |
| `/history` | Caller-scoped generation activity, filters, details and refunds |
| `/developers` | Developer introduction and capability overview |
| `/docs` | English API guide with cURL, JavaScript and Python examples |
| `/playground` | Real API requests, account key retrieval, JSON editing, task following and safe example copying |
| `/pricing` | Live plans, monthly/annual totals and available checkout methods |
| `/billing` | Order review, cashier link and payment verification |
| `/account` | Profile, password, key reveal/rotation/enablement and order history |
| `/usage` | Actual balance, credit ledger and token-metered API calls |
| `/login`, `/signup`, `/forgot-password` | Existing account login, username or verified-email registration and password reset |
| `/tools` | Real enhancement, image editing and image-to-3D entry points |
| `/about`, `/help`, `/privacy`, `/terms` | English supporting pages |

## Shared backend contracts

Browser requests remain on this website's `/api/*` origin and are forwarded by Next.js. Website actions use the existing JWT session routes. Public generation requests use `/api/open/v1`; chat and Responses use `/api/integrations/v1`. API keys are held in memory in the playground, never persisted there.

The frontend reuses the existing generation journal and pricing helpers. The journal is namespaced by this frontend and the authenticated account. Image batches use `batchCount`; reference video and audio use `videoReferences` and `audioReferences`, matching the provider adapters. Quotes verify owned video duration before enhancement and reference-video surcharges. Session-bound generation headers prevent an account switch from sending a prepared request under a different account.

## Google sign-in

Set `NEXT_PUBLIC_GOOGLE_CLIENT_ID` before building. The local ignored `.env.local`
contains the supplied public Web Client ID. No client secret is stored or needed.
Login and signup use Google's official English popup button; password login and
recovery remain available. The frontend exchanges the Google credential for the
shared backend's existing session. Existing email accounts require a verification
code before binding, keeping their credits and creations.
New Google accounts using a third-party email provider also verify that address
before creation; Gmail and verified Workspace accounts can sign up directly.
The exchange includes the original nonce and a separate protected cookie per
challenge. Requests time out after 20 seconds without automatic retries. Stale
profile responses and account changes cannot silently overwrite a newer session.

**Deploy the matching shared backend extension first.** Frontend configuration
alone cannot enable Google authentication on the currently deployed service.
The backend requires `TIDECANVAS_GOOGLE_CLIENTID` and the exact frontend origins in
`TIDECANVAS_GOOGLE_ALLOWEDORIGINS`, a reachable Redis, and the startup migration for
`user_identity`. See the adjacent backend's `docs/GOOGLE_LOGIN.md` for configuration,
the cookie/nonce flow and tests. Missing backend support is shown as an actionable
English message instead of a pretend successful login.

Google Auth Platform must include localhost/port 3100 and the final HTTPS domain
under authorized JavaScript origins. Add your testing Google accounts to the
console's test-user list while it is in Testing mode. Review console publication
requirements for a public launch. The popup callback does not use redirect URIs.

## Brand and deployment configuration

Brand settings are centralized in `src/lib/brand.ts` and `.env.example`. Framelyn is a provisional name, not a representation of registered business or domain ownership.

Set these variables **before building**, since public variables and rewrite destinations are captured by the production build:

```text
BACKEND_URL=https://your-existing-backend.example
NEXT_PUBLIC_BRAND_NAME=Framelyn
NEXT_PUBLIC_SITE_URL=https://your-new-site.example
NEXT_PUBLIC_BILLING_CURRENCY=CNY
NEXT_PUBLIC_SUPPORT_EMAIL=your-actual-support-address
NEXT_PUBLIC_GOOGLE_CLIENT_ID=your-web-client-id.apps.googleusercontent.com
```

```powershell
npm run build
npm start
```

The backend remains the authority for model availability, permissions, account balances, payment methods, prices, refunds and email delivery. Currency must match what the backend actually charges: changing the label is not a currency conversion. Existing checkout pages and account emails remain controlled by that service. For an overseas launch, use its actual international payment configuration and English email templates rather than frontend placeholders. The informational privacy and terms pages should be reviewed against the operator's actual policies before publication.

## Docker

```text
docker build --build-arg BACKEND_URL=https://your-existing-backend.example --build-arg NEXT_PUBLIC_SITE_URL=https://your-new-site.example -t framelyn-web .
docker run --rm -p 3100:3100 framelyn-web
```

Only the frontend is started. A backend address of `localhost` inside a container refers to that container, so supply the reachable shared service address when building.

## Verification

```powershell
npm test
npm run typecheck
npm run lint
npm run build
```

Browser checks require a running frontend and an installed Chromium-compatible browser:

```powershell
# Windows defaults to Microsoft Edge. Set BROWSER_PATH for another installation.
$env:BROWSER_PATH = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
npm run test:browser
npm run test:google
```

The browser suite intercepts all backend requests with explicit test fixtures. It covers the 21 routes at desktop and phone sizes, login, generation/batch input, task polling, uploads, RH quotes, API key use, API generation and annual checkout totals. No live provider request, payment, email or account mutation is made by these tests. Screenshots and results are written to `.impeccable/review` and are ignored by Git.

See `ASSETS.md` for the shipped imagery and `DESIGN.md` for the frontend design system.
