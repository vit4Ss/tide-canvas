# Framelyn design system

## Identity
An English creative workspace with a graphite ground and pale chartreuse as its primary action color. The two-part geometric frame mark and the gently overlapping reference photographs carry the brand. The interface preserves familiar control behavior and keeps active work separate from the landing-page composition.

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
Selected controls use the accent or a neutral lift. Dropdowns share `src/components/select.tsx`, with Radix handling keyboard navigation, typeahead, focus recovery and viewport positioning. Graphite menus use pale chartreuse checks and a tinted selected row; neutral outlined rows identify keyboard focus. Long labels wrap in the menu and truncate in the trigger. Lists scroll within available space, and touch targets are at least 44 px. Empty values such as “All formats” and “Model default” retain their original meaning. Details, dialogs and forms retain their existing keyboard behavior. Disabled controls stay visibly disabled. Errors and success notices use readable, explicit copy. Generation progress comes from actual tasks; there are no artificial progress timers. API requests have clear read-only or credit-using labels. Rotation and deletion have confirmation dialogs. Reduced-motion styles cover hover motion and loading indicators.

Google login uses the official English Identity Services button within the
existing login/signup composition. Preparing, submitting, unavailable and expired
states have explicit copy. Email verification appears inline for account linking
or third-party email ownership, while the password flow remains usable. Provider
and credential errors never create a local session. The public client ID is a
runtime setting supplied by the server; Google's client secret is never used by the frontend.

The follow-up auth review added bounded/cancellable credential requests, per-flow
nonce binding and guards against stale account responses. Username signup now
matches the shared backend's 4–20 character letter/number/underscore contract.
Regression fixtures cover slow previous-account queries, stalled requests,
malformed responses, account changes during login and browser storage failures.
Private workspace pages reset their dialogs, drafts and temporary credentials on
an account change. Known same-account token refreshes preserve drafts; unknown
or different-account changes hide private content while the server verifies the
new session. The history-dialog regression confirms old account details disappear.

Library and completed Studio cards use real result covers or a paused video
frame, loaded only near the viewport. An unavailable video cover falls back to
the video itself; preview decoding does not require cross-origin canvas access.
The English catalog and workspace expose only image, video, audio, 3D and
enhancement models. Text generation records and token-metered text API reports
are hidden. All-format history merges the existing per-media backend feeds
before pagination, retaining accurate totals without modifying shared data.
Audio and 3D covers come from result metadata. Missing files and failed previews have
explicit labels, and the preview dialog provides retry and original-file links.
The media browser suite uses a local, range-enabled MP4 fixture to verify
desktop/touch rendering, lazy loading, no autoplay, failure recovery and uploads.

Pricing uses the independent English USD catalog. Annual cards show the monthly
equivalent plus the full annual total; unpaid provider integration is shown as
“Checkout coming soon”. Admin-authored English FAQ, comparison and promotion
content comes from English-scoped endpoints. Orders format their own currency,
including legacy CNY purchases. No exchange rate is invented in the frontend.

## Evidence and verdict
The browser suite validates 21 routes at 1440 px and 390 px, with no horizontal overflow or runtime exceptions. Explicit mocks cover login, generation, batch inputs, quotes, polling, API keys, API calls and checkout. Source scans verify that original branding and Chinese system copy are absent from rendered fixtures. Shipping imagery has its source recorded in `ASSETS.md` and is identified as photographic reference material.

Final review is performed in this session because no subagent runner is available. Verdict: ready for configured backend integration and an operator review of deployment, billing configuration and policy copy. Paid provider tasks and actual checkout were not invoked during verification.

## Homepage expansion

The approved hero and existing homepage sections stay in place. A local provider logo strip identifies only media model families returned by the live catalog; each link opens its filtered collection. A full-width, two-row photographic inspiration gallery adds twelve varied crops and editable English prompts. It uses native horizontal scrolling, manual previous/next controls, keyboard navigation and reduced-motion behavior, with no automatic loop or autoplay. New references are locally hosted WebP files with source records in ASSETS.md. Failed images retain a usable prompt link and a visible explanation.

Homepage verification: lint and production build passed. Desktop (1440 px) and touch/mobile (390 px, reduced motion) checks confirmed twelve decoded images, native swipe and keyboard scrolling, arrow boundaries, prompt transfer into the studio, provider filtering and reset, and zero page runtime errors. Catalog failures, a text-only catalog and an unavailable image were exercised separately. Screenshot artifacts are under `.impeccable/review/home-{providers,showcase}-*.png`. No generation request was submitted. Verdict: ready for review on localhost:3100; not committed or deployed.
