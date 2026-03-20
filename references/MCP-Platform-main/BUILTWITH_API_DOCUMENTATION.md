# BuildWith API - Complete Documentation

## Table of Contents
1. [Overview](#overview)
2. [Authentication](#authentication)
3. [Rate Limits & Quotas](#rate-limits--quotas)
4. [Pricing & Credits](#pricing--credits)
5. [API Endpoints](#api-endpoints)
6. [Response Formats](#response-formats)
7. [Error Handling](#error-handling)
8. [Best Practices](#best-practices)

---

## Overview

BuildWith provides comprehensive technology profiling services that allow you to:
- Analyze technology stacks of websites
- Track technology adoption trends
- Generate leads based on technology usage
- Monitor competitive landscape
- Access financial and company data

The API operates on an HTTP request/response model and supports multiple output formats (JSON, XML, CSV, XLSX).

### Base URL Pattern
```
https://api.builtwith.com/[API_Name]/api.[Output_Format]?KEY=[Your_Key]&[Parameters]
```

---

## Authentication

### API Key Authentication
BuildWith uses **querystring key authentication**.

**How to get your API key:**
1. Sign up or login at https://builtwith.com
2. Navigate to your account dashboard
3. Your API key will be displayed in the API section

**Key Refresh:**
API keys can be refreshed through account management settings.

**Usage Example:**
```
https://api.builtwith.com/domain-api/api.json?KEY=YOUR_API_KEY&LOOKUP=example.com
```

---

## Rate Limits & Quotas

### Free API
- **Rate Limit:** 1 request per second
- **Access:** Limited features only

### Paid API (Standard)
- **Concurrent Requests:** Maximum 8 concurrent requests
- **Rate Limit:** Maximum 10 requests per second
- **Error Code:** 429 (Too Many Requests) when exceeded

### Dedicated Endpoints
- **Custom Rate Limits:** Available for high-volume users
- **Contact:** Reach out to BuildWith for dedicated endpoint solutions

### Backoff Strategy Recommendations
1. **Exponential Backoff:** Start with 1s delay, double on each retry
2. **Maximum Retries:** 3-5 attempts recommended
3. **Jitter:** Add random jitter (0-1s) to prevent thundering herd
4. **429 Handling:** Wait at least 60 seconds before retrying

---

## Pricing & Credits

### Credit System
BuildWith operates on a **credit-based model** where API calls consume credits from your account balance.

**Important Notes:**
- Different APIs use different credit types
- Product API uses "Product Credits" (not standard API credits)
- 1 Product API lookup can return up to 5,000 products

### Subscription Plans
- **Starting Price:** $295/month (premium subscriptions only)
- **Free Tier:** Limited access with strict rate limits
- **Enterprise:** Custom pricing for dedicated endpoints

### Credit Costs
- Costs vary by API endpoint and data depth
- Contact BuildWith sales for detailed pricing per endpoint

---

## API Endpoints

### 1. Free API
**Description:** Basic technology detection with limited data.

**Endpoint:**
```
https://api.builtwith.com/free-api/[format]?KEY=[key]
```

**Features:**
- Last updated timestamps
- Technology group counts
- Category information

**Limitations:**
- 1 request/second rate limit
- Limited data depth

---

### 2. Domain API (v21)
**Description:** Comprehensive technology information for any website.

**Endpoint:**
```
https://api.builtwith.com/domain-api/api.[format]?KEY=[key]&LOOKUP=[domain]
```

**Parameters:**
- `LOOKUP` (required): Domain to analyze
- `hideAll` (optional): Remove descriptions, links, tags, categories
- `onlyLiveTechnologies` (optional): Return only active technologies
- `noMetaData` (optional): Exclude metadata (improves performance)

**Response Includes:**
- Current technology stack
- Historical technology data
- Technology versions
- Sub-domain analysis
- Tag manager information
- ads.txt data

**Output Formats:** JSON, XML, CSV, XLSX

**Use Cases:**
- Technology stack profiling
- Competitive analysis
- Lead qualification

---

### 3. Domain Live API (Dedicated)
**Description:** Real-time comprehensive technology search across domains.

**Endpoint:**
```
https://api.builtwith.com/dedicated-domain-live-api/[format]?KEY=[key]
```

**Features:**
- Real-time domain verification
- Internal page indexing
- Subdomain discovery
- Tag manager detection
- Technology version detection

**Note:** Legacy endpoint still operational for existing customers.

---

### 4. Lists API
**Description:** Access lists of websites using specific technologies.

**Endpoint:**
```
https://api.builtwith.com/lists-api/api.[format]?KEY=[key]&TECH=[technology]
```

**Parameters:**
- `TECH` (required): Technology identifier
- `includeMetaData` (optional): Include contact/company info
- `offset` (optional): Pagination offset
- `since` (optional): Filter by date (YYYY-MM-DD)

**Response Includes:**
- Domain lists using specific tech
- Contact information (if requested)
- Company metadata (if requested)

**Output Formats:** JSON, XML, TXT (limited)

**Use Cases:**
- Lead generation
- Market research
- Technology adoption tracking

---

### 5. Keywords API
**Description:** Multi-domain technology lookup using keywords.

**Endpoint:**
```
https://api.builtwith.com/keywords-api/api.[format]?KEY=[key]&KEYWORDS=[keywords]
```

**Parameters:**
- `KEYWORDS` (required): Comma-separated keywords

**Features:**
- Batch domain lookups
- Technology correlation
- Keyword-based discovery

---

### 6. Trends API
**Description:** Historical technology adoption and trend data.

**Endpoint:**
```
https://api.builtwith.com/trends-api/api.[format]?KEY=[key]&TECH=[technology]
```

**Features:**
- Historical adoption rates
- Technology growth trends
- Market share analysis
- Time-series data

**Output Formats:** JSON, XML

**Use Cases:**
- Market analysis
- Technology forecasting
- Investment research

---

### 7. Relationships API
**Description:** Discover relationships between websites.

**Endpoint:**
```
https://api.builtwith.com/relationships-api/api.[format]?KEY=[key]&LOOKUP=[domain]
```

**Response Includes:**
- Connected websites
- Relationship types
- Link duration
- Shared technologies

**Output Formats:** JSON, XML

**Use Cases:**
- Network analysis
- Ownership discovery
- Partner identification

---

### 8. Financial API
**Description:** Financial data for websites in BuildWith database.

**Endpoint:**
```
https://api.builtwith.com/financial-api/api.[format]?KEY=[key]&LOOKUP=[domain]
```

**Response Format:** JSON only

**Features:**
- Company financial data
- Revenue estimates
- Funding information
- Company size metrics

**Use Cases:**
- Investment research
- Lead scoring
- Market sizing

---

### 9. Product API
**Description:** Product information and usage across websites.

**Endpoint:**
```
https://api.builtwith.com/product-api/api.[format]?KEY=[key]
```

**Credit System:**
- Uses **Product Credits** (NOT standard API credits)
- 1 lookup can return up to 5,000 products

**Features:**
- Product usage data
- Product categories
- Adoption metrics

---

### 10. Company to URL API
**Description:** Resolve company names to website URLs.

**Features:**
- Company name lookup
- URL discovery
- Brand resolution

---

### 11. Trust API
**Description:** Website trustworthiness assessment.

**Features:**
- Trust scores
- Security indicators
- Reputation metrics

---

### 12. Recommendations API (rec1)
**Description:** Get domain recommendations based on criteria.

**Features:**
- Similar domain discovery
- Technology-based recommendations
- Lead suggestions

---

## Response Formats

### Supported Formats
1. **JSON** - Most common, all endpoints
2. **XML** - Available for most endpoints
3. **CSV** - Domain API only
4. **XLSX** - Domain API only
5. **TXT** - Lists API only (limited)

### Format Specification
Append format to endpoint:
```
api.json   - JSON format
api.xml    - XML format
api.csv    - CSV format
api.xlsx   - XLSX format
api.txt    - TXT format (Lists API only)
```

---

## Error Handling

### HTTP Status Codes

| Code | Meaning | Action Required |
|------|---------|-----------------|
| 200 | Success | Process response |
| 400 | Bad Request | Check parameters |
| 401 | Unauthorized | Verify API key |
| 403 | Forbidden | Check permissions |
| 429 | Too Many Requests | Implement backoff, wait 60s |
| 500 | Server Error | Retry with exponential backoff |
| 503 | Service Unavailable | Retry later |

### Error Response Format
```json
{
  "error": "Error message",
  "code": "ERROR_CODE",
  "details": "Additional information"
}
```

### Common Errors
1. **Invalid API Key:** Check key validity and refresh if needed
2. **Rate Limit Exceeded:** Implement proper backoff strategy
3. **Insufficient Credits:** Purchase additional credits
4. **Invalid Domain:** Verify domain format and existence

---

## Best Practices

### 1. Rate Limit Management
```javascript
// Implement token bucket or sliding window
const rateLimiter = {
  maxRequestsPerSecond: 10,
  maxConcurrent: 8,
  queue: [],
  active: 0
};
```

### 2. Backoff Strategy
```javascript
async function retryWithBackoff(fn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (error.status === 429) {
        const delay = Math.min(1000 * Math.pow(2, i) + Math.random() * 1000, 60000);
        await sleep(delay);
      } else {
        throw error;
      }
    }
  }
  throw new Error('Max retries exceeded');
}
```

### 3. Caching
- Cache responses for frequently queried domains
- Implement TTL based on data freshness requirements
- Use domain as cache key

### 4. Batch Operations
- Use Keywords API for multiple domain lookups
- Implement request queuing for better throughput
- Group related requests together

### 5. Error Handling
- Always handle 429 errors with backoff
- Log API errors for debugging
- Implement circuit breaker for cascading failures

### 6. Performance Optimization
- Use `noMetaData` parameter when metadata not needed
- Set `onlyLiveTechnologies` to reduce response size
- Choose appropriate response format (JSON is fastest)

### 7. Credit Management
- Monitor credit consumption
- Set up alerts for low credits
- Understand which endpoints consume more credits

---

## API Comparison Matrix

| API | Real-time | Historical | Batch | Credits | Use Case |
|-----|-----------|------------|-------|---------|----------|
| Free | ✓ | ✗ | ✗ | 0 | Testing |
| Domain | ✓ | ✓ | ✗ | Low | Single lookups |
| Domain Live | ✓ | ✓ | ✗ | Medium | Dedicated access |
| Lists | ✓ | ✗ | ✓ | Medium | Lead gen |
| Keywords | ✓ | ✗ | ✓ | Medium | Multi-domain |
| Trends | ✗ | ✓ | ✗ | Low | Analytics |
| Relationships | ✓ | ✓ | ✗ | Low | Network analysis |
| Financial | ✓ | ✗ | ✗ | High | Investment research |
| Product | ✓ | ✗ | ✗ | High | Product research |

---

## MCP Server Implementation Considerations

### Required Features
1. **Rate Limiting Middleware**
   - Token bucket algorithm
   - Request queue management
   - Concurrent request limiting (max 8)

2. **Backoff Strategy**
   - Exponential backoff with jitter
   - 429 error handling
   - Circuit breaker pattern

3. **Caching Layer**
   - Redis or in-memory cache
   - Configurable TTL
   - Cache invalidation strategy

4. **Error Handling**
   - Comprehensive error mapping
   - Retry logic
   - Fallback mechanisms

5. **Monitoring**
   - Request metrics
   - Credit consumption tracking
   - Error rate monitoring
   - Performance metrics

6. **Configuration**
   - API key management
   - Rate limit configuration
   - Cache settings
   - Retry policies

---

## Resources

- **Official API Documentation:** https://api.builtwith.com/
- **Knowledge Base:** https://kb.builtwith.com/
- **Pricing:** https://builtwith.com/plans
- **API Key Management:** Account Dashboard
- **Support:** Contact via BuildWith support channels

---

**Document Version:** 1.0
**Last Updated:** 2025-01-11
**Status:** Draft - Pending SpecKit Review
