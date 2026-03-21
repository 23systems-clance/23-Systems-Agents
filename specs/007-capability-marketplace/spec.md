# Spec 007: Capability Marketplace

**Status:** Draft
**Priority:** P2
**Estimated Effort:** 60 hours
**Dependencies:** Spec 006 Phase 0 (capability registry in Postgres, tenant entitlements table)
**Sequence:** After Spec 006 Phase 0 — builds on the capability registry and per-tenant entitlements established there

> **PRODUCTION DEPLOY SAFEGUARD:** Production deployments (merges to main, GKE service updates, DNS cutover to production domain) MUST NOT proceed unless the user explicitly says **"DEPLOY PRODUCTION"**. Staging deployments are unrestricted.

---

## Overview

Build a marketplace layer on top of the capability registry (Spec 006 FR-023). The registry catalogs skills, MCP servers, agent templates, and team templates with per-tenant entitlements. This spec adds: an LLM-powered task router that selects relevant capabilities per job, usage metering for billing, licensing tiers, tenant-published capabilities, and versioning.

The marketplace is core platform infrastructure — as the catalog grows from ~20 capabilities to hundreds, tenants need curated subsets, usage tracking, and the ability to publish their own capabilities.

## Why a Marketplace

| Problem | Without Marketplace | With Marketplace |
|---------|-------------------|-----------------|
| Capability discovery | All skills dumped into every prompt | Task router selects relevant subset |
| Token cost | 20+ skill descriptions × every job = wasted tokens | Only 2-3 relevant descriptions per job |
| Multi-tenant access control | All tenants see all capabilities | Per-tenant entitlements by licensing tier |
| Revenue model | Flat subscription only | Usage-based billing per capability invocation |
| Ecosystem growth | Only platform team publishes skills | Tenants can publish and license capabilities |
| Quality control | No versioning, no compatibility tracking | Semantic versioning + compatibility matrix |

---

## Goals

1. **Task router** — LLM-powered (or rule-based fallback) selection of relevant capabilities per job from the tenant's entitled set
2. **Usage metering** — Track per-tenant, per-capability invocation counts and token consumption for billing
3. **Licensing tiers** — Free, Pro, Enterprise tiers with different capability entitlements
4. **Tenant publishing** — Allow tenants to publish skills/MCP servers to the marketplace for other tenants to license
5. **Versioning** — Semantic versioning for capabilities with compatibility tracking

## Non-Goals

- Building a payment processor (use Stripe)
- Building a public-facing marketplace website (API-first, UI later)
- Replacing the capability registry (that's Spec 006 — this builds on it)
- Real-time capability hot-swapping during agent execution

---

## User Scenarios & Testing

### User Story 1 — Task Router Selects Relevant Capabilities (Priority: P0)

When a job is dispatched, the worker queries the task router to select which capabilities (from the tenant's entitled set) are relevant to the task. Only those capability descriptions are injected into the agent's system prompt.

**Why this priority**: This is the primary token-savings and agent-quality improvement.

**Acceptance Scenarios**:

1. **Given** a task "Deploy a landing page", **When** the task router runs, **Then** it selects `generate-landing-page` and `automate-browser` (not `fetch-transcript` or `audit-compliance`)
2. **Given** a task "Research competitors", **When** the router runs, **Then** it selects `search-web` and `fetch-transcript`
3. **Given** the task router fails (LLM error), **When** fallback activates, **Then** all entitled capabilities are injected (current behavior)
4. **Given** a tenant on free tier with only `search-web` entitled, **When** the router runs, **Then** it can only select from `search-web` regardless of task content

---

### User Story 2 — Usage Metering for Billing (Priority: P0)

Every capability invocation is metered: which tenant, which capability, how many tokens consumed, timestamp. This data feeds into billing.

**Acceptance Scenarios**:

1. **Given** a job completes using `search-web` and `automate-browser`, **When** metering runs, **Then** two usage records are created (one per capability) with tenant_id, tokens, and timestamp
2. **Given** a billing period query for tenant-abc, **When** the usage API is called, **Then** it returns aggregated counts per capability for the period
3. **Given** a failed job, **When** the agent used capabilities before failing, **Then** those invocations are still metered (usage occurred)

---

### User Story 3 — Licensing Tiers (Priority: P1)

Tenants are assigned a tier (free, pro, enterprise) that determines which capabilities they can access. Tier changes take effect on the next job dispatch.

**Acceptance Scenarios**:

1. **Given** a free-tier tenant, **When** they dispatch a job, **Then** only free-tier capabilities are available
2. **Given** a tenant upgrades from free to pro, **When** the next job dispatches, **Then** pro-tier capabilities are available
3. **Given** an enterprise tenant, **When** they dispatch a job, **Then** all platform capabilities plus any custom-licensed capabilities are available

---

### User Story 4 — Tenant Publishes a Capability (Priority: P2)

A tenant creates a skill and publishes it to the marketplace. Other tenants can discover and license it.

**Acceptance Scenarios**:

1. **Given** a tenant publishes a skill, **When** it's submitted, **Then** it appears in the marketplace catalog with `status: pending_review`
2. **Given** a published skill passes review, **When** approved, **Then** other tenants can license it
3. **Given** a tenant licenses a published skill, **When** their next job dispatches, **Then** the skill is available in their entitled set

---

### User Story 5 — Capability Versioning (Priority: P2)

Capabilities have semantic versions. When a capability is updated, existing tenants continue using their licensed version until they explicitly upgrade.

**Acceptance Scenarios**:

1. **Given** a capability at v1.0.0, **When** the publisher releases v1.1.0, **Then** existing licensees stay on v1.0.0
2. **Given** a tenant on v1.0.0, **When** they choose to upgrade, **Then** v1.1.0 is used for subsequent jobs
3. **Given** a breaking change (v2.0.0), **When** released, **Then** a compatibility warning is shown and auto-upgrade is blocked

---

## Requirements

### Functional Requirements

- **FR-027**: System MUST support a task router that selects relevant capabilities from the tenant's entitled set based on task description
- **FR-028**: System MUST meter capability usage per tenant per invocation (capability_id, tenant_id, tokens_consumed, timestamp)
- **FR-029**: System MUST support licensing tiers (free, pro, enterprise) that determine capability entitlements
- **FR-030**: System SHOULD support tenant-published capabilities with review workflow (pending_review → approved → listed)
- **FR-031**: System SHOULD support semantic versioning for capabilities with per-tenant version pinning
- **FR-032**: Task router MUST fall back to injecting all entitled capabilities if routing fails
- **FR-033**: Usage metering MUST be non-blocking — metering failures must not affect job execution
- **FR-034**: System MUST provide a usage API for billing queries (aggregated by tenant, capability, and time period)

### Key Entities

*Extends Spec 006 entities (Capability, Entitlement, Usage Record):*

- **Tier**: Licensing level (free, pro, enterprise) with a defined set of entitled capabilities
- **Published Capability**: A tenant-submitted capability in the marketplace with review status
- **Version**: Semantic version of a capability (major.minor.patch) with changelog and compatibility info
- **Usage Aggregate**: Pre-computed billing summary per tenant per period

---

## Technical Design

### Capability Registry Schema (extends Spec 006)

Spec 006 Phase 0 creates the foundational `capabilities` and `tenant_capabilities` tables. This spec adds:

```sql
-- Task routing metadata (added to capabilities table or separate)
ALTER TABLE capabilities ADD COLUMN keywords TEXT[];  -- for rule-based routing fallback
ALTER TABLE capabilities ADD COLUMN embedding VECTOR(384);  -- for semantic routing (optional)

-- Usage metering
CREATE TABLE capability_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  capability_id UUID NOT NULL REFERENCES capabilities(id),
  job_id UUID NOT NULL,
  tokens_consumed INTEGER DEFAULT 0,
  invoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_usage_tenant_period ON capability_usage(tenant_id, invoked_at);
CREATE INDEX idx_usage_capability ON capability_usage(capability_id, invoked_at);

-- Licensing tiers
CREATE TABLE tiers (
  id TEXT PRIMARY KEY,  -- 'free', 'pro', 'enterprise'
  name TEXT NOT NULL,
  max_jobs_per_month INTEGER,
  max_capabilities INTEGER,
  price_cents INTEGER DEFAULT 0
);

-- Tier entitlements (which capabilities each tier includes)
CREATE TABLE tier_capabilities (
  tier_id TEXT NOT NULL REFERENCES tiers(id),
  capability_id UUID NOT NULL REFERENCES capabilities(id),
  PRIMARY KEY (tier_id, capability_id)
);

-- Tenant tier assignment
ALTER TABLE tenants ADD COLUMN tier_id TEXT REFERENCES tiers(id) DEFAULT 'free';

-- Marketplace (tenant-published capabilities)
CREATE TABLE published_capabilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  capability_id UUID NOT NULL REFERENCES capabilities(id),
  publisher_tenant_id UUID NOT NULL REFERENCES tenants(id),
  status TEXT NOT NULL DEFAULT 'pending_review',  -- pending_review, approved, rejected, delisted
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewer_notes TEXT
);

-- Capability versions
CREATE TABLE capability_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  capability_id UUID NOT NULL REFERENCES capabilities(id),
  version TEXT NOT NULL,  -- semver: '1.0.0', '1.1.0', '2.0.0'
  changelog TEXT,
  breaking_change BOOLEAN DEFAULT FALSE,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(capability_id, version)
);

-- Tenant version pins
ALTER TABLE tenant_capabilities ADD COLUMN pinned_version TEXT;
```

### Task Router Design

```
Task Description + Tenant Entitlements
    │
    ├── Rule-Based Router (fast, deterministic)
    │     └── Keyword match: task words ∩ capability keywords
    │         Score each capability, return top-N above threshold
    │
    ├── LLM Router (Ollama, higher quality)
    │     └── Prompt: "Given this task and these capabilities,
    │                  which are relevant? Return JSON array of IDs."
    │         Model: Mistral Small 24B (local, ~$0.00)
    │
    └── Fallback: Return all entitled capabilities (current behavior)

Selection = intersection(router_result, tenant_entitlements)
```

```javascript
// task-router.js — pseudocode
async function routeCapabilities(taskDescription, tenantId) {
  const entitled = await getEntitlements(tenantId);

  try {
    // Try LLM router first (Ollama — free, ~2s)
    const selected = await llmRoute(taskDescription, entitled);
    return selected;
  } catch {
    try {
      // Fallback: keyword matching (~10ms)
      const selected = keywordRoute(taskDescription, entitled);
      if (selected.length > 0) return selected;
    } catch {}

    // Final fallback: all entitled capabilities
    return entitled;
  }
}
```

### Usage Metering Design

Metering is **fire-and-forget** — it must never block job execution.

```javascript
// meter.js — pseudocode
async function meterUsage(tenantId, jobId, capabilitiesUsed, tokensConsumed) {
  // Non-blocking: enqueue to a separate BullMQ queue for async persistence
  await usageMeterQueue.add('meter', {
    tenantId,
    jobId,
    capabilities: capabilitiesUsed,
    tokens: tokensConsumed,
    timestamp: new Date()
  });
  // Returns immediately — worker persists to Postgres asynchronously
}
```

### Licensing Tier Defaults

| Tier | Monthly Price | Capabilities | Jobs/Month | Token Budget |
|------|--------------|-------------|------------|-------------|
| Free | $0 | Core skills (search-web, list-secrets) | 10 | 50K |
| Pro | $49 | All platform skills + MCP servers | 100 | 500K |
| Enterprise | Custom | All + marketplace + custom | Unlimited | Custom |

---

## Cost Estimates

### Infrastructure Cost (incremental over Spec 006)

| Component | Monthly Cost |
|-----------|-------------|
| Task router (Ollama — already running) | $0 |
| Usage metering (Postgres writes — already provisioned) | ~$0 |
| BullMQ metering queue (Redis — already provisioned) | ~$0 |
| **Total incremental** | **~$0/mo** |

The marketplace layer is almost entirely application code running on infrastructure already provisioned by Spec 006.

### Token Savings from Task Router

| Scenario | Without Router | With Router | Savings |
|----------|---------------|-------------|---------|
| 20 capabilities × 50 tasks/mo | ~500K prompt tokens | ~150K prompt tokens | 70% |
| 50 capabilities × 200 tasks/mo | ~5M prompt tokens | ~1M prompt tokens | 80% |
| 100 capabilities × 1000 tasks/mo | ~50M prompt tokens | ~5M prompt tokens | 90% |

At Claude Sonnet's input token pricing (~$3/M tokens), the router saves $0.15–$135/mo depending on scale.

---

## Implementation Plan

### Phase 0.5: Task Router (8 hours)

**Deliverables:**
- [ ] Rule-based keyword router (deterministic, fast)
- [ ] LLM router via Ollama (Mistral Small 24B)
- [ ] Fallback chain: LLM → keyword → all entitled
- [ ] Integration with Spec 006 Blueprint worker Step 1

**Tasks:**
1. Add `keywords` column to `capabilities` table
2. Seed keywords for all current skills
3. Implement keyword matching router
4. Implement LLM router prompt (Ollama)
5. Implement fallback chain
6. Integrate into worker's Step 1 (Resolve & Prepare)
7. Test: verify correct capabilities selected for various task types
8. Test: verify fallback works when Ollama is down

### Phase 1: Usage Metering + Tiers (16 hours)

**Deliverables:**
- [ ] `capability_usage` table with async metering
- [ ] BullMQ metering queue (fire-and-forget)
- [ ] `tiers` and `tier_capabilities` tables
- [ ] Tier assignment on tenant model
- [ ] Usage API for billing queries
- [ ] Admin UI for tier management

**Tasks:**
1. Create `capability_usage`, `tiers`, `tier_capabilities` tables (migration)
2. Implement async metering via BullMQ queue + worker
3. Integrate metering into Blueprint worker Step 7 (Notify + Meter)
4. Define default tiers (free, pro, enterprise) with capability mappings
5. Add `tier_id` to tenant model
6. Implement usage aggregation queries (by tenant, capability, period)
7. Create `/api/usage` endpoint for billing
8. Create admin UI page for tier management
9. Test: verify metering records created for completed jobs
10. Test: verify metering doesn't block on failure

### Phase 1+: Marketplace (20 hours)

**Deliverables:**
- [ ] Tenant publishing workflow (submit → review → approve)
- [ ] Marketplace catalog API (browse, search, filter)
- [ ] Capability licensing (tenant licenses a published capability)
- [ ] Semantic versioning with version pinning

**Tasks:**
1. Create `published_capabilities` and `capability_versions` tables
2. Implement publish workflow API (submit, review, approve, reject)
3. Implement marketplace catalog API (list, search, filter by category/tier)
4. Implement licensing flow (tenant requests → entitlement created)
5. Implement version management (publish version, pin version, upgrade)
6. Add `pinned_version` to `tenant_capabilities`
7. Create marketplace browse UI
8. Create publisher dashboard UI
9. Test: full publish → review → approve → license → use flow
10. Test: version upgrade with breaking change warning

### Phase 2: Advanced (16 hours)

**Deliverables:**
- [ ] Semantic embedding router (pgvector)
- [ ] Usage-based billing integration (Stripe)
- [ ] Capability analytics dashboard
- [ ] Publisher revenue sharing

**Tasks:**
1. Add pgvector extension to Postgres
2. Generate embeddings for capability descriptions
3. Implement semantic similarity router
4. Integrate Stripe for usage-based billing
5. Build analytics dashboard (usage trends, popular capabilities)
6. Implement revenue sharing model for publishers

---

## Risks & Mitigation

### Risk 1: Task Router Quality
**Impact:** Medium — wrong capability selection degrades agent performance
**Probability:** Medium — keyword matching is imprecise, LLM can hallucinate
**Mitigation:** Three-tier fallback (LLM → keyword → all). Log routing decisions for quality analysis. Start with conservative threshold (include more rather than fewer).

### Risk 2: Metering Accuracy
**Impact:** High — billing disputes if metering is inaccurate
**Probability:** Low — BullMQ persistence + Postgres writes are reliable
**Mitigation:** Async metering with at-least-once delivery. Reconciliation job compares metered vs actual job records weekly.

### Risk 3: Marketplace Abuse
**Impact:** Medium — low-quality or malicious skills published
**Probability:** Medium — any open publishing system attracts spam
**Mitigation:** Mandatory review workflow. Automated checks (linting, no secrets in code, size limits). Reputation scoring for publishers.

### Risk 4: Version Compatibility
**Impact:** Medium — breaking changes in capabilities affect dependent jobs
**Probability:** Low-Medium — skills are relatively self-contained
**Mitigation:** Semantic versioning with auto-pinning. Breaking changes require explicit tenant opt-in. Compatibility testing before version publish.

---

## Relationship to Other Specs

| Spec | Relationship |
|------|-------------|
| **006** (Infra Migration) | **Depends on** — capability registry (FR-023) and tenant entitlements (FR-026) are created in Spec 006 Phase 0 |
| **003** (AWS Deployment) | Compatible — marketplace is cloud-agnostic application code |
| **001** (End User Portal) | Integrates — marketplace UI lives in the portal |
| **002** (Slack Pipeline) | Extends — Slack can trigger capability-routed jobs |

---

**Spec Author:** 23 Systems
**Created:** 2026-03-21
**Status:** Draft — Ready for Review
**Reference Analysis:** Stripe Minions Toolshed pattern (see plan: `drifting-pondering-wren.md`)
