-- text2llm web mode minimal schema
-- Apply in Supabase SQL editor before enabling proxy telemetry.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  route text not null,
  provider text not null,
  model text,
  input_tokens integer,
  output_tokens integer,
  latency_ms integer,
  cost_usd numeric(10, 6),
  error text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.usage_events enable row level security;

drop policy if exists "Users read own profile" on public.profiles;
create policy "Users read own profile"
  on public.profiles
  for select
  using (auth.uid() = user_id);

drop policy if exists "Users update own profile" on public.profiles;
create policy "Users update own profile"
  on public.profiles
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users read own settings" on public.user_settings;
create policy "Users read own settings"
  on public.user_settings
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users read own events" on public.usage_events;
create policy "Users read own events"
  on public.usage_events
  for select
  using (auth.uid() = user_id);

drop policy if exists "Users insert own events" on public.usage_events;
create policy "Users insert own events"
  on public.usage_events
  for insert
  with check (auth.uid() = user_id);

-- --- Dataset Processing Tables & Webhooks ---

create table if not exists public.dataset_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  file_key text not null,
  output_format text not null default 'jsonl',
  status text not null default 'pending', -- 'pending', 'processing', 'completed', 'failed'
  result_url text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.dataset_jobs enable row level security;

drop policy if exists "Users read own jobs" on public.dataset_jobs;
create policy "Users read own jobs"
  on public.dataset_jobs
  for select
  using (auth.uid() = user_id);

drop policy if exists "Users insert own jobs" on public.dataset_jobs;
create policy "Users insert own jobs"
  on public.dataset_jobs
  for insert
  with check (auth.uid() = user_id);

-- Setup Database Webhook via Postgres Trigger
create or replace function public.notify_dataset_job()
returns trigger
language plpgsql
security definer
as $$
begin
  -- Note: We are using the production Edge Function URL for mzmyesthlfnoqsxqenyb
  perform supabase_functions.http_request(
    'https://mzmyesthlfnoqsxqenyb.supabase.co/functions/v1/process-dataset', 
    'POST',
    '{"Content-Type": "application/json"}',
    jsonb_build_object('record', row_to_json(NEW))::text,
    '5000'
  );
  return NEW;
end;
$$;

drop trigger if exists tr_process_dataset_job on public.dataset_jobs;
create trigger tr_process_dataset_job
  after insert on public.dataset_jobs
  for each row
  execute function public.notify_dataset_job();
