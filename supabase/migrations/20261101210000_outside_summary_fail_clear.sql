begin;
-- S47-42 OUTSIDE-요약실패정리 (OUTSIDE-읽기고침·요약·순서 남은 일, #1684 PR 본문 '이미 들어간 실패 문구 줄 정리'):
-- 사회운동 Now 글 표(app_outside_posts)에서 요약 칸(summary_ko)이 AI '재료 없음' 안내 문장('… 요약할 수 없음' 등)인 줄만 요약을 비운다(제목만 보임).
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다. 이 브랜치는 적용 직전 정지.
--
-- 고르는 규칙: _shared/ai-model.ts AI_NO_MATERIAL_PATTERNS(#1684)와 같은 꼴. 빈칸을 한 칸으로 줄인 요약에
--   한국어 꼴(대소문자 구분)이나 영어 꼴(대소문자 무시)이 하나라도 맞으면 대상. JS의 \b는 PostgreSQL에서 \y로 쓴다.
--   실제 요약 속 '내용이 없어 비판함' 같은 말은 걸리지 않는다(시험: tests/auth-handoff/outside-summary-fail-clear.test.mjs가 JS 검사 목록과 같은 판정인지 본다).
-- 무엇: 새 비공개 표 app_outside_summary_fixes에 대상 글의 id·작업공간·옛 요약·옛 핵심 문장을 남긴 뒤,
--   그 글의 summary_ko를 비우고 key_sentences를 빈 목록으로 둔다(#1684 처리 방법 그대로 — 요약이 비면 핵심 문장도 두지 않는 수집기 규칙과 같음).
--   제목·한국어 제목·종류·주소·날짜·본문 문장 표·다른 표·행 수·권한·정책·함수·트리거는 바꾸지 않는다. 다시 요약하지 않는다.
--   대상이 150건을 넘으면 아무것도 바꾸지 않고 멈춘다.
-- 권한: 새 표는 RLS 켜고 정책 없음, PUBLIC·anon·authenticated·service_role 권한 모두 회수(화면·API 누구도 읽지 못함, SQL로만).
-- 출력: 요약·제목은 어디에도 내보내지 않는다(사전 확인은 건수·예/아니오·해시만).
-- 되돌리기: 짝 rollback(SQL Editor 전용) — 이 표의 옛 요약으로 되돌리고(그 뒤 요약이 다시 채워진 글이 있으면 멈춤) 표와 기록 1행을 지운다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_outside_posts in share row exclusive mode;

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261101210000')
     or to_regclass('public.app_outside_summary_fixes') is not null
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261031230000' and name = 'outside_statements') <> 1
     or (select count(*) from pg_attribute where attrelid = 'public.app_outside_posts'::regclass and not attisdropped
         and ((attname = 'summary_ko' and atttypid = 'text'::regtype)
           or (attname = 'key_sentences' and atttypid = 'jsonb'::regtype)
           or (attname in ('id', 'workspace_id') and atttypid = 'uuid'::regtype))) <> 4
     or exists (select 1 from pg_class where oid = 'public.app_outside_posts'::regclass and not relrowsecurity) then
    raise exception 'OUTSIDE_SUMMARY_FAIL_CLEAR_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create table public.app_outside_summary_fixes (
  post_id uuid primary key,
  workspace_id uuid not null,
  old_summary_ko text not null,
  old_key_sentences jsonb not null,
  fixed_at timestamptz not null default now()
);

alter table public.app_outside_summary_fixes enable row level security;
revoke all on table public.app_outside_summary_fixes from public, anon, authenticated, service_role;

insert into public.app_outside_summary_fixes (post_id, workspace_id, old_summary_ko, old_key_sentences)
  select p.id, p.workspace_id, p.summary_ko, p.key_sentences
  from public.app_outside_posts p
  where p.summary_ko is not null
    and (regexp_replace(p.summary_ko, '\s+', ' ', 'g') ~ '요약할\s*수\s*(가\s*)?없|요약(이|은)?\s*(불가|어려)|(본문|원문|기사\s*본문|글\s*본문|기사|글의?\s*내용|본문\s*내용)(이|은|을|가)?\s*(제공되지\s*않|없(어|음|으므로|는|습)|비어\s*있|확인(할|되)\s*수\s*없|확인되지\s*않|포함되(어\s*있)?지\s*않)|제목만(으로는|\s*있|\s*제공)|(요약할|정리할)\s*(내용|재료|정보)(이|가)?\s*(없|부족)'
      or regexp_replace(p.summary_ko, '\s+', ' ', 'g') ~* '\y(cannot|can''t|unable to)\s+(be\s+)?summari[sz]|\yno\s+(article\s+)?(body|content|text)\s+(was\s+|is\s+)?(provided|available)');

do $$
begin
  if (select count(*) from public.app_outside_summary_fixes) > 150 then
    raise exception 'OUTSIDE_SUMMARY_FAIL_CLEAR_TOO_MANY; stop';
  end if;
end
$$;

update public.app_outside_posts p
  set summary_ko = null, key_sentences = '[]'::jsonb
  from public.app_outside_summary_fixes f
  where f.post_id = p.id
    and p.summary_ko = f.old_summary_ko;

-- 사후 확인: 남긴 행마다 요약이 비고 핵심 문장이 빈 목록, 같은 규칙으로 다시 세면 0, 새 표는 RLS 켜짐·정책 없음·API 역할 권한 없음. 다르면 전체 취소.
do $$
begin
  if exists (select 1 from public.app_outside_summary_fixes f join public.app_outside_posts p on p.id = f.post_id
             where p.summary_ko is not null or p.key_sentences <> '[]'::jsonb)
     or (select count(*) from public.app_outside_summary_fixes f join public.app_outside_posts p on p.id = f.post_id)
        <> (select count(*) from public.app_outside_summary_fixes)
     or exists (select 1 from public.app_outside_posts p
        where p.summary_ko is not null
          and (regexp_replace(p.summary_ko, '\s+', ' ', 'g') ~ '요약할\s*수\s*(가\s*)?없|요약(이|은)?\s*(불가|어려)|(본문|원문|기사\s*본문|글\s*본문|기사|글의?\s*내용|본문\s*내용)(이|은|을|가)?\s*(제공되지\s*않|없(어|음|으므로|는|습)|비어\s*있|확인(할|되)\s*수\s*없|확인되지\s*않|포함되(어\s*있)?지\s*않)|제목만(으로는|\s*있|\s*제공)|(요약할|정리할)\s*(내용|재료|정보)(이|가)?\s*(없|부족)'
            or regexp_replace(p.summary_ko, '\s+', ' ', 'g') ~* '\y(cannot|can''t|unable to)\s+(be\s+)?summari[sz]|\yno\s+(article\s+)?(body|content|text)\s+(was\s+|is\s+)?(provided|available)'))
     or not exists (select 1 from pg_class where oid = 'public.app_outside_summary_fixes'::regclass and relrowsecurity)
     or exists (select 1 from pg_policy where polrelid = 'public.app_outside_summary_fixes'::regclass)
     or has_table_privilege('anon', 'public.app_outside_summary_fixes', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('authenticated', 'public.app_outside_summary_fixes', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('service_role', 'public.app_outside_summary_fixes', 'select,insert,update,delete,truncate,references,trigger')
     or exists (select 1 from pg_class where oid = 'public.app_outside_summary_fixes'::regclass and relacl::text ~ '(^|[{,])=')
     or not exists (select 1 from pg_class where oid = 'public.app_outside_posts'::regclass and relrowsecurity) then
    raise exception 'OUTSIDE_SUMMARY_FAIL_CLEAR_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261101210000', 'outside_summary_fail_clear', array['OUTSIDE summary fail clear: private table app_outside_summary_fixes (RLS, no policy, all API privileges revoked) keeps id/old summary/old key sentences; app_outside_posts.summary_ko emptied (key_sentences to []) only where the summary is an AI no-material notice matching AI_NO_MATERIAL_PATTERNS (max 150 rows)']);
commit;
