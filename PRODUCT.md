# Framelyn

<!-- impeccable:product:v4 -->

## Product purpose
An independent English-language frontend for creators and developers, backed by the existing FlowLight service. The user requested a complete overseas edition with a landing page, creation studio, API documentation and calls, pricing, and supporting account interfaces.

## Positioning
One workspace for exploring available AI models, creating images, video, audio and 3D assets, managing results, and integrating the same capabilities through an API. Framelyn is a provisional brand chosen for this build, not a claim of trademark or domain ownership.

## Audience and operating context
English-speaking independent creators, designers and developers. Desktop supports longer creative sessions; mobile supports browsing, account management and reviewing work. The user selected a distinctive, simple dark creative-tool interface.

## Evidence on hand
Existing frontend contracts, model pricing helpers, authentication endpoints, file uploads, account API keys, asynchronous generation endpoints and task recovery logic are available in the adjacent source project.

## Product principles
- English throughout product navigation, instructions and system errors.
- A coherent independent identity; no original developer name, Chinese site brand, regulatory footer or source-project promotional links in the interface.
- Real catalog, account, credit, task and billing data. Example artwork must be identified as inspiration, never as a customer's generated results.
- Preserve existing backend authorization, idempotency, pricing and payment semantics. No duplicate backend and no invented payment support, currency conversion or subscription entitlement.
- Every visible action must work or state its real prerequisite. Clear loading, empty, failed and signed-out states.
- Keyboard access, readable contrast, touch targets, responsive layouts and reduced-motion support.

## Implementation constraints
Project root: D:/mbfczzzz/claude/canvasEN. Frontend only, using Next.js and the same REST contracts. Backend origin is configured through BACKEND_URL, with http://localhost:8080 for development. Production deployments must provide their actual shared backend address. Existing backend checkout uses CNY; display its true currency unless a backend deployment supports a different one. Brand name and deployment settings are centralized.
