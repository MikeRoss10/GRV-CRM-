-- Security hardening from Supabase advisors.
alter function public.status_rank(public.opportunity_status) set search_path = public;
alter function public.opportunities_before_write() set search_path = public;

-- Trigger functions are never called over the API.
revoke execute on function public.opportunities_after_update() from public, anon, authenticated;
revoke execute on function public.register_response() from public, anon, authenticated;
revoke execute on function public.opportunities_before_write() from public, anon, authenticated;

-- Policy helpers are only needed by signed-in users.
revoke execute on function public.is_member(uuid) from public, anon;
revoke execute on function public.has_role(uuid, public.member_role[]) from public, anon;
grant execute on function public.is_member(uuid), public.has_role(uuid, public.member_role[]) to authenticated;
