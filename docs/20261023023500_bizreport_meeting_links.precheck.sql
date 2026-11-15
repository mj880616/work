-- SELECT only. Aggregates and hashes; no meeting or link text. Run before dry-run/apply (also the dry-run before/after comparison).
-- 읽기 전용 역할(표 소유자 아님)에서 돈다: information_schema 대신 pg_catalog만 읽는다(#978).
-- 적용 전 기대: 새 칸·함수·정책·제약 없음, 연결 표 → 회의 FK 하나이고 이름이 app_record_links_meeting_id_fkey(설계 7.3절, 화면 2단계가 이 이름으로 읽음),
--   출처·중복·도착지 규칙이 저장소 마지막 모양, 두 표 RLS 켜짐·anon/PUBLIC 권한 없음, 연결 표 정책은 소유자 정책 하나,
--   장소 칸은 없거나 글자 칸이고 200자 넘는 행 없음. 하나라도 다르면 적용하지 않고 멈춘다(권한·정책을 넓히지 않는다).
-- 개수·해시는 기록만 하고 사후 확인에서 같은 이름 항목이 같은 값이어야 한다(바뀌는 칸·제약·색인·정책은 해시에서 뺐다).
-- expect: source meeting column count = 0
-- expect: record links FKs to meetings = 1
-- expect: location column count = 0~1
-- expect: location over 200 rows = 0
-- expect: meetings rows = 기록
-- expect: meetings with project rows = 기록
-- expect: record links rows = 기록
-- expect: meetings other columns hash = 기록
-- expect: record links other columns hash = 기록
-- expect: meetings other constraints hash = 기록
-- expect: record links kept constraints hash = 기록
-- expect: indexes hash = 기록
-- expect: owner RLS grants hash = 기록
-- expect: record links owner policy hash = 기록
-- expect: meetings policies hash = 기록
-- expect: triggers hash = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261023023500') then '예' else '아니오' end as value
union all select 'both tables exist',case when to_regclass('public.app_meetings') is not null and to_regclass('public.app_record_links') is not null then '예' else '아니오' end
union all select 'source meeting column count',count(*)::text from pg_attribute where attrelid=to_regclass('public.app_record_links') and attname='source_meeting_id' and not attisdropped
union all select 'new function, policy, constraints absent',case when to_regprocedure('public.app_meeting_set_links(uuid,timestamptz,jsonb)') is null
  and not exists(select 1 from pg_policy where polrelid=to_regclass('public.app_record_links') and polname='record_links_source_meeting_ws')
  and not exists(select 1 from pg_constraint where conname in ('app_record_links_source_meeting_id_fkey','app_record_links_source_meeting_shape','app_meetings_location_length_check'))
  then '예' else '아니오' end
union all select 'record links FKs to meetings',count(*)::text from pg_constraint where conrelid=to_regclass('public.app_record_links') and contype='f' and confrelid=to_regclass('public.app_meetings')
union all select 'meeting FK name is app_record_links_meeting_id_fkey',case when exists(select 1 from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
  where c.conrelid=to_regclass('public.app_record_links') and c.conname='app_record_links_meeting_id_fkey' and c.contype='f'
    and c.confrelid=to_regclass('public.app_meetings') and array_length(c.conkey,1)=1 and a.attname='meeting_id') then '예' else '아니오' end
union all select 'source, unique and target rules are the repository shape',case when
  exists(select 1 from pg_constraint where conrelid=to_regclass('public.app_record_links') and conname='app_record_links_one_source'
    and regexp_replace(pg_get_constraintdef(oid),'[\s()]','','g')='CHECKnum_nonnullsgoogle_task_id,note_id=1')
  and exists(select 1 from pg_constraint where conrelid=to_regclass('public.app_record_links') and conname='app_record_links_unique'
    and regexp_replace(pg_get_constraintdef(oid),'[\s()]','','g')='UNIQUENULLSNOTDISTINCTgoogle_task_id,note_id,project_id,organization_id,meeting_id,document_id')
  and exists(select 1 from pg_constraint where conrelid=to_regclass('public.app_record_links') and conname='app_record_links_one_target'
    and regexp_replace(pg_get_constraintdef(oid),'[\s()]','','g')='CHECKnum_nonnullsproject_id,organization_id,meeting_id,document_id=1') then '예' else '아니오' end
union all select 'RLS enabled on both tables',case when (select count(*) from pg_class where oid in (to_regclass('public.app_meetings'),to_regclass('public.app_record_links')) and relrowsecurity)=2 then '예' else '아니오' end
union all select 'no anon or public table privilege',case when not has_table_privilege('anon','public.app_meetings','select,insert,update,delete')
  and not has_table_privilege('anon','public.app_record_links','select,insert,update,delete')
  and not exists(select 1 from pg_class where oid in (to_regclass('public.app_meetings'),to_regclass('public.app_record_links')) and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'record links owner policy only',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_record_links'))=1
  and exists(select 1 from pg_policy where polrelid=to_regclass('public.app_record_links') and polname='record_links_owner_all' and polpermissive and polcmd='*'
    and polroles=array['authenticated'::regrole]::oid[] and regexp_replace(pg_get_expr(polqual,polrelid),'[\s()]','','g')='private.app_is_workspace_ownerworkspace_id') then '예' else '아니오' end
union all select 'meeting workspace helper exists',case when to_regprocedure('private.app_meeting_in_workspace(uuid,uuid)') is not null then '예' else '아니오' end
union all select 'meetings updated_at and project_id types',case when (select count(*) from pg_attribute where attrelid=to_regclass('public.app_meetings') and not attisdropped
  and ((attname='updated_at' and atttypid='timestamptz'::regtype) or (attname='project_id' and atttypid='uuid'::regtype)))=2 then '예' else '아니오' end
union all select 'location column count',count(*)::text from pg_attribute where attrelid=to_regclass('public.app_meetings') and attname='location' and not attisdropped
union all select 'location absent or text',case when not exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_meetings') and attname='location' and not attisdropped
  and atttypid<>'text'::regtype) then '예' else '아니오' end
union all select 'location over 200 rows',count(*) filter(where length(to_jsonb(m)->>'location')>200)::text from public.app_meetings m
union all select 'meetings rows',count(*)::text from public.app_meetings
union all select 'meetings with project rows',count(*) filter(where project_id is not null)::text from public.app_meetings
union all select 'record links rows',count(*)::text from public.app_record_links
union all select 'meetings other columns hash',md5(coalesce(string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||coalesce(pg_get_expr(d.adbin,d.adrelid),'none'),',' order by a.attname),''))
  from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where a.attrelid=to_regclass('public.app_meetings') and a.attnum>0 and not a.attisdropped and a.attname<>'location'
union all select 'record links other columns hash',md5(coalesce(string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||coalesce(pg_get_expr(d.adbin,d.adrelid),'none'),',' order by a.attname),''))
  from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where a.attrelid=to_regclass('public.app_record_links') and a.attnum>0 and not a.attisdropped and a.attname<>'source_meeting_id'
union all select 'meetings other constraints hash',md5(coalesce(string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname),''))
  from pg_constraint where conrelid=to_regclass('public.app_meetings') and conname<>'app_meetings_location_length_check'
union all select 'record links kept constraints hash',md5(coalesce(string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname),''))
  from pg_constraint where conrelid=to_regclass('public.app_record_links')
    and conname not in ('app_record_links_one_source','app_record_links_unique','app_record_links_source_meeting_id_fkey','app_record_links_source_meeting_shape')
union all select 'indexes hash',md5(coalesce(string_agg(tablename||':'||indexname||':'||indexdef,',' order by tablename,indexname),''))
  from pg_indexes where schemaname='public' and tablename in ('app_meetings','app_record_links')
    and indexname not in ('app_record_links_unique','app_record_links_source_meeting_idx')
union all select 'owner RLS grants hash',md5(coalesce(string_agg(relname||':'||relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),',' order by relname),''))
  from pg_class where oid in (to_regclass('public.app_meetings'),to_regclass('public.app_record_links'))
union all select 'record links owner policy hash',md5(coalesce(string_agg(polname::text||polcmd::text||polroles::text||polpermissive::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_record_links') and polname<>'record_links_source_meeting_ws'
union all select 'meetings policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polroles::text||polpermissive::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_meetings')
union all select 'triggers hash',md5(coalesce(string_agg(tgrelid::regclass::text||':'||tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgrelid::regclass::text,tgname),''))
  from pg_trigger where tgrelid in (to_regclass('public.app_meetings'),to_regclass('public.app_record_links')) and not tgisinternal;
