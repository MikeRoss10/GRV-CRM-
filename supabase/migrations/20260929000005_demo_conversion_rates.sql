-- Raise sample-data conversion rates so demo workspaces show enough wins to compare sources.
-- Idempotent: fresh databases already get these values from 20260929000003_demo_data.sql.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.seed_demo_data(uuid)'::regprocedure);
  if position('array[0.30, 0.35, 0.40, 0.60, 0.55, 0.60, 0.70]' in d) > 0 then return; end if;
  d := replace(d, 'array[0.40, 0.45, 0.45, 0.55, 0.50, 0.60, 0.65]', 'array[0.45, 0.50, 0.50, 0.65, 0.60, 0.65, 0.70]');
  d := replace(d, 'array[0.25, 0.28, 0.30, 0.45, 0.42, 0.50, 0.60]', 'array[0.30, 0.35, 0.40, 0.60, 0.55, 0.60, 0.70]');
  execute d;
end $$;
