-- TODO-내일만 1번 원인 확인(요청함 10/29 16:41). 읽기 전용: select만, 아무것도 바꾸지 않는다.
-- 커맨드센터가 SQL Editor(또는 Supabase MCP 조회 전용)에서 실행해 결과를 PR 댓글로 붙인다.
-- 후보 내용(요약·근거)·사람 이름·방 이름·방 열쇠는 출력하지 않는다. 출처·종류·상태·방 종류별 건수만 낸다.
-- 정보 스키마(information_schema)는 쓰지 않는다. 작업공간이 여럿이어도 작업공간 id는 출력하지 않고 합계만 낸다.
--
-- 읽는 법:
--  A. 대기(open) 후보: 출처(source_kind)×종류(kind) 건수 — 엉뚱한 것이 어느 출처에서 많이 오는지.
--  B. 전체 후보: 출처×상태(open·tasked·dismissed) 건수 — 무시 비율이 높은 출처가 판단이 넓은 곳.
--  C. 텔레그램 대기 후보: 방 종류(개인 대화 user·단체방 group·채널 channel·모름)별 건수 — 단체방 전체 부탁 비중 추정.
--  D. 텔레그램 '나' 이름표: 작업공간마다 is_self=true인 사람 줄 수(1이 정상, 0이면 '나'가 안 잡혀 명진이 보낸 부탁이 후보로 들어갈 수 있음),
--     방·날짜 연결 중 '나'로 이어진 줄 수와 전체 줄 수, '나' 줄이 하나도 없는 방 수.
--  E. 최근 7일 새로 생긴 대기 후보: 출처별 건수.
select 'A open by source/kind' as section, c.source_kind || ' / ' || c.kind as key, count(*)::text as n
  from public.app_todo_candidates c where c.status = 'open'
  group by c.source_kind, c.kind
union all
select 'B all by source/status', c.source_kind || ' / ' || c.status, count(*)::text
  from public.app_todo_candidates c
  group by c.source_kind, c.status
union all
select 'C telegram open by room kind', coalesce(r.chat_kind, '모름'), count(*)::text
  from public.app_todo_candidates c
  left join public.app_feed_items i on i.id = c.source_id and i.workspace_id = c.workspace_id
  left join public.app_feed_rooms r on r.workspace_id = i.workspace_id and r.room_key = i.room_key
  where c.source_kind = 'telegram' and c.status = 'open'
  group by r.chat_kind
union all
select 'D self rows per workspace', 'is_self=true 줄 수 ' || x.self_rows::text, count(*)::text
  from (select s.workspace_id, count(*) filter (where s.is_self) as self_rows
          from public.app_tg_senders s group by s.workspace_id) x
  group by x.self_rows
union all
select 'D day links', case when s.is_self then '나로 이어진 줄' else '다른 사람 줄' end, count(*)::text
  from public.app_tg_day_senders d
  join public.app_tg_senders s on s.id = d.sender_id and s.workspace_id = d.workspace_id
  group by s.is_self
union all
select 'D rooms without self', '나 줄이 없는 방 수', count(*)::text
  from (select d.workspace_id, d.room_key
          from public.app_tg_day_senders d
          join public.app_tg_senders s on s.id = d.sender_id and s.workspace_id = d.workspace_id
          group by d.workspace_id, d.room_key
          having count(*) filter (where s.is_self) = 0) x
union all
select 'E open created in last 7 days by source', c.source_kind, count(*)::text
  from public.app_todo_candidates c
  where c.status = 'open' and c.created_at >= now() - interval '7 days'
  group by c.source_kind
order by 1, 2;
