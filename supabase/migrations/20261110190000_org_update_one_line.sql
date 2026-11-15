begin;
-- S56-18 RECORD-한줄AI요약(요청함 11/10, 11/09 명진 A안, 시안 docs/design/mockups/org-record-oneline.html PR 2186).
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지).
--
-- 무엇: 조직 기록(app_suborganization_updates)에 '한 줄' 칸 one_line(text, null 허용) 하나와 검사 1개, 트리거 1개.
--   one_line = 원문이 길 때 서버 AI(ai-assist kind record_one_line, 사용자 로그인)가 만든 '무슨 일이 있었는지' 한 줄. null이면 화면이 임시 한 줄.
--   원문(raw_text)은 하나도 바꾸지 않는다. 기존 행은 모두 null(지금 화면 그대로).
--   트리거: 원문(raw_text)이 바뀌었는데 같은 쓰기에서 one_line을 따로 정하지 않았으면 one_line을 비운다(옛 원문의 한 줄이 남지 않게).
--   기존 정책(owner)·표 권한·RLS는 바꾸지 않는다. 이 표는 authenticated에 표 단위 읽기·넣기·수정 권한이 있어(사전 확인으로 판정) 새 칸에 따로 권한을 주지 않는다.
--   트리거 함수는 security invoker·search_path='', 실행 권한을 모두 걷는다.
-- 짝: docs/20261110190000_org_update_one_line.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_suborganization_updates in access exclusive mode;

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261110190000')
     or to_regclass('public.app_suborganization_updates') is null
     or not exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_suborganization_updates')
           and attname = 'raw_text' and not attisdropped)
     or exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_suborganization_updates')
           and attname = 'one_line' and not attisdropped)
     or exists (select 1 from pg_constraint where conrelid = to_regclass('public.app_suborganization_updates')
           and conname = 'app_suborganization_updates_one_line_check')
     or to_regprocedure('private.app_suborganization_updates_one_line_reset()') is not null then
    raise exception 'ORG_UPDATE_ONE_LINE_PRECONDITION: unexpected state';
  end if;
end
$$;

alter table public.app_suborganization_updates
  add column one_line text,
  add constraint app_suborganization_updates_one_line_check check (
    one_line is null or (char_length(one_line) between 1 and 120 and one_line = btrim(one_line) and one_line !~ '[[:cntrl:]]'));

create function private.app_suborganization_updates_one_line_reset()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $reset$
begin
  if new.raw_text is distinct from old.raw_text and new.one_line is not distinct from old.one_line then
    new.one_line := null;
  end if;
  return new;
end
$reset$;
revoke all on function private.app_suborganization_updates_one_line_reset() from public, anon, authenticated, service_role;

create trigger app_suborganization_updates_one_line_reset
before update on public.app_suborganization_updates
for each row execute function private.app_suborganization_updates_one_line_reset();

do $$
begin
  if (select count(*) from pg_attribute where attrelid = to_regclass('public.app_suborganization_updates')
        and attname = 'one_line' and atttypid = 'text'::regtype and not attnotnull and not attisdropped) <> 1
     or not exists (select 1 from pg_constraint where conrelid = to_regclass('public.app_suborganization_updates')
        and conname = 'app_suborganization_updates_one_line_check')
     or not exists (select 1 from pg_trigger where tgrelid = to_regclass('public.app_suborganization_updates')
        and tgname = 'app_suborganization_updates_one_line_reset' and not tgisinternal) then
    raise exception 'ORG_UPDATE_ONE_LINE_POSTCONDITION: column, check or trigger missing';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261110190000', 'org_update_one_line', array['S56-18 RECORD-한줄AI요약: app_suborganization_updates.one_line text + check (1~120, trimmed, no control) + before update trigger clearing one_line when raw_text changes']);
commit;
