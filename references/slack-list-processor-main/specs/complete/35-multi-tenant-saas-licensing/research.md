# Research: Multi-Tenant SaaS Licensing

**Branch**: `35-multi-tenant-saas-licensing` | **Date**: 2026-03-18
**Phase**: 0 — Outline & Research

---

## R1: Slack OAuth Scopes for Channel Listing (Public + Private)

**Decision**: Add `channels:read` and `groups:read` bot scopes to the Slack app manifest and OAuth install URL.

**Rationale**: The current app has 7 scopes (`assistant:write`, `chat:write`, `files:read`, `files:write`, `users:read`, `users:read.email`, `im:write`). Listing private channels requires `groups:read`. Listing public channels requires `channels:read`. Both are needed for FR-022 (list both public and private channels in selection UIs).

**Alternatives considered**:
- `channels:read` only → Cannot list private channels. Rejected.
- `conversations.list` without type filter → Returns only public channels by default. Insufficient.

**Implementation detail**:
- Call `conversations.list({ types: 'public_channel,private_channel' })` with both scopes
- Bot can only see private channels it has been invited to (Slack platform constraint)
- Cache channel lists per workspace for 5 minutes (edge case EC-008 in spec)
- Existing installs will need scope re-authorization — the install URL already includes scopes, so a one-click re-install updates them

**Impact**: OAuth install URL in `src/routes/oauth/install.ts` needs updated `REQUIRED_SCOPES` array. Existing workspace installations retain old scopes until re-authorized.

---

## R2: Client Admin Detection via Slack API

**Decision**: Use `users.info` API response's `is_admin` boolean field to determine client admin vs. client user.

**Rationale**: The Slack `users.info` method returns a user object with `is_admin`, `is_owner`, and `is_primary_owner` fields. This maps directly to the spec's FR-028 requirement: workspace admins get full client dashboard access; non-admin members get read-only enrichment history.

**Alternatives considered**:
- `admin.users.list` → Enterprise Grid only. Not available for standard workspaces. Rejected.
- Custom admin role in our database → Adds management overhead. Slack's native admin role is sufficient. Rejected.
- `users.list` for batch fetching → More data but less efficient for single-user checks. Use `users.info` for real-time, cache with TTL for dashboard auth.

**Implementation detail**:
- On client dashboard login (Slack OAuth), call `users.info` with the authenticated user's ID
- Cache `is_admin` status for 15 minutes (admin changes are infrequent)
- Map: `is_admin: true` → client admin (full dashboard), `is_admin: false` → client user (read-only history)

---

## R3: Feature Toggle Patterns for @slack/bolt

**Decision**: Extend the existing `authorize` function to inject feature flags into Bolt's `context`, and create a reusable `requireFeature()` middleware for command/action gating.

**Rationale**: Bolt's custom `authorize` function already runs before every listener and has access to `teamId`. Extending it to resolve and attach feature flags from `WorkspaceInstallation.settings` is the natural integration point. A `requireFeature(featureName)` middleware wraps individual listeners and returns a user-friendly message when a feature is disabled.

**Alternatives considered**:
- Global middleware that checks all features → Too broad. Feature checks should be per-listener. Rejected.
- Separate feature flag service (LaunchDarkly, Flagsmith) → External dependency, cost, and complexity for what amounts to a per-workspace JSON config. Rejected.
- Check features inside each handler → No DRY. Leads to missed checks. Rejected.

**Implementation detail**:
```typescript
// Feature flag middleware for Bolt
const requireFeature = (feature: string) => async ({ context, ack, say, next }) => {
  const flags = context.featureFlags || {};
  if (!flags[feature]) {
    if (ack) await ack();
    await say('This feature is not available on your current plan.');
    return;
  }
  await next();
};

// Usage
app.command('/enrich', requireFeature('enrichment'), enrichHandler);
```

- Slash commands are always visible in Slack (cannot be hidden per-workspace) — we can only block execution
- Action buttons in Block Kit are conditionally rendered based on feature flags when building messages
- Feature flag defaults: enrichment=true, campaigns=false, workflows=false, dialer=false, analytics=false, icpAnalysis=false, personalityAnalysis=false, aiAgent=false

---

## R4: Stripe Checkout for One-Time Credit Pack Purchases

**Decision**: Use Stripe Checkout Sessions with `mode: 'payment'` for one-time credit pack purchases. Credit packs are pre-defined products with fixed credit amounts and prices.

**Rationale**: The existing billing system already uses Stripe for subscription management and overage charging. Credit packs are one-time purchases that add to the workspace's balance immediately, independent of the subscription cycle (per FR-006a).

**Alternatives considered**:
- Stripe Payment Intents directly → More complex, requires custom UI. Checkout handles the payment form. Rejected.
- Pre-created Stripe Price objects → Less flexible for pricing changes. Using `price_data` for dynamic pricing. Considered viable, but `price_data` is simpler for our use case.
- In-app payment form → PCI compliance burden. Stripe Checkout handles all card data. Rejected.

**Implementation detail**:
- Define credit packs as database records: `CreditPack { id, name, creditAmount, priceUsd, active }`
- Create Checkout Session:
  - `mode: 'payment'`
  - `line_items: [{ price_data: { currency: 'usd', product_data: { name }, unit_amount: priceUsd * 100 }, quantity: 1 }]`
  - `metadata: { slackTeamId, creditPackId, creditAmount }`
  - `success_url` / `cancel_url` pointing to client dashboard
- Listen for `checkout.session.completed` webhook → call `creditManager.addCredits()` with credit amount
- Transaction type: `CREDIT_PACK_PURCHASE` (new enum value for `CreditTransaction.type`)

---

## R5: License Key Generation & Format

**Decision**: Use prefix-based alphanumeric keys: `SLKP-XXXX-XXXX-XXXX-XXXX` (20 chars, 4 groups of 4, prefix `SLKP`). Generated with `crypto.randomBytes()` using an unambiguous character set.

**Rationale**: Prefix identifies the product (SLacK Processor). Alphanumeric with ambiguous characters removed (0/O, 1/I/l) prevents user typos. 16 random characters from a 32-char set provides ~80 bits of entropy — sufficient for license keys that are validated server-side.

**Alternatives considered**:
- UUID v4 → Long (36 chars), hard to type manually, no product branding. Rejected.
- Short numeric codes → Low entropy, brute-forceable. Rejected.
- JWT-based keys → Over-engineered for a server-validated one-time activation key. Rejected.

**Implementation detail**:
```typescript
function generateLicenseKey(): string {
  const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 chars, no 0/O/1/I/l
  const bytes = crypto.randomBytes(16);
  let key = '';
  for (let i = 0; i < 16; i++) {
    key += charset[bytes[i] % charset.length];
  }
  return `SLKP-${key.match(/.{1,4}/g)!.join('-')}`;
}
```

- Store full key in database (not hashed — keys need to be displayed in admin dashboard for distribution)
- Single-use enforcement via `activatedWorkspaceId` field (non-null = used)
- Expiration only blocks new activations, not existing workspaces (per clarification Q2)

---

## R6: Email Delivery for "Send Copy To" via Resend

**Decision**: Use the existing Resend integration (`resend` package, already a dependency) to send enrichment result files as email attachments.

**Rationale**: Resend is already in the project's dependencies (v6.9.3) and supports file attachments via Buffer or Base64 content. No new dependencies needed.

**Alternatives considered**:
- AWS SES → More configuration, less developer-friendly API. Resend is already integrated. Rejected.
- SendGrid → Additional dependency, no advantage over Resend. Rejected.
- S3 presigned URL in email (no attachment) → Users expect file attachment, not a temporary download link. Rejected.

**Implementation detail**:
- Download enrichment result file from S3
- Send via Resend with `attachments: [{ filename, content: buffer }]`
- Email body includes: enrichment type, row count, date, workspace name
- Max 40MB per email (Resend limit) — enrichment files are typically <5MB
- Use `from: 'noreply@[configured-domain]'` — requires verified domain in Resend

---

## R7: Slack App Home Tab for Client Onboarding

**Decision**: Use App Home tab as the primary onboarding surface for new client workspaces, supplemented by welcome DM with a link to App Home.

**Rationale**: App Home provides a persistent, revisitable UI that users can access anytime by clicking the app name. DMs are good for initial notification but get buried in conversation history. App Home's `views.publish` method allows dynamic, step-by-step wizard rendering with Block Kit.

**Alternatives considered**:
- DM-only onboarding → Gets lost in conversation history, not persistent. Rejected.
- Modal-based onboarding → Modals have a 10-minute timeout and can't be revisited. Rejected.
- Web-based onboarding → Requires leaving Slack. The spec explicitly requests in-Slack onboarding. Rejected.

**Implementation detail**:
- Listen for `app_home_opened` event
- Check `WorkspaceInstallation.onboardingStatus` (new field: `pending` | `license_key` | `billing` | `channels` | `complete`)
- Render appropriate step as Block Kit view with progress indicator ("Step 2 of 4")
- Each step has action buttons that advance the state machine
- On completion, App Home switches to a dashboard view showing credit balance, quick links, and recent enrichments

---

## R8: Platform Owner Auto-Detection

**Decision**: Use a `PLATFORM_OWNER_TEAM_ID` environment variable. If `WorkspaceInstallation.slackTeamId` matches this value, the workspace is treated as the platform owner with all features enabled and billing exempt.

**Rationale**: Hardcoded config is simpler than a database flag for a single workspace. The platform owner team ID is stable and known at deploy time. This aligns with clarification Q4 from the spec.

**Alternatives considered**:
- Database flag on WorkspaceInstallation → Requires manual setup, could be accidentally changed. Rejected.
- First-installed workspace auto-promoted → Fragile, what if workspace is reinstalled. Rejected.
- Multiple platform owner workspaces → Over-engineered for v1. One team ID is sufficient. Rejected.

**Implementation detail**:
- New config: `config.platformOwnerTeamId = env('PLATFORM_OWNER_TEAM_ID', '')`
- In `authorize()` function: if teamId matches, set `context.isPlatformOwner = true` and all feature flags to true
- In billing gate: skip credit checks if `billingExempt` is true (already exists on `BillingProfile`)
- Auto-create `BillingProfile` with `billingExempt: true` if platform owner workspace lacks one

---

## R9: Existing Code Reuse Assessment

**Decision**: Maximize reuse of existing systems. Net-new code focused on licensing, feature gating, onboarding wizard, credit preview, send-copy-to, and client dashboard.

| Existing System | Reuse Level | Changes Needed |
|-----------------|-------------|----------------|
| `creditManager.ts` | High | Add `addCredits()` method for credit pack purchases |
| `billingGate.ts` | High | No changes — already checks billing status |
| `creditRateCalculator.ts` | High | No changes — used for cost estimation |
| `overageCharger.ts` | High | No changes — handles Stripe overage charges |
| `monthlyResetProcessor.ts` | High | No changes — handles credit cycle resets |
| `magicLinkService.ts` | Medium | May extend for client dashboard access |
| `authorize.ts` | High | Extend to inject feature flags from workspace settings |
| `installationStore.ts` | High | No changes — OAuth token storage works as-is |
| `auditLogger.ts` | High | No changes — used for all new audit events |
| `billingSetup.ts` route | Medium | Extend for client-initiated billing setup during onboarding |
| `stripeWebhook.ts` | Medium | Add handler for credit pack purchase webhook |
| `enrichment/costCalculator.ts` | High | Used directly for credit preview estimation |
| `analyze/reportGenerator.ts` | Medium | Extend to accept workspace ICP context |
| `aiark/client.ts` | High | No changes — used for personality analysis |
| `apollo/client.ts` | High | No changes — used for company intelligence |

**Net-new systems**: License key management, feature toggle service, onboarding wizard, credit preview UI, send-copy-to service, channel registration service, client dashboard API + frontend.
