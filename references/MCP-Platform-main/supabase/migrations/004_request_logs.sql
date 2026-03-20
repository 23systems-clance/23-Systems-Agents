-- Migration: Request Logs
-- Description: Create request logs table with TimescaleDB for analytics
-- Created: 2026-01-11

-- Enable TimescaleDB extension
create extension if not exists timescaledb;

-- Create request_logs table
create table public.request_logs (
  id uuid not null default uuid_generate_v4(),
  timestamp timestamptz not null default now(),

  -- Request Identity
  user_id uuid references public.users(id) on delete set null,
  api_key_id uuid references public.api_keys(id) on delete set null,
  agent_id uuid references public.agents(id) on delete set null,

  -- MCP Request Info
  server_id text not null, -- e.g., 'builtwith', 'stripe', 'github'
  tool_name text not null, -- e.g., 'builtwith_domain_lookup'

  -- Response Info
  status_code int not null, -- HTTP status code (200, 401, 403, 429, 500)
  duration_ms int not null, -- Request duration in milliseconds
  cached boolean not null default false, -- Was result served from cache?
  error_category text, -- NULL if success, or error category (RATE_LIMIT, AUTH, VALIDATION, etc.)
  error_message text, -- Error message if failed

  -- Request Metadata
  ip_address inet, -- Client IP address
  user_agent text, -- User agent string

  -- Request Arguments (for debugging)
  arguments jsonb, -- Tool arguments (sanitized - no sensitive data)

  -- Primary key (composite with timestamp for hypertable)
  primary key (id, timestamp)
);

-- Convert to TimescaleDB hypertable (partitioned by time)
select create_hypertable(
  'public.request_logs',
  'timestamp',
  chunk_time_interval => interval '1 day',
  if_not_exists => true
);

-- Enable RLS
alter table public.request_logs enable row level security;

-- RLS Policies: Users can only see their own request logs
create policy "Users can view own request logs"
  on public.request_logs for select
  using (auth.uid() = user_id);

-- Create indexes for common queries
create index idx_request_logs_user_id_timestamp on public.request_logs(user_id, timestamp desc);
create index idx_request_logs_api_key_id_timestamp on public.request_logs(api_key_id, timestamp desc);
create index idx_request_logs_agent_id_timestamp on public.request_logs(agent_id, timestamp desc) where agent_id is not null;
create index idx_request_logs_server_tool on public.request_logs(server_id, tool_name, timestamp desc);
create index idx_request_logs_status_code on public.request_logs(status_code, timestamp desc);
create index idx_request_logs_error_category on public.request_logs(error_category, timestamp desc) where error_category is not null;

-- Create continuous aggregates for analytics (TimescaleDB feature)

-- Hourly aggregates
create materialized view public.request_logs_hourly
with (timescaledb.continuous) as
select
  time_bucket('1 hour', timestamp) as bucket,
  user_id,
  server_id,
  tool_name,

  -- Counts
  count(*) as request_count,
  count(*) filter (where status_code = 200) as success_count,
  count(*) filter (where status_code >= 400) as error_count,
  count(*) filter (where cached = true) as cache_hit_count,

  -- Latency stats
  avg(duration_ms) as avg_duration_ms,
  percentile_cont(0.50) within group (order by duration_ms) as p50_duration_ms,
  percentile_cont(0.95) within group (order by duration_ms) as p95_duration_ms,
  percentile_cont(0.99) within group (order by duration_ms) as p99_duration_ms,
  min(duration_ms) as min_duration_ms,
  max(duration_ms) as max_duration_ms,

  -- Error breakdown
  count(*) filter (where error_category = 'RATE_LIMIT') as rate_limit_errors,
  count(*) filter (where error_category = 'AUTH') as auth_errors,
  count(*) filter (where error_category = 'VALIDATION') as validation_errors,
  count(*) filter (where error_category = 'SERVER') as server_errors

from public.request_logs
group by bucket, user_id, server_id, tool_name;

-- Add refresh policy (refresh every hour, for data older than 1 hour)
select add_continuous_aggregate_policy('public.request_logs_hourly',
  start_offset => interval '2 hours',
  end_offset => interval '1 hour',
  schedule_interval => interval '1 hour',
  if_not_exists => true
);

-- Daily aggregates (for longer-term trends)
create materialized view public.request_logs_daily
with (timescaledb.continuous) as
select
  time_bucket('1 day', timestamp) as bucket,
  user_id,
  server_id,

  -- Counts
  count(*) as request_count,
  count(*) filter (where status_code = 200) as success_count,
  count(*) filter (where status_code >= 400) as error_count,
  count(*) filter (where cached = true) as cache_hit_count,

  -- Latency stats
  avg(duration_ms) as avg_duration_ms,
  percentile_cont(0.95) within group (order by duration_ms) as p95_duration_ms,

  -- Cache hit rate
  (count(*) filter (where cached = true))::float / count(*)::float as cache_hit_rate

from public.request_logs
group by bucket, user_id, server_id;

-- Add refresh policy (refresh daily)
select add_continuous_aggregate_policy('public.request_logs_daily',
  start_offset => interval '3 days',
  end_offset => interval '1 day',
  schedule_interval => interval '1 day',
  if_not_exists => true
);

-- Retention policy: Keep raw logs for 90 days, aggregates forever
select add_retention_policy('public.request_logs',
  interval '90 days',
  if_not_exists => true
);

-- Helper function to log a request (called by middleware)
create or replace function public.log_request(
  p_user_id uuid,
  p_api_key_id uuid,
  p_agent_id uuid,
  p_server_id text,
  p_tool_name text,
  p_status_code int,
  p_duration_ms int,
  p_cached boolean,
  p_error_category text default null,
  p_error_message text default null,
  p_ip_address inet default null,
  p_user_agent text default null,
  p_arguments jsonb default null
)
returns void as $$
begin
  insert into public.request_logs (
    user_id,
    api_key_id,
    agent_id,
    server_id,
    tool_name,
    status_code,
    duration_ms,
    cached,
    error_category,
    error_message,
    ip_address,
    user_agent,
    arguments
  ) values (
    p_user_id,
    p_api_key_id,
    p_agent_id,
    p_server_id,
    p_tool_name,
    p_status_code,
    p_duration_ms,
    p_cached,
    p_error_category,
    p_error_message,
    p_ip_address,
    p_user_agent,
    p_arguments
  );
end;
$$ language plpgsql security definer;

-- Helper function to get user analytics
create or replace function public.get_user_analytics(
  p_user_id uuid,
  p_start_date timestamptz default now() - interval '30 days',
  p_end_date timestamptz default now()
)
returns jsonb as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'totalRequests', count(*),
    'successCount', count(*) filter (where status_code = 200),
    'errorCount', count(*) filter (where status_code >= 400),
    'avgDurationMs', avg(duration_ms),
    'cacheHitRate', (count(*) filter (where cached = true))::float / count(*)::float,
    'byServer', (
      select jsonb_object_agg(server_id, row_to_json(stats))
      from (
        select
          server_id,
          count(*) as request_count,
          avg(duration_ms) as avg_duration_ms
        from public.request_logs
        where user_id = p_user_id
          and timestamp >= p_start_date
          and timestamp <= p_end_date
        group by server_id
      ) as stats
    )
  ) into v_result
  from public.request_logs
  where user_id = p_user_id
    and timestamp >= p_start_date
    and timestamp <= p_end_date;

  return v_result;
end;
$$ language plpgsql security definer;

-- Comments
comment on table public.request_logs is 'TimescaleDB hypertable for MCP request logs';
comment on column public.request_logs.timestamp is 'Request timestamp (hypertable partition key)';
comment on column public.request_logs.cached is 'True if result was served from cache';
comment on column public.request_logs.error_category is 'Error category if request failed';
comment on function public.log_request is 'Insert request log (called by middleware)';
comment on function public.get_user_analytics is 'Get analytics for a user within date range';
