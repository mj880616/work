begin;
-- S50-26 OUTSIDE-노동묶음·정돈 '옛 글 다시 정돈'(요청함 11/02 00:19 '이미 들어간 글도 다시 정돈', 00:17 OUTSIDE-제목·게시날짜 합침).
-- 사회운동 Now 글 표(app_outside_posts)에서 정돈 함수(_shared/outside-tidy.ts tidyTitle, #1729)가 생기기 전에 들어간 글의 제목만
-- 같은 규칙으로 다시 맞춘다. 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다. 이 브랜치는 적용 직전 정지.
--
-- 규칙(tidyTitle과 같은 꼴, 최대 4번 되풀이 — 시험 tests/auth-handoff/outside-title-retidy.test.mjs가 같은 판정인지 본다):
--   빈칸 한 칸으로 → 맨 앞 괄호 꼬리표([성명]·【보도자료】·(2026.10.31)·[단체명 성명] 등, 괄호 안이 종류 낱말·단체명·날짜일 때만, 뒤에 2자 이상 남을 때만)
--   → 맨 뒤 같은 괄호 꼬리표 → 맨 앞 '단체명 (…그룹) 성명:' → 맨 앞 '성명:' → 맨 뒤 ' - 단체명' → 맨 뒤 날짜.
--   [단독]·[주간홍보] 같은 다른 머리말은 그대로. 꼬리표뿐인 제목도 그대로(빈 제목 금지).
--   긴 제목 나누기·자르기(100자)는 SQL에서 하지 않는다: 목록 첫 쪽에 남은 글은 수집기(outside-feed)가 글 쪽 제목으로 다시 맞춘다(이 PR).
-- 무엇: 새 비공개 표 app_outside_title_fixes에 고친 글의 id·작업공간·옛 제목·새 제목을 남긴 뒤 그 글의 title만 새 제목으로 바꾼다.
--   종류(kind)·한국어 제목·주소·날짜·요약·본문 문장 표·다른 표·행 수·권한·정책·함수·트리거는 바꾸지 않는다. 글을 지우거나 다시 읽지 않는다.
--   고칠 글이 3000건을 넘으면 아무것도 바꾸지 않고 멈춘다.
-- 권한: 새 표는 RLS 켜고 정책 없음, PUBLIC·anon·authenticated·service_role 권한 모두 회수(화면·API 누구도 읽지 못함, SQL로만).
-- 출력: 제목은 어디에도 내보내지 않는다(사전·사후 확인은 건수·예/아니오·해시만).
-- 되돌리기: 짝 rollback(SQL Editor 전용) — 이 표의 옛 제목으로 되돌리고(그 사이 제목이 또 바뀐 글이 있으면 멈춤) 표와 기록 1행을 지운다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_outside_posts in share row exclusive mode;

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261105200000')
     or to_regclass('public.app_outside_title_fixes') is not null
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261031230000' and name = 'outside_statements') <> 1
     or (select count(*) from pg_attribute where attrelid = 'public.app_outside_posts'::regclass and not attisdropped
         and ((attname in ('title', 'source_key') and atttypid = 'text'::regtype)
           or (attname in ('id', 'workspace_id') and atttypid = 'uuid'::regtype))) <> 4
     or exists (select 1 from pg_class where oid = 'public.app_outside_posts'::regclass and not relrowsecurity) then
    raise exception 'OUTSIDE_TITLE_RETIDY_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create table public.app_outside_title_fixes (
  post_id uuid primary key,
  workspace_id uuid not null,
  old_title text not null,
  new_title text not null,
  fixed_at timestamptz not null default now()
);

alter table public.app_outside_title_fixes enable row level security;
revoke all on table public.app_outside_title_fixes from public, anon, authenticated, service_role;

-- 새 제목 계산(쓰기는 이 비공개 표에만). 정돈 4번 되풀이(tidyTitle은 바뀌지 않으면 일찍 멈추지만, 바뀌지 않는 제목은 몇 번 더 돌려도 같다).
-- 단체 이름은 _shared/outside-catalog.ts OUTSIDE_CATALOG name과 같다(시험이 대조). 카탈로그 밖 열쇠는 이름 없이 종류·날짜 꼬리표만.
insert into public.app_outside_title_fixes (post_id, workspace_id, old_title, new_title)
with recursive n(source_key, name) as (
  values ('kctu', '민주노총'), ('kptu', '공공운수노조'), ('kmwu', '금속노조'), ('kfsu', '서비스연맹'), ('hakbi', '학비노조'),
         ('laborparty', '노동당'), ('kgreens', '녹색당'), ('jinboparty', '진보당'), ('justice', '정의당'),
         ('pssp', '사회진보연대'), ('ws', '노동자연대'), ('platformc', '플랫폼C'), ('leftall', '전국결집'),
         ('socialism', '사회주의를향한전진'), ('socialist', '사회주의자'),
         ('jacobin', 'Jacobin'), ('labornotes', 'Labor Notes'), ('redpepper', 'Red Pepper'), ('socialistworker', 'Socialist Worker')
),
base as (
  select p.id, p.workspace_id, p.title, regexp_replace(coalesce(n.name, ''), '\s', '', 'g') as nflat
  from public.app_outside_posts p left join n on n.source_key = p.source_key
  where p.title <> '제목 없음 · 원문 링크'
),
s(id, step, t, nflat, nl) as (
  select b.id, 0, btrim(regexp_replace(b.title, '\s+', ' ', 'g')), b.nflat, regexp_replace(b.nflat, '(.)', '\1\\s?', 'g') from base b
  union all
  select s.id, s.step + 1, e.t7, s.nflat, s.nl
  from s
  -- 맨 앞 괄호 꼬리표(괄호 안이 종류 낱말·단체명·날짜이고 뒤에 2자 이상 남을 때만)
  cross join lateral (select regexp_match(s.t, '^\s*[[<(【〈「《（]\s*([^]>)】〉」》）]{1,30})\s*[]>)】〉」》）]\s*') as m, regexp_replace(s.t, '^\s*[[<(【〈「《（]\s*([^]>)】〉」》）]{1,30})\s*[]>)】〉」》）]\s*', '') as r) a
  cross join lateral (select case when a.m is not null and char_length(a.r) > 1 and (regexp_replace(a.m[1], '\s', '', 'g') ~ '(성명|논평|보도자료|기자회견|입장|브리핑|발언|논설|칼럼|규탄|공동성명|결의문|호소문|선언)' or (s.nflat <> '' and position(s.nflat in regexp_replace(a.m[1], '\s', '', 'g')) > 0) or btrim(a.m[1]) ~ '^(20\d{2}\s*[-./년]\s*)?\d{1,2}\s*[-./월]\s*\d{1,2}\s*일?\s*\.?(\s*\([월화수목금토일]\))?$') then a.r else s.t end as t1) a2
  -- 맨 뒤 괄호 꼬리표(같은 조건)
  cross join lateral (select regexp_match(a2.t1, '\s*[[<(【〈「《（]\s*([^[<(【〈「《（]{1,30})\s*[]>)】〉」》）]\s*$') as m, regexp_replace(a2.t1, '\s*[[<(【〈「《（]\s*([^[<(【〈「《（]{1,30})\s*[]>)】〉」》）]\s*$', '') as r) c
  cross join lateral (select case when c.m is not null and char_length(c.r) > 1 and (regexp_replace(c.m[1], '\s', '', 'g') ~ '(성명|논평|보도자료|기자회견|입장|브리핑|발언|논설|칼럼|규탄|공동성명|결의문|호소문|선언)' or (s.nflat <> '' and position(s.nflat in regexp_replace(c.m[1], '\s', '', 'g')) > 0) or btrim(c.m[1]) ~ '^(20\d{2}\s*[-./년]\s*)?\d{1,2}\s*[-./월]\s*\d{1,2}\s*일?\s*\.?(\s*\([월화수목금토일]\))?$') then c.r else a2.t1 end as t2) c2
  -- 맨 앞 '단체명 (…그룹) 성명:'·'성명:', 맨 뒤 ' - 단체명'·날짜
  cross join lateral (select case when s.nflat <> '' then regexp_replace(c2.t2, '^\s*' || s.nl || '(\s?[가-힣]{1,6}그룹)?\s?(성명|논평|보도자료|기자회견|입장|브리핑|발언|논설|칼럼|규탄|공동성명|결의문|호소문|선언)?\s*[-:：–—|]\s*(?=\S)', '') else c2.t2 end as t3) d
  cross join lateral (select regexp_replace(d.t3, '^\s*(성명|논평|보도자료|기자회견|입장|브리핑|발언|논설|칼럼|규탄|공동성명|결의문|호소문|선언)\s*(:|：)\s*(?=\S)', '') as t4) d2
  cross join lateral (select case when s.nflat <> '' then regexp_replace(d2.t4, '\s*[-–—|:｜]\s*' || s.nl || '\s*$', '') else d2.t4 end as t5) d3
  cross join lateral (select btrim(regexp_replace(d3.t5, '\s*[-,·–—|]?\s*20\d{2}\s*[-./년]\s*\d{1,2}\s*[-./월]\s*\d{1,2}\s*일?\.?\s*$', '')) as t7) e
  where s.step < 4
)
select b.id, b.workspace_id, b.title, f.t
from base b
join s on s.id = b.id and s.step = 4
cross join lateral (select case when s.t = '' then b.title else s.t end as t) f
where f.t <> b.title and char_length(f.t) between 1 and 500 and f.t !~ '[[:cntrl:]]';

do $$
begin
  if (select count(*) from public.app_outside_title_fixes) > 3000 then
    raise exception 'OUTSIDE_TITLE_RETIDY_TOO_MANY; stop';
  end if;
end
$$;

update public.app_outside_posts p
  set title = f.new_title
  from public.app_outside_title_fixes f
  where f.post_id = p.id
    and p.title = f.old_title;

-- 사후 확인: 남긴 행마다 제목이 새 제목, 새 표는 RLS 켜짐·정책 없음·API 역할 권한 없음. 다르면 전체 취소.
do $$
begin
  if (select count(*) from public.app_outside_title_fixes f join public.app_outside_posts p on p.id = f.post_id and p.title = f.new_title)
        <> (select count(*) from public.app_outside_title_fixes)
     or not exists (select 1 from pg_class where oid = 'public.app_outside_title_fixes'::regclass and relrowsecurity)
     or exists (select 1 from pg_policy where polrelid = 'public.app_outside_title_fixes'::regclass)
     or has_table_privilege('anon', 'public.app_outside_title_fixes', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('authenticated', 'public.app_outside_title_fixes', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('service_role', 'public.app_outside_title_fixes', 'select,insert,update,delete,truncate,references,trigger')
     or exists (select 1 from pg_class where oid = 'public.app_outside_title_fixes'::regclass and relacl::text ~ '(^|[{,])=')
     or not exists (select 1 from pg_class where oid = 'public.app_outside_posts'::regclass and relrowsecurity) then
    raise exception 'OUTSIDE_TITLE_RETIDY_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261105200000', 'outside_title_retidy', array['OUTSIDE title retidy: private table app_outside_title_fixes (RLS, no policy, all API privileges revoked) keeps id/old title/new title; app_outside_posts.title re-tidied with the outside-tidy.ts tidyTitle rules (kind/name/date tags; no split or cut; max 3000 rows); no other column, row, privilege, policy or function change']);
commit;
