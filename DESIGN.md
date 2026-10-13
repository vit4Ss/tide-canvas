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

Pricing uses the independent English USD catalog. Standard and 12× credit packs
show their full one-time price and cost per 100 credits. Internal monthly/yearly
API values remain compatible; the UI does not describe purchases as subscriptions.
Unavailable checkout includes an explanation and support link. English FAQ, comparison and promotion
content comes from English-scoped endpoints. Orders format their own currency,
including legacy CNY purchases. No exchange rate is invented in the frontend.

Studio drafts are account-scoped in tab storage and survive navigation/reload.
Sign-in transfers an anonymous draft once. Model reads have a timeout and retry
action. Audio suggestions and controls distinguish music, sound effects and
speech. On mobile a compact fixed generation button shows the credit amount;
settings and cost explanations remain in normal document flow.

The Library provides server-filtered search, account-persisted names, owned-file
downloads and cancellable ZIP downloads (24 files / 100 MB). External legacy
single-file downloads are checked before saving with a 100 MB browser-memory
limit; large first-party files use the existing streaming ticket. GLB/glTF previews
load an interactive viewer only on demand, retaining an original-file fallback.

Compare up to three models using published capabilities and credit metadata.
Examples come from the explicit `framelyn-examples` community category and a
matching model label. Publisher-supplied labels are not benchmark evidence.
Usage reconciles the whole account balance through aggregates without displaying
text-model records. Support and policies are maintained centrally; missing terms
remain visibly unpublished.

## Evidence and verdict
The browser suite validates 21 routes at 1440 px and 390 px, with no horizontal overflow or runtime exceptions. Explicit mocks cover login, generation, batch inputs, quotes, polling, API keys, API calls and checkout. Source scans verify that original branding and Chinese system copy are absent from rendered fixtures. Shipping imagery has its source recorded in `ASSETS.md` and is identified as photographic reference material.

Final review is performed in this session because no subagent runner is available. Verdict: ready for configured backend integration and an operator review of deployment, billing configuration and policy copy. Paid provider tasks and actual checkout were not invoked during verification.

## Homepage expansion

The approved hero and existing homepage sections stay in place. A local provider logo strip identifies only media model families returned by the live catalog; each link opens its filtered collection. A full-width, two-row photographic inspiration gallery adds twelve varied crops and editable English prompts. It uses native horizontal scrolling, manual previous/next controls, keyboard navigation and reduced-motion behavior, with no automatic loop or autoplay. New references are locally hosted WebP files with source records in ASSETS.md. Failed images retain a usable prompt link and a visible explanation.

Homepage verification: lint and production build passed. Desktop (1440 px) and touch/mobile (390 px, reduced motion) checks confirmed twelve decoded images, native swipe and keyboard scrolling, arrow boundaries, prompt transfer into the studio, provider filtering and reset, and zero page runtime errors. Catalog failures, a text-only catalog and an unavailable image were exercised separately. Screenshot artifacts are under `.impeccable/review/home-{providers,showcase}-*.png`. No generation request was submitted. Verdict: ready for review on localhost:3100; not committed or deployed.

## Model collection and Studio selection

The model selector now shares local family logos with the collection cards. The selected value and menu options show the same icon while retaining plain text labels for keyboard typeahead and accessible names. Unknown families and failed logo images fall back to a format glyph. Other selects keep their existing behavior.

The collection uses a more compact heading, counts derived from the media catalog, provider links and format filters. Logo-led cards pair each medium with a static line illustration, actual model settings, original credit labels and a single link into Studio. Illustrations identify media formats; they are not generated samples, measurements or quality scores. The graphite/chartreuse palette, independent billing and existing generation requests remain unchanged.

Validation covers 320–1440 px layouts, provider/search/format filtering, selected-model handoff, icon failures, empty/error states and the existing keyboard/touch select checks. Browser previews use mocked catalog data and are stored at `.impeccable/review/models-refined-*.png` and `.impeccable/review/studio-model-*.png`.

The detail pass adds one-click filter resets with focus recovery, Escape-to-clear search, full-name trigger tooltips, explicit maintenance labels, static loading placeholders and additional local media-family logos. Catalog models with price matrices, modifiers or conflicting base prices defer the estimate to Studio rather than advertising a fixed per-request charge. This is presentation only: generation estimates and backend billing are unchanged.

The interaction audit persists collection search and format filters in the URL,
including Back/reload recovery, without a catalog request per keystroke. Mobile
workspace navigation hides closed links from keyboard navigation, contains focus
while open, supports Escape/outside dismissal, restores focus and releases its
scroll lock on route or viewport changes. Both landscape and short desktop
sidebars scroll independently. The skip link now targets the content region;
preview dialogs expose their actual title to assistive technology.
Closing a preview explicitly restores its initiating control even when React
detaches the dialog before native focus restoration. Reduced-motion transitions
are disabled rather than shortened to a fractional frame, so hidden navigation
becomes focusable reliably on opening.

Studio supporting actions have larger touch targets and an explicit disclosure
chevron. Small-screen prompts use 16 px text; creation dates and credits use
separate readable rows rather than 8 px metadata. The navigation browser suite
uses a 122-model fixture and covers typing, history recovery, focus, scroll cleanup,
preview and zero mutation requests. Run it with `node tests/navigation-browser.mjs`
against `FRONTEND_TEST_URL` (and `BROWSER_PATH` when Chrome is not on the default path).

## Workspace detail pass

Activity keeps its desktop table and uses compact records on phones, with the
same source, outcome, credit, refund and timestamp data. Search has an explicit
submit action, clear/reset controls and a distinct filtered-empty state. Details
open immediately with loading/error/retry states; closed or replaced requests
are aborted and remain isolated to the authenticated account.

Library metadata uses readable 11 px text and separate date/size rows. Filtering
and first-use empty states lead to the relevant action. External-file links use
an external-link icon, delete failures appear within the confirmation dialog and
deleting the last item on a later page returns to the previous page.

Studio format tabs support arrow/Home/End exploration and Enter/Space activation.
Clicking the active format preserves reference files. Prompt enhancement keeps a
newer draft intact and offers the returned suggestion explicitly, without another
service call to apply it. No billing rates or generation endpoints are changed.
The workspace-detail browser suite covers slow/out-of-order replies, account
switching, retries, pagination, touch targets and 320–1440 px layouts using mocks.

## Stripe checkout

The shared dialog now separates a fixed header, a scrollable body and fixed
actions. Confirmation dialogs use 480 px, forms 560 px, details 760 px and media
1120 px maximum widths. Phone layouts use dynamic viewport height and 44 px
controls. Opening a dialog locks background scroll; closing restores position
and focus. Backdrop dismissal requires a click that begins and ends outside,
so dragging text or images out of a dialog does not dismiss it.

Mutation dialogs visibly disable dismissal while a bounded request is pending.
API-key replacement and file deletion reconcile uncertain outcomes with a read
before another mutation. Errors remain inside their dialog. Rename selects the
current name on opening, disables unchanged submissions and keeps unfinished
edits on incidental close within the current library page; Discard clears them.

Asset previews show the actual name, downloadable files, optional metadata,
image zoom and adjacent items on the current page. Preview history lets Back
dismiss and Forward reopen a cached item while the page remains mounted.
Navigation retains keyboard focus at the first/last item and resets the content
scroll when changing assets. Native video/audio controls retain their own keys.

Purchase confirmation names the action plainly and describes Stripe without a
single-choice payment selector. A new complete order can go straight to Stripe
only when its plan, currency, cycle, amount and credits match the user's
selection. Reused, changed, processing or incomplete orders use the owned-order
review/recovery page. No payment is inferred from a redirect or query parameter.

Dialog regression evidence: desktop, phone and a 420 px-tall viewport cover
focus/selection, scroll lock, long names, fixed controls, failure/timeout recovery,
draft retention, preview zoom/download/navigation, Back/Forward, and direct
Stripe versus price-change/reused-order review. All mutations and checkout
navigation in these tests use isolated fixtures.

USD purchases use Stripe hosted Checkout in payment mode. Pricing and invoices explicitly state that each purchase is one-time, with no automatic renewal. Annual credits are delivered together after confirmed payment. The invoice presents the immutable order amount, name, credits and deadline. Returning from Stripe prompts a bounded server verification loop; the return query never determines payment status. A failed session creation can be resumed from the original order. Public checkout requests are scoped to the authenticated account, and billing requests are cancelled on navigation/account changes. Secret keys remain server-side.

Stripe validation uses a local mock API and fixture browser routes; no actual Stripe account or charge was used. Local desktop/mobile views and error/recovery states were checked. Real Sandbox verification is required after account setup.

Validation for the Stripe pass: 47 frontend unit/contract tests, production build, ESLint, pricing and Stripe browser flows passed. Shared-backend tests cover concurrent creation/settlement, lost responses, invalid signatures, rollback and retry, currency/owner/environment gates, fixed order snapshots and legacy order deadlines. Admin USD/CNY currency checks and desktop/mobile payment screens passed. Real Stripe Sandbox/production validation remains pending account setup; credentials and live checkout are not enabled.

The payment review added regression coverage for same-account token refresh during create/prepare/verify requests, channel disablement with an existing checkout URL, malformed payment responses, and delayed bank payments. Processing payments retain their original order past the checkout deadline and suppress further payment links. Paid/refunded state comes from the stored order after conditional updates, rather than assuming an expiry or repeated settlement succeeded.

Review evidence: the new same-account session tests failed for all three payment actions before the fix and now pass. Backend tests reproduced and fixed expiry/read and refund/settlement races, disabled-channel link exposure and delayed-payment repurchase. The checkout browser flow also verifies malformed responses and the processing state. Production build, ESLint, unit tests and Go build/vet pass; live Stripe validation is still pending account setup.

The second review verifies that native dialog Escape events respect the parent submission guard, then dismiss and reopen normally after a failed checkout. Changing monthly/yearly options now returns an unfinished order for the same plan, with its original amount disclosed before payment. Processing orders show their real state in account history and do not offer cancellation. Server configuration normalizes copied credentials and accepts incomplete disabled drafts without enabling payments; annual grant bounds are checked before checkout.

The multi-round regression pass covers unissued checkout cancellation/expiry, dropped async-failure notifications, modal cancellation errors/timeouts, same-account refresh and different-account replacement for all four payment actions. Stripe retrieval expands the PaymentIntent for terminal failure recovery. Recharge uses the shared precise ledger, preserving fractional and reserved balances. Pending purchases reserve only incoming capacity, without freezing spendable credits. MySQL-dialect inspection corrected the earlier assumed INT32 bound; limits now derive from the actual fixed-point representation.

Final multi-round evidence: three targeted passes completed. The critical concurrent/late/duplicate-event cases passed five repetitions with randomized test order. The six-script Stripe browser suite passed, including all four actions across same-account refresh and different-account replacement, cancellation failure/timeout, dialog recovery and cycle switching. Frontend build and backend build/vet passed. Database behavior used isolated SQLite plus checks of the actual GORM MySQL dialect; this environment has no configured independent MySQL instance or real Stripe Sandbox, so those integrations remain unverified.
