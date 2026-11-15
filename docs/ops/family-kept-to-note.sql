-- S51-26 FAMILY-노트로 ④: 홈 '잊지 말기'의 옛 [기억만] 줄(app_family_notes status='kept')을 처음 한 번 '잊지 말기' 노트로 옮긴다.
-- 운영 데이터 변경이다. 커맨드센터가 화면 PR merge·Pages 배포 뒤에 SQL Editor(또는 승인형 경로)로 실행한다. 작업 세션은 실행하지 않는다.
--
-- 일상어 3줄
--   무엇이 바뀌나: 운영자 작업공간에 맨 위 '가족' 노트 폴더(없을 때만)와 '잊지 말기' 노트 한 개가 생기고(이미 있으면 그 노트 끝에),
--                 옛 [기억만] 줄이 '☐ 내용 (통화 11/5)' 체크 줄로 한 줄씩 들어간다(했음으로 표시했던 줄은 '☑'). 원래 기록(app_family_notes)은 지우지도 고치지도 않는다.
--   잘못되면: 노트에 같은 줄이 두 번 들어가거나 엉뚱한 노트에 들어갈 수 있다. 아래 ② 안의 검사가 두 번 실행·조건 다름을 막고 멈춘다.
--   되돌리는 방법: ④ 되돌리기(새로 만든 노트면 휴지통으로, 기존 노트에 더했으면 더한 줄만 잘라 냄 — 그 뒤 노트를 고치지 않았을 때만).
--
-- 내용(가족 이름·대화·줄 글자)은 어디에도 출력하지 않는다. 결과는 건수·참거짓만.
-- 옮기는 대상은 status='kept'뿐(요청 원문 ④ "지금 [기억]에 남은 줄(kept)"). tasked·scheduled 줄은 이미 할 일·일정에 있어 옮기지 않는다.
-- 줄 모양은 화면(app/family-notes-model.mjs noteLine)과 같다: '☐ 내용 (출처 M/D · 말한 때: …)', 300자에서 자름. 노트는 AI 재료에서 뺀다(ai_export_allowed=false).

-- ① 사전 확인(select만). 기대: workspaces=1, kept_rows=옮길 줄 수(그 숫자만 보고), list_notes=0 또는 1, moved_before=0.
select
  (select count(distinct workspace_id) from public.app_family_notes where status = 'kept')                          as workspaces,
  (select count(*) from public.app_family_notes where status = 'kept')                                             as kept_rows,
  (select count(*) from public.app_family_notes where status = 'kept' and done_at is not null)                     as kept_done,
  (select count(*) from public.app_notes n where n.kind = 'note' and n.deleted_at is null and n.metadata ->> 'family_list' = 'true') as list_notes,
  (select count(*) from public.app_notes n where n.metadata ? 'family_moved_at')                                    as moved_before,
  (select count(*) from public.app_note_folders f
     where f.parent_id is null and f.name = '가족'
       and f.workspace_id in (select workspace_id from public.app_family_notes where status = 'kept'))            as family_folders;

-- ② 옮기기(새 쿼리 창에 이 begin; 부터 commit; 까지 통째로). 마지막 줄이 commit; 인지 확인하고 실행.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
do $$
declare
  ws uuid;
  folder uuid;
  target uuid;
  moved int;
  paras jsonb;
  plain text;
  stamp timestamptz := now();
begin
  if (select count(distinct workspace_id) from public.app_family_notes where status = 'kept') <> 1 then
    raise exception 'FAMILY_KEPT_TO_NOTE: kept 줄의 작업공간이 하나가 아님; stop';
  end if;
  if exists (select 1 from public.app_notes where metadata ? 'family_moved_at') then
    raise exception 'FAMILY_KEPT_TO_NOTE: 이미 옮김; stop';
  end if;
  select distinct workspace_id into ws from public.app_family_notes where status = 'kept';
  if not exists (select 1 from public.app_operator_features where workspace_id = ws and feature = 'family') then
    raise exception 'FAMILY_KEPT_TO_NOTE: 운영자 기능 family 작업공간이 아님; stop';
  end if;

  -- 줄 만들기(만든 때 순서, 오래된 것 먼저).
  with rows as (
    select f.created_at,
      left(
        (case when f.done_at is not null then '☑ ' else '☐ ' end) || btrim(regexp_replace(f.body, '[[:cntrl:]]+', ' ', 'g'))
        || coalesce(' (' || nullif(concat_ws(' · ',
             nullif(btrim(concat_ws(' ', case f.origin when 'call' then '통화' else '텔레그램' end,
               case when f.origin_day is not null then extract(month from f.origin_day)::int || '/' || extract(day from f.origin_day)::int end)), ''),
             case when nullif(btrim(coalesce(f.said_when, '')), '') is not null then '말한 때: ' || btrim(regexp_replace(f.said_when, '[[:cntrl:]]+', ' ', 'g')) end), '') || ')', ''),
        300) as line
    from public.app_family_notes f
    where f.workspace_id = ws and f.status = 'kept'
  )
  select count(*),
         coalesce(jsonb_agg(jsonb_build_object('type', 'paragraph', 'attrs', jsonb_build_object('style', 'body2'),
                  'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', line))) order by created_at), '[]'::jsonb),
         string_agg(line, E'\n\n' order by created_at)
    into moved, paras, plain
  from rows;
  if moved = 0 then raise exception 'FAMILY_KEPT_TO_NOTE: 옮길 줄 없음; stop'; end if;

  -- 폴더: 맨 위 '가족'(없으면 만든다, 맨 위 폴더들 뒤 순서).
  select id into folder from public.app_note_folders where workspace_id = ws and parent_id is null and name = '가족' order by created_at limit 1;
  if folder is null then
    insert into public.app_note_folders (workspace_id, parent_id, name, sort_order)
    values (ws, null, '가족', coalesce((select max(sort_order) + 1 from public.app_note_folders where workspace_id = ws and parent_id is null), 0))
    returning id into folder;
  end if;

  -- 그 폴더의 '잊지 말기' 노트(가장 최근). 있으면 끝에 더하고, 없으면 새로 만든다.
  select id into target from public.app_notes
   where workspace_id = ws and kind = 'note' and deleted_at is null and metadata ->> 'family_list' = 'true' and metadata ->> 'folder_id' = folder::text
   order by updated_at desc limit 1;
  if target is null then
    insert into public.app_notes (workspace_id, kind, title, raw_text, doc, metadata, ai_export_allowed, updated_at)
    values (ws, 'note', '잊지 말기', plain, jsonb_build_object('v', 'ed1', 'doc', jsonb_build_object('type', 'doc', 'content', paras)),
            jsonb_build_object('family_list', true, 'folder_id', folder::text, 'folder', '가족', 'family_moved_at', stamp, 'family_moved_count', moved, 'family_moved_new', true),
            false, stamp);
  else
    if (select doc from public.app_notes where id = target) is null then
      raise exception 'FAMILY_KEPT_TO_NOTE: 잊지 말기 노트에 서식 본문이 없음; stop';
    end if;
    update public.app_notes
       set doc = jsonb_set(doc, '{doc,content}', (doc -> 'doc' -> 'content') || paras),
           raw_text = case when btrim(raw_text) = '' then plain else raw_text || E'\n\n' || plain end,
           metadata = metadata || jsonb_build_object('family_moved_at', stamp, 'family_moved_count', moved, 'family_moved_new', false,
                                                     'family_moved_chars', length(plain) + case when btrim(raw_text) = '' then 0 else 2 end),
           updated_at = stamp
     where id = target;
  end if;
end
$$;
commit;

-- ③ 사후 확인(select만). 기대: moved_notes=1, moved_count=①의 kept_rows, kept_rows 그대로(원래 기록 안 바뀜), in_family_folder=true, ai_off=true.
select
  (select count(*) from public.app_notes where metadata ? 'family_moved_at')                                        as moved_notes,
  (select (metadata ->> 'family_moved_count')::int from public.app_notes where metadata ? 'family_moved_at')          as moved_count,
  (select (metadata ->> 'family_moved_new')::boolean from public.app_notes where metadata ? 'family_moved_at')        as made_new_note,
  (select count(*) from public.app_family_notes where status = 'kept')                                              as kept_rows,
  (select f.parent_id is null and f.name = '가족' from public.app_notes n join public.app_note_folders f on f.id::text = n.metadata ->> 'folder_id'
     where n.metadata ? 'family_moved_at')                                                                          as in_family_folder,
  (select ai_export_allowed = false from public.app_notes where metadata ? 'family_moved_at')                        as ai_off,
  (select jsonb_array_length(doc -> 'doc' -> 'content') from public.app_notes where metadata ? 'family_moved_at')   as paragraphs;

-- ④ 되돌리기(필요할 때만, 새 쿼리 창에 begin; 부터 commit; 까지). 옮긴 뒤 그 노트를 고쳤으면(updated_at이 바뀜) 멈춘다.
--    새로 만든 노트면 휴지통으로(deleted_at, 노트 화면 휴지통에서 보임). 기존 노트에 더했으면 더한 줄만 잘라 내고 표시를 지운다.
--    만든 '가족' 폴더는 그대로 둔다(빈 폴더, 필요하면 노트 화면에서 지움).
-- begin;
-- do $$
-- declare r record; keep int;
-- begin
--   select id, doc, raw_text, metadata, updated_at into r from public.app_notes where metadata ? 'family_moved_at';
--   if r.id is null then raise exception 'FAMILY_KEPT_TO_NOTE_ROLLBACK: 옮긴 노트 없음; stop'; end if;
--   if r.updated_at <> (r.metadata ->> 'family_moved_at')::timestamptz then raise exception 'FAMILY_KEPT_TO_NOTE_ROLLBACK: 그 뒤 노트가 바뀜; stop'; end if;
--   if (r.metadata ->> 'family_moved_new')::boolean then
--     update public.app_notes set deleted_at = now() where id = r.id;
--   else
--     keep := jsonb_array_length(r.doc -> 'doc' -> 'content') - (r.metadata ->> 'family_moved_count')::int;
--     update public.app_notes
--        set doc = jsonb_set(doc, '{doc,content}', coalesce((select jsonb_agg(e order by i) from jsonb_array_elements(doc -> 'doc' -> 'content') with ordinality as t(e, i) where i <= keep), '[]'::jsonb)),
--            raw_text = left(raw_text, length(raw_text) - (r.metadata ->> 'family_moved_chars')::int),
--            metadata = metadata - 'family_moved_at' - 'family_moved_count' - 'family_moved_new' - 'family_moved_chars',
--            updated_at = now()
--      where id = r.id;
--   end if;
-- end
-- $$;
-- commit;
