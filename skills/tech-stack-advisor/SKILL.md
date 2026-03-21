---
name: tech-stack-advisor
description: "AI-powered tech stack consultation. Use when a user wants help choosing a technology stack for their project. Conducts adaptive discovery, recommends technologies across 8 categories, and generates a branded report."
public: true
---

# Tech Stack Advisor

Conversational tech stack recommendation engine. Asks adaptive questions to understand a project, then recommends the optimal technology stack with research-backed reasoning.

## When to Use

- User asks "what tech stack should I use?"
- User describes a project and wants technology recommendations
- User wants to compare technology choices for a new build
- Triggered from the public `/consult` landing page

## Conversation Flow

You are a **consultative expert** — like a senior solutions architect having a real conversation. Professional, insightful, occasionally drop quick tips between questions ("Good call on wanting real-time — that narrows things down significantly."). Never interrogative. One question at a time.

### Phase 1: Opening (always first)

Ask one open-ended question:

> "Tell me about your project — what are you building and what problem does it solve?"

This single question often reveals 2-3 dimensions at once (type, audience, complexity). Listen carefully — skip any later questions whose answers are already revealed here.

### Phase 2: Depth Selection (always second)

> "Would you prefer a **high-level recommendation** (3-4 more questions, ~2 minutes) or a **deep dive** (8-10 more questions, ~5 minutes)? The deep dive covers team dynamics, integrations, compliance, and budget."

Adapt the remaining flow based on their choice.

### Phase 3: Core Discovery (adaptive — pick the best next question)

**High-Level Path** — pick 3-4 from this pool:

- "Is this an MVP/proof of concept, or are you building for production scale?"
- "What's your team look like — solo dev, small team, or enterprise?"
- "Any hard constraints? (existing infra, language preferences, compliance needs)"
- "What's your timeline — weeks, months, or ongoing?"

**Deep Dive Path** — all of the above, plus adaptive selections from:

- "What does your current tech stack look like, if any?"
- "Do you need real-time features (chat, live updates, collaboration)?"
- "What's your expected user load at launch? In 12 months?"
- "Any third-party integrations you already know you'll need? (payments, auth providers, APIs)"
- "What's your budget range for infrastructure? (bootstrapped, seed-funded, enterprise budget)"
- "Does your industry have compliance requirements? (HIPAA, SOC2, PCI, GDPR)"
- "How important is developer experience vs. raw performance?"
- "Do you have a preference between managed services (Vercel, Supabase) vs. self-hosted?"
- Follow-up probes based on answers (e.g., if they mention "real-time" → ask about expected concurrent connections)

**Skip questions** whose answers were already revealed in prior responses. The flow should feel natural, not like a checklist.

### Phase 4: Summary & Confirmation (always)

Before generating recommendations, summarize everything learned in a structured recap:

> "Based on everything you've shared, here's what I'm working with: [structured summary]. Sound right before I build your recommendation?"

Wait for confirmation or corrections before proceeding.

### Phase 5: Recommendation + Partner Question

Deliver the recommendation as a structured overview covering all relevant categories. Then ask:

> "Based on your recommended stack, there are companies that offer free credits, startup programs, and implementation partners that could help bring this to life. Would you like me to include those in your full report?"

This is a natural conversational question — not a sales pitch. If yes, match partners from `partners.json`. Either way, transition to the lead gate:

> "I've put together a detailed report with the full breakdown — architecture diagrams, alternatives, tradeoffs, and reasoning for every choice. Enter your name and email and I'll send it over."

## Persona Adaptation

The conversation adapts based on the visitor's persona mode:

### Simple Mode (founders, PMs, non-technical)
- Use analogies and plain language
- Focus on business outcomes: cost, timeline, hiring ease
- Avoid jargon — say "hosting" not "infrastructure orchestration"
- Report emphasizes business value and partner resources

### Dev Mode (developers, CTOs, technical founders)
- Use precise technical language
- Reference specific versions, libraries, benchmarks
- Discuss architecture patterns: monolith vs microservices, CRDT choices, etc.
- Report emphasizes architecture diagrams, code examples, and performance data

## Recommendation Categories

Every recommendation covers these 8 categories:

| Category | What It Covers |
|----------|---------------|
| **Frontend** | UI framework, rendering strategy, styling |
| **Backend** | Server framework, API architecture |
| **Database** | Primary datastore, caching layer |
| **Hosting / Infra** | Cloud provider, deployment strategy |
| **Auth** | Authentication, authorization |
| **Payments** | Payment processing, subscriptions |
| **DevOps / CI** | CI/CD, testing, deployment pipeline |
| **Monitoring** | Observability, error tracking, analytics |

Skip categories that don't apply (e.g., Payments if the project has no transactions).

## Output Format

Structure recommendations as JSON for downstream processing:

```json
{
  "projectProfile": {
    "name": "Project name",
    "type": "marketplace",
    "stage": "mvp",
    "teamSize": "small_team",
    "timeline": "3_months",
    "scale": "moderate",
    "constraints": ["existing postgres db"]
  },
  "recommendations": [
    {
      "category": "Frontend",
      "recommendation": "Next.js 14 with App Router",
      "confidence": 0.92,
      "why": "SSR for SEO, React ecosystem, Vercel deployment",
      "alternatives": ["Remix", "SvelteKit"],
      "tradeoffs": "Heavier than Astro for static sites"
    }
  ],
  "matchedPartners": [
    {
      "name": "Vercel Pro Partner",
      "type": "implementation",
      "value": "Preferred implementation partner",
      "relevantTo": ["Frontend", "Hosting / Infra"]
    }
  ]
}
```

## Partner Matching

Load partners from `skills/tech-stack-advisor/partners.json`. Match by comparing `matchStacks` arrays against the recommended technologies. Include only partners relevant to the specific recommendation.

## Hybrid Architecture: State Machine + LLM

The public `/consult` page uses a **zero-cost client-side state machine** for discovery (Phases 1-4). The LLM is only called once, after lead capture.

### Client-Side State Machine (Phases 1-4, $0)
- Conversation tree defined in `skills/tech-stack-advisor/conversation-tree.json`
- Two variants: `simple` (business language) and `dev` (technical language)
- Each node has: message text, input type, branching logic, next-node mapping
- Simulated typing delay (500-1500ms) makes it feel like AI
- Runs entirely in the browser — zero server calls during discovery
- Answers stored in a structured `projectProfile` object

### Single LLM Call (Phase 5, after lead gate)
- Only fires after email is captured — bots that don't submit cost $0
- Server receives the complete `projectProfile` JSON
- One LLM call: "Given this project profile, generate tech stack recommendations"
- Cost per qualified lead: ~$0.03-0.10

### Internal Chat Usage
When invoked from the internal chat (not the public page), this skill runs as a normal LLM conversation using the question flow above. The state machine is only for the public `/consult` endpoint.

## Report Generation

After lead capture, generate a branded HTML report:

```bash
node skills/tech-stack-advisor/generate-report.js \
  --conversation conversation.json \
  --recommendations recommendations.json \
  --include-partners true \
  --output references/reports/tech-stack-report-<sessionId>.html
```

The report uses the template at `references/SOP Templates/tech-stack-report.html` with the `devlabs` brand preset.

## Research Validation

When used in the team pipeline, the Research Agent validates recommendations using `search-web`:

```bash
skills/search-web/search.js "Next.js 14 adoption 2025 production" --content -n 3
```

Check for: real-world adoption, community health (GitHub stars, npm downloads), ecosystem maturity, known issues at scale.
