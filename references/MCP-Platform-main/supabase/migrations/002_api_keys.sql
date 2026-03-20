-- Migration: API Keys
-- Description: Create API keys table with server-level permissions (Option 3)
-- Created: 2026-01-11

create table public.api_keys (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,

  -- API Key Storage
  key_hash text unique not null, -- bcrypt hash of full key
  key_prefix text not null, -- First 12 chars for display (e.g., "mcp_prod_abc")

  -- Metadata
  name text not null, -- User-friendly name (e.g., "Claude Code Key")
  description text,

  -- Role & Permissions
  role text not null references public.roles(name),

  -- Server-Level Permissions (Option 3)
  allowed_servers text[], -- NULL = all servers, [] = none, ['builtwith', 'github'] = specific
  allowed_tools text[], -- Optional: tool-level granularity

  -- Agent Assignment (inherits agent's permissions)
  agent_id uuid references public.agents(id) on delete set null,
  agent_name text, -- Denormalized for quick lookups

  -- Rate Limiting
  rate_limit_override jsonb, -- Override role defaults
  -- Example: {"requestsPerSecond": 20, "maxConcurrent": 10, "dailyQuota": 5000}

  -- External API Keys (BYOK for enterprise)
  external_api_keys jsonb, -- Encrypted external keys
  -- Example: {"builtwith": "encrypted_key", "stripe": "encrypted_key"}

  -- Status
  enabled boolean not null default true,
  last_used_at timestamptz,
  expires_at timestamptz,

  -- Metadata
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Constraints
  constraint unique_key_prefix unique(key_prefix),
  constraint check_name_length check(length(name) >= 1 and length(name) <= 100)
);

-- Enable RLS
alter table public.api_keys enable row level security;

-- RLS Policies: Users can only see their own API keys
create policy "Users can view own API keys"
  on public.api_keys for select
  using (auth.uid() = user_id);

create policy "Users can create own API keys"
  on public.api_keys for insert
  with check (auth.uid() = user_id);

create policy "Users can update own API keys"
  on public.api_keys for update
  using (auth.uid() = user_id);

create policy "Users can delete own API keys"
  on public.api_keys for delete
  using (auth.uid() = user_id);

-- Add trigger for updated_at
create trigger set_updated_at
  before update on public.api_keys
  for each row
  execute function public.handle_updated_at();

-- Create indexes
create index idx_api_keys_user_id on public.api_keys(user_id);
create index idx_api_keys_enabled on public.api_keys(enabled) where enabled = true;
create index idx_api_keys_agent_id on public.api_keys(agent_id) where agent_id is not null;
create index idx_api_keys_key_hash on public.api_keys(key_hash); -- For fast lookups during auth
create index idx_api_keys_expires_at on public.api_keys(expires_at) where expires_at is not null;

-- Function to check if user can create more API keys
create or replace function public.can_create_api_key(p_user_id uuid)
returns boolean as $$
declare
  v_role_name text;
  v_max_keys int;
  v_current_count int;
begin
  -- Get user's role
  select role into v_role_name from public.users where id = p_user_id;

  -- Get max allowed keys for role
  select max_api_keys into v_max_keys from public.roles where name = v_role_name;

  -- -1 means unlimited
  if v_max_keys = -1 then
    return true;
  end if;

  -- Count current keys
  select count(*) into v_current_count
  from public.api_keys
  where user_id = p_user_id and enabled = true;

  return v_current_count < v_max_keys;
end;
$$ language plpgsql security definer;

-- Function to update last_used_at (called by auth middleware)
create or replace function public.update_api_key_last_used(p_key_hash text)
returns void as $$
begin
  update public.api_keys
  set last_used_at = now()
  where key_hash = p_key_hash;
end;
$$ language plpgsql security definer;

-- Comments
comment on table public.api_keys is 'Global API keys with server-level permissions (Option 3)';
comment on column public.api_keys.key_hash is 'bcrypt hash of full API key';
comment on column public.api_keys.key_prefix is 'Display-safe prefix (first 12 chars)';
comment on column public.api_keys.allowed_servers is 'NULL = all servers, [] = none, [ids] = specific servers';
comment on column public.api_keys.allowed_tools is 'Optional tool-level permissions';
comment on column public.api_keys.rate_limit_override is 'JSONB override for role rate limits';
comment on column public.api_keys.external_api_keys is 'Encrypted BYOK external API keys (enterprise)';
