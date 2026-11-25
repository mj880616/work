begin;
-- S70-27 BRIEF-손수정(명진 11/25 11:14 "브리핑 ai가 만든걸 수기 수정가능하게").
-- 브리핑 룸에서 AI가 만든 요약(소제목·줄)을 사람이 고쳐 저장한다. AI 원문(brief 칸)은 그대로 두고, 고친 글은 새 칸 edited에 따로 둔다.
-- 화면은 edited가 있으면 그것을, 없으면 brief를 보인다. [원래 AI 글로 되돌리기] = edited를 비운다. 다시 만들기(brief-start)는 새 행을 만들어
-- 옛 행(고친 글 포함)을 지우지 않는다(화면이 묻고, 취소가 기본).
--
-- 무엇:
--  1) app_document_briefs에 칸 둘: edited(jsonb, 고친 요약 한 장 — 비어 있으면 AI 글 그대로), edited_at(고친 시각). 크기·모양 검사 하나.
--     표 권한·정책·RLS 그대로(authenticated는 표 읽기 권한으로 새 칸도 읽기만, service_role은 새 칸을 넣거나 고치지 못함 — 칸 권한 목록에 없음).
--  2) public.app_document_brief_edit(브리핑 id, 고친 요약 또는 null) — SECURITY DEFINER, search_path 빈 값, authenticated만 실행.
--     로그인 사용자만, 다 된(done) 브리핑만, 행의 작업공간 주인(private.app_is_workspace_owner)만 고친다. 화면이 보낸 작업공간 값은 받지 않는다.
--     고친 요약은 객체·60000바이트 이하·v=3·gist와 sections가 배열일 때만 받는다. null이면 고친 글을 지운다(AI 글로 되돌림).
--     돌려주는 값은 고친 시각(되돌리면 null)뿐 — 브리핑 내용을 돌려주지 않는다. 남의 작업공간 행·없는 행은 0건 → 오류.
-- 안 하는 것: 기존 칸·정책·표 권한·RLS·다른 함수 변경, Edge 변경, 기존 자료 변경, 읽생기 객체.
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"(확장 규칙)으로만 한다(이 브랜치는 적용 직전 정지).
-- 짝: docs/20261125143000_document_brief_edit.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261125143000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261113220000' and name = 'document_briefs') <> 1
     or to_regclass('public.app_document_briefs') is null
     or exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_document_briefs')
         and attname in ('edited', 'edited_at') and not attisdropped)
     or to_regprocedure('public.app_document_brief_edit(uuid,jsonb)') is not null
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef)
     or has_table_privilege('authenticated', 'public.app_document_briefs', 'update') then
    raise exception 'DOCUMENT_BRIEF_EDIT_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_document_briefs
  add column edited jsonb,
  add column edited_at timestamptz;
alter table public.app_document_briefs
  add constraint app_document_briefs_edited_check check (
    edited is null or (jsonb_typeof(edited) = 'object' and octet_length(edited::text) <= 60000));

create function public.app_document_brief_edit(p_brief_id uuid, p_edited jsonb)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_at timestamptz;
  v_changed integer;
begin
  if (select auth.uid()) is null or p_brief_id is null then
    raise exception using errcode = '42501', message = 'DOCUMENT_BRIEF_EDIT_NOT_ALLOWED';
  end if;
  if p_edited is not null and (
       pg_catalog.jsonb_typeof(p_edited) is distinct from 'object'
       or pg_catalog.octet_length(p_edited::text) > 60000
       or (p_edited ->> 'v') is distinct from '3'
       or pg_catalog.jsonb_typeof(p_edited -> 'gist') is distinct from 'array'
       or pg_catalog.jsonb_typeof(p_edited -> 'sections') is distinct from 'array') then
    raise exception using errcode = '22023', message = 'DOCUMENT_BRIEF_EDIT_SHAPE';
  end if;
  v_at := case when p_edited is null then null else pg_catalog.now() end;
  update public.app_document_briefs b
     set edited = p_edited, edited_at = v_at
   where b.id = p_brief_id
     and b.status = 'done'
     and b.brief is not null
     and private.app_is_workspace_owner(b.workspace_id);
  get diagnostics v_changed = row_count;
  if v_changed <> 1 then
    raise exception using errcode = '42501', message = 'DOCUMENT_BRIEF_EDIT_NOT_FOUND';
  end if;
  return v_at;
end
$$;

revoke all on function public.app_document_brief_edit(uuid, jsonb) from public, anon, service_role;
grant execute on function public.app_document_brief_edit(uuid, jsonb) to authenticated;

-- 마지막 확인: 칸 둘, 함수 DEFINER·빈 search_path·authenticated만, 표 권한·정책은 그대로. 어긋나면 전체 취소.
do $$
declare t regclass := 'public.app_document_briefs'::regclass;
begin
  if (select count(*) from pg_attribute where attrelid = t and attname in ('edited', 'edited_at') and not attisdropped) <> 2
     or (select count(*) from pg_proc where oid = to_regprocedure('public.app_document_brief_edit(uuid,jsonb)')
        and prosecdef and proconfig = array['search_path=""'] and prorettype = 'timestamptz'::regtype) <> 1
     or has_function_privilege('anon', 'public.app_document_brief_edit(uuid,jsonb)', 'execute')
     or has_function_privilege('service_role', 'public.app_document_brief_edit(uuid,jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.app_document_brief_edit(uuid,jsonb)', 'execute')
     or has_table_privilege('authenticated', t, 'insert,update,delete')
     or has_any_column_privilege('authenticated', t, 'insert,update')
     or has_column_privilege('service_role', t, 'edited', 'update')
     or has_column_privilege('service_role', t, 'edited', 'insert')
     or has_table_privilege('anon', t, 'select,insert,update,delete')
     or not (select relrowsecurity from pg_class where oid = t)
     or (select count(*) from pg_policy where polrelid = t) <> 1 then
    raise exception 'DOCUMENT_BRIEF_EDIT_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261125143000', 'document_brief_edit', array['S70-27 BRIEF hand edit: app_document_briefs add columns edited (jsonb, checked object <= 60000 bytes) and edited_at; new public.app_document_brief_edit(uuid, jsonb) (SECURITY DEFINER, search_path empty, authenticated only) sets or clears the edited copy of one done brief in the caller''s own workspace (owner check) and returns only the edit time; AI original brief column unchanged; no policy, RLS or table grant change; no anon, PUBLIC or service_role execute']);
commit;
