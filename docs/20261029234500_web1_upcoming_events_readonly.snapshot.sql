-- SELECT only. 적용 전 main_upcoming_events 구조·권한·정책 snapshot. 결과를 캡처해 둔다(rollback 대조용). 행 값 없음. information_schema를 읽지 않는다.
-- 'restore policy' 줄 = 쓰기 정책을 되살리는 create policy 문장. migration이 기록 행 statements[2..]에 남기는 문장과 같아야 한다.
-- 'grant' 줄 = anon·authenticated·PUBLIC의 표 권한(aclexplode). rollback의 grant 목록은 이 줄에 있는 권한만 남기고 실행한다.
select 'column' as kind,a.attname::text as name,format_type(a.atttypid,a.atttypmod)||':required='||a.attnotnull::text||':default='||coalesce(pg_get_expr(d.adbin,d.adrelid),'none')||':acl='||coalesce(a.attacl::text,'none') as definition
from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
where a.attrelid=to_regclass('public.main_upcoming_events') and a.attnum>0 and not a.attisdropped
union all select 'constraint',conname::text,pg_get_constraintdef(oid) from pg_constraint where conrelid=to_regclass('public.main_upcoming_events')
union all select 'policy',polname::text,polcmd::text||':permissive='||polpermissive::text||':'||polroles::regrole[]::text||':using='||coalesce(pg_get_expr(polqual,polrelid),'-')||':check='||coalesce(pg_get_expr(polwithcheck,polrelid),'-') from pg_policy where polrelid=to_regclass('public.main_upcoming_events')
union all select 'restore policy',p.polname::text,format('create policy %I on public.main_upcoming_events as permissive for %s to %s%s%s',
    p.polname,case p.polcmd when 'a' then 'insert' when 'w' then 'update' else 'delete' end,
    (select string_agg(case when r.oid=0 then 'public' else quote_ident(r.oid::regrole::text) end,', ' order by r.oid) from unnest(p.polroles) r(oid)),
    case when p.polqual is null then '' else ' using ('||pg_get_expr(p.polqual,p.polrelid)||')' end,
    case when p.polwithcheck is null then '' else ' with check ('||pg_get_expr(p.polwithcheck,p.polrelid)||')' end)
  from pg_policy p where p.polrelid=to_regclass('public.main_upcoming_events') and p.polcmd in ('a','w','d')
union all select 'trigger',tgname::text,tgenabled::text||':'||tgfoid::regprocedure::text from pg_trigger where tgrelid=to_regclass('public.main_upcoming_events') and not tgisinternal
union all select 'index',c.relname::text,pg_get_indexdef(i.indexrelid) from pg_index i join pg_class c on c.oid=i.indexrelid where i.indrelid=to_regclass('public.main_upcoming_events')
union all select 'owner RLS acl',relname::text,relowner::regrole::text||':rls='||relrowsecurity::text||':force='||relforcerowsecurity::text||':acl='||coalesce(relacl::text,'default') from pg_class where oid=to_regclass('public.main_upcoming_events')
union all select 'grant',case when x.grantee=0 then 'PUBLIC' else x.grantee::regrole::text end||':'||x.privilege_type,x.is_grantable::text
  from pg_class c,aclexplode(c.relacl) x
 where c.oid=to_regclass('public.main_upcoming_events') and (x.grantee=0 or x.grantee in ('anon'::regrole::oid,'authenticated'::regrole::oid))
order by 1,2,3;
