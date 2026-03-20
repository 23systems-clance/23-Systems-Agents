-- Migration: MCP Servers
-- Description: Create MCP servers registry (for future auto-generation)
-- Created: 2026-01-11

create table public.mcp_servers (
  id text primary key, -- Slug identifier (e.g., 'builtwith', 'stripe', 'github')
  user_id uuid references public.users(id) on delete cascade, -- NULL for system servers

  -- Server Info
  name text not null,
  description text not null,
  category text not null, -- 'payment', 'analytics', 'crm', 'custom'
  tags text[] not null default '{}',

  -- Source
  source_type text not null, -- 'builtin', 'openapi', 'manual'
  api_documentation jsonb, -- OpenAPI/Swagger spec (if auto-generated)

  -- Tools
  tools jsonb not null, -- Array of tool definitions (MCP format)
  -- Example: [
  --   {
  --     "name": "builtwith_free_lookup",
  --     "description": "...",
  --     "inputSchema": {...}
  --   }
  -- ]

  -- Configuration
  config jsonb not null default '{}'::jsonb,
  -- Example: {
  --   "rateLimit": {"requestsPerSecond": 10, "maxConcurrent": 8},
  --   "cache": {"enabled": true, "ttlMs": 3600000},
  --   "retry": {"maxRetries": 3}
  -- }

  -- Access Control
  required_access_level text not null default 'basic', -- 'basic', 'advanced', 'full'
  is_public boolean not null default true, -- False for private/custom servers

  -- Quality Metrics (updated periodically)
  uptime float, -- 0.0 to 1.0 (99.9% = 0.999)
  avg_latency_ms float,
  error_rate float, -- 0.0 to 1.0

  -- Usage Stats (updated periodically)
  total_requests bigint not null default 0,
  active_users int not null default 0,

  -- Deployment
  deployment_url text, -- HTTP endpoint URL (e.g., 'https://api.mcpfactory.com/mcp/builtwith')
  version text not null default '1.0.0',

  -- Metadata
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  author text, -- User email or 'MCP Factory'

  -- Constraints
  constraint check_id_format check(id ~ '^[a-z0-9-]+$'), -- Lowercase, alphanumeric, hyphens
  constraint check_source_type check(source_type in ('builtin', 'openapi', 'manual')),
  constraint check_access_level check(required_access_level in ('basic', 'advanced', 'full'))
);

-- Enable RLS
alter table public.mcp_servers enable row level security;

-- RLS Policies
create policy "Public servers are viewable by everyone"
  on public.mcp_servers for select
  using (is_public = true or auth.uid() = user_id);

create policy "Users can create their own servers"
  on public.mcp_servers for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own servers"
  on public.mcp_servers for update
  using (auth.uid() = user_id);

create policy "Users can delete their own servers"
  on public.mcp_servers for delete
  using (auth.uid() = user_id);

-- Add trigger for updated_at
create trigger set_updated_at
  before update on public.mcp_servers
  for each row
  execute function public.handle_updated_at();

-- Create indexes
create index idx_mcp_servers_category on public.mcp_servers(category);
create index idx_mcp_servers_tags on public.mcp_servers using gin(tags);
create index idx_mcp_servers_user_id on public.mcp_servers(user_id) where user_id is not null;
create index idx_mcp_servers_is_public on public.mcp_servers(is_public) where is_public = true;
create index idx_mcp_servers_uptime on public.mcp_servers(uptime desc) where uptime is not null;

-- Seed builtin servers
insert into public.mcp_servers (id, name, description, category, source_type, tools, config, deployment_url) values
  (
    'builtwith',
    'BuildWith API',
    'Technology profiling and domain analysis using BuildWith API. Discover what technologies websites are built with.',
    'analytics',
    'builtin',
    '[
      {
        "name": "builtwith_free_lookup",
        "description": "Get basic technology information for a domain using the BuildWith Free API. Returns technology counts grouped by category.",
        "inputSchema": {
          "type": "object",
          "properties": {
            "domain": {
              "type": "string",
              "description": "Domain name to lookup (e.g., github.com)"
            }
          },
          "required": ["domain"]
        }
      },
      {
        "name": "builtwith_domain_lookup",
        "description": "Get comprehensive technology stack analysis for a domain.",
        "inputSchema": {
          "type": "object",
          "properties": {
            "domain": {
              "type": "string",
              "description": "Domain name to lookup"
            },
            "hideMetadata": {
              "type": "boolean",
              "description": "Hide metadata in response"
            },
            "onlyLive": {
              "type": "boolean",
              "description": "Only return live technologies"
            }
          },
          "required": ["domain"]
        }
      },
      {
        "name": "builtwith_list_sites",
        "description": "Find websites that use a specific technology.",
        "inputSchema": {
          "type": "object",
          "properties": {
            "technology": {
              "type": "string",
              "description": "Technology name to search for"
            },
            "offset": {
              "type": "number",
              "description": "Pagination offset"
            }
          },
          "required": ["technology"]
        }
      }
    ]'::jsonb,
    '{
      "rateLimit": {"requestsPerSecond": 10, "maxConcurrent": 8},
      "cache": {"enabled": true, "ttlMs": 3600000},
      "retry": {"maxRetries": 3, "initialDelayMs": 1000, "maxDelayMs": 10000}
    }'::jsonb,
    'http://localhost:8080'
  );

-- Helper function to get server by ID
create or replace function public.get_mcp_server(p_server_id text)
returns jsonb as $$
declare
  v_server jsonb;
begin
  select row_to_json(s)::jsonb into v_server
  from public.mcp_servers s
  where id = p_server_id;

  return v_server;
end;
$$ language plpgsql security definer;

-- Helper function to search servers
create or replace function public.search_mcp_servers(
  p_query text default null,
  p_category text default null,
  p_tags text[] default null
)
returns setof public.mcp_servers as $$
begin
  return query
  select *
  from public.mcp_servers
  where is_public = true
    and (p_query is null or name ilike '%' || p_query || '%' or description ilike '%' || p_query || '%')
    and (p_category is null or category = p_category)
    and (p_tags is null or tags && p_tags)
  order by total_requests desc, uptime desc;
end;
$$ language plpgsql security definer;

-- Comments
comment on table public.mcp_servers is 'Registry of MCP servers (builtin and user-generated)';
comment on column public.mcp_servers.id is 'Slug identifier (lowercase, alphanumeric, hyphens)';
comment on column public.mcp_servers.source_type is 'builtin (factory), openapi (auto-generated), manual (custom)';
comment on column public.mcp_servers.tools is 'JSONB array of MCP tool definitions';
comment on column public.mcp_servers.config is 'JSONB server configuration (rate limits, cache, retry)';
comment on column public.mcp_servers.required_access_level is 'Minimum role access level required';
