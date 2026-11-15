-- TODO-내일만 3 원인 확인(10/29). 읽기 전용: select만, 아무것도 바꾸지 않는다. 커맨드센터가 SQL Editor(또는 Supabase MCP 조회 전용)에서 실행한다.
-- 사람 이름·방 이름·방 번호·후보 내용은 출력하지 않는다. 방 번호는 '모양'(양수/-100…/짧은 음수/그 밖)으로만 묶어 건수를 낸다.
-- 정보 스키마(information_schema)는 쓰지 않는다. 작업공간 id는 출력하지 않고 합계만 낸다.
--
-- 읽는 법:
--  A. 방 표(app_feed_rooms): 방 번호 모양 × 방 종류(chat_kind, 비었으면 '비어 있음') 건수.
--     '짧은 음수'나 '-100…'이 1개 이상이면 수집기가 텔레그램 표시 번호(음수=단체방)를 쓰는 것이 확인된다 → 서버의 '방 번호로 방 종류 정하기'를 배포해도 된다.
--     모두 '양수'뿐이면 번호 규칙이 다를 수 있으니 서버 배포 전에 멈추고 커맨드센터가 판단한다(양수가 모두 1:1로 잡혀 단체방 전체 부탁이 올라올 수 있음).
--  B. 텔레그램 대기(open) 후보: 방 표 줄이 없음 / 줄은 있으나 종류 비어 있음 / 종류 있음 × 방 번호 모양 건수.
--  C. 보낸 사람 이름표(app_tg_senders): 열쇠 있음/없음 × is_self 건수. 열쇠 있는 사람이 있으면 '나로 표시' 한 번이 모든 방·날에 적용된다.
--  D. 앱 스크립트가 지금까지 self를 보낸 적이 있는지 직접 알 길은 없다(기본값 false와 같음). C의 is_self=true가 0이면 '보낸 적 없음 또는 false만'으로 본다.
with rooms as (
  select r.chat_kind,
         case when r.room_key ~ '^[1-9][0-9]*$' then '양수'
              when r.room_key ~ '^-100[0-9]+$' then '-100…'
              when r.room_key ~ '^-[1-9][0-9]*$' then '짧은 음수'
              else '그 밖' end as shape
    from public.app_feed_rooms r
)
select 'A rooms by key shape/kind' as section, shape || ' / ' || coalesce(chat_kind, '비어 있음') as key, count(*)::text as n
  from rooms group by shape, chat_kind
union all
select 'B open telegram candidates by room row/kind/shape',
       case when r.room_key is null then '방 표 줄 없음' when r.chat_kind is null then '종류 비어 있음' else '종류 ' || r.chat_kind end
       || ' / ' ||
       case when i.room_key is null then '소식 줄 없음'
            when i.room_key ~ '^[1-9][0-9]*$' then '양수'
            when i.room_key ~ '^-100[0-9]+$' then '-100…'
            when i.room_key ~ '^-[1-9][0-9]*$' then '짧은 음수'
            else '그 밖' end,
       count(*)::text
  from public.app_todo_candidates c
  left join public.app_feed_items i on i.id = c.source_id and i.workspace_id = c.workspace_id
  left join public.app_feed_rooms r on r.workspace_id = i.workspace_id and r.room_key = i.room_key
  where c.source_kind = 'telegram' and c.status = 'open'
  group by 2
union all
select 'C senders by key/self', case when s.sender_key is null then '열쇠 없음' else '열쇠 있음' end || ' / is_self=' || s.is_self::text, count(*)::text
  from public.app_tg_senders s
  group by 2
order by 1, 2;
