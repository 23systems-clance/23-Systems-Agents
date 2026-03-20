-- Migration: Initial Schema
-- Description: Create users and roles tables
-- Created: 2026-01-11

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Create users table (extends Supabase auth.users)
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  name text,
  organization text,
  role text not null default 'free', -- References roles.name

  -- Metadata
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Enable RLS
alter table public.users enable row level security;

-- RLS Policies: Users can only see their own data
create policy "Users can view own profile"
  on public.users for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.users for update
  using (auth.uid() = id);

-- Create roles table
create table public.roles (
  name text primary key,
  display_name text not null,

  -- Rate limits (JSONB)
  rate_limit jsonb not null default '{
    "requestsPerSecond": 1,
    "maxConcurrent": 2,
    "dailyQuota": 100,
    "burstSize": 5
  }'::jsonb,

  -- Permissions
  max_api_keys int not null default 1,
  max_agents int not null default 0,
  access_level text not null default 'basic', -- basic, advanced, full

  -- Features (JSONB array)
  features jsonb not null default '[]'::jsonb,

  created_at timestamptz not null default now()
);

-- Enable RLS (roles are public read-only)
alter table public.roles enable row level security;

create policy "Roles are viewable by everyone"
  on public.roles for select
  using (true);

-- Seed default roles
insert into public.roles (name, display_name, rate_limit, max_api_keys, max_agents, access_level, features) values
  (
    'free',
    'Free',
    '{
      "requestsPerSecond": 1,
      "maxConcurrent": 2,
      "dailyQuota": 100,
      "burstSize": 5
    }'::jsonb,
    1,
    0,
    'basic',
    '[]'::jsonb
  ),
  (
    'pro',
    'Pro',
    '{
      "requestsPerSecond": 10,
      "maxConcurrent": 8,
      "dailyQuota": 10000,
      "burstSize": 20
    }'::jsonb,
    5,
    3,
    'advanced',
    '["analytics", "custom_rate_limits"]'::jsonb
  ),
  (
    'enterprise',
    'Enterprise',
    '{
      "requestsPerSecond": 100,
      "maxConcurrent": 50,
      "dailyQuota": -1,
      "burstSize": 200
    }'::jsonb,
    -1,
    -1,
    'full',
    '["analytics", "composition", "custom_rate_limits", "priority_support", "byok"]'::jsonb
  );

-- Create updated_at trigger function
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Add trigger to users table
create trigger set_updated_at
  before update on public.users
  for each row
  execute function public.handle_updated_at();

-- Create indexes
create index idx_users_email on public.users(email);
create index idx_users_role on public.users(role);

-- Comments
comment on table public.users is 'User profiles (extends auth.users)';
comment on table public.roles is 'User roles with rate limits and permissions';
comment on column public.roles.rate_limit is 'JSONB: {requestsPerSecond, maxConcurrent, dailyQuota, burstSize}';
comment on column public.roles.features is 'JSONB array of enabled features';
