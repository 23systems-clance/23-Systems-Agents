# Sales Engineer Agent Strategy and Framework

## Purpose
This document consolidates the discussion on which agents a sales engineer should create, how lead scoring should work, how outbound scoring differs from inbound intent scoring, how to control LLM costs at scale, and how to operationalize the system inside a Slack + backend workflow environment.

---

## 1. Primary Agents a Sales Engineer Should Create

### 1. Lead Scoring / Qualification Agent
This should be the first agent.

**Job:**
- Determine whether a lead or account is worth sales attention.
- Score fit, buying signals, and readiness.
- Route leads into hot, warm, nurture, or discard queues.

**Why it matters:**
- Lead quality is usually the first bottleneck.
- It creates the decision layer that all downstream workflows depend on.

---

### 2. Use-Case Discovery Agent
**Job:**
- Identify the prospect’s likely problem.
- Map the account to a specific solution area, wedge, or service offering.
- Suggest discovery questions.

**Why it matters:**
- Sales engineers need to move from generic qualification to concrete use-case alignment.
- Good use-case discovery improves demos, meetings, and proposals.

---

### 3. Intent / Problem Likelihood Agent
For inbound, this is a traditional intent agent.
For outbound, it becomes a problem-likelihood agent.

**Job:**
- Inbound: assess whether the buyer is showing real interest.
- Outbound: infer whether the company is likely to have the problem even before engagement.

**Signals:**
- Pricing/product/security page visits
- Demo requests
- Email replies
- Hiring activity
- Public initiatives
- Trigger events

---

### 4. Demo Engagement Agent
**Job:**
- Track how prospects interact with demo environments or product content.
- Convert demo behavior into buying-signal scores.
- Surface which features or motions drew the most interest.

**Why it matters:**
- This helps the sales engineer distinguish curiosity from genuine buying behavior.

---

### 5. Pre-Call Research Agent
**Job:**
- Research the company before the call.
- Summarize likely pain points, company context, stack clues, and likely opportunity areas.
- Recommend discovery questions and a meeting angle.

**Why it matters:**
- It shortens prep time and improves meeting quality.

---

### 6. AE / Rep Handoff Agent
**Job:**
- Turn raw lead data, meetings, or demo activity into a concise handoff brief.
- Summarize account background, likely pain, qualification status, objections, and next steps.

**Why it matters:**
- It improves transition quality from SDR/BDR to AE/SE.

---

### 7. Follow-Up Orchestration Agent
**Job:**
- Decide the best next step after a meeting, reply, or score change.
- Route to SDR, AE, nurture, retargeting, or hold.

**Why it matters:**
- It turns scoring into action.

---

### 8. Campaign Optimization / Feedback Agent
**Job:**
- Review outcomes across segments, personas, campaigns, and sources.
- Identify what is working and what should change.

**Why it matters:**
- This is how the system improves over time instead of becoming static.

---

## 2. Recommended Rollout Order

### Phase 1
- Lead Scoring Agent
- Use-Case Discovery Agent
- AE Handoff Agent

### Phase 2
- Intent / Problem Likelihood Agent
- Pre-Call Research Agent
- Follow-Up Orchestration Agent

### Phase 3
- Demo Engagement Agent
- Campaign Optimization Agent

### If only starting with 3 agents
1. Lead Scoring Agent
2. Use-Case Discovery Agent
3. AE Handoff Agent

---

## 3. Lead Scoring Framework

## Goal
Score each lead on:
- **Fit**: Are they the right kind of company/person?
- **Intent**: Are they acting like a buyer?
- **Readiness**: Are they in a stage where sales should engage now?

### Core formula
**Lead Score = Fit Score + Intent Score + Readiness Score**

Use a 100-point scale.

---

### 3.1 Fit Score (40 points)
Measures whether the lead fits the ideal customer profile.

#### Firmographic fit
- Industry match: 0–10
- Company size / revenue band: 0–10
- Geography / territory fit: 0–5
- Tech stack compatibility: 0–10
- Strategic account / partner alignment: 0–5

#### Contact fit
- Job title / seniority relevance: 0–10
  - Economic buyer / executive sponsor = high
  - Technical evaluator / practitioner = medium-high
  - Irrelevant role = low

---

### 3.2 Intent Score (35 points)
Measures whether the lead is acting like a buyer.

#### High-intent signals
- Demo request: +15
- Pricing / ROI / implementation question: +10
- Product/security/integration page visits: +5 to +10
- Multiple visits in 7 days: +5
- Meaningful outreach reply: +10
- Webinar / event engagement: +5
- Form with project detail: +10

#### Weak signals
- Single email open: +0 to +1
- Generic homepage visit: +1
- Top-of-funnel asset only: +2

#### Negative signals
- Personal email domain: -5
- Student / competitor / agency research: -10
- No engagement after 30 days: -10
- Unsubscribe / bad data: -20

---

### 3.3 Readiness Score (25 points)
Measures whether there is an active project and whether sales should work it now.

#### Suggested criteria
- Clear pain / use case identified: 0–8
- Timeline exists: 0–5
- Budget signal: 0–4
- Authority / buying committee identified: 0–4
- Technical feasibility confirmed: 0–4

---

### 3.4 Score bands
- **80–100** = Hot / sales-ready
- **60–79** = Warm / SDR review + nurture
- **40–59** = Early-stage nurture
- **Below 40** = Low priority

---

### 3.5 Design principles
- Weight **fit more than vanity engagement**.
- Add **recency decay**:
  - Last 7 days = 100%
  - 8–14 days = 75%
  - 15–30 days = 50%
  - 31+ days = 25%
- Use **threshold triggers**, not just total score.
  - Demo request = immediate review
  - Pricing page + senior title + target account = fast track

---

## 4. Outbound Scoring Framework

Traditional intent scoring is weak for outbound because many prospects have shown no prior engagement.

### Replace intent with:
**Outbound Score = Account Fit + Problem Likelihood + Persona Relevance**

---

### 4.1 Account Fit (40 points)
Measure whether the company belongs in your ICP.

**Factors:**
- Industry
- Company size
- Geography
- Business model
- Tech stack
- Growth stage
- Strategic account / partner relevance

---

### 4.2 Problem Likelihood (35 points)
Measure whether the company is likely to have the problem you solve.

**Signals:**
- Hiring for related roles
- Public initiatives or priorities
- Funding rounds
- Product launches
- Cloud migration / security modernization / compliance work
- Website messaging that implies operational complexity
- Stack mismatch that maps to your offer

---

### 4.3 Persona Relevance (25 points)
Measure whether the contact is close to the pain, budget, or implementation.

**Factors:**
- Functional ownership
- Seniority
- Buyer / evaluator / influencer role
- Champion potential

---

### 4.4 Engagement as a later-stage boost
Use engagement as an adjustment after outreach starts, not as the base score.

**Examples:**
- Positive reply: +20
- Referral to owner: +15
- Meeting booked: +25
- Multiple meaningful clicks: +5
- Unsubscribe: -20
- “Not a priority”: -10

---

### 4.5 Outbound priority bands
- **80–100** = High-priority outbound
- **65–79** = Standard sequence
- **50–64** = Test / lighter-touch outreach
- **Below 50** = Low priority

---

## 5. Researching Companies and Customers for Outbound

Research should focus on **evidence of likely pain**, not just demographics.

### Research categories
1. **Company basics**
   - Industry
   - Employee count
   - Revenue band
   - Geography
   - Business model

2. **Strategic initiatives**
   - AI
   - Security
   - Automation
   - Cost optimization
   - Migration
   - Compliance
   - Modernization

3. **Trigger events**
   - Funding
   - Acquisition
   - Leadership change
   - Expansion
   - Hiring spike
   - Product launch
   - Compliance deadline

4. **Tech environment**
   - Stack clues
   - Cloud vendor
   - Tools named in job posts
   - Infrastructure maturity

5. **Role mapping**
   - Economic buyer
   - Functional owner
   - Technical owner
   - Evaluator
   - End-user leader

---

## 6. Cost-Efficient Setup for Thousands of Leads per Month

Do **not** run an LLM on every lead.

### Correct design
**cheap deterministic filters first → light enrichment second → LLM only on a small high-value slice**

---

### 6.1 Stage 1: Hard Gate (almost free)
Reject obvious junk before any LLM.

**Use fields like:**
- Verified business email = yes
- Not a personal domain
- Mobile / phone valid
- Company name present
- Website/domain present
- Country in supported market
- Title present
- Not duplicate
- Not competitor / student / vendor / disqualified

---

### 6.2 Stage 2: Cheap Rules-Based ICP Screen
No LLM yet.

**Score with:**
- Employee count in target range
- Industry in target set
- Geography in target set
- Title / function relevance
- Seniority relevance
- Revenue band
- Technology installed
- Existing CRM account
- Prior engagement history

This creates a **pre-score**.

---

### 6.3 Stage 3: Enrich only above threshold
- Pre-score < 30 = discard / low-touch nurture
- Pre-score 30–50 = optional low-cost enrichment
- Pre-score 50+ = eligible for deeper company research / LLM review

---

### 6.4 Stage 4: LLM only for the top slice
Run the LLM on:
- Top-scoring accounts
- Strategic named accounts
- Leads with missing but promising data
- Leads assigned for SDR/SE action
- Ambiguous accounts that need interpretation

Typical target: **5–15% of total monthly volume**, not 100%.

---

### 6.5 Better LLM trigger rules
Do not trigger LLM research on “verified email = yes” alone.

#### Minimum gate
- Verified business email = yes
- Company domain exists
- Company name exists
- Title exists
- Supported region

#### Then require at least one or two of:
- Mobile / direct dial valid
- Employee count in target band
- Industry in target ICP
- Relevant function / seniority
- Named account / strategic account flag
- Existing CRM account
- Multiple contacts from same company

---

### 6.6 Account-level research, not lead-level research
If several contacts come from the same company:
- Research the company once
- Reuse the account summary across all contacts
- Rank contacts with cheap rules

This is one of the biggest cost savers.

---

### 6.7 Cost-control rules
- Cache company research for 30–90 days
- Refresh only on trigger events or stale cache
- Batch domain research
- Use short structured prompts, not essays
- Use smaller models first, larger ones only for edge cases
- Avoid deep LLM research for low-ACV segments

---

## 7. How to Build the Lead Research / Prioritization Agent

Do not build one giant always-on agent.

### Build a multi-stage scoring pipeline:
1. Gatekeeper
2. Rules-based pre-score
3. Account-level research
4. Contact-level ranking
5. Routing

---

### 7.1 Agent roles

#### Gatekeeper Agent
**Job:** filter obvious junk with deterministic rules.

#### Research / Scoring Agent
**Job:** analyze promising accounts and produce fit/use-case/priority outputs.

#### Routing Agent
**Job:** decide the next step:
- SDR sequence
- AE/SE handoff
- nurture
- recycle
- enrich later

---

### 7.2 Two main objects

#### Account object
Store:
- domain
- company name
- employee band
- industry
- geo
- tech stack
- strategic flags
- ICP fit score
- problem likelihood score
- last research date
- cached research summary

#### Contact object
Store:
- email verification
- phone validity
- title
- department
- seniority
- profile match
- contact fit score
- engagement score
- routing status

---

### 7.3 The three key scores

#### Eligibility Score
Cheap score used to decide whether further work should happen.

#### Account Priority Score
Measures:
- ICP fit
- Problem likelihood
- Strategic value
- Trigger-event relevance

#### Contact Priority Score
Measures:
- Function relevance
- Seniority
- Buyer/evaluator likelihood
- Contactability
- Engagement

**Final Priority = Account Priority + Contact Priority + engagement adjustments**

---

### 7.4 Best LLM tasks
Use the LLM for:
- ICP fit classification from company context
- Use-case inference
- Buyer department inference
- Outreach angle generation
- Ambiguous title classification
- Priority reasoning and explanation

### Do not use the LLM for:
- Email verification
- Phone validation
- Duplicate checking
- Simple title matching
- Threshold checks
- Basic normalization already handled by vendors/rules

---

### 7.5 Trigger logic
Run only the needed layers.

#### Always run gatekeeper when a lead enters
#### Run full research when:
- Lead passes eligibility threshold
- Account is new or cache is stale
- Account is strategic
- Multiple leads appear from same domain
- There is material engagement

#### Re-run account research when:
- Research is 60+ days old
- A major trigger event appears
- A new senior persona is added
- The account becomes a higher priority

---

### 7.6 Structured output design
Ask the model for compact JSON, not long prose.

Example fields:
- icp_fit
- icp_fit_score
- problem_likelihood_score
- likely_use_cases
- likely_buyer_departments
- priority_reason_codes
- outreach_angle
- confidence
- disqualifiers

---

## 8. Operationalizing in Slack + Backend Systems

If this is implemented through a Slack application backed by a workflow engine and backend services, use Slack as the **control plane**, not the permanent database.

### Recommended production agents behind the Slack orchestrator

1. **Slack Orchestrator Agent**
   - Routes events/commands to the right workflow.

2. **Client Context Agent**
   - Resolves client, assigned BDRs, permissions, and tenant context.

3. **List Intake Agent**
   - Handles list upload from Slack or list pull from HubSpot.
   - Validates and classifies list type.

4. **List Enrichment Agent**
   - Runs company/contact/phone enrichment.

5. **List QA / Filter Agent**
   - Dedupes, normalizes, and filters records.

6. **Prioritization Agent**
   - Scores accounts and contacts for outreach priority.

7. **Daily Plan Agent**
   - Builds each BDR’s daily plan and call list.

8. **Activity Sync Agent**
   - Normalizes activity and syncs outcomes into CRM / backend systems.

9. **Manager Insights Agent**
   - Summarizes output, bottlenecks, and performance.

10. **Onboarding / SOP Agent**
   - Guides BDRs with scripts, next steps, and client-specific procedures.

---

## 9. Workflow Builder + Agents Architecture

If the backend already has a workflow builder with triggers, use it together with agents.

### Correct separation
- **Workflow builder** = process orchestration
- **Agents** = reasoning/execution blocks
- **Prompt library** = reusable instruction/config layer

---

### 9.1 Keep the workflow builder
The workflow builder should own:
- triggers
- conditions
- sequencing
- retries
- approvals
- branching
- handoffs between tools/services/agents

---

### 9.2 Add an Agent Registry / Agent Navigation
Yes, add a dedicated area to manage agents.

Each agent should have:
- name
- purpose
- system prompt
- tools it can call
- input schema
- output schema
- model
- version
- status
- owner
- cost policy

---

### 9.3 Make agents reusable nodes in the workflow builder
Agents should show up as typed nodes such as:
- Run Agent
- Enrich List
- Filter List
- Score Contacts
- Generate Daily Plan
- Push to HubSpot
- Notify Slack
- Await Approval

The workflow selects the agent by ID; it should not copy the prompt inline.

---

### 9.4 Add a Prompt Library
Store reusable prompt fragments here, not directly in every workflow.

Examples:
- base assistant prompt
- list-intake classifier prompt
- daily brief format
- manager report template
- client-specific instructions

---

### 9.5 Versioning
Every agent should support:
- draft
- test
- published

Every workflow should reference:
- latest published version, or
- a pinned version

This prevents prompt changes from silently breaking production workflows.

---

## 10. Recommended MVP

### Phase 1
- Lead Scoring Agent
- Use-Case Discovery Agent
- AE Handoff Agent
- Gatekeeper rules
- Rules-based pre-score
- Account cache
- CRM writeback

### Phase 2
- Pre-Call Research Agent
- Problem Likelihood Agent
- Follow-Up Orchestration Agent
- Account-level LLM research
- Better persona normalization

### Phase 3
- Demo Engagement Agent
- Campaign Optimization Agent
- Trigger-event refresh
- Feedback loop from SDR/SE outcomes
- Slack workflow-builder integration with agent registry

---

## 11. Success Metrics

Track whether the system improves:
- SDR acceptance rate
- Meeting-booked rate
- Meeting-held rate
- Qualified opportunity rate
- Closed-won rate
- Junk-touch rate
- Cost per qualified lead
- Time spent per researched account

Use these outcomes to reweight the scoring system over time.

---

## 12. Final Recommendation

The best design is not “AI researches every lead.”

The best design is:

**A scoring and orchestration system decides which accounts deserve research, and AI only helps on the promising slice.**

For a sales engineer, the highest-value starting set is:
1. Lead Scoring Agent
2. Use-Case Discovery Agent
3. AE Handoff Agent

Then expand into:
- Problem Likelihood / Intent
- Pre-Call Research
- Follow-Up Orchestration
- Demo Engagement
- Campaign Optimization

For scale, keep the architecture disciplined:
- rules first
- enrichment second
- account-level LLM research third
- routing last
- Slack as control plane
- backend as orchestrator
- workflows for process
- agents for reasoning
- prompt library for centralized configuration

