begin;
-- S63-08 BRIEF-브리핑룸삭제 PR ①(DB만, 명진 확정 11/16 10:55 "브리핑만 지우기 자료까지. 지우기 선택 가능하게").
-- 브리핑 룸 [브리핑만 삭제]: 자료 한 건의 브리핑 작업 행(app_document_briefs)을 자기 작업공간 것만 지운다. 자료(app_documents)·Drive 파일은 그대로.
-- 표 app_document_briefs(20261113220000)는 authenticated 읽기만이라 화면이 직접 지울 길이 없다. 표 권한·정책은 바꾸지 않고(기존 표 권한 추가 없음)
-- 새 함수 1개로만 지운다: public.app_document_brief_delete(uuid) — SECURITY DEFINER, search_path 빈 값,
--   로그인 사용자만, 행마다 private.app_is_workspace_owner(workspace_id) 검사(남의 작업공간 행은 0건), 화면이 보낸 작업공간 값은 받지 않는다.
--   돌려주는 값은 지운 행 수(정수)뿐 — 브리핑 내용·id를 돌려주지 않는다.
-- 만드는 중(queued·running) 브리핑도 지운다: 서버 실행(Edge document-actions 브리핑 길)은 저장할 때 행이 없으면 멈춘다(brief-run.mjs save/claim, Edge 변경 없음).
-- 권한: authenticated만 실행, anon·PUBLIC·service_role 실행 없음. 표·칸·정책·RLS·다른 함수·기존 자료 변경 없음. 읽생기 객체 없음.
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지).
-- 짝: docs/20261116110000_document_brief_delete.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261116110000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261113220000' and name = 'document_briefs') <> 1
     or to_regclass('public.app_document_briefs') is null
     or to_regprocedure('public.app_document_brief_delete(uuid)') is not null
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef)
     or has_table_privilege('authenticated', 'public.app_document_briefs', 'delete') then
    raise exception 'DOCUMENT_BRIEF_DELETE_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create function public.app_document_brief_delete(p_document_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  removed integer;
begin
  if (select auth.uid()) is null or p_document_id is null then
    raise exception using errcode = '42501', message = 'DOCUMENT_BRIEF_DELETE_NOT_ALLOWED';
  end if;
  delete from public.app_document_briefs b
   where b.document_id = p_document_id
     and private.app_is_workspace_owner(b.workspace_id);
  get diagnostics removed = row_count;
  return removed;
end
$$;

revoke all on function public.app_document_brief_delete(uuid) from public, anon, service_role;
grant execute on function public.app_document_brief_delete(uuid) to authenticated;

-- 마지막 확인: 함수 DEFINER·빈 search_path·authenticated만, 표 권한은 그대로(authenticated 지우기 없음). 어긋나면 전체 취소.
do $$
begin
  if (select count(*) from pg_proc where oid = to_regprocedure('public.app_document_brief_delete(uuid)')
        and prosecdef and proconfig = array['search_path=""'] and prorettype = 'integer'::regtype) <> 1
     or has_function_privilege('anon', 'public.app_document_brief_delete(uuid)', 'execute')
     or has_function_privilege('service_role', 'public.app_document_brief_delete(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.app_document_brief_delete(uuid)', 'execute')
     or has_table_privilege('authenticated', 'public.app_document_briefs', 'insert,update,delete')
     or has_table_privilege('anon', 'public.app_document_briefs', 'select,insert,update,delete')
     or (select count(*) from pg_policy where polrelid = 'public.app_document_briefs'::regclass) <> 1 then
    raise exception 'DOCUMENT_BRIEF_DELETE_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261116110000', 'document_brief_delete', array['S63-08 BRIEF delete: new public.app_document_brief_delete(uuid) (SECURITY DEFINER, search_path empty, authenticated only) deletes only the caller''s own workspace brief rows for one document (owner check per row) and returns the deleted count; no table, column, policy, RLS or table grant change; no anon, PUBLIC or service_role execute']);
commit;
