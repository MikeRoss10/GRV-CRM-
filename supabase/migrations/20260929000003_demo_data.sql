-- Demo data: ~90 days of realistic leads, costs, calls and outcomes, tagged 'demo' so it can be cleared.

create or replace function public.seed_demo_data(p_workspace uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  firsts text[] := array['Anjali','Rahul','Kavita','Priya','Amit','Sneha','Vikram','Neha','Arjun','Pooja','Rohan','Meera','Sanjay','Divya','Karan','Isha','Nikhil','Ritu','Aditya','Swati','Manoj','Farah','Imran','Lakshmi','Suresh','Deepa','Harsh','Tanvi','Yusuf','Gayatri'];
  lasts text[] := array['Sharma','Mehta','Rao','Iyer','Patel','Desai','Kulkarni','Nair','Singh','Joshi','Khan','Reddy','Shah','Gupta','Pillai','Bhat','Menon','Chopra','Verma','Shetty'];
  services text[] := array['2 BHK apartment','3 BHK apartment','1 BHK rental','Office space','Villa','Residential plot','Retail shop'];
  places text[] := array['Andheri','Powai','Bandra','Thane','Navi Mumbai','Borivali','Goregaon','Chembur','Malad'];
  -- source, relative volume, p(contacted), p(qualified|contacted), p(appt|qualified), p(won|appt), median response minutes
  srcs text[] := array['justdial','sulekha','91acres','meta_ads','google_ads','website','referral'];
  vol int[] := array[42, 34, 14, 24, 18, 9, 7];
  p_contact numeric[] := array[0.62, 0.70, 0.64, 0.80, 0.78, 0.85, 0.92];
  p_qual numeric[] := array[0.22, 0.28, 0.38, 0.55, 0.50, 0.60, 0.70];
  p_appt numeric[] := array[0.45, 0.50, 0.50, 0.65, 0.60, 0.65, 0.70];
  p_won numeric[] := array[0.30, 0.35, 0.40, 0.60, 0.55, 0.60, 0.70];
  resp int[] := array[55, 38, 60, 12, 15, 20, 25];
  i int; s int; n int := 0; total int := 0; v_res jsonb; v_opp uuid; v_at timestamptz;
  v_phone text; v_name text; v_svc text; v_loc text; v_resp_at timestamptz;
  v_contacted boolean; v_qual boolean; v_appt boolean; v_won boolean; v_status opportunity_status; v_age interval;
  v_src_id uuid; m int; v_cost bigint;
begin
  if not has_role(p_workspace, array['owner']::member_role[]) then raise exception 'Only owners can load demo data'; end if;
  perform set_config('leadlens.seeding', 'on', true);

  foreach s in array array[1,2,3,4,5,6,7] loop total := total + vol[s]; end loop;

  for i in 1..(total * 1) loop
    -- Pick a source proportional to volume.
    declare r int := floor(random() * total)::int; acc int := 0;
    begin
      s := 1;
      loop acc := acc + vol[s]; exit when r < acc or s = 7; s := s + 1; end loop;
    end;

    v_at := now() - (random() * interval '90 days');
    if i > total - 6 then v_at := now() - (random() * interval '50 minutes'); end if; -- a few fresh leads for the SLA queue
    v_name := firsts[1 + floor(random() * array_length(firsts, 1))::int] || ' ' || lasts[1 + floor(random() * array_length(lasts, 1))::int];
    v_svc := services[1 + floor(random() * array_length(services, 1))::int];
    v_loc := places[1 + floor(random() * array_length(places, 1))::int];
    v_phone := '+919' || lpad(floor(random() * 1000000000)::bigint::text, 9, '0');
    -- ~7% of enquiries come from someone who already enquired (cross-source duplicates).
    if random() < 0.07 and n > 10 then
      select c.phone_e164, c.full_name into v_phone, v_name from contacts c
      where c.workspace_id = p_workspace and c.phone_e164 is not null order by random() limit 1;
    end if;

    v_cost := case when srcs[s] = 'sulekha' then (300 + floor(random() * 8) * 100)::bigint * 100 else null end;

    v_res := _ingest_core(p_workspace, jsonb_build_object(
      'source_type', srcs[s],
      'event_type', case when srcs[s] in ('justdial', 'sulekha') then 'sms' when srcs[s] in ('website', 'referral') then 'manual' else 'email' end,
      'idempotency_key', 'demo-' || gen_random_uuid(),
      'raw', format(E'[Demo] New enquiry via %s\nName: %s\nMobile: %s\nRequirement: %s\nLocation: %s', initcap(replace(srcs[s], '_', ' ')), v_name, v_phone, v_svc, v_loc)
        || case when v_cost is not null then format(E'\nLead price: Rs %s', v_cost / 100) else '' end,
      'full_name', v_name, 'phone_e164', case when random() < 0.04 then null else v_phone end, 'phone_original', v_phone,
      'service', v_svc, 'location', v_loc,
      'requirement', 'Looking for ' || v_svc || ' in ' || v_loc,
      'budget_minor', (floor(40 + random() * 160) * 100000 * 100)::bigint,
      'cost_minor', v_cost,
      'provider_lead_id', case when srcs[s] in ('justdial', 'sulekha', '91acres') then upper(left(srcs[s], 2)) || floor(random() * 9000000 + 1000000)::text else null end,
      'received_at', v_at,
      'confidence', case when random() < 0.05 then 0.62 else 0.9 + random() * 0.09 end,
      'shared_evidence', case when srcs[s] = 'sulekha' and random() < 0.35 then 'source_stated' else 'none' end,
      'parser_version', srcs[s] || '-v1',
      'touch_type', case when srcs[s] in ('meta_ads', 'google_ads', 'website') then 'form_submit' when srcs[s] = 'referral' then 'referral' else 'lead_notification' end,
      'campaign_name', case srcs[s] when 'meta_ads' then 'Lead form – ' || v_loc when 'google_ads' then 'Search – ' || v_svc else null end
    ));
    v_opp := (v_res->>'opportunity_id')::uuid;
    if v_res->>'result' <> 'created' then continue; end if;
    n := n + 1;

    v_age := now() - v_at;
    v_resp_at := v_at + make_interval(mins => greatest(1, (resp[s] * (0.2 + random() * 1.8))::int));
    v_contacted := random() < p_contact[s] and v_age > interval '1 day';
    v_qual := v_contacted and random() < p_qual[s];
    v_appt := v_qual and random() < p_appt[s];
    v_won := v_appt and random() < p_won[s] and v_age > interval '5 days';

    v_status := case
      when v_won then 'won'
      when v_appt then (case when random() < 0.5 then 'proposal' else 'appointment' end)::opportunity_status
      when v_qual then (case when random() < 0.3 then 'nurture' when random() < 0.3 then 'lost' else 'qualified' end)::opportunity_status
      when v_contacted then (case when random() < 0.55 then 'lost' when random() < 0.1 then 'invalid' else 'contacted' end)::opportunity_status
      when v_age < interval '1 day' then 'new'
      else (case when random() < 0.6 then 'lost' else 'attempting_contact' end)::opportunity_status end;

    update opportunities set
      status = v_status,
      tags = array['demo'],
      owner_user_id = case when v_status = 'new' and random() < 0.6 then null else v_uid end,
      first_response_at = case when v_status = 'new' then null else least(v_resp_at, now()) end,
      contacted_at = case when v_contacted then v_resp_at + interval '5 minutes' end,
      qualified_at = case when v_qual then v_resp_at + interval '1 day' end,
      appointment_at = case when v_appt then v_resp_at + interval '3 days' end,
      won_at = case when v_won then v_resp_at + interval '5 days' end,
      revenue_minor = case when v_won then (floor(40 + random() * 110) * 1000 * 100)::bigint end,
      gross_margin_minor = case when v_won then (floor(24 + random() * 60) * 1000 * 100)::bigint end,
      lost_reason = case when v_status = 'lost' then (array['price','timing','no_response','competitor','not_serviceable'])[1 + floor(random() * 5)::int] end
    where id = v_opp;

    if v_status <> 'new' then
      insert into calls (workspace_id, opportunity_id, provider, call_type, direction, status, started_at, ended_at, duration_seconds, outcome, summary, user_id)
      values (p_workspace, v_opp, 'manual', 'human', 'outbound',
        case when v_contacted then 'completed' else 'no_answer' end,
        v_resp_at, v_resp_at + make_interval(secs => case when v_contacted then 60 + floor(random() * 360) else 0 end),
        case when v_contacted then (60 + floor(random() * 360))::int else 0 end,
        case when v_qual then 'qualified' when v_contacted then 'connected' else null end,
        case when v_qual then 'Budget and location confirmed; wants a site visit.' when v_contacted then 'Spoke briefly; details shared.' else null end,
        v_uid);
      if random() < 0.5 then
        insert into messages (workspace_id, opportunity_id, channel, direction, body_redacted, sent_at, delivered_at, cost_minor, author_user_id)
        values (p_workspace, v_opp, 'sms', 'outbound', 'Hi ' || split_part(v_name, ' ', 1) || ', thanks for your enquiry. We will call you shortly.',
          v_resp_at - interval '1 minute', v_resp_at, 25, v_uid);
      end if;
    end if;

    if v_status in ('contacted', 'qualified', 'appointment', 'proposal', 'attempting_contact', 'nurture') then
      insert into tasks (workspace_id, opportunity_id, assignee_user_id, task_type, title, due_at, priority, created_by)
      values (p_workspace, v_opp, v_uid,
        case v_status when 'appointment' then 'appointment' when 'attempting_contact' then 'call' else 'follow_up' end,
        case v_status when 'appointment' then 'Site visit' when 'attempting_contact' then 'Try calling again' when 'proposal' then 'Chase proposal' else 'Follow up' end,
        now() + make_interval(hours => (floor(random() * 120) - 48)::int),
        case when random() < 0.2 then 'high' else 'normal' end, v_uid);
    end if;
  end loop;

  -- Pooled monthly spend. 91acres is intentionally left without costs to show the "unknown cost" state.
  for m in 0..3 loop
    select id into v_src_id from source_accounts where workspace_id = p_workspace and source_type = 'justdial' order by created_at limit 1;
    insert into cost_events (workspace_id, source_account_id, cost_type, amount_minor, occurred_at, period_start, period_end, allocation_method, notes, created_by)
    values (p_workspace, v_src_id, 'subscription', 1400000, date_trunc('month', now()) - make_interval(months => m),
      (date_trunc('month', now()) - make_interval(months => m))::date, (date_trunc('month', now()) - make_interval(months => m) + interval '1 month - 1 day')::date,
      'equal_daily', 'Demo data: monthly listing package', v_uid);
    select id into v_src_id from source_accounts where workspace_id = p_workspace and source_type = 'meta_ads' order by created_at limit 1;
    insert into cost_events (workspace_id, source_account_id, cost_type, amount_minor, occurred_at, period_start, period_end, allocation_method, notes, created_by)
    values (p_workspace, v_src_id, 'click', 1250000, date_trunc('month', now()) - make_interval(months => m),
      (date_trunc('month', now()) - make_interval(months => m))::date, (date_trunc('month', now()) - make_interval(months => m) + interval '1 month - 1 day')::date,
      'equal_daily', 'Demo data: Meta Ads monthly spend', v_uid);
    select id into v_src_id from source_accounts where workspace_id = p_workspace and source_type = 'google_ads' order by created_at limit 1;
    insert into cost_events (workspace_id, source_account_id, cost_type, amount_minor, occurred_at, period_start, period_end, allocation_method, notes, created_by)
    values (p_workspace, v_src_id, 'click', 1000000, date_trunc('month', now()) - make_interval(months => m),
      (date_trunc('month', now()) - make_interval(months => m))::date, (date_trunc('month', now()) - make_interval(months => m) + interval '1 month - 1 day')::date,
      'equal_daily', 'Demo data: Google Ads monthly spend', v_uid);
  end loop;
  update cost_events set notes = 'Demo data: lead price from source message'
  where workspace_id = p_workspace and cost_type = 'per_lead'
    and opportunity_id in (select id from opportunities where workspace_id = p_workspace and 'demo' = any(tags));

  insert into audit_events (workspace_id, entity_type, entity_id, action, details)
  values (p_workspace, 'workspace', p_workspace, 'demo_data_loaded', jsonb_build_object('leads', n));
  return n;
end $$;

create or replace function public.clear_demo_data(p_workspace uuid)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not has_role(p_workspace, array['owner']::member_role[]) then raise exception 'Only owners can clear demo data'; end if;
  perform set_config('leadlens.seeding', 'on', true);
  delete from cost_events where workspace_id = p_workspace and notes like 'Demo data:%';
  delete from raw_events where workspace_id = p_workspace and idempotency_key like 'demo-%';
  with d as (delete from opportunities where workspace_id = p_workspace and 'demo' = any(tags) returning 1) select count(*) into n from d;
  delete from contacts c where c.workspace_id = p_workspace and not exists (select 1 from opportunities o where o.contact_id = c.id);
  insert into audit_events (workspace_id, entity_type, entity_id, action, details)
  values (p_workspace, 'workspace', p_workspace, 'demo_data_cleared', jsonb_build_object('leads', n));
  return n;
end $$;

revoke execute on function public.seed_demo_data(uuid) from public, anon;
revoke execute on function public.clear_demo_data(uuid) from public, anon;
revoke execute on function public.create_workspace(text, text, text, text, int, text) from public, anon;
revoke execute on function public.accept_invites() from public, anon;
revoke execute on function public.rotate_ingest_token(uuid) from public, anon;
revoke execute on function public.create_lead(uuid, jsonb) from public, anon;
revoke execute on function public.merge_opportunities(uuid, uuid) from public, anon;
revoke execute on function public.unmerge_opportunity(uuid) from public, anon;
grant execute on function public.seed_demo_data(uuid), public.clear_demo_data(uuid),
  public.create_workspace(text, text, text, text, int, text), public.accept_invites(), public.rotate_ingest_token(uuid),
  public.create_lead(uuid, jsonb), public.merge_opportunities(uuid, uuid), public.unmerge_opportunity(uuid),
  public.source_economics(uuid, timestamptz, timestamptz, text, boolean) to authenticated;
