-- 초안(DRAFT) — RTW-노트일원화 ④ 옮기기 4/4: 되돌리기(옮겨 온 노트만 삭제). 설명: docs/design/rtw-note-copy-sql.md
-- 무엇이 바뀌나: 2/4로 옮겨 온 노트(metadata.rtw 표시)만 Web2 노트에서 지운다. 읽생기 원본과 바구니·업무일지·일기·직접 쓴 노트는 그대로다.
-- 잘못되면: 옮긴 뒤 고친 노트·연결 또는 첨부가 붙은 노트·종류를 바꾼 노트가 하나라도 있으면 아무것도 지우지 않고 멈춘다(오류 문구에 개수가 나온다). 고친 내용을 지워서 통과시키지 않는다.
-- 되돌리는 법: 지운 뒤에도 읽생기 원본이 남아 있으므로 2/4를 다시 실행하면 처음부터 다시 옮겨진다.
-- 쓰는 법: SQL Editor 새 쿼리 창(+)에 전부 붙여 넣기 → 첫 줄 begin; · 마지막 줄 commit; 확인 → 대상 프로젝트 확인 → 실행 → Success 확인 → 3/4로 옮긴 노트 0개 확인.
--   먼저 지워질 개수만 보고 싶으면 마지막 줄 commit;을 rollback;으로 바꿔 실행한다(오류 없이 끝나면 지울 수 있다는 뜻이고, 실제로는 지워지지 않는다).
-- 이 파일은 app_notes에서 delete만 한다. 읽생기 표·권한·정책·함수는 바꾸지 않는다.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
-- 되돌리는 동안 노트가 새로 들어오거나 고쳐지지 않게 노트 표에 쓰기 잠금을 건다.
lock table public.app_notes in share row exclusive mode;

do $$
declare
  ws uuid;
  n_all int;
  n_edited int;
  n_kind int;
  n_attach int;
  n_other int;
  n_linked int;
  n_del int;
  total_before int;
begin
  if (select count(*) from public.app_workspaces where slug = 'kptu-work') <> 1 then
    raise exception 'RTW_REVERT_STOP-01: Web2 작업공간(kptu-work)이 1개가 아님';
  end if;
  select id into ws from public.app_workspaces where slug = 'kptu-work';

  select count(*) into n_all from public.app_notes where metadata -> 'rtw' is not null;
  if n_all = 0 then
    raise exception 'RTW_REVERT_STOP-02: 되돌릴 노트가 없음(metadata.rtw 표시 노트 0개)';
  end if;
  -- 이 SQL이 만든 표시(5가지 원본 표, 작업공간 kptu-work)가 아닌 노트가 섞여 있으면 멈춘다.
  if exists (select 1 from public.app_notes
             where metadata -> 'rtw' is not null
               and (workspace_id <> ws
                    or jsonb_typeof(metadata -> 'rtw') is distinct from 'object'
                    or metadata -> 'rtw' ->> 'table' is null
                    or metadata -> 'rtw' ->> 'table' not in ('rtw_resources', 'rtw_notes', 'rtw_questions', 'rtw_records', 'rtw_writing_context')
                    or metadata -> 'rtw' ->> 'id' is null)) then
    raise exception 'RTW_REVERT_STOP-03: metadata.rtw가 예상과 다른 노트가 있음';
  end if;
  -- app_notes를 가리키는 다른 표(app_record_links 외)가 새로 생겼으면 멈춘다(지우면 같이 지워질 수 있음).
  if to_regclass('public.app_record_links') is null
     or exists (select 1 from pg_constraint
                where confrelid = 'public.app_notes'::regclass and contype = 'f'
                  and conrelid <> 'public.app_record_links'::regclass) then
    raise exception 'RTW_REVERT_STOP-04: app_notes를 가리키는 다른 표가 있음';
  end if;

  select count(*) filter (where updated_at is distinct from (metadata -> 'rtw' ->> 'src_updated_at')::timestamptz),
         count(*) filter (where kind <> 'note'),
         count(*) filter (where attachments <> '[]'::jsonb or archived_at is not null),
         count(*) filter (where ai_export_allowed is distinct from true or (metadata - 'rtw') <> '{}'::jsonb),
         count(*) filter (where exists (select 1 from public.app_record_links l where l.note_id = n.id))
    into n_edited, n_kind, n_attach, n_other, n_linked
  from public.app_notes n
  where n.metadata -> 'rtw' is not null;
  if n_edited + n_kind + n_attach + n_other + n_linked > 0 then
    raise exception 'RTW_REVERT_STOP-05: 옮긴 뒤 바뀐 노트가 있어 멈춤 (고침 %, 종류 바뀜 %, 첨부·보관 %, 기타 %, 연결 %). 아무것도 지우지 않음',
      n_edited, n_kind, n_attach, n_other, n_linked;
  end if;

  select count(*) into total_before from public.app_notes;
  delete from public.app_notes where metadata -> 'rtw' is not null;
  get diagnostics n_del = row_count;
  if n_del <> n_all
     or exists (select 1 from public.app_notes where metadata -> 'rtw' is not null)
     or (select count(*) from public.app_notes) <> total_before - n_all then
    raise exception 'RTW_REVERT_STOP-06: 지운 수가 예상과 다름(전체 취소)';
  end if;
end
$$;

-- 모든 확인을 통과했을 때만 저장한다. 이 줄이 마지막 줄이어야 한다.
commit;
