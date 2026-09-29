-- Workers (role 'rep') see customers and leads only: no spend, cost entries, economics or connection status.

drop policy if exists "members read cost events" on public.cost_events;
create policy "admins and analysts read cost events" on public.cost_events for select to authenticated
  using (public.has_role(workspace_id, array['owner', 'manager', 'analyst']::public.member_role[]));

drop policy if exists "members read connections" on public.connections;
create policy "admins and analysts read connections" on public.connections for select to authenticated
  using (public.has_role(workspace_id, array['owner', 'manager', 'analyst']::public.member_role[]));

-- source_economics runs as the caller; also return no rows at all for workers.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.source_economics(uuid, timestamptz, timestamptz, text, boolean)'::regprocedure);
  if position('Workers never see economics' in d) > 0 then return; end if;
  d := replace(d,
    'where sa.workspace_id = p_workspace and sa.status <> ''archived''',
    'where sa.workspace_id = p_workspace and sa.status <> ''archived''
    -- Workers never see economics.
    and public.has_role(p_workspace, array[''owner'', ''manager'', ''analyst'']::public.member_role[])');
  if position('Workers never see economics' in d) = 0 then raise exception 'source_economics patch did not apply'; end if;
  execute d;
end $$;
