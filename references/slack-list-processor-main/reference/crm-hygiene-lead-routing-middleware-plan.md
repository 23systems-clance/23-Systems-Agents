# CRM Hygiene + Lead Routing Middleware Plan

## Executive summary

Build this as a **standalone middleware / prospecting control plane** with:

- its **own canonical database**
- a **rules engine**
- an **enrichment layer**
- a **CRM adapter layer**
- **HubSpot first**, but architected so Salesforce is just another adapter later

Do **not** build this as only an API gateway proxy.

A thin proxy will not solve the real problems:

- dedupe
- suppression
- enrichment waterfall
- ICP scoring
- routing
- sequence governance
- retries and replay
- field alignment
- keeping unqualified prospecting noise out of the CRM

## Recommendation in one sentence

Build:

**source -> intake API -> canonical DB -> enrichment / rules / routing engine -> CRM sync adapter -> HubSpot or Salesforce**

Not:

**source -> proxy -> CRM**

---

## 1. Should we focus on HubSpot, Salesforce, or both?

### Recommendation
Start with **HubSpot first**.  
Design the architecture so **Salesforce is a second adapter**, not a redesign.

### Why
HubSpot is the better first wedge because:

- faster implementation
- simpler object model for first launch
- lower integration overhead
- easier onboarding for SMB / mid-market teams
- cleaner path to proving the middleware value quickly

### What “design for both” means

Do **not** hardcode HubSpot fields throughout the product.

Instead use:

- a **canonical internal schema**
- a **CRM adapter interface**
- a **field-mapping layer**
- **tenant-specific sync policies**

That gives you:

- HubSpot-first go-to-market
- Salesforce compatibility later
- freedom to support other CRMs without rebuilding the core

---

## 2. Should this be only an API gateway proxy?

### Recommendation
No.

You should build a **real middleware application**, not a thin pass-through layer.

### Why a proxy is not enough
A proxy only forwards payloads.  
It does not give you:

- identity resolution
- account/contact dedupe
- suppression logic
- enrichment orchestration
- CRM schema discovery
- field alignment
- sync status tracking
- retry / replay
- audit logs
- routing and qualification decisions

### What to build instead
A full middleware application with these layers:

1. **Intake layer**
2. **Canonical data layer**
3. **Enrichment layer**
4. **Decision / rules engine**
5. **CRM adapter layer**
6. **Observability + replay layer**

---

## 3. Should we have a secondary database of CRM contact and account data?

### Recommendation
Yes.

But think of it as more than a cache.

It should be your **canonical prospecting database**.

### Why
You need your own data store for things CRMs are poor at handling cleanly at scale:

- raw imports
- enrichment attempts and snapshots
- dedupe fingerprints
- suppression history
- routing decisions
- sequence enrollment state
- activity history from outreach tools
- sync status and errors
- audit trails
- multi-tenant controls

### What lives in your database
- imported prospects
- canonical accounts
- canonical contacts
- enrichment snapshots
- scoring results
- routing assignments
- suppression flags
- sync state
- field mappings
- workflow logs
- activity timelines

### What lives in the CRM
Only what the customer wants represented there, typically:

- qualified leads / contacts
- companies / accounts
- key activities
- tasks
- lifecycle stage updates
- opportunities / deals later

### Principle
Your app should be the **system of action for prospecting**.  
The CRM should be the **system of record for qualified sales data**.

---

## 4. Should we enrich before sending to HubSpot or Salesforce?

### Recommendation
Yes, **by default**.

### Default sync model
Use:

**ingest -> normalize -> dedupe -> suppress -> enrich -> score -> route -> sync**

### Why
This keeps the CRM cleaner and more valuable by preventing:

- junk contacts
- duplicate companies
- incomplete records
- unqualified noise
- inconsistent field values

### Exceptions
Allow these modes too:

#### A. Pre-sync enrichment
Best default.

Use when:
- data quality matters most
- the team wants only good records in CRM

#### B. Post-sync enrichment
Useful when:
- the customer needs immediate record visibility in CRM
- speed matters more than completeness

Flow:
- create minimal shell record in CRM
- enrich afterward
- backfill CRM fields later

#### C. Hybrid sync
Useful for hand-raisers and hot inbound.

Flow:
- push minimal shell immediately
- enrich in the background
- update CRM after enrichment completes

### Recommendation
Make **pre-sync enrichment the default**, with workflow-level overrides.

---

## 5. Should we pull existing properties from the client’s HubSpot to ensure alignment?

### Recommendation
Yes. This is mandatory.

### Why
Every customer will have custom fields, custom picklists, required properties, and naming differences.

If you do not discover their schema first, onboarding becomes brittle and sync failures rise fast.

### Onboarding flow for CRM alignment

When a client connects HubSpot or Salesforce:

1. fetch object schemas
2. fetch standard and custom properties
3. fetch enum / picklist values
4. identify required vs optional fields
5. identify read-only fields
6. identify associations
7. store a schema snapshot
8. let ops map your canonical fields to the client’s properties
9. validate mappings before first live sync

### What to support in the mapping layer

For each field mapping, store:

- canonical field name
- CRM property name
- data type
- transform rule
- fallback rule
- validation rule
- sync direction
- whether the field is required

### Example
Canonical field:

`job_title`

Could map to:

- `jobtitle` in HubSpot
- `Title` in Salesforce
- a custom field in another CRM later

---

## 6. Should we pull from CRM back into our system too?

### Recommendation
Yes, but selectively.

Do **not** start with full bidirectional sync chaos.

### Start with these inbound CRM reads

Use CRM as a source for:

- existing contacts/accounts for dedupe
- ownership data
- lifecycle stage
- active opportunity signals
- customer / closed-won status
- suppression reference data

### Write back from your app to CRM

Send:

- qualified contacts / leads
- associated accounts / companies
- key notes / activities
- tasks
- lifecycle stage changes
- meeting / handoff state

### Delay these until later

- arbitrary custom field bidirectional sync
- deep historical imports
- many-object recursive sync rules
- “sync everything both ways” behavior

---

## 7. Core use cases the middleware should support

## A. CSV / list import

### Flow
1. user uploads CSV or pastes a list
2. each row becomes a candidate contact/account pair
3. normalize company, title, name, and domain
4. dedupe against your canonical DB
5. suppress based on customer / opp / prior no / competitor rules
6. enrich missing fields
7. score ICP fit
8. route to rep, queue, or sequence
9. sync only if policy says to sync

### Value
- cleaner lead intake
- less manual cleanup
- better routing accuracy

---

## B. Inbound form / demo request / warm signal

### Flow
1. webhook arrives
2. match to existing contact/account
3. if found, update engagement score
4. if not found, create shell prospect
5. enrich immediately or in background
6. route to fast-lane
7. create rep task
8. optionally push to CRM instantly

### Value
- fast response to warm leads
- reduced missed hand-raisers
- better SLA execution

---

## C. Reply-based governance

### Flow
1. prospect replies by email or LinkedIn
2. attach reply to canonical record
3. pause all other sequences
4. create follow-up task
5. log key activity in CRM
6. update qualification state

### Value
- no sequence collisions
- cleaner rep experience
- reduced embarrassing overlap

---

## D. Meeting booked / AE handoff

### Flow
1. meeting is booked
2. mark contact as qualified
3. create or update handoff state
4. associate account/contact/activity
5. push pre-meeting context into CRM
6. open do-not-prospect window
7. transition to AE workflow

### Value
- cleaner handoff
- better pipeline hygiene
- preserved context

---

## E. Ongoing hygiene / repair jobs

### Examples
- duplicate contacts under same domain
- bad account-contact associations
- missing owner assignments
- conflicting lifecycle stages
- invalid emails
- sequence conflicts
- field normalization drift

### Value
- continuous CRM cleanliness
- less ops fire-fighting
- higher trust in data

---

## 8. Canonical data model

Recommended core entities:

- `workspace`
- `integration_connection`
- `account`
- `contact`
- `lead`
- `list`
- `sequence_enrollment`
- `activity`
- `task`
- `enrichment_snapshot`
- `crm_sync_state`
- `field_mapping`
- `suppression_rule`
- `routing_rule`
- `event_log`

### Why this matters
The canonical model prevents your product from being trapped inside any one CRM schema.

---

## 9. CRM adapter design

Build CRM adapters like:

- `hubspot_adapter`
- `salesforce_adapter`

Each adapter should handle only:

- authentication
- metadata discovery
- search / upsert
- association logic
- activity sync
- rate limits
- retries
- error normalization

### Important rule
Keep business logic out of adapters.

Adapters should not decide routing, scoring, or suppression.  
They should only translate and sync.

---

## 10. The full processing pipeline

### Inbound sources
- CSV uploads
- Slack commands
- website forms
- intent signals
- email reply webhooks
- LinkedIn reply events
- calendar events
- outreach platform events
- dialer outcomes
- enrichment providers

### Processing flow

#### Step 1: Intake
- validate payload
- identify workspace / client
- assign event ID

#### Step 2: Identity resolution
- normalize domain
- normalize names
- match account
- match contact
- generate dedupe fingerprint

#### Step 3: Suppression
- existing customer?
- active opportunity?
- prior negative reply?
- do-not-contact?
- competitor?

#### Step 4: Enrichment
- contact enrichment
- account enrichment
- email verification
- phone enrichment
- firmographics
- technographics

#### Step 5: Scoring
- ICP fit
- persona fit
- engagement score
- urgency / intent score

#### Step 6: Routing
- assign owner
- assign queue
- assign sequence
- manual review if needed
- choose sync timing

#### Step 7: CRM sync
- fetch mappings
- validate required fields
- create / update company or account
- create / update contact or lead
- add notes / activities / tasks as needed

#### Step 8: Observability
- write event log
- mark sync status
- capture errors
- retry or replay if needed

---

## 11. Product positioning recommendation

### Do not position it as:
- “HubSpot to Salesforce sync”
- “generic CRM middleware”
- “just an API proxy”

That sounds like iPaaS and makes the product feel generic.

### Position it as:
**Pre-CRM prospecting middleware with CRM sync**

This is stronger because it says:

- we clean and qualify data before it enters the CRM
- we reduce prospecting noise
- we improve routing and conversion
- we keep the CRM clean

---

## 12. Phase-by-phase build plan

## Phase 1: HubSpot-first middleware core

Build first:

- intake API
- canonical contact/account model
- CSV import
- dedupe engine
- suppression engine
- enrichment waterfall
- ICP scoring
- routing rules
- HubSpot schema discovery
- HubSpot sync adapter
- event log
- retry / replay queue

### Goal
Prove the middleware value with one CRM and one clean workflow engine.

---

## Phase 2: Governance and workflow intelligence

Add:

- reply-based pause logic
- sequence conflict prevention
- fast-lane routing
- activity timeline
- task creation
- meeting-booked handoff
- QA and reporting views

### Goal
Move from basic sync tool to real prospecting control plane.

---

## Phase 3: Salesforce adapter

Once the canonical model and field-mapping engine are stable:

Add:

- Salesforce auth
- metadata discovery
- lead/contact/account mapping
- owner sync
- opportunity context
- activity logging

### Goal
Expand CRM compatibility without changing the core architecture.

---

## Phase 4: Broader CRM capabilities later

Only after the middleware engine is stable:

- opportunity management
- deeper reporting
- full sales workflow objects
- post-handoff collaboration workflows

### Goal
Avoid overbuilding too early.

---

## 13. Recommended initial sync policy

Start opinionated.

### Supported objects at first
- contacts / leads
- companies / accounts
- key activities
- tasks
- basic qualification status

### Delay until later
- deep deal / opportunity automation
- full bidirectional custom field sync
- arbitrary cross-object logic

This keeps onboarding and support manageable.

---

## 14. Final recommendations

## Best product shape
A **standalone middleware / prospecting control plane** with its own DB.

## Best CRM strategy
**HubSpot first, Salesforce second.**

## Best architecture
**Canonical schema + adapter pattern + field-mapping layer**

## Best data strategy
**Maintain your own prospecting DB** and sync only the right data into the CRM.

## Best enrichment strategy
**Enrich before sync by default**, with exceptions for urgent inbound cases.

## Best onboarding strategy
**Discover the customer’s CRM schema first**, then map and validate before live sync.

## Best positioning
**Pre-CRM prospecting middleware with CRM sync**

---

## Short answer to the biggest decisions

### Should we focus on HubSpot or Salesforce?
Start with **HubSpot first**.

### Should we just build an API gateway proxy?
No. Build a **real middleware application**.

### Should we have a secondary database?
Yes. A **canonical prospecting database**.

### Should we enrich before sending to CRM?
Yes, **by default**.

### Should we read the client’s HubSpot properties for alignment?
Yes, absolutely.

### Should we support both CRMs eventually?
Yes, through an **adapter model**, not dual deep builds from day one.
