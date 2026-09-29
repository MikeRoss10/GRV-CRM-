-- LeadLens core schema
-- Money is stored as integer minor units (paise for INR). Timestamps are UTC.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Workspaces and membership
-- ---------------------------------------------------------------------------

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'Asia/Kolkata',
  default_currency text not null default 'INR',
  vertical text,
  default_sla_minutes integer not null default 15 check (default_sla_minutes > 0),
  staff_hourly_cost_minor bigint check (staff_hourly_cost_minor >= 0),
  call_window_start time not null default '10:00',
  call_window_end time not null default '19:00',
  created_at timestamptz not null default now()
);

-- Secrets are kept apart so only owners can read them.
create table public.workspace_secrets (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  ingest_token text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  rotated_at timestamptz not null default now()
);

create type public.member_role as enum ('owner', 'manager', 'rep', 'analyst');

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  email text not null,
  role public.member_role not null,
  active boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index on public.workspace_members (user_id);

create table public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null,
  name text,
  role public.member_role not null,
  invited_by uuid references auth.users(id),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, email)
);

-- ---------------------------------------------------------------------------
-- Access helpers (security definer so policies don't recurse)
-- ---------------------------------------------------------------------------

create or replace function public.is_member(p_workspace uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from workspace_members
    where workspace_id = p_workspace and user_id = auth.uid() and active
  );
$$;

create or replace function public.has_role(p_workspace uuid, p_roles public.member_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from workspace_members
    where workspace_id = p_workspace and user_id = auth.uid() and active and role = any(p_roles)
  );
$$;

-- ---------------------------------------------------------------------------
-- Sources, connections, raw events
-- ---------------------------------------------------------------------------

create table public.connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null check (provider in ('gmail', 'sms', 'voice', 'ads', 'csv', 'webhook')),
  provider_account_ref text not null,
  status text not null default 'pending' check (status in ('pending', 'healthy', 'degraded', 'error', 'disconnected')),
  scopes text[],
  last_sync_at timestamptz,
  cursor text,
  watch_expires_at timestamptz,
  error_code text,
  error_message_safe text,
  created_at timestamptz not null default now()
);
create index on public.connections (workspace_id);

create table public.source_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_type text not null check (source_type in ('justdial', 'sulekha', '91acres', 'meta_ads', 'google_ads', 'website', 'referral', 'walk_in', 'other')),
  display_name text not null,
  account_identifier text,
  billing_model text not null default 'manual' check (billing_model in ('subscription', 'package', 'prepaid', 'per_lead', 'cpc', 'cpm', 'cpa', 'manual')),
  active_from date not null default current_date,
  active_to date,
  default_allocation_method text not null default 'equal_daily' check (default_allocation_method in ('equal_daily', 'lead_weighted', 'manual', 'direct_only')),
  -- Explicit assumption: this source has no direct spend (e.g. referrals). Without it, no cost = Unknown.
  zero_cost boolean not null default false,
  status text not null default 'active' check (status in ('active', 'paused', 'archived')),
  created_at timestamptz not null default now()
);
create index on public.source_accounts (workspace_id);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  full_name text,
  phone_e164 text,
  phone_original text,
  email text,
  locality text,
  language text,
  do_not_contact boolean not null default false,
  do_not_contact_reason text check (do_not_contact_reason in ('user_opt_out', 'manual_block', 'provider_block', 'compliance_review')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.contacts (workspace_id, phone_e164);
create index on public.contacts (workspace_id, email);

create type public.opportunity_status as enum (
  'new', 'assigned', 'attempting_contact', 'contacted', 'qualified', 'appointment', 'proposal', 'won',
  'lost', 'nurture', 'invalid', 'duplicate', 'spam', 'do_not_contact'
);

create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  title text not null,
  status public.opportunity_status not null default 'new',
  owner_user_id uuid references auth.users(id),
  service text,
  requirement_text text,
  location text,
  budget_minor bigint,
  budget_currency text default 'INR',
  received_at timestamptz not null default now(),
  first_response_at timestamptz,
  contacted_at timestamptz,
  qualified_at timestamptz,
  appointment_at timestamptz,
  won_at timestamptz,
  lost_reason text check (lost_reason in ('price', 'timing', 'not_serviceable', 'no_response', 'competitor', 'invalid', 'other')),
  revenue_minor bigint check (revenue_minor >= 0),
  gross_margin_minor bigint,
  duplicate_status text not null default 'none' check (duplicate_status in ('none', 'probable', 'confirmed', 'merged')),
  duplicate_confidence numeric(3,2) check (duplicate_confidence between 0 and 1),
  duplicate_of_id uuid references public.opportunities(id) on delete set null,
  data_quality_status text not null default 'complete' check (data_quality_status in ('complete', 'needs_review', 'incomplete')),
  parser_confidence numeric(3,2),
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.opportunities (workspace_id, received_at desc);
create index on public.opportunities (contact_id);

create table public.source_touches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  source_account_id uuid not null references public.source_accounts(id) on delete cascade,
  touch_type text not null default 'lead_notification' check (touch_type in ('lead_notification', 'ad_click', 'form_submit', 'referral', 'manual')),
  provider_lead_id text,
  campaign_name text,
  medium text,
  observed_at timestamptz not null default now(),
  attribution_weight numeric not null default 1,
  shared_lead_evidence text not null default 'none' check (shared_lead_evidence in ('none', 'source_stated', 'probable_pattern', 'confirmed')),
  evidence_ref text
);
create index on public.source_touches (opportunity_id, observed_at);
create index on public.source_touches (source_account_id, provider_lead_id);

create table public.raw_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  connection_id uuid references public.connections(id) on delete set null,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  provider_event_id text,
  event_type text not null check (event_type in ('email', 'sms', 'delivery', 'call_callback', 'ad_spend', 'csv_row', 'manual')),
  received_at timestamptz not null default now(),
  provider_occurred_at timestamptz,
  payload text not null,
  parsed jsonb,
  parse_status text not null default 'pending' check (parse_status in ('pending', 'parsed', 'needs_review', 'failed', 'ignored')),
  parser_version text,
  idempotency_key text not null,
  unique (workspace_id, idempotency_key)
);

-- ---------------------------------------------------------------------------
-- Communication, tasks, costs, consent, audit
-- ---------------------------------------------------------------------------

create table public.message_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  channel text not null check (channel in ('sms', 'whatsapp', 'email')),
  language text not null default 'en',
  body text not null,
  approved boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  channel text not null check (channel in ('gmail', 'sms', 'whatsapp', 'email', 'internal_note')),
  direction text not null check (direction in ('inbound', 'outbound')),
  provider_message_id text,
  sender_ref text,
  recipient_ref text,
  body_redacted text,
  sent_at timestamptz default now(),
  delivered_at timestamptz,
  read_at timestamptz,
  template_id uuid references public.message_templates(id) on delete set null,
  consent_basis_id uuid,
  cost_minor bigint,
  author_user_id uuid references auth.users(id) default auth.uid()
);
create index on public.messages (opportunity_id, sent_at);

create table public.calls (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  provider text not null default 'manual',
  call_type text not null default 'human' check (call_type in ('human', 'ai_assisted', 'ai_autonomous', 'inbound')),
  direction text not null default 'outbound' check (direction in ('inbound', 'outbound')),
  status text not null default 'completed' check (status in ('queued', 'ringing', 'answered', 'no_answer', 'busy', 'failed', 'completed')),
  started_at timestamptz default now(),
  ended_at timestamptz,
  duration_seconds integer check (duration_seconds >= 0),
  provider_call_id text,
  script_version text,
  language text,
  recording_enabled boolean not null default false,
  transcript_ref text,
  summary text,
  outcome text check (outcome in ('connected', 'qualified', 'appointment', 'callback', 'not_interested', 'opt_out', 'invalid', 'other')),
  consent_basis_id uuid,
  cost_minor bigint,
  user_id uuid references auth.users(id) default auth.uid()
);
create index on public.calls (opportunity_id, started_at);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  assignee_user_id uuid references auth.users(id),
  task_type text not null default 'follow_up' check (task_type in ('call', 'message', 'follow_up', 'appointment', 'review')),
  title text,
  due_at timestamptz not null,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  status text not null default 'open' check (status in ('open', 'completed', 'snoozed', 'cancelled')),
  completed_at timestamptz,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.tasks (workspace_id, status, due_at);
create index on public.tasks (opportunity_id);

create table public.cost_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_account_id uuid not null references public.source_accounts(id) on delete cascade,
  -- Set for direct per-lead charges; null for pooled spend that is allocated over a period.
  opportunity_id uuid references public.opportunities(id) on delete set null,
  cost_type text not null check (cost_type in ('subscription', 'package', 'prepaid_topup', 'per_lead', 'click', 'impression', 'agency_fee', 'staff_time', 'message', 'call', 'adjustment')),
  amount_minor bigint not null check (amount_minor >= 0),
  currency text not null default 'INR',
  occurred_at timestamptz not null default now(),
  period_start date,
  period_end date,
  provider_ref text,
  allocation_method text not null default 'equal_daily' check (allocation_method in ('direct', 'equal_daily', 'lead_weighted', 'manual', 'unknown')),
  notes text,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  check (period_start is null or period_end is null or period_end >= period_start)
);
create index on public.cost_events (source_account_id);
create index on public.cost_events (opportunity_id);

create table public.consent_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  channel text not null check (channel in ('voice', 'sms', 'email', 'whatsapp')),
  basis_type text not null check (basis_type in ('customer_inquiry', 'explicit_opt_in', 'transactional', 'service_relationship', 'manual_review', 'unknown')),
  purpose text not null,
  captured_at timestamptz not null default now(),
  expires_at timestamptz,
  source_evidence_ref text,
  revoked_at timestamptz,
  verified_by_user_id uuid references auth.users(id)
);
create index on public.consent_events (opportunity_id);

create table public.call_policies (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  enabled boolean not null default false,
  provider text,
  provider_compliance_complete boolean not null default false,
  caller_id text,
  script_name text not null default 'New enquiry qualification v1',
  script_body text not null default '',
  language text not null default 'en',
  disclosure text not null default 'I''m an AI assistant calling on behalf of {business}.',
  recording_enabled boolean not null default false,
  transfer_user_id uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_user_id uuid references auth.users(id) default auth.uid(),
  entity_type text not null,
  entity_id uuid,
  action text not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index on public.audit_events (workspace_id, entity_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.workspaces enable row level security;
alter table public.workspace_secrets enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invites enable row level security;
alter table public.connections enable row level security;
alter table public.source_accounts enable row level security;
alter table public.contacts enable row level security;
alter table public.opportunities enable row level security;
alter table public.source_touches enable row level security;
alter table public.raw_events enable row level security;
alter table public.message_templates enable row level security;
alter table public.messages enable row level security;
alter table public.calls enable row level security;
alter table public.tasks enable row level security;
alter table public.cost_events enable row level security;
alter table public.consent_events enable row level security;
alter table public.call_policies enable row level security;
alter table public.audit_events enable row level security;

create policy "members read workspace" on public.workspaces for select to authenticated using (public.is_member(id));
create policy "owners update workspace" on public.workspaces for update to authenticated
  using (public.has_role(id, array['owner']::public.member_role[]));

create policy "owners read secrets" on public.workspace_secrets for select to authenticated
  using (public.has_role(workspace_id, array['owner']::public.member_role[]));

create policy "members read members" on public.workspace_members for select to authenticated using (public.is_member(workspace_id));
create policy "owners manage members" on public.workspace_members for update to authenticated
  using (public.has_role(workspace_id, array['owner']::public.member_role[]));
create policy "users update own presence" on public.workspace_members for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "owners manage invites" on public.workspace_invites for all to authenticated
  using (public.has_role(workspace_id, array['owner']::public.member_role[]))
  with check (public.has_role(workspace_id, array['owner']::public.member_role[]));

create policy "members read connections" on public.connections for select to authenticated using (public.is_member(workspace_id));
create policy "owners manage connections" on public.connections for all to authenticated
  using (public.has_role(workspace_id, array['owner', 'manager']::public.member_role[]))
  with check (public.has_role(workspace_id, array['owner', 'manager']::public.member_role[]));

create policy "members read sources" on public.source_accounts for select to authenticated using (public.is_member(workspace_id));
create policy "cost roles manage sources" on public.source_accounts for all to authenticated
  using (public.has_role(workspace_id, array['owner', 'manager', 'analyst']::public.member_role[]))
  with check (public.has_role(workspace_id, array['owner', 'manager', 'analyst']::public.member_role[]));

create policy "members read cost events" on public.cost_events for select to authenticated using (public.is_member(workspace_id));
create policy "cost roles manage cost events" on public.cost_events for all to authenticated
  using (public.has_role(workspace_id, array['owner', 'manager', 'analyst']::public.member_role[]))
  with check (public.has_role(workspace_id, array['owner', 'manager', 'analyst']::public.member_role[]));

-- Lead-handling tables: everyone reads, analysts are read-only.
do $$
declare t text;
begin
  foreach t in array array['contacts', 'opportunities', 'source_touches', 'messages', 'calls', 'tasks', 'consent_events'] loop
    execute format('create policy "members read %1$s" on public.%1$I for select to authenticated using (public.is_member(workspace_id))', t);
    execute format('create policy "sales insert %1$s" on public.%1$I for insert to authenticated with check (public.has_role(workspace_id, array[''owner'',''manager'',''rep'']::public.member_role[]))', t);
    execute format('create policy "sales update %1$s" on public.%1$I for update to authenticated using (public.has_role(workspace_id, array[''owner'',''manager'',''rep'']::public.member_role[])) with check (public.has_role(workspace_id, array[''owner'',''manager'',''rep'']::public.member_role[]))', t);
  end loop;
end $$;

-- Raw payloads: not visible to analysts.
create policy "sales read raw events" on public.raw_events for select to authenticated
  using (public.has_role(workspace_id, array['owner', 'manager', 'rep']::public.member_role[]));
create policy "managers review raw events" on public.raw_events for update to authenticated
  using (public.has_role(workspace_id, array['owner', 'manager']::public.member_role[]));

create policy "members read templates" on public.message_templates for select to authenticated using (public.is_member(workspace_id));
create policy "managers manage templates" on public.message_templates for all to authenticated
  using (public.has_role(workspace_id, array['owner', 'manager']::public.member_role[]))
  with check (public.has_role(workspace_id, array['owner', 'manager']::public.member_role[]));

create policy "members read call policy" on public.call_policies for select to authenticated using (public.is_member(workspace_id));
create policy "owners manage call policy" on public.call_policies for update to authenticated
  using (public.has_role(workspace_id, array['owner']::public.member_role[]));

create policy "members read audit" on public.audit_events for select to authenticated using (public.is_member(workspace_id));
create policy "members write own audit" on public.audit_events for insert to authenticated
  with check (public.is_member(workspace_id) and actor_user_id = auth.uid());
