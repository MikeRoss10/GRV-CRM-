-- LeadLens business logic: funnel timestamps, audit, suppression, ingestion, economics.

create or replace function public.status_rank(s public.opportunity_status)
returns int language sql immutable as $$
  select case s
    when 'new' then 0 when 'assigned' then 1 when 'attempting_contact' then 2 when 'contacted' then 3
    when 'qualified' then 4 when 'appointment' then 5 when 'proposal' then 6 when 'won' then 7
    else -1 end;
$$;

-- Fill funnel timestamps when a lead progresses. Explicit values are kept.
create or replace function public.opportunities_before_write()
returns trigger language plpgsql as $$
declare r int := public.status_rank(new.status);
begin
  new.updated_at := now();
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    if r >= 3 then new.contacted_at := coalesce(new.contacted_at, now()); end if;
    if r >= 3 then new.first_response_at := coalesce(new.first_response_at, new.contacted_at, now()); end if;
    if r >= 4 then new.qualified_at := coalesce(new.qualified_at, now()); end if;
    if r >= 5 then new.appointment_at := coalesce(new.appointment_at, now()); end if;
    if r = 7 then new.won_at := coalesce(new.won_at, now()); end if;
  end if;
  if tg_op = 'UPDATE' and new.owner_user_id is not null and old.owner_user_id is null and new.status = 'new' then
    new.status := 'assigned';
  end if;
  return new;
end $$;

create trigger opportunities_before_write before insert or update on public.opportunities
  for each row execute function public.opportunities_before_write();

-- Every state change lands on the timeline; do-not-contact suppresses the contact.
create or replace function public.opportunities_after_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('leadlens.seeding', true), '') = 'on' then return new; end if;
  if new.status is distinct from old.status then
    insert into audit_events (workspace_id, actor_user_id, entity_type, entity_id, action, details)
    values (new.workspace_id, auth.uid(), 'opportunity', new.id, 'status_changed',
            jsonb_build_object('from', old.status, 'to', new.status, 'lost_reason', new.lost_reason));
  end if;
  if new.owner_user_id is distinct from old.owner_user_id then
    insert into audit_events (workspace_id, actor_user_id, entity_type, entity_id, action, details)
    values (new.workspace_id, auth.uid(), 'opportunity', new.id, 'owner_changed',
            jsonb_build_object('from', old.owner_user_id, 'to', new.owner_user_id));
  end if;
  if new.revenue_minor is distinct from old.revenue_minor then
    insert into audit_events (workspace_id, actor_user_id, entity_type, entity_id, action, details)
    values (new.workspace_id, auth.uid(), 'opportunity', new.id, 'revenue_changed',
            jsonb_build_object('from', old.revenue_minor, 'to', new.revenue_minor));
  end if;
  if new.duplicate_status is distinct from old.duplicate_status then
    insert into audit_events (workspace_id, actor_user_id, entity_type, entity_id, action, details)
    values (new.workspace_id, auth.uid(), 'opportunity', new.id, 'duplicate_status_changed',
            jsonb_build_object('from', old.duplicate_status, 'to', new.duplicate_status, 'of', new.duplicate_of_id));
  end if;
  if new.status = 'do_not_contact' and old.status is distinct from 'do_not_contact' then
    update contacts set do_not_contact = true, do_not_contact_reason = coalesce(do_not_contact_reason, 'user_opt_out'), updated_at = now()
    where id = new.contact_id;
  end if;
  return new;
end $$;

create trigger opportunities_after_update after update on public.opportunities
  for each row execute function public.opportunities_after_update();

-- Outbound messages and connected calls count as the first response.
create or replace function public.register_response()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_at timestamptz;
begin
  if coalesce(current_setting('leadlens.seeding', true), '') = 'on' then return new; end if;
  if tg_table_name = 'messages' then
    if new.direction <> 'outbound' or new.channel = 'internal_note' then return new; end if;
    v_at := coalesce(new.sent_at, now());
    update opportunities set first_response_at = coalesce(first_response_at, v_at),
      status = case when status in ('new', 'assigned') then 'attempting_contact' else status end
    where id = new.opportunity_id;
  else
    v_at := coalesce(new.started_at, now());
    if new.direction = 'outbound' then
      update opportunities set first_response_at = coalesce(first_response_at, v_at) where id = new.opportunity_id;
    end if;
    if new.status in ('answered', 'completed') and new.outcome is distinct from 'invalid' then
      update opportunities set status = 'contacted', contacted_at = coalesce(contacted_at, v_at)
      where id = new.opportunity_id and status in ('new', 'assigned', 'attempting_contact');
    elsif new.status in ('no_answer', 'busy', 'failed') then
      update opportunities set status = 'attempting_contact'
      where id = new.opportunity_id and status in ('new', 'assigned');
    end if;
    if new.outcome = 'opt_out' then
      update opportunities set status = 'do_not_contact' where id = new.opportunity_id;
    end if;
  end if;
  return new;
end $$;

create trigger messages_register_response after insert on public.messages
  for each row execute function public.register_response();
create trigger calls_register_response after insert on public.calls
  for each row execute function public.register_response();

-- ---------------------------------------------------------------------------
-- Workspace lifecycle
-- ---------------------------------------------------------------------------

create or replace function public.create_workspace(
  p_name text, p_vertical text default null, p_timezone text default 'Asia/Kolkata',
  p_currency text default 'INR', p_sla_minutes int default 15, p_member_name text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_ws uuid; v_uid uuid := auth.uid(); v_email text;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  select email into v_email from auth.users where id = v_uid;

  insert into workspaces (name, vertical, timezone, default_currency, default_sla_minutes, staff_hourly_cost_minor)
  values (p_name, p_vertical, p_timezone, p_currency, p_sla_minutes, 25000)
  returning id into v_ws;

  insert into workspace_secrets (workspace_id) values (v_ws);
  insert into workspace_members (workspace_id, user_id, name, email, role)
  values (v_ws, v_uid, coalesce(nullif(p_member_name, ''), split_part(v_email, '@', 1)), v_email, 'owner');

  insert into source_accounts (workspace_id, source_type, display_name, billing_model, zero_cost) values
    (v_ws, 'justdial', 'Justdial', 'subscription', false),
    (v_ws, 'sulekha', 'Sulekha', 'per_lead', false),
    (v_ws, '91acres', '91acres', 'package', false),
    (v_ws, 'meta_ads', 'Meta Ads', 'cpc', false),
    (v_ws, 'google_ads', 'Google Ads', 'cpc', false),
    (v_ws, 'website', 'Website', 'manual', true),
    (v_ws, 'referral', 'Referral', 'manual', true);

  insert into call_policies (workspace_id, script_body, transfer_user_id) values (v_ws,
    'Confirm the enquiry. Ask: budget, preferred location, timeline, and best callback time. Offer transfer to a human at any point. Stop immediately if the person asks not to be contacted.',
    v_uid);

  insert into message_templates (workspace_id, name, channel, language, body, approved, created_by) values
    (v_ws, 'First response', 'sms', 'en', 'Hi {name}, thanks for your enquiry about {service} with {business}. We will call you shortly. Reply STOP to opt out.', true, v_uid),
    (v_ws, 'Missed call follow-up', 'whatsapp', 'en', 'Hi {name}, we tried calling about your {service} enquiry. When is a good time to talk? – {business}', true, v_uid),
    (v_ws, 'पहला जवाब', 'sms', 'hi', 'नमस्ते {name}, {service} के बारे में पूछताछ के लिए धन्यवाद। हम जल्द ही कॉल करेंगे। – {business}', true, v_uid);

  insert into connections (workspace_id, provider, provider_account_ref, status)
  values (v_ws, 'webhook', 'Email / SMS forwarding endpoint', 'pending');

  return v_ws;
end $$;

create or replace function public.accept_invites()
returns int language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_email text; v_count int := 0; r record;
begin
  select lower(email) into v_email from auth.users where id = v_uid;
  for r in select * from workspace_invites where lower(email) = v_email and accepted_at is null loop
    insert into workspace_members (workspace_id, user_id, name, email, role)
    values (r.workspace_id, v_uid, coalesce(r.name, split_part(v_email, '@', 1)), v_email, r.role)
    on conflict (workspace_id, user_id) do nothing;
    update workspace_invites set accepted_at = now() where id = r.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

create or replace function public.rotate_ingest_token(p_workspace uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v text;
begin
  if not has_role(p_workspace, array['owner']::member_role[]) then raise exception 'Only owners can rotate the ingest token'; end if;
  update workspace_secrets set ingest_token = encode(extensions.gen_random_bytes(24), 'hex'), rotated_at = now()
  where workspace_id = p_workspace returning ingest_token into v;
  insert into audit_events (workspace_id, entity_type, entity_id, action) values (p_workspace, 'workspace', p_workspace, 'ingest_token_rotated');
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- Ingestion: one normalized opportunity per enquiry, with dedupe and evidence.
-- p fields: source_type, event_type, idempotency_key, raw, full_name, phone_e164, phone_original,
-- email, service, location, requirement, budget_minor, cost_minor, provider_lead_id, received_at,
-- confidence, shared_evidence, parser_version, language, touch_type, campaign_name
-- ---------------------------------------------------------------------------

create or replace function public._ingest_core(p_ws uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_source uuid; v_raw uuid; v_contact uuid; v_opp uuid; v_prior record; v_existing uuid;
  v_received timestamptz := coalesce((p->>'received_at')::timestamptz, now());
  v_phone text := nullif(p->>'phone_e164', '');
  v_email text := lower(nullif(p->>'email', ''));
  v_conf numeric := coalesce((p->>'confidence')::numeric, 1);
  v_source_type text := coalesce(nullif(p->>'source_type', ''), 'other');
  v_key text := coalesce(nullif(p->>'idempotency_key', ''), encode(extensions.digest(coalesce(p->>'raw', '') || v_source_type || coalesce(v_phone, ''), 'sha256'), 'hex'));
  v_dup_status text := 'none'; v_dup_conf numeric; v_dup_of uuid; v_quality text;
begin
  -- Idempotency: the same provider event never creates a second lead.
  select opportunity_id into v_existing from raw_events where workspace_id = p_ws and idempotency_key = v_key;
  if found then return jsonb_build_object('opportunity_id', v_existing, 'result', 'already_ingested'); end if;

  select id into v_source from source_accounts
  where workspace_id = p_ws and source_type = v_source_type and status <> 'archived' order by created_at limit 1;
  if v_source is null then
    insert into source_accounts (workspace_id, source_type, display_name)
    values (p_ws, v_source_type, initcap(replace(v_source_type, '_', ' '))) returning id into v_source;
  end if;

  insert into raw_events (workspace_id, event_type, payload, parsed, parse_status, parser_version, idempotency_key, provider_occurred_at)
  values (p_ws, coalesce(nullif(p->>'event_type', ''), 'manual'), coalesce(p->>'raw', ''), p - 'raw',
          case when v_phone is null or v_conf < 0.8 then 'needs_review' else 'parsed' end,
          p->>'parser_version', v_key, v_received)
  returning id into v_raw;

  -- Same source re-sending the same lead ID: confirmed duplicate, attach evidence only.
  if nullif(p->>'provider_lead_id', '') is not null then
    select t.opportunity_id into v_existing from source_touches t
    where t.source_account_id = v_source and t.provider_lead_id = p->>'provider_lead_id' limit 1;
    if found then
      update raw_events set opportunity_id = v_existing, parse_status = 'ignored' where id = v_raw;
      return jsonb_build_object('opportunity_id', v_existing, 'result', 'same_source_lead_id');
    end if;
  end if;

  if v_phone is not null then
    select id into v_contact from contacts where workspace_id = p_ws and phone_e164 = v_phone order by created_at limit 1;
  end if;
  if v_contact is null and v_email is not null then
    select id into v_contact from contacts where workspace_id = p_ws and email = v_email order by created_at limit 1;
  end if;

  if v_contact is null then
    insert into contacts (workspace_id, full_name, phone_e164, phone_original, email, locality, language)
    values (p_ws, nullif(p->>'full_name', ''), v_phone, nullif(p->>'phone_original', ''), v_email,
            nullif(p->>'location', ''), nullif(p->>'language', ''))
    returning id into v_contact;
  else
    update contacts set full_name = coalesce(full_name, nullif(p->>'full_name', '')),
      email = coalesce(email, v_email), phone_e164 = coalesce(phone_e164, v_phone),
      locality = coalesce(locality, nullif(p->>'location', '')), updated_at = now()
    where id = v_contact;
    -- Probable duplicate: same person enquired within 30 days. Never auto-merged.
    select o.id, (select c.phone_e164 = v_phone from contacts c where c.id = o.contact_id) as phone_match
      into v_prior
    from opportunities o
    where o.contact_id = v_contact and o.received_at > v_received - interval '30 days' and o.received_at <= v_received
      and o.duplicate_status <> 'merged'
    order by o.received_at desc limit 1;
    if v_prior.id is not null then
      v_dup_status := 'probable'; v_dup_of := v_prior.id;
      v_dup_conf := case when v_prior.phone_match then 0.9 else 0.7 end;
    end if;
  end if;

  v_quality := case
    when v_phone is null or v_conf < 0.8 then 'needs_review'
    when nullif(p->>'service', '') is null then 'incomplete'
    else 'complete' end;

  insert into opportunities (workspace_id, contact_id, title, service, requirement_text, location, budget_minor,
    received_at, duplicate_status, duplicate_confidence, duplicate_of_id, data_quality_status, parser_confidence)
  values (p_ws, v_contact,
    coalesce(nullif(concat_ws(' · ', nullif(p->>'service', ''), nullif(p->>'location', '')), ''), 'New enquiry'),
    nullif(p->>'service', ''), nullif(p->>'requirement', ''), nullif(p->>'location', ''),
    (p->>'budget_minor')::bigint, v_received, v_dup_status, v_dup_conf, v_dup_of, v_quality, v_conf)
  returning id into v_opp;

  insert into source_touches (workspace_id, opportunity_id, source_account_id, touch_type, provider_lead_id,
    campaign_name, observed_at, shared_lead_evidence, evidence_ref)
  values (p_ws, v_opp, v_source, coalesce(nullif(p->>'touch_type', ''), 'lead_notification'),
    nullif(p->>'provider_lead_id', ''), nullif(p->>'campaign_name', ''), v_received,
    coalesce(nullif(p->>'shared_evidence', ''), 'none'), v_raw::text);

  if (p->>'cost_minor')::bigint is not null then
    insert into cost_events (workspace_id, source_account_id, opportunity_id, cost_type, amount_minor, occurred_at,
      allocation_method, provider_ref, notes, created_by)
    values (p_ws, v_source, v_opp, 'per_lead', (p->>'cost_minor')::bigint, v_received, 'direct',
      nullif(p->>'provider_lead_id', ''), 'Lead price stated in source message', null);
  end if;

  -- A customer's own enquiry is the communication basis for replying about that enquiry.
  insert into consent_events (workspace_id, opportunity_id, channel, basis_type, purpose, captured_at, expires_at, source_evidence_ref)
  select p_ws, v_opp, ch, 'customer_inquiry',
    'Respond to enquiry' || coalesce(' about ' || nullif(p->>'service', ''), ''), v_received, v_received + interval '30 days', v_raw::text
  from unnest(array['voice', 'sms', 'whatsapp', 'email']) ch;

  update raw_events set opportunity_id = v_opp where id = v_raw;
  update connections set last_sync_at = now(), status = 'healthy'
  where workspace_id = p_ws and provider = 'webhook' and coalesce(current_setting('leadlens.seeding', true), '') <> 'on';

  return jsonb_build_object('opportunity_id', v_opp, 'result', 'created', 'duplicate_status', v_dup_status);
end $$;

revoke execute on function public._ingest_core(uuid, jsonb) from public, anon, authenticated;

-- Webhook entry point: authenticated by the workspace's ingest token.
create or replace function public.ingest_lead(p_token text, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ws uuid;
begin
  select workspace_id into v_ws from workspace_secrets where ingest_token = p_token;
  if v_ws is null then raise exception 'Invalid ingest token' using errcode = '28000'; end if;
  return _ingest_core(v_ws, p);
end $$;

revoke execute on function public.ingest_lead(text, jsonb) from public;
grant execute on function public.ingest_lead(text, jsonb) to anon, authenticated;

-- In-app entry point (manual add, CSV import, parser tester "save").
create or replace function public.create_lead(p_workspace uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not has_role(p_workspace, array['owner', 'manager', 'rep']::member_role[]) then
    raise exception 'Not allowed to create leads in this workspace';
  end if;
  return _ingest_core(p_workspace, p);
end $$;

-- ---------------------------------------------------------------------------
-- Duplicate merge: keeps both records, marks the secondary as merged.
-- ---------------------------------------------------------------------------

create or replace function public.merge_opportunities(p_primary uuid, p_secondary uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_ws uuid;
begin
  select workspace_id into v_ws from opportunities where id = p_primary;
  if not has_role(v_ws, array['owner', 'manager']::member_role[]) then raise exception 'Only owners and managers can merge'; end if;
  if not exists (select 1 from opportunities where id = p_secondary and workspace_id = v_ws) then raise exception 'Lead not found'; end if;
  -- Copy source touches so attribution sees both sources; originals stay on the merged record.
  insert into source_touches (workspace_id, opportunity_id, source_account_id, touch_type, provider_lead_id, campaign_name, medium, observed_at, attribution_weight, shared_lead_evidence, evidence_ref)
  select workspace_id, p_primary, source_account_id, touch_type, provider_lead_id, campaign_name, medium, observed_at, attribution_weight, shared_lead_evidence, evidence_ref
  from source_touches where opportunity_id = p_secondary;
  update opportunities set duplicate_status = 'merged', duplicate_of_id = p_primary, status = 'duplicate' where id = p_secondary;
  insert into audit_events (workspace_id, entity_type, entity_id, action, details)
  values (v_ws, 'opportunity', p_primary, 'merged', jsonb_build_object('merged_id', p_secondary));
end $$;

create or replace function public.unmerge_opportunity(p_secondary uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_ws uuid; v_primary uuid;
begin
  select workspace_id, duplicate_of_id into v_ws, v_primary from opportunities where id = p_secondary and duplicate_status = 'merged';
  if v_ws is null then raise exception 'Lead is not merged'; end if;
  if not has_role(v_ws, array['owner', 'manager']::member_role[]) then raise exception 'Only owners and managers can unmerge'; end if;
  delete from source_touches t where t.opportunity_id = v_primary
    and exists (select 1 from source_touches s where s.opportunity_id = p_secondary and s.evidence_ref is not distinct from t.evidence_ref and s.source_account_id = t.source_account_id);
  update opportunities set duplicate_status = 'probable', status = 'new' where id = p_secondary;
  insert into audit_events (workspace_id, entity_type, entity_id, action, details)
  values (v_ws, 'opportunity', v_primary, 'unmerged', jsonb_build_object('unmerged_id', p_secondary));
end $$;

-- ---------------------------------------------------------------------------
-- Source economics. Pooled costs are allocated equal-daily over their period;
-- per-lead costs are direct. No cost data means spend is unknown, not zero.
-- ---------------------------------------------------------------------------

create or replace function public.source_economics(
  p_workspace uuid, p_from timestamptz, p_to timestamptz,
  p_attribution text default 'first', p_include_response boolean default false
) returns table (
  source_account_id uuid, display_name text, source_type text, zero_cost boolean,
  spend_minor bigint, spend_known boolean, spend_has_allocated boolean, cost_event_count int,
  response_cost_minor bigint,
  leads int, contacted int, qualified int, appointments int, wins int,
  revenue_minor bigint, gross_margin_minor bigint,
  duplicates_probable int, duplicates_confirmed int, shared_stated int,
  responded int, sla_met int, median_response_minutes numeric, needs_review int
) language sql stable security invoker set search_path = public as $$
  with ws as (
    select default_sla_minutes, coalesce(staff_hourly_cost_minor, 0) as hourly from workspaces where id = p_workspace
  ),
  attributed as (
    select o.*, t.source_account_id as src, t.shared_lead_evidence
    from opportunities o
    cross join lateral (
      select st.source_account_id, st.shared_lead_evidence from source_touches st
      where st.opportunity_id = o.id
      order by case when p_attribution = 'last' then extract(epoch from st.observed_at) * -1 else extract(epoch from st.observed_at) end
      limit 1
    ) t
    where o.workspace_id = p_workspace and o.received_at >= p_from and o.received_at < p_to
      and o.duplicate_status <> 'merged'
  ),
  spend as (
    select ce.source_account_id as src,
      sum(case
        when ce.period_start is not null and ce.period_end is not null then
          ce.amount_minor::numeric
            * greatest(0, (least(ce.period_end, (p_to - interval '1 microsecond')::date) - greatest(ce.period_start, p_from::date) + 1))
            / (ce.period_end - ce.period_start + 1)
        when ce.occurred_at >= p_from and ce.occurred_at < p_to then ce.amount_minor
        else 0 end)::bigint as amount,
      bool_or(ce.period_start is not null and ce.period_end is not null
        and (ce.period_start < p_from::date or ce.period_end > (p_to - interval '1 microsecond')::date)) as partial,
      count(*) filter (where
        (ce.period_start is not null and ce.period_end is not null and ce.period_start <= (p_to - interval '1 microsecond')::date and ce.period_end >= p_from::date)
        or ((ce.period_start is null or ce.period_end is null) and ce.occurred_at >= p_from and ce.occurred_at < p_to)) as n
    from cost_events ce
    where ce.workspace_id = p_workspace and ce.cost_type not in ('staff_time', 'message', 'call')
    group by ce.source_account_id
  ),
  response as (
    select a.src,
      coalesce(sum(c.cost_minor), 0)
      + coalesce(sum(c.duration_seconds) filter (where c.call_type = 'human'), 0) * (select hourly from ws) / 3600
      + coalesce((select sum(m.cost_minor) from messages m join attributed a2 on a2.id = m.opportunity_id where a2.src = a.src), 0)
      as amount
    from attributed a left join calls c on c.opportunity_id = a.id
    group by a.src
  ),
  funnel as (
    select a.src,
      count(*)::int as leads,
      count(*) filter (where a.contacted_at is not null)::int as contacted,
      count(*) filter (where a.qualified_at is not null)::int as qualified,
      count(*) filter (where a.appointment_at is not null)::int as appointments,
      count(*) filter (where a.won_at is not null)::int as wins,
      coalesce(sum(a.revenue_minor) filter (where a.won_at is not null), 0)::bigint as revenue,
      coalesce(sum(a.gross_margin_minor) filter (where a.won_at is not null), 0)::bigint as margin,
      count(*) filter (where a.duplicate_status = 'probable')::int as dup_probable,
      count(*) filter (where a.duplicate_status = 'confirmed')::int as dup_confirmed,
      count(*) filter (where a.shared_lead_evidence in ('source_stated', 'confirmed'))::int as shared_stated,
      count(*) filter (where a.first_response_at is not null)::int as responded,
      count(*) filter (where a.first_response_at is not null
        and extract(epoch from a.first_response_at - a.received_at) / 60 <= (select default_sla_minutes from ws))::int as sla_met,
      (percentile_cont(0.5) within group (order by extract(epoch from a.first_response_at - a.received_at) / 60)
        filter (where a.first_response_at is not null))::numeric as median_resp,
      count(*) filter (where a.data_quality_status = 'needs_review')::int as needs_review
    from attributed a group by a.src
  )
  select sa.id, sa.display_name, sa.source_type, sa.zero_cost,
    case when sa.zero_cost then 0 else s.amount end,
    sa.zero_cost or coalesce(s.n, 0) > 0,
    coalesce(s.partial, false),
    coalesce(s.n, 0)::int,
    case when p_include_response then coalesce(r.amount, 0)::bigint else 0 end,
    coalesce(f.leads, 0), coalesce(f.contacted, 0), coalesce(f.qualified, 0), coalesce(f.appointments, 0), coalesce(f.wins, 0),
    coalesce(f.revenue, 0), coalesce(f.margin, 0),
    coalesce(f.dup_probable, 0), coalesce(f.dup_confirmed, 0), coalesce(f.shared_stated, 0),
    coalesce(f.responded, 0), coalesce(f.sla_met, 0), round(f.median_resp, 1), coalesce(f.needs_review, 0)
  from source_accounts sa
  left join spend s on s.src = sa.id
  left join funnel f on f.src = sa.id
  left join response r on r.src = sa.id
  where sa.workspace_id = p_workspace and sa.status <> 'archived'
    and (coalesce(f.leads, 0) > 0 or coalesce(s.n, 0) > 0 or sa.status = 'active')
  order by coalesce(f.leads, 0) desc, sa.display_name;
$$;
