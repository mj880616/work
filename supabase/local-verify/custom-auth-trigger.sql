-- LOCAL verification supplement only. A public/private pg_dump does not include
-- the operating project's custom trigger attached to auth.users. The read-only
-- catalog inventory found this AFTER INSERT row trigger with no arguments or
-- condition. Never apply this file to the operating database.
do $local$
begin
  if current_setting('app.local_verification',true) is distinct from 'on' then
    raise exception 'Custom Auth trigger supplement is local-only';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_trigger t
    where t.tgrelid='auth.users'::regclass and t.tgname='app_auth_user_profile'
  ) then
    execute 'create trigger app_auth_user_profile after insert on auth.users '
      || 'for each row execute function private.app_new_profile()';
  end if;
end
$local$;
