-- SELECT only. Run after apply (all 예 expected) or after rollback ('objects and history agree' = 예, 'trash installed' = 아니오).
-- 숫자·해시 항목(행 수·외래키·트리거·제약·칸·권한·정책·행 해시)은 사전 확인의 같은 이름 항목과 같아야 한다.
-- 새로 생긴 칸·트리거·정책·제약은 해시와 목록에서 뺀다(새로 생긴 것만 다르다). 프로젝트·담당조직·사업 보고·자료실 폴더·노트 휴지통은 이번에 바꾸지 않는다.
with history as (
  select count(*) as n,count(*) filter(where name='trash_share_pages_db') as named
  from supabase_migrations.schema_migrations where version='20261027050000'
), cols as (
  select count(*) as n,
    count(*) filter(where (attname='deleted_at' and atttypid='timestamptz'::regtype and not attnotnull and not atthasdef)
      or (attname='deleted_status' and atttypid='text'::regtype and not attnotnull and not atthasdef)) as ok
  from pg_attribute where attrelid=to_regclass('public.app_share_pages') and not attisdropped and attname in ('deleted_at','deleted_status')
), chk as (
  select count(*) as n,count(*) filter(where contype='c' and convalidated and pg_get_constraintdef(oid) like '%deleted_status%' and pg_get_constraintdef(oid) like '%deleted_at%') as valid
  from pg_constraint where conrelid=to_regclass('public.app_share_pages') and conname='app_share_pages_trash_check'
), trg as (
  select count(*) as n,count(*) filter(where tgenabled='O' and tgfoid=to_regprocedure('private.app_trash_share_page_before_delete()')
    and pg_get_triggerdef(oid) like '%BEFORE DELETE ON public.app_share_pages FOR EACH ROW%') as valid
  from pg_trigger where tgrelid=to_regclass('public.app_share_pages') and tgname='app_share_pages_a_trash_before_delete'
), pol as (
  select count(*) as n,count(*) filter(where not polpermissive and polcmd='*' and polroles=array[(select oid from pg_roles where rolname='authenticated')]
    and pg_get_expr(polqual,polrelid)='(deleted_at IS NULL)' and pg_get_expr(polwithcheck,polrelid)='(deleted_at IS NULL)') as valid
  from pg_policy where polrelid=to_regclass('public.app_share_pages') and polname='app_share_pages_trash_hidden'
), first_trg as (
  select tgname from pg_trigger where tgrelid=to_regclass('public.app_share_pages') and not tgisinternal and (tgtype & 1)=1 and (tgtype & 2)=2 and (tgtype & 8)=8 order by convert_to(tgname::text,'UTF8') limit 1
), fns as (
  select count(*) as n,
    count(*) filter(where p.prosecdef and p.proconfig=array['search_path=""']
      and not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0)
      and not has_function_privilege('anon',p.oid,'execute') and not has_function_privilege('service_role',p.oid,'execute')
      and not has_function_privilege('authenticated',p.oid,'execute')) as valid
  from pg_proc p where p.oid=to_regprocedure('private.app_trash_share_page_before_delete()')
), rpc as (
  -- RPC 3개: 적용 뒤에는 공유 페이지까지 알고, 되돌린 뒤에는 앞 단계(노트까지) 모양이다. 어느 쪽이든 서명·DEFINER·search_path·권한은 같아야 한다.
  select count(*) as n,
    count(*) filter(where p.prosecdef and p.proconfig=array['search_path=""']
      and not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0)
      and not has_function_privilege('anon',p.oid,'execute') and not has_function_privilege('service_role',p.oid,'execute')
      and has_function_privilege('authenticated',p.oid,'execute')) as valid,
    count(*) filter(where p.prosrc like '%app_share_pages%' and p.prosrc like '%app_notes%' and p.prosrc like '%app_library_folders%' and p.prosrc like '%app_suborganizations%' and p.prosrc like '%app_meetings%' and p.prosrc like '%public.app_spaces%') as wide,
    count(*) filter(where p.prosrc not like '%app_share_pages%' and p.prosrc like '%app_notes%' and p.prosrc like '%app_library_folders%' and p.prosrc like '%app_suborganizations%' and p.prosrc like '%app_meetings%' and p.prosrc like '%public.app_spaces%') as narrow
  from pg_proc p where p.oid in (to_regprocedure('public.app_trash_list(text)'),to_regprocedure('public.app_trash_restore(text,uuid)'),to_regprocedure('public.app_trash_purge(text,uuid)'))
), installed as (
  select (select n from cols)=2 and (select ok from cols)=2 and (select n from chk)=1 and (select valid from chk)=1
    and (select n from trg)=1 and (select valid from trg)=1 and (select n from pol)=1 and (select valid from pol)=1 and to_regclass('public.app_share_pages_trash_idx') is not null
    and (select n from fns)=1 and (select valid from fns)=1 and (select n from rpc)=3 and (select valid from rpc)=3 and (select wide from rpc)=3 as ok
), removed as (
  select (select n from cols)=0 and (select n from chk)=0 and (select n from trg)=0 and (select n from pol)=0 and to_regclass('public.app_share_pages_trash_idx') is null
    and (select n from fns)=0 and (select n from rpc)=3 and (select valid from rpc)=3 and (select narrow from rpc)=3 as ok
)
select 'objects and history agree' as item,case when ((select n from history)=0 and (select ok from removed))
  or ((select n from history)=1 and (select named from history)=1 and (select ok from installed)) then '예' else '아니오' end as ok
union all select 'trash installed',case when (select ok from installed) then '예' else '아니오' end
union all select 'page trash trigger runs first',case when (select n from trg)=0 or (select tgname from first_trg)='app_share_pages_a_trash_before_delete' then '예' else '아니오' end
union all select 'links and media still cascade from pages',case when (select count(*) from pg_constraint where conrelid=to_regclass('public.app_share_page_links') and contype='f' and confrelid=to_regclass('public.app_share_pages') and confdeltype='c')=1
  and (select count(*) from pg_constraint where conrelid=to_regclass('public.app_share_page_media') and contype='f' and confrelid=to_regclass('public.app_share_pages') and confdeltype='c')=1 then '예' else '아니오' end
union all select 'note trash still installed',case when exists(select 1 from pg_trigger where tgrelid=to_regclass('public.app_notes') and tgname='app_notes_a_trash_before_delete' and tgenabled='O')
  and exists(select 1 from pg_policy where polrelid=to_regclass('public.app_notes') and polname='app_notes_trash_hidden') then '예' else '아니오' end
union all select 'library folder trash still installed',case when exists(select 1 from pg_trigger where tgrelid=to_regclass('public.app_library_folders') and tgname='app_library_folders_a_trash_before_delete' and tgenabled='O') then '예' else '아니오' end
union all select 'organization and report trash still installed',case when exists(select 1 from pg_trigger where tgrelid=to_regclass('public.app_suborganizations') and tgname='app_suborganizations_a_trash_before_delete' and tgenabled='O')
  and exists(select 1 from pg_trigger where tgrelid=to_regclass('public.app_meetings') and tgname='app_meetings_a_trash_before_delete' and tgenabled='O') then '예' else '아니오' end
union all select 'project trash still installed',case when exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_spaces') and attname in ('deleted_at') and not attisdropped)
  and exists(select 1 from pg_trigger where tgrelid=to_regclass('public.app_spaces') and tgname='app_spaces_a_trash_before_delete' and tgenabled='O')
  and exists(select 1 from pg_policy where polrelid=to_regclass('public.app_spaces') and polname='app_spaces_trash_hidden') then '예' else '아니오' end
union all select 'RLS still enabled and not forced on pages',case when (select count(*) from pg_class where oid=to_regclass('public.app_share_pages') and relrowsecurity and not relforcerowsecurity)=1 then '예' else '아니오' end
union all select 'no anon or public table grants on pages',case when not exists(select 1 from pg_class where oid=to_regclass('public.app_share_pages') and relacl::text ~ '(^|[{,])(anon)?=') and not exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_share_pages') and attacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'page row count',count(*)::text from public.app_share_pages
union all select 'page foreign keys in by action',coalesce((select string_agg(confdeltype::text||'='||n::text,',' order by confdeltype) from (select confdeltype,count(*) n from pg_constraint where contype='f' and confrelid=to_regclass('public.app_share_pages') group by confdeltype) f),'')
union all select 'page triggers',coalesce((select string_agg(tgname::text||':'||tgenabled::text,', ' order by tgname) from pg_trigger where tgrelid=to_regclass('public.app_share_pages') and not tgisinternal and tgname<>'app_share_pages_a_trash_before_delete'),'')
union all select 'page constraints hash',md5(coalesce((select string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname) from pg_constraint where conrelid=to_regclass('public.app_share_pages') and conname<>'app_share_pages_trash_check'),''))
union all select 'page columns hash',md5(coalesce((select string_agg(attname||':'||format_type(atttypid,atttypmod)||':'||attnotnull::text,',' order by attnum) from pg_attribute where attrelid=to_regclass('public.app_share_pages') and attnum>0 and not attisdropped and attname not in ('deleted_at','deleted_status')),''))
union all select 'page owner RLS grants hash',md5(coalesce((select relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,'') from pg_class where oid=to_regclass('public.app_share_pages')),''))
union all select 'page column grants hash',md5(coalesce((select string_agg(attname||':'||coalesce(attacl::text,''),',' order by attname) from pg_attribute where attrelid=to_regclass('public.app_share_pages') and attnum>0 and not attisdropped and attname not in ('deleted_at','deleted_status')),''))
union all select 'page policies hash',md5(coalesce((select string_agg(polname::text||polcmd::text||polpermissive::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname) from pg_policy where polrelid=to_regclass('public.app_share_pages') and polname<>'app_share_pages_trash_hidden'),''))
union all select 'page rows hash (ids only)',md5(coalesce((select string_agg(id::text,',' order by id) from public.app_share_pages),''))
union all select 'link row count',count(*)::text from public.app_share_page_links
union all select 'link policies hash',md5(coalesce((select string_agg(polname::text||polcmd::text||polpermissive::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname) from pg_policy where polrelid=to_regclass('public.app_share_page_links')),''))
union all select 'media row count',count(*)::text from public.app_share_page_media
union all select 'media policies hash',md5(coalesce((select string_agg(polname::text||polcmd::text||polpermissive::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname) from pg_policy where polrelid=to_regclass('public.app_share_page_media')),''));
