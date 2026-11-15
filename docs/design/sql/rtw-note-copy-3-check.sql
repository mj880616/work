-- 초안(DRAFT) — RTW-노트일원화 ④ 옮기기 3/4: 옮긴 뒤 확인(읽기 전용, select 한 문장). 설명: docs/design/rtw-note-copy-sql.md
-- 무엇이 바뀌나: 아무것도 안 바뀐다(select만). 옮겨진 노트 수를 읽생기 원본 수와 대조하는 표 하나가 나온다.
-- 잘못되면: 해당 없음(조회만).
-- 되돌리는 법: 해당 없음.
-- 쓰는 법: SQL Editor 새 쿼리 창(+)에 붙여 넣고 실행 → 판정 칸이 전부 OK(또는 -)인지 확인. 개수만 나오고 글 내용은 나오지 않는다.
with me as (select owner_id as id from public.rtw_personal_mode where id = 'owner'),
ws as (select id from public.app_workspaces where slug = 'kptu-work'),
mv as (
  select n.id, n.workspace_id, n.kind, n.title, n.raw_text, n.attachments, n.updated_at, n.metadata,
         n.metadata -> 'rtw' ->> 'table' as src_table, n.metadata -> 'rtw' ->> 'id' as src_id
  from public.app_notes n
  where n.metadata -> 'rtw' is not null
),
src as (
  select
    (select count(*) from public.rtw_resources where owner_id = me.id) as res,
    (select count(*) from public.rtw_notes where owner_id = me.id and resource_id is null) as memo_alone,
    (select count(*) from public.rtw_questions where owner_id = me.id) as q,
    (select count(*) from public.rtw_records where owner_id = me.id) as rec,
    (select count(*) from public.rtw_writing_context where owner_id = me.id and btrim(coalesce(profile_md, ''), E' \t\r\n') <> '') as wc,
    (select count(*) from public.rtw_resources x where x.owner_id = me.id
       and not exists (select 1 from mv where mv.src_table = 'rtw_resources' and mv.src_id = x.id::text))
    + (select count(*) from public.rtw_notes x where x.owner_id = me.id and x.resource_id is null
       and not exists (select 1 from mv where mv.src_table = 'rtw_notes' and mv.src_id = x.id::text))
    + (select count(*) from public.rtw_questions x where x.owner_id = me.id
       and not exists (select 1 from mv where mv.src_table = 'rtw_questions' and mv.src_id = x.id::text))
    + (select count(*) from public.rtw_records x where x.owner_id = me.id
       and not exists (select 1 from mv where mv.src_table = 'rtw_records' and mv.src_id = x.id::text))
    + (select count(*) from public.rtw_writing_context x where x.owner_id = me.id and btrim(coalesce(x.profile_md, ''), E' \t\r\n') <> ''
       and not exists (select 1 from mv where mv.src_table = 'rtw_writing_context' and mv.src_id = x.owner_id::text)) as not_moved
  from me
),
r as (
  select 10 as ord, '개수' as grp, '옮겨진 노트 합계' as item, (select count(*) from mv) as val,
         (select res + memo_alone + q + rec + wc from src) as expected, 'eq' as how
  union all select 11, '개수', '읽기 글', (select count(*) from mv where src_table = 'rtw_resources'), (select res from src), 'eq'
  union all select 12, '개수', '독립 메모', (select count(*) from mv where src_table = 'rtw_notes'), (select memo_alone from src), 'eq'
  union all select 13, '개수', '질문', (select count(*) from mv where src_table = 'rtw_questions'), (select q from src), 'eq'
  union all select 14, '개수', '글쓰기 기록', (select count(*) from mv where src_table = 'rtw_records'), (select rec from src), 'eq'
  union all select 15, '개수', '훈련 기준', (select count(*) from mv where src_table = 'rtw_writing_context'), (select wc from src), 'eq'
  union all select 20, '빠진 것', '아직 안 옮겨진 읽생기 글(옮긴 뒤 새로 쓴 글 포함)', (select not_moved from src), 0, 'eq'
  union all select 30, '안전', '작업공간(workspace_id) 종류 수', (select count(distinct workspace_id) from mv), 1, 'eq'
  union all select 31, '안전', '옮긴 노트가 Web2 작업공간(kptu-work) 밖에 있는 수', (select count(*) from mv where workspace_id not in (select id from ws)), 0, 'eq'
  union all select 32, '안전', '같은 원본이 두 번 들어간 수', (select count(*) - count(distinct (src_table, src_id)) from mv), 0, 'eq'
  union all select 33, '안전', '종류가 note가 아닌 수', (select count(*) from mv where kind <> 'note'), 0, 'eq'
  union all select 34, '안전', '가장 긴 제목(자)', (select coalesce(max(char_length(title)), 0) from mv), 200, 'max'
  union all select 35, '안전', '가장 긴 본문(자)', (select coalesce(max(char_length(raw_text)), 0) from mv), 100000, 'max'
  union all select 36, '안전', '옮긴 뒤 고쳐진 노트(옮긴 직후에는 0)', (select count(*) from mv where updated_at is distinct from (metadata -> 'rtw' ->> 'src_updated_at')::timestamptz), 0, 'eq'
  union all select 37, '안전', '연결·첨부가 붙은 노트(옮긴 직후에는 0)',
         (select count(*) from mv where attachments <> '[]'::jsonb or exists (select 1 from public.app_record_links l where l.note_id = mv.id)), 0, 'eq'
  union all select 100, 'app_notes 현황(종류별 행 수)', 'kind = ' || kind, count(*), null, 'info'
         from public.app_notes group by kind
  union all select 101, 'app_notes 현황(종류별 행 수)', '그 중 읽생기에서 옮긴 노트', (select count(*) from mv), null, 'info'
)
select grp as "구분", item as "항목", val::text as "값", coalesce(expected::text, '-') as "기대·원본",
       case how
         when 'info' then '-'
         when 'max' then case when val <= expected then 'OK' else '확인 필요' end
         else case when val is not distinct from expected then 'OK' else '확인 필요' end
       end as "판정"
from r
order by ord, item;
