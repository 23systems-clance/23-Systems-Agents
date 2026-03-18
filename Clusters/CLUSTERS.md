# Clusters Feature

Worker clusters — groups of autonomous agents that coordinate on tasks.

## Architecture

```
lib/db/schema.js          ← Tables: clusters, cluster_roles, cluster_workers
lib/db/clusters.js        ← CRUD functions (synchronous, better-sqlite3)
lib/cluster/actions.js    ← Server actions (auth + DB calls)
lib/cluster/components/   ← React UI (JSX source → esbuild → JS)
templates/app/cluster/    ← Next.js page wiring (thin imports from package)
templates/app/clusters/   ← Next.js page wiring (list, roles)
```

Package export: `thepopebot/cluster` → `lib/cluster/components/index.js`

## Database Tables

### `clusters`
| Column | Type | Notes |
|--------|------|-------|
| id | text PK | UUID |
| user_id | text | Owner |
| name | text | Default "New Cluster" |
| starred | integer | 0/1 |
| created_at | integer | Epoch ms |
| updated_at | integer | Epoch ms |

### `cluster_roles`
Reusable role definitions shared across clusters.

| Column | Type | Notes |
|--------|------|-------|
| id | text PK | UUID |
| user_id | text | Owner |
| role_name | text | Display name |
| role | text | Full role description/prompt |
| created_at | integer | Epoch ms |
| updated_at | integer | Epoch ms |

### `cluster_workers`
Individual replicas within a cluster.

| Column | Type | Notes |
|--------|------|-------|
| id | text PK | UUID |
| cluster_id | text | Parent cluster |
| cluster_role_id | text | Nullable, FK to cluster_roles |
| name | text | Default "Worker N" |
| replica_index | integer | Auto-incrementing per cluster |
| code_workspace_id | text | Nullable, link to code workspace |
| trigger_config | text | Nullable JSON, null = manual only |
| created_at | integer | Epoch ms |
| updated_at | integer | Epoch ms |

## Trigger Config

Stored as JSON in `trigger_config` column. Parsed in `getCluster()` server action.

```json
{
  "cron": "*/5 * * * *",
  "file_watch": "/data/inbox,/data/reports",
  "webhook": true
}
```

| Key | Type | Description |
|-----|------|-------------|
| `cron` | string | Cron expression. Absent = disabled. |
| `file_watch` | string | Comma-separated folder paths. Absent = disabled. |
| `webhook` | boolean | true = enabled. Absent = disabled. |
| Manual | — | Always available, not stored. |

**UI behavior**: Trigger badges in worker cards act as toggles. Clicking enables/disables. When enabled, config fields expand below with auto-save on blur.

**Runtime execution**: Not yet implemented — UI/DB only for now.

## Server Actions (`lib/cluster/actions.js`)

| Action | Purpose |
|--------|---------|
| `getClusters()` | List user's clusters |
| `getCluster(clusterId)` | Get cluster with workers (parses triggerConfig JSON) |
| `createCluster(name)` | Create cluster |
| `renameCluster(id, name)` | Rename cluster |
| `starCluster(id)` | Toggle starred |
| `deleteCluster(id)` | Delete cluster + workers |
| `getClusterRoles()` | List user's roles |
| `createClusterRole(name, role)` | Create role |
| `updateClusterRole(id, {roleName, role})` | Update role |
| `deleteClusterRole(id)` | Delete role, unassign workers |
| `addClusterWorker(clusterId, roleId)` | Add worker to cluster |
| `assignWorkerRole(workerId, roleId)` | Assign role to worker |
| `renameClusterWorker(workerId, name)` | Rename worker |
| `updateWorkerTriggers(workerId, config)` | Update trigger config JSON |
| `removeClusterWorker(workerId)` | Remove worker |

## UI Components

| Component | File | Purpose |
|-----------|------|---------|
| `ClustersLayout` | `clusters-layout.js` | Sidebar nav for clusters section |
| `ClustersPage` | `clusters-page.js` | Cluster list with create/delete/star |
| `ClusterPage` | `cluster-page.js` | Single cluster: workers, roles, triggers |
| `ClusterRolesPage` | `cluster-roles-page.js` | Role CRUD |

## DB Functions (`lib/db/clusters.js`)

All synchronous (better-sqlite3). Follow project patterns: `randomUUID()` for IDs, `Date.now()` for timestamps, touch parent `updatedAt` on child mutations.

Key function: `updateWorkerTriggerConfig(id, config)` — `JSON.stringify(config)` into column, or null to clear.
