# API Contracts: AWS Infrastructure Hardening

## No New API Contracts

This feature does not introduce new API endpoints or modify existing API contracts. All existing endpoints remain unchanged:

- `GET /api/v1/health` - Health check (behavior change: always returns 200, body indicates degraded status)
- `GET /api/v1/jobs` - Job listing (unchanged)
- `POST /api/webhooks/apollo/phone-results` - Apollo webhook (unchanged, now served over HTTPS)

## Health Endpoint Response Change

The only API behavior change is the health endpoint response code:

**Before** (current):
```json
// HTTP 503 when DB or Redis unreachable
{
  "status": "degraded",
  "redis_connected": false,
  "database_connected": false
}
```

**After** (hardened):
```json
// HTTP 200 always (prevents ALB/ECS restart loops)
{
  "status": "degraded",
  "version": "1.0.0",
  "uptime": 5,
  "redis_connected": false,
  "database_connected": false,
  "timestamp": "2026-03-05T00:00:00.000Z"
}
```

The `version` field will now return the actual package version instead of a hardcoded fallback.
