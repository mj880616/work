-- SELECT only. Run before apply (approved DB workflow or SQL Editor, phone path C). Aggregates and hashes only; no row values.
-- 적용 전 기대: 아래 예/아니오 항목 모두 예. 표 행 수·최근 기록은 기록만(색인 필요 여부 판단용).
-- 승인형 DB workflow 기대값(DB-승인형확장): 아래에 없는 항목은 모두 예여야 한다. 기록 = 값만 남기고 판정하지 않음.
-- expect: recent migrations = 기록
-- expect: notes rows = 기록
-- expect: documents rows = 기록
-- expect: meetings rows = 기록
-- expect: search tables policies hash = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261022120000') then '예' else '아니오' end as value
union all select 'no search function yet',case when not exists(select 1 from pg_proc where proname='app_search_records' and pronamespace='public'::regnamespace) then '예' else '아니오' end
union all select 'owner check function (security definer)',case when exists(select 1 from pg_proc where oid=to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then '예' else '아니오' end
union all select 'notes columns',case when (select count(*) from pg_attribute where attrelid=to_regclass('public.app_notes') and not attisdropped
  and attname in('id','kind','title','raw_text','attachments','archived_at','occurred_at','journal_day'))=8 then '예' else '아니오' end
union all select 'diary kind in notes CHECK',case when exists(select 1 from pg_constraint where conrelid=to_regclass('public.app_notes') and conname='app_notes_kind_check'
  and pg_get_constraintdef(oid) like '%diary%') then '예' else '아니오' end
union all select 'record links columns',case when (select count(*) from pg_attribute where attrelid=to_regclass('public.app_record_links') and not attisdropped
  and attname in('note_id','project_id','organization_id','status'))=4 then '예' else '아니오' end
union all select 'documents columns',case when (select count(*) from pg_attribute where attrelid=to_regclass('public.app_documents') and not attisdropped
  and attname in('id','title','file_name','source','category','tags','description','document_date','created_at','project_id','organization_id'))=11 then '예' else '아니오' end
union all select 'meetings columns',case when (select count(*) from pg_attribute where attrelid=to_regclass('public.app_meetings') and not attisdropped
  and attname in('id','title','series_name','meeting_at','transcript_text','decisions','created_at','project_id'))=8 then '예' else '아니오' end
union all select 'projects columns',case when (select count(*) from pg_attribute where attrelid=to_regclass('public.app_spaces') and not attisdropped
  and attname in('id','name','status','metadata','updated_at'))=5 then '예' else '아니오' end
union all select 'progress columns',case when (select count(*) from pg_attribute where attrelid=to_regclass('public.app_project_progress_updates') and not attisdropped
  and attname in('id','project_id','summary','next_step','status_label','effective_on'))=6 then '예' else '아니오' end
union all select 'milestones columns',case when (select count(*) from pg_attribute where attrelid=to_regclass('public.app_project_milestones') and not attisdropped
  and attname in('id','project_id','title','status','start_at'))=5 then '예' else '아니오' end
union all select 'organizations columns',case when (select count(*) from pg_attribute where attrelid=to_regclass('public.app_suborganizations') and not attisdropped
  and attname in('id','name','aliases','description','updated_at'))=5 then '예' else '아니오' end
union all select 'organization updates columns',case when (select count(*) from pg_attribute where attrelid=to_regclass('public.app_suborganization_updates') and not attisdropped
  and attname in('id','organization_id','raw_text','detail_text','occurred_at'))=5 then '예' else '아니오' end
union all select 'organization timeline columns',case when (select count(*) from pg_attribute where attrelid=to_regclass('public.app_suborganization_timeline') and not attisdropped
  and attname in('id','organization_id','title','summary','event_date','event_year'))=6 then '예' else '아니오' end
union all select 'search tables all RLS enabled',case when (select count(*) from pg_class where relrowsecurity and oid in(to_regclass('public.app_notes'),to_regclass('public.app_record_links'),
  to_regclass('public.app_documents'),to_regclass('public.app_meetings'),to_regclass('public.app_spaces'),to_regclass('public.app_project_progress_updates'),
  to_regclass('public.app_project_milestones'),to_regclass('public.app_suborganizations'),to_regclass('public.app_suborganization_updates'),
  to_regclass('public.app_suborganization_timeline')))=10 then '예' else '아니오' end
union all select 'search tables policies hash',md5(coalesce(string_agg(c.relname||':'||p.polname||':'||p.polcmd::text||':'||p.polroles::text||':'||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||':'||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by c.relname,p.polname),''))
  from pg_policy p join pg_class c on c.oid=p.polrelid where c.relnamespace='public'::regnamespace and c.relname in('app_notes','app_record_links','app_documents','app_meetings','app_spaces',
  'app_project_progress_updates','app_project_milestones','app_suborganizations','app_suborganization_updates','app_suborganization_timeline')
union all select 'notes rows',(select count(*)::text from public.app_notes)
union all select 'documents rows',(select count(*)::text from public.app_documents)
union all select 'meetings rows',(select count(*)::text from public.app_meetings)
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
