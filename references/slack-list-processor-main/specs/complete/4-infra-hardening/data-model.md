# Data Model: AWS Infrastructure Hardening & Gap Resolution

**Date**: 2026-03-05

## Overview

This feature is an infrastructure hardening effort. **No new database entities, tables, or schema changes are required.** All changes are to infrastructure configuration (CloudFormation), deployment tooling (deploy.sh), and targeted application code fixes.

## Existing Entities (Unchanged)

The following entities are referenced by the feature but not modified:

- **jobs** - Enrichment job records (referenced by graceful shutdown - in-flight jobs must drain)
- **api_usage_logs** - Cost attribution records (referenced by FR-023 - cost tracking env vars)
- **audit_logs** - Immutable audit trail (referenced by log retention compliance - FR-024)

## Configuration Changes (Not Data Model)

| Change | Type | Impact |
| ------ | ---- | ------ |
| Secrets Manager secret | AWS resource | Stores all app secrets as JSON |
| Redis ReplicationGroup | AWS resource | Replaces CacheCluster (data loss on migration - ephemeral data only) |
| WAF WebACL | AWS resource | New resource, no data model impact |
| Auto Scaling resources | AWS resource | New resources, no data model impact |
| Second NAT Gateway | AWS resource | New resource, no data model impact |

## Redis Data (Ephemeral)

The Redis migration from CacheCluster to ReplicationGroup will cause data loss. Affected ephemeral data:

- **BullMQ job queues**: Jobs in queue will be lost. Must ensure no active jobs before migration.
- **Conversation state**: In-progress Slack conversations will be reset. Users will need to restart any in-progress enrichment flows.

This is acceptable because Redis data is designed to be ephemeral with no durability guarantees.
