-- SELECT only. Counts and hashes; no title or id. Run before dry-run/apply (also the dry-run before/after comparison).
-- 적용 전 기대: prerequisite recorded 예 / new migration absent 예 / fix table absent 예 / RLS enabled 예 / anon or public table privilege 아니오.
-- 'titles with lead kind tag'는 맨 앞 괄호 꼬리표([성명] 등)가 남은 제목 수(한 번만 본 수, 기록만). 실제로 고칠 수는 migration이 세고 3000건 넘으면 멈춘다.
-- 나머지 행 수·해시는 사후 확인과 같은 값이어야 한다(제목 밖의 칸, 문장 표, 권한·정책·트리거·제약 변경 없음, 행 추가·삭제 없음).
-- expect: prerequisite recorded = 예
-- expect: new migration absent = 예
-- expect: fix table absent = 예
-- expect: RLS enabled = 예
-- expect: anon or public table privilege = 아니오
-- expect: titles with lead kind tag = 기록
-- expect: posts rows = 기록
-- expect: sentences rows = 기록
-- expect: columns except title hash = 기록
-- expect: constraints hash = 기록
-- expect: policies hash = 기록
-- expect: owner RLS grants hash = 기록
-- expect: column grants hash = 기록
-- expect: triggers hash = 기록
with n(source_key, name) as (values ('kctu', '민주노총'), ('kptu', '공공운수노조'), ('kmwu', '금속노조'), ('kfsu', '서비스연맹'), ('hakbi', '학비노조'),
  ('laborparty', '노동당'), ('kgreens', '녹색당'), ('jinboparty', '진보당'), ('justice', '정의당'),
  ('pssp', '사회진보연대'), ('ws', '노동자연대'), ('platformc', '플랫폼C'), ('leftall', '전국결집'),
  ('socialism', '사회주의를향한전진'), ('socialist', '사회주의자'),
  ('jacobin', 'Jacobin'), ('labornotes', 'Labor Notes'), ('redpepper', 'Red Pepper'), ('socialistworker', 'Socialist Worker')),
x as (select (regexp_match(p.title, '^\s*[[<(【〈「《（]\s*([^]>)】〉」》）]{1,30})\s*[]>)】〉」》）]\s*'))[1] as tag_in, regexp_replace(p.title, '^\s*[[<(【〈「《（]\s*([^]>)】〉」》）]{1,30})\s*[]>)】〉」》）]\s*', '') as rest,
         regexp_replace(coalesce(n.name, ''), '\s', '', 'g') as nflat
  from public.app_outside_posts p left join n on n.source_key = p.source_key where p.title <> '제목 없음 · 원문 링크'),
tagged as (select 1 from x where x.tag_in is not null and char_length(x.rest) > 1
  and (regexp_replace(x.tag_in, '\s', '', 'g') ~ '(성명|논평|보도자료|기자회견|입장|브리핑|발언|논설|칼럼|규탄|공동성명|결의문|호소문|선언)'
       or (x.nflat <> '' and position(x.nflat in regexp_replace(x.tag_in, '\s', '', 'g')) > 0)
       or btrim(x.tag_in) ~ '^(20\d{2}\s*[-./년]\s*)?\d{1,2}\s*[-./월]\s*\d{1,2}\s*일?\s*\.?(\s*\([월화수목금토일]\))?$'))
select 'prerequisite recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261031230000' and name='outside_statements')=1 then '예' else '아니오' end as value
union all select 'new migration absent',case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261105200000') then '예' else '아니오' end
union all select 'fix table absent',case when to_regclass('public.app_outside_title_fixes') is null then '예' else '아니오' end
union all select 'RLS enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.app_outside_posts') and relrowsecurity) then '예' else '아니오' end
union all select 'anon or public table privilege',case when has_table_privilege('anon','public.app_outside_posts','select,insert,update,delete')
  or exists(select 1 from pg_class where oid=to_regclass('public.app_outside_posts') and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'titles with lead kind tag',(select count(*) from tagged)::text
union all select 'posts rows',(select count(*) from public.app_outside_posts)::text
union all select 'sentences rows',(select count(*) from public.app_outside_sentences)::text
union all select 'columns except title hash',md5(coalesce(string_agg(id::text||':'||workspace_id::text||':'||source_key||':'||kind||':'||lang||':'||coalesce(title_ko,'')||':'||coalesce(author,'')||':'||url||':'||coalesce(published_at::text,'')||':'||fetched_at::text||':'||coalesce(summary_ko,'')||':'||key_sentences::text||':'||has_body::text,',' order by id),'')) from public.app_outside_posts
union all select 'constraints hash',md5(coalesce(string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname),'')) from pg_constraint where conrelid=to_regclass('public.app_outside_posts')
union all select 'owner RLS grants hash',md5(coalesce(string_agg(relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),''),''))
  from pg_class where oid=to_regclass('public.app_outside_posts')
union all select 'column grants hash',md5(coalesce(string_agg(attname||':'||coalesce(attacl::text,''),',' order by attname),'')) from pg_attribute where attrelid=to_regclass('public.app_outside_posts') and attnum>0 and not attisdropped
union all select 'policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_outside_posts')
union all select 'triggers hash',md5(coalesce(string_agg(tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgname),'')) from pg_trigger where tgrelid=to_regclass('public.app_outside_posts') and not tgisinternal;
