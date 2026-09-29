-- Sources created on the fly for walk-ins, referrals and website forms have no direct spend.
do $$
declare d text;
begin
  d := pg_get_functiondef('public._ingest_core(uuid, jsonb)'::regprocedure);
  if position('v_source_type in (''walk_in'', ''referral'', ''website'')' in d) > 0 then return; end if;
  d := replace(d,
    'insert into source_accounts (workspace_id, source_type, display_name)
    values (p_ws, v_source_type, initcap(replace(v_source_type, ''_'', '' ''))) returning id into v_source;',
    'insert into source_accounts (workspace_id, source_type, display_name, zero_cost)
    values (p_ws, v_source_type, initcap(replace(v_source_type, ''_'', '' '')), v_source_type in (''walk_in'', ''referral'', ''website'')) returning id into v_source;');
  if position('v_source_type in (''walk_in'', ''referral'', ''website'')' in d) = 0 then raise exception 'ingest patch did not apply'; end if;
  execute d;
end $$;

update public.source_accounts sa set zero_cost = true
where sa.source_type in ('walk_in', 'referral', 'website') and not sa.zero_cost
  and not exists (select 1 from public.cost_events ce where ce.source_account_id = sa.id);
