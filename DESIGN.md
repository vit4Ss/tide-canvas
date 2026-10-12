# Framelyn design system

## Identity
An English creative workspace with a graphite ground and pale chartreuse as its primary action color. The two-part geometric frame mark and the gently overlapping reference photographs carry the brand. The interface preserves familiar native controls and keeps active work separate from the landing-page composition.

## Tokens
Source of truth: `src/app/globals.css`.

| Role | Value |
| --- | --- |
| Background | `#111312` |
| Surface | `#191c1a` |
| Raised/selected neutral | `#202420` |
| Text | `#f2f1eb` |
| Secondary text | `#a4aaa1` |
| Supporting text | `#8b9587` |
| Divider | `#303730` |
| Action | `#ddecad` |
| Action text | `#1b2512` |
| Error | `#f1a99e` |

Geist is self-hosted through the package. Product headings are 26–39 px; the landing's main display is 43–75 px depending on viewport. Code uses the platform monospace stack. Button radii are 8 px, field radii 8 px, content panel radii 10–14 px. Shadows are avoided; tonal separation and borders supply hierarchy.

## Composition
Marketing content uses a centered 1280 px measure with 48 px desktop edges and 22 px phone edges. The workspace rail is 224 px and becomes a dismissible overlay below 800 px. Studio output settings are progressively disclosed rather than pushing the core prompt and submit action below the working viewport. Documentation uses a 248 px anchored section rail and a bounded reading column.

## Interaction and state
Selected controls use the accent or a neutral lift. Native selects, details, dialogs and forms retain keyboard behavior. Disabled controls stay visibly disabled. Errors and success notices use readable, explicit copy. Generation progress comes from actual tasks; there are no artificial progress timers. API requests have clear read-only or credit-using labels. Rotation and deletion have confirmation dialogs. Reduced-motion styles cover hover motion and loading indicators.

Google login uses the official English Identity Services button within the
existing login/signup composition. Preparing, submitting, unavailable and expired
states have explicit copy. Email verification appears inline for account linking
or third-party email ownership, while the password flow remains usable. Provider
and credential errors never create a local session. The public client ID is a
build-time setting; Google's client secret is never used by the frontend.

The follow-up auth review added bounded/cancellable credential requests, per-flow
nonce binding and guards against stale account responses. Username signup now
matches the shared backend's 4–20 character letter/number/underscore contract.
Regression fixtures cover slow previous-account queries, stalled requests,
malformed responses, account changes during login and browser storage failures.
Private workspace pages reset their dialogs, drafts and temporary credentials on
an account change. Known same-account token refreshes preserve drafts; unknown
or different-account changes hide private content while the server verifies the
new session. The history-dialog regression confirms old account details disappear.

## Evidence and verdict
The browser suite validates 21 routes at 1440 px and 390 px, with no horizontal overflow or runtime exceptions. Explicit mocks cover login, generation, batch inputs, quotes, polling, API keys, API calls and checkout. Source scans verify that original branding and Chinese system copy are absent from rendered fixtures. Shipping imagery has its source recorded in `ASSETS.md` and is identified as photographic reference material.

Final review is performed in this session because no subagent runner is available. Verdict: ready for configured backend integration and an operator review of deployment, billing configuration and policy copy. Paid provider tasks and actual checkout were not invoked during verification.
