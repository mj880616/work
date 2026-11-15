-- LEDGER-반영기준점검: '메모만 남긴 고치기' 뒤 약속이 '상대가 안 지킨 약속'에서 빠진 일 확인용 — 읽기 전용 (select만).
-- 사용: Supabase SQL Editor 새 쿼리 창(+)에 붙여 넣는다. 조각이 셋이고 SQL Editor는 마지막 조각의 결과만 보여 주므로, 조각 하나씩(; 까지) 선택해 [Run selected]로 따로 실행하고 결과를 캡처해 커맨드센터에 보낸다.
-- 이 파일은 아무것도 바꾸지 않는다(insert/update/delete/함수 호출 없음). 기록 내용·사람 이름·개인정보는 이 파일에 없다.
-- 두 약속은 제목 일부로만 찾는다(아래 두 검색어). 검색어는 제목에 들어 있는 짧은 말이면 된다.
--
-- 순서:
--  1) 아래 1)을 실행 → 두 약속의 옛 기록·새 기록 줄이 나온다(chain_no 1이 가장 처음 기록, 숫자가 클수록 나중).
--  2) 아래 2)를 실행 → 대체될 때 AI가 만든 수정 요청에서 '바뀐 칸 이름과 값'을 본다.
--  3) 아래 3)을 실행 → 지금 '상대가 안 지킨 약속' 조건에 걸리는 약속 목록과 비교한다.
--
-- 읽는 법(결론 판정):
--  - 1)에서 새 기록의 commitment_status가 waiting이 아니면 → 상태가 바뀌어 빠진 것(2)의 changed_fields에 commitment_status가 있는지 확인).
--  - follow_up_on이 비었거나 오늘(서울) 이후로 바뀌었으면 → 확인일 변경으로 빠진 것.
--  - validity가 current/needs_check가 아니면(retired 등) → 폐기되어 빠진 것.
--  - 위가 모두 그대로(waiting + 지난 확인일 + current)인데도 3)에 없으면 → 코드 밖 원인(화면 읽기 조건·한도 30건)이라 다시 조사한다.

-- 검색어(두 약속). 필요하면 여기만 바꾼다.
-- 약속 가: 제목에 '궤도협의회' 와 '후속 면담' / 약속 나: 제목에 '증원' 과 '감축소요'

-- 1) 두 약속의 기록 줄(대체 전후 칸 비교): 같은 약속은 replaced_by 줄로 이어져 있다.
with recursive target as (
  select r.id from public.app_ledger_records r
  where r.kind = 'commitment'
    and ((r.title like '%궤도협의회%' and r.title like '%후속 면담%') or (r.title like '%증원%' and r.title like '%감축소요%'))
),
chain(id) as (
  -- 찾은 기록에서 시작해 '대체한 기록'(새 쪽)과 '대체된 기록'(옛 쪽)을 끝까지 따라간다.
  select id from target
  union
  select n.id from chain c
    join public.app_ledger_records cur on cur.id = c.id
    join public.app_ledger_records n on n.id = cur.superseded_by or n.superseded_by = cur.id
)
select r.ledger_id, r.created_at, r.validity, r.commitment_status, r.follow_up_on, (r.follow_up_on < (now() at time zone 'Asia/Seoul')::date) as overdue_now,
       (r.counterparty is not null and r.counterparty <> '') as has_counterparty, r.scope, r.sensitivity, r.date_start, r.date_precision,
       (select s.ledger_id from public.app_ledger_records s where s.id = r.superseded_by) as replaced_by,
       left(r.supersede_reason, 20) as supersede_reason_head,
       (select count(*) from public.app_ledger_record_sources rs where rs.record_id = r.id) as source_lines,
       (select count(*) from public.app_ledger_links l where l.record_id = r.id) as link_lines,
       char_length(coalesce(r.note, '')) as note_len
from public.app_ledger_records r
where r.id in (select id from chain)
order by r.title, r.created_at;

-- 2) 변경 기록과 수정 요청: 바뀐 칸 이름·값(상태·확인일은 값까지, 글 칸은 칸 이름만 — 내용은 보이지 않는다).
select r.ledger_id, c.created_at, c.action, c.route, left(c.note, 30) as note_head,
       c.detail ->> 'prev_validity' as prev_validity, c.detail ->> 'replaced_by' as replaced_by, c.detail ->> 'replaces' as replaces,
       f.received_from, f.status as fix_status,
       (select string_agg(k, ',' order by k) from jsonb_object_keys(coalesce(it.value -> 'set', '{}'::jsonb)) k) as changed_fields,
       it.value ->> 'do' as fix_do, it.value ->> 'target' as fix_target,
       it.value -> 'set' ->> 'commitment_status' as set_commitment_status,
       it.value -> 'set' ->> 'follow_up_on' as set_follow_up_on,
       left(it.value ->> 'reason', 30) as reason_head
from public.app_ledger_record_changes c
join public.app_ledger_records r on r.id = c.record_id and r.workspace_id = c.workspace_id
left join public.app_ledger_fix_requests f on f.id = c.fix_request_id and f.workspace_id = c.workspace_id
left join lateral jsonb_array_elements(coalesce(f.request -> 'items', '[]'::jsonb)) it(value) on c.action = 'replaced' and it.value ->> 'target' = r.ledger_id
where c.route = 'correction'
  and r.kind = 'commitment'
  and ((r.title like '%궤도협의회%' and r.title like '%후속 면담%') or (r.title like '%증원%' and r.title like '%감축소요%'))
order by r.title, c.created_at;

-- 3) 지금 '상대가 안 지킨 약속' 조건(앱의 읽기 조건과 같음: 대기 + 현재/확인필요 + 확인일이 오늘(서울)보다 앞)에 걸리는 약속 수와 두 약속의 포함 여부.
select count(*) as overdue_total,
       count(*) filter (where title like '%궤도협의회%' and title like '%후속 면담%') as rail_council_in_list,
       count(*) filter (where title like '%증원%' and title like '%감축소요%') as headcount_in_list
from public.app_ledger_records
where kind = 'commitment' and commitment_status = 'waiting' and validity in ('current', 'needs_check')
  and follow_up_on < (now() at time zone 'Asia/Seoul')::date;
