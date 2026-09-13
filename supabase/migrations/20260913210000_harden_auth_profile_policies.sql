-- Keep browser access scoped to the signed-in user while preserving the
-- auth.users trigger that creates a profile for every new account.

revoke all on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to postgres, service_role;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

revoke all on function public.consume_signal_analysis(text) from public, anon;
grant execute on function public.consume_signal_analysis(text) to authenticated, service_role;

-- analysis_usage is an implementation table for consume_signal_analysis().
-- It must not be queried or mutated directly through the browser Data API.
revoke all on table public.analysis_usage from public, anon, authenticated;

drop policy if exists users_read_own_profile on public.profiles;
drop policy if exists profiles_read_own on public.profiles;
create policy profiles_read_own
on public.profiles
for select
to authenticated
using (id = (select auth.uid()) or public.is_admin());

drop policy if exists users_insert_own_profile on public.profiles;
create policy users_insert_own_profile
on public.profiles
for insert
to authenticated
with check (id = (select auth.uid()) and role = 'user');

drop policy if exists signal_history_own_select on public.signal_history;
create policy signal_history_own_select
on public.signal_history
for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists signal_history_own_insert on public.signal_history;
create policy signal_history_own_insert
on public.signal_history
for insert
to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists signal_history_own_update on public.signal_history;
create policy signal_history_own_update
on public.signal_history
for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists signal_history_own_delete on public.signal_history;
create policy signal_history_own_delete
on public.signal_history
for delete
to authenticated
using (user_id = (select auth.uid()));

create index if not exists signal_history_user_id_idx
on public.signal_history (user_id);
