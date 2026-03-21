# BuiltWith API - Use Cases Beyond Technographic Enrichment

## Overview

BuiltWith offers 13 API endpoints. Most teams only use the Domain API for technographic lookups. Below are additional use cases organized by API endpoint.

---

## 1. Technology Reports / Company Discovery (Lists API)

**Endpoint:** `/lists4/api.json`

### Use Cases

**Prospecting by Technology Stack**
- "Find all companies using Salesforce in the United States" -> filtered company list with domains, contact info, traffic data
- "Show me companies that adopted HubSpot in the last 30 days" -> using `SINCE=30 Days Ago` parameter
- "Which companies use both Shopify and Klaviyo?" -> cross-reference two Lists API calls

**Competitive Intelligence**
- Track how many companies use a competitor's product vs yours
- Identify companies using a competitor's tool as migration targets
- Monitor new adopters of competing technologies weekly

**Market Sizing**
- Count total websites using a specific technology globally or by region
- Measure TAM (Total Addressable Market) for a product category
- Track technology adoption rates over time for investor reports

**Co-Sell / Partner Lists**
- "Find all companies using AWS + Snowflake" -> potential co-sell targets for cloud partnerships
- Build partner ecosystem maps by finding overlapping technology users

---

## 2. Technology Trend Analysis (Trends API)

**Endpoint:** `/trends/api.json`

### Use Cases

**Market Share Tracking**
- Monitor React vs Angular vs Vue adoption over time
- Track which e-commerce platforms are gaining/losing market share (Shopify vs WooCommerce vs Magento)
- Generate quarterly "State of Technology" reports for specific verticals

**Investment Research**
- Track adoption curves of technologies tied to public/private companies
- Identify technologies with accelerating adoption as investment signals
- Compare technology growth rates across categories

**Content Marketing / Thought Leadership**
- Generate data-backed blog posts: "The Rise of Headless CMS in 2024"
- Create industry benchmark reports with real adoption data
- Power data visualizations for presentations and webinars

---

## 3. Company Name to Domain Resolution (Company to URL API)

**Endpoint:** `/ctu1/api.json`

### Use Cases

**CRM Data Cleansing**
- Upload a list of company names from CRM, resolve them to verified domains
- Fix missing or incorrect website fields in Salesforce/HubSpot records
- Validate company names against actual web presence

**List Building from Event Attendees**
- Convert conference attendee lists (company names only) into actionable domain lists
- Then chain into Domain API for technographic enrichment

**Account-Based Marketing (ABM)**
- Convert target account lists from company names to domains for subsequent tech stack analysis
- Identify which accounts in your ABM list use technologies that integrate with your product

---

## 4. Site Relationship Mapping (Relationships API)

**Endpoint:** `/rv1/api.json`

### Use Cases

**Corporate Structure Discovery**
- Find all websites owned by or connected to a parent company
- Map subsidiary and brand relationships through shared technology fingerprints
- Identify franchise networks by shared technology infrastructure

**Competitive Landscape Mapping**
- Discover which sites share the same advertising networks
- Map affiliate program participants
- Find technology vendor ecosystems (all sites using the same custom integration)

**M&A Due Diligence**
- Identify all web properties associated with an acquisition target
- Discover undisclosed brand relationships
- Map technology dependencies across a portfolio of sites

---

## 5. Lead Scoring / Trust Verification (Trust API)

**Endpoint:** `/trust1/api.json`

### Use Cases

**Fraud Prevention**
- Score inbound leads by checking if their website is legitimate vs parked/suspect
- Flag domains associated with affiliate spam or phishing patterns
- Verify site age to filter out newly created suspicious domains

**Lead Quality Scoring**
- Incorporate trust signals into lead scoring models
- Filter out low-quality leads with parked pages or expired domains
- Prioritize leads with established, legitimate web presence

**Vendor / Partner Vetting**
- Verify that potential partners have legitimate web operations
- Check for suspect technology indicators before entering agreements
- Assess the digital maturity of potential vendors

---

## 6. Technology Recommendations (Recommendations API)

**Endpoint:** `/rec1/api.json`

### Use Cases

**Upsell / Cross-Sell Intelligence**
- "Companies like yours typically also use X" -> data-driven upsell suggestions
- Identify technology gaps in prospect tech stacks that your product fills
- Build "commonly paired with" recommendation engines

**Technology Advisory**
- Recommend complementary technologies based on current stack analysis
- Identify missing security or analytics tools for client websites
- Generate automated technology audit reports with recommendations

---

## 7. E-Commerce Product Discovery (Product API)

**Endpoint:** `/product/api.json`

### Use Cases

**Competitive Product Research**
- Search for e-commerce sites selling specific product categories
- Discover which platforms are used for specific product types
- Map the competitive landscape for DTC brands in a category

**Market Research**
- Identify trends in product offerings across e-commerce sites
- Track new product category emergence
- Analyze pricing and product positioning across competitors

---

## 8. SEO / Keyword Intelligence (Keywords API)

**Endpoint:** `/kw1/api.json`

### Use Cases

**SEO Competitive Analysis**
- Extract keywords associated with competitor websites (up to 16 at once)
- Identify keyword gaps between your site and competitors
- Discover content themes driving traffic to competing sites

**Content Strategy**
- Find keyword opportunities from technology-specific site clusters
- Identify topic clusters associated with high-traffic sites in your vertical

---

## 9. Redirect Chain Analysis (Redirects API)

**Endpoint:** `/redirect1/api.json`

### Use Cases

**M&A / Brand Tracking**
- Track when companies redirect old brand domains to new acquisitions
- Detect domain consolidation indicating mergers
- Monitor competitor domain portfolio changes

**SEO Auditing**
- Identify redirect chains that may impact SEO performance
- Detect broken or circular redirects
- Track historical redirect patterns for domain authority analysis

---

## 10. Combined Workflow Examples

### "Build me a prospecting list"

```
1. Lists API     -> Find 500 companies using "OpenAI" in the US
2. Trust API     -> Filter out parked/suspect domains
3. Domain API    -> Enrich remaining domains with full tech stacks
4. Company to URL -> Resolve any company names to domains
5. Export as CSV  -> Deliver to Slack channel
```

### "Technology competitive report"

```
1. Lists API     -> Count companies using Product A vs Product B
2. Trends API    -> Chart adoption over last 12 months
3. Keywords API  -> Extract keyword themes from top adopters
4. Generate PDF  -> Deliver report to Slack channel
```

### "Validate and enrich my CRM list"

```
1. Company to URL -> Resolve company names to domains
2. Trust API      -> Score each domain for legitimacy
3. Domain API     -> Get full tech stacks
4. Relationships  -> Discover connected/subsidiary sites
5. Export as CSV   -> Deliver back to Slack
```

---

## Pricing Notes

| Plan | Monthly Cost | Key Limitations |
|------|-------------|-----------------|
| Basic | $295/mo | 2 technology filters |
| Pro | $495/mo | 10 technology filters |
| Team | $995/mo | Unlimited filters |

- Lists API calls consume credits based on result volume
- Free API available for basic lookups (1 req/sec, limited data)
- All endpoints support JSON, XML, CSV, TSV, XLSX output formats
- Rate limit: 8 concurrent requests, 10 requests/second on paid plans
