# Google login on the shared backend

Framelyn remains a frontend. Deploy the following auth extension to the existing
FlowLight Go server; it uses the same database, Redis, user accounts, point ledger
and JWT session format.

## Deployment configuration

Set these environment variables on the backend process/container and restart it:

```text
TIDECANVAS_GOOGLE_CLIENTID=your-web-client-id.apps.googleusercontent.com
TIDECANVAS_GOOGLE_ALLOWEDORIGINS=https://framelyn.tcmzhan.com
```

The client ID must exactly match the frontend container's runtime
`GOOGLE_CLIENT_ID`. On the separate test server, set allowed origins to
`https://test-framelyn.tcmzhan.com`; local development uses
`http://localhost:3100`. The frontend uses `APP_ENV=prod` and
`SITE_URL=https://framelyn.tcmzhan.com` in production, or `APP_ENV=test` and
`SITE_URL=https://test-framelyn.tcmzhan.com` on the test server.
Origins are an explicit comma-separated list, without paths or trailing slashes.
The feature is disabled when no client ID is configured. Redis must be reachable;
authentication fails closed when nonce storage is unavailable. The backend needs
outbound HTTPS access to `www.googleapis.com` for Google's rotating public keys.
Google's client secret is not used by this ID-token flow.

Go does not automatically load `.env` files. Set the actual client ID and the
appropriate site's origin in the backend deployment environment.

The existing startup migration adds `user_identity`, with unique provider/subject
and provider/user indexes. There are no changes to existing user columns or
password login routes. Apply the usual deployment migration procedure.

If deploying through Docker Compose, declare these environment variables under
the backend service's `environment` block; a value in the host shell or `.env`
alone is not automatically passed to a container.

The `flowingLight` branch publishes the shared backend image
`ghcr.io/vit4ss/tide-canvas-backend:latest`. The separate `flowlight-en` branch
publishes only the English frontend image. Publishing or restarting the frontend
does not deploy these backend routes. After configuring the backend environment
and a successful backend image build, update the existing production service:

```sh
docker compose pull backend
docker compose up -d --no-deps backend
```

Set `GOOGLE_CLIENT_ID` on `frontend-en` to the same client ID and recreate that
service with `docker compose up -d --no-deps frontend-en`. No OAuth client secret
is needed in either container.

## Browser flow

1. POST `/api/auth/google/challenge` with a JSON body from an allowed origin.
   The server returns `clientId`, `nonce`, `expiresIn` (300 seconds), and sets an
   HttpOnly, SameSite=Strict cookie on `/api/auth/google` through the frontend proxy.
   Each challenge has its own cookie name, so another tab does not replace it.
2. Initialize Google's official Identity Services button with this nonce. Receive
   the `credential` in the popup's JavaScript callback.
3. POST `/api/auth/google` with `{ "credential": "...", "nonce": "..." }`. The backend checks the
   origin, cookie, single-use nonce, Google RS256 signature, audience, issuer,
   expiration, authorized party and verified email. Success returns the existing
   `LoginVO` (`accessToken`, `refreshToken`, `expiresIn`, `userInfo`).
4. If the Google subject is new but its email already belongs to an account, a
   409 response has `data: { "requiresLink": true, "email": "..." }`. Send an email
   code using the existing `/api/auth/email-code` endpoint, then resubmit the same
   credential with `code`. The verified account ID is checked again in the
   transaction. Account linking preserves credits and grants no signup bonus.
   Both the credential and its original nonce must be included when resubmitting
   with `code`. The exact verified account must still exist with the same email;
   a renamed or deleted account never turns a binding attempt into registration.

For a first-time Google account with a non-Gmail, non-Workspace address, Google
is not authoritative for the current email owner. A fresh email code is required
before creation; the same 409 payload has `existingAccount: false`. Gmail and
verified Workspace accounts can create an account directly. This email proof
must not authorize merging into an account created concurrently by someone else.

The five-minute challenge remains usable while entering a binding code; it is
consumed once after verification, before account/session creation. Expired challenges require starting a new
Google login. A bound Google subject continues to identify the same account even
if its Google email changes. Disabled and deleted accounts cannot sign in; a
deleted account is not recreated from the retained identity binding. First-use
creation respects the existing registration switch and signup reward. Account
creation, identity insertion and the reward commit together.

## Console and frontend settings

In Google Auth Platform, configure the brand, support email, homepage, privacy
policy and terms with the overseas site's actual identity. Use a Web application
client with `http://localhost`, `http://localhost:3100`,
`https://framelyn.tcmzhan.com` and `https://test-framelyn.tcmzhan.com` under
authorized JavaScript origins. This popup callback flow does not
need an authorized redirect URI. Add test accounts while using Testing mode;
check Google console publication/verification requirements before public launch.

The frontend loads GIS directly from Google, uses its official English button and
sets `Cross-Origin-Opener-Policy: same-origin-allow-popups`. If an operator adds a
CSP, allow Google's official GIS script, frame, style and connection endpoints.
Do not strip `Origin`, `Set-Cookie`, `Cookie`, or `X-Forwarded-Proto` in the proxy.
SMTP delivery and email branding remain the existing shared backend's settings.

Frontend Google requests have a 20-second timeout, are cancelled when leaving the
flow, and do not include website JWTs or automatically retry credentials. A stale
account lookup or delayed Google response cannot replace a newer login. Failed
browser storage writes restore the previous access/refresh pair. Google key
service failures remain 503 responses during a brief retry cooldown; invalid
credentials remain 400. Cached keys respect max-age/no-cache and response Age.
Private frontend pages also reset open details, drafts and temporary keys when
the account changes. A monotonically increasing session version rejects delayed
Google responses even after a sign-in/sign-out cycle returns to the same state.

## Validation

```text
go test ./internal/pkg/googleauth ./internal/handler/auth ./internal/config
go vet ./internal/pkg/googleauth ./internal/handler/auth ./internal/config
```

The verifier uses local signed fixtures and a local JWKS server, including forged
signatures, wrong audience/issuer/nonce, expiry, unverified email and key caching.
Request tests cover allowed origins, JSON-only submissions and protected cookies.
Account lifecycle tests use the repository's SQLite driver and require CGO; the
tests explicitly skip on CGO-disabled machines. The backend image workflow runs
the auth tests with CGO enabled before publishing. No real Google credential or
production account is used by these tests.

On this Windows workspace, database tests were also executed with a temporary
module file replacing the SQLite test driver with `github.com/glebarez/sqlite`
v1.11.0 (pure Go). The application's `go.mod` and `go.sum` remain unchanged. To
reproduce this alternative from the backend directory in PowerShell:

```powershell
New-Item -ItemType Directory '..\.runtime\google-tests' -Force | Out-Null
Copy-Item go.mod '..\.runtime\google-tests\portable.mod'
Copy-Item go.sum '..\.runtime\google-tests\portable.sum'
go mod edit '-modfile=../.runtime/google-tests/portable.mod' '-replace=gorm.io/driver/sqlite=github.com/glebarez/sqlite@v1.11.0'
go test '-mod=mod' '-modfile=../.runtime/google-tests/portable.mod' -v ./internal/handler/auth -run TestGoogle
```

References: [Google setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid),
[server verification](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token).
