-- Migration: Agents
-- Description: Create agents table for AI agent management
-- Created: 2026-01-11

create table public.agents (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,

  -- Agent Info
  name text not null,
  description text,

  -- Server & Tool Permissions
  allowed_servers text[] not null default '{}', -- Empty = no access, specific IDs = limited access
  allowed_tools text[], -- NULL = all tools in allowed servers, specific = limited tools

  -- Rate Limiting
  rate_limit jsonb, -- Agent-specific rate limits
  -- Example: {"requestsPerSecond": 5, "maxConcurrent": 3, "dailyQuota": 1000}

  -- Per-Server Rate Limits (advanced)
  server_rate_limits jsonb, -- Different limits per server
  -- Example: {
  --   "builtwith": {"requestsPerSecond": 2},
  --   "stripe": {"requestsPerSecond": 10}
  -- }

  -- Metadata
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Constraints
  constraint check_name_length check(length(name) >= 1 and length(name) <= 100)
);

-- Enable RLS
alter table public.agents enable row level security;

-- RLS Policies: Users can only see their own agents
create policy "Users can view own agents"
  on public.agents for select
  using (auth.uid() = user_id);

create policy "Users can create own agents"
  on public.agents for insert
  with check (auth.uid() = user_id);

create policy "Users can update own agents"
  on public.agents for update
  using (auth.uid() = user_id);

create policy "Users can delete own agents"
  on public.agents for delete
  using (auth.uid() = user_id);

-- Add trigger for updated_at
create trigger set_updated_at
  before update on public.agents
  for each row
  execute function public.handle_updated_at();

-- Create indexes
create index idx_agents_user_id on public.agents(user_id);
create index idx_agents_name on public.agents(user_id, name); -- For lookups

-- Function to check if user can create more agents
create or replace function public.can_create_agent(p_user_id uuid)
returns boolean as $$
declare
  v_role_name text;
  v_max_agents int;
  v_current_count int;
begin
  -- Get user's role
  select role into v_role_name from public.users where id = p_user_id;

  -- Get max allowed agents for role
  select max_agents into v_max_agents from public.roles where name = v_role_name;

  -- -1 means unlimited
  if v_max_agents = -1 then
    return true;
  end if;

  -- 0 means agents not allowed
  if v_max_agents = 0 then
    return false;
  end if;

  -- Count current agents
  select count(*) into v_current_count
  from public.agents
  where user_id = p_user_id;

  return v_current_count < v_max_agents;
end;
$$ language plpgsql security definer;

-- Comments
comment on table public.agents is 'AI agents with scoped server/tool permissions';
comment on column public.agents.allowed_servers is 'Array of server IDs this agent can access';
comment on column public.agents.allowed_tools is 'NULL = all tools, array = specific tools only';
comment on column public.agents.rate_limit is 'JSONB rate limits for this agent';
comment on column public.agents.server_rate_limits is 'JSONB per-server rate limit overrides';
