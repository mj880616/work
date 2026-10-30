-- TG-발언자이름 소급 보내기(tgFeed_backfillSenders) 전·후 확인. 읽기 전용(select만). 이름·번호·key·방 이름은 출력하지 않는다(건수만).
-- 쓰는 법: Supabase SQL Editor 새 쿼리 창(+)에 통째로 붙여 넣고 실행 → 결과 캡처. 소급 전에 한 번, 소급 끝난 뒤 한 번.
-- 기대(소급 전, 10/30 기준): 사람 153 · 열쇠 있음 153 · 나(is_self) 0. 이름 있음은 그때 값을 적어 둔다.
-- 기대(소급 뒤): 이름 있음이 늘고, 나(is_self)는 1(또는 기록 주인 계정 수만큼). 방·날 연결 수가 늘어남.

select
  count(*)                                                         as people,              -- 이름표 사람 수
  count(*) filter (where s.sender_key is not null)                 as with_key,            -- 열쇠(해시) 있는 사람
  count(*) filter (where coalesce(s.name, s.auto_name) is not null) as with_name,           -- 이름(손 이름 또는 수집기 이름) 있는 사람
  count(*) filter (where s.auto_name is not null)                  as with_auto_name,      -- 수집기 이름 있는 사람
  count(*) filter (where s.is_self)                                as is_self_true,        -- '나'로 표시되는 사람
  (select count(*) from public.app_tg_day_senders)                 as day_links,           -- 방·날·라벨 연결 수
  (select count(distinct (l.room_key, l.day)) from public.app_tg_day_senders l) as room_days, -- 연결이 있는 방·날 수
  (select min(l.day) from public.app_tg_day_senders l)             as first_day,
  (select max(l.day) from public.app_tg_day_senders l)             as last_day
from public.app_tg_senders s;
