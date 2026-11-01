-- SELECT only. Counts and hashes; no summary, title or id. Run before dry-run/apply (also the dry-run before/after comparison).
-- 적용 전 기대: prerequisite recorded 예 / new migration absent 예 / fix table absent 예 / RLS enabled 예 / anon or public table privilege 아니오.
-- 'summaries to clear'는 요약을 비울 글 수(0~150만 진행, 넘으면 멈춤). 'en summaries to clear'는 그중 외국 글 수, 'with key sentences'는 그중 핵심 문장이 있는 글 수(기록만).
-- 'posts with summary'는 요약이 있는 글 수(기록만, 적용 뒤 줄어드는 것이 정상이라 사후 확인에는 없음).
-- 나머지 행 수·해시는 사후 확인과 같은 값이어야 한다(요약·핵심 문장 밖의 칸, 문장 표, 권한·정책·트리거·제약 변경 없음, 행 추가·삭제 없음).
-- expect: prerequisite recorded = 예
-- expect: new migration absent = 예
-- expect: fix table absent = 예
-- expect: RLS enabled = 예
-- expect: anon or public table privilege = 아니오
-- expect: summaries to clear = 0~150
-- expect: en summaries to clear = 기록
-- expect: summaries to clear with key sentences = 기록
-- expect: posts with summary = 기록
-- expect: posts rows = 기록
-- expect: sentences rows = 기록
-- expect: other columns hash = 기록
-- expect: constraints hash = 기록
-- expect: policies hash = 기록
-- expect: owner RLS grants hash = 기록
-- expect: column grants hash = 기록
-- expect: triggers hash = 기록
with k as (select p.lang, p.key_sentences from public.app_outside_posts p
  where p.summary_ko is not null
    and (regexp_replace(p.summary_ko, '\s+', ' ', 'g') ~ '요약할\s*수\s*(가\s*)?없|요약(이|은)?\s*(불가|어려)|(본문|원문|기사\s*본문|글\s*본문|기사|글의?\s*내용|본문\s*내용)(이|은|을|가)?\s*(제공되지\s*않|없(어|음|으므로|는|습)|비어\s*있|확인(할|되)\s*수\s*없|확인되지\s*않|포함되(어\s*있)?지\s*않)|제목만(으로는|\s*있|\s*제공)|(요약할|정리할)\s*(내용|재료|정보)(이|가)?\s*(없|부족)'
      or regexp_replace(p.summary_ko, '\s+', ' ', 'g') ~* '\y(cannot|can''t|unable to)\s+(be\s+)?summari[sz]|\yno\s+(article\s+)?(body|content|text)\s+(was\s+|is\s+)?(provided|available)'))
select 'prerequisite recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261031230000' and name='outside_statements')=1 then '예' else '아니오' end as value
union all select 'new migration absent',case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261101210000') then '예' else '아니오' end
union all select 'fix table absent',case when to_regclass('public.app_outside_summary_fixes') is null then '예' else '아니오' end
union all select 'RLS enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.app_outside_posts') and relrowsecurity) then '예' else '아니오' end
union all select 'anon or public table privilege',case when has_table_privilege('anon','public.app_outside_posts','select,insert,update,delete')
  or exists(select 1 from pg_class where oid=to_regclass('public.app_outside_posts') and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'summaries to clear',(select count(*) from k)::text
union all select 'en summaries to clear',(select count(*) from k where k.lang='en')::text
union all select 'summaries to clear with key sentences',(select count(*) from k where k.key_sentences<>'[]'::jsonb)::text
union all select 'posts with summary',(select count(*) from public.app_outside_posts where summary_ko is not null)::text
union all select 'posts rows',(select count(*) from public.app_outside_posts)::text
union all select 'sentences rows',(select count(*) from public.app_outside_sentences)::text
union all select 'other columns hash',md5(coalesce(string_agg(id::text||':'||workspace_id::text||':'||source_key||':'||kind||':'||lang||':'||title||':'||coalesce(title_ko,'')||':'||coalesce(author,'')||':'||url||':'||coalesce(published_at::text,'')||':'||fetched_at::text||':'||has_body::text,',' order by id),'')) from public.app_outside_posts
union all select 'constraints hash',md5(coalesce(string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname),'')) from pg_constraint where conrelid=to_regclass('public.app_outside_posts')
union all select 'owner RLS grants hash',md5(coalesce(string_agg(relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),''),''))
  from pg_class where oid=to_regclass('public.app_outside_posts')
union all select 'column grants hash',md5(coalesce(string_agg(attname||':'||coalesce(attacl::text,''),',' order by attname),'')) from pg_attribute where attrelid=to_regclass('public.app_outside_posts') and attnum>0 and not attisdropped
union all select 'policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_outside_posts')
union all select 'triggers hash',md5(coalesce(string_agg(tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgname),'')) from pg_trigger where tgrelid=to_regclass('public.app_outside_posts') and not tgisinternal;
