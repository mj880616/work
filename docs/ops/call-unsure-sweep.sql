begin;
-- CALL-업무기본 ⑤ 일괄 변경(CC가 call-unsure-census.sql 건수를 보고한 뒤에만 실행. 새 쿼리 창(+)에서 시작, 대상 프로젝트 확인).
-- 하는 일: 개인 통화함의 애매 통화(kind='unsure', 숨기지 않은 것) 중 상대 표기에 담당조직 이름·별칭이 든 줄을 업무 통화함으로 옮긴다.
--   app_call_move(..., 'work')와 같은 동작이다: 같은 id·같은 원본 고유키·같은 전문·요약·created_at, moved_at=지금, refilled_at=비움(= 업무 기준 정보 다시 채우기 대기, 7절 길).
--   조직·프로젝트 연결, 고정은 만들지 않는다. 내용은 지우지 않는다(개인 통화함에서 업무 통화함으로 한 번에 옮김).
-- 업무 기준 정보 다시 채우기: 이 SQL은 AI를 부르지 않는다. 옮긴 줄은 앱의 '정보 채우기 대기 [다시 시도]'(기존 7절 길)로 채운다.
-- 되돌리는 법: 옮긴 줄은 앱에서 [개인으로]를 누르면 개인 통화함으로 돌아간다(app_call_move 'personal'). 일괄로 되돌릴 때는 moved_at이 이번 실행 시각인 업무 통화 id를 같은 방식으로 되돌린다.
-- 아래 expected 숫자를 census의 'rule hit' 건수로 바꾼 뒤 실행한다. 건수가 다르면 아무것도 바꾸지 않고 멈춘다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create temporary table sweep_ids on commit drop as
with keys as (
  select o.workspace_id, k.key
  from public.app_suborganizations o
  cross join lateral (
    select distinct regexp_replace(replace(lower(regexp_replace(n, '[[:space:]·‧․.,()\[\]{}<>「」『』''"“”‘’\-–_/]', '', 'g')), '노동조합', '노조'), '(지부|지회)$', '') as key
    from unnest(array[o.name] || coalesce(o.aliases, '{}')) as n
    union
    select replace(lower(regexp_replace(n, '[[:space:]·‧․.,()\[\]{}<>「」『』''"“”‘’\-–_/]', '', 'g')), '노동조합', '노조')
    from unnest(array[o.name] || coalesce(o.aliases, '{}')) as n
  ) k
  where o.deleted_at is null and coalesce(o.active, true) and char_length(k.key) >= 3
)
select distinct c.id
from public.app_call_personal c
join keys k on k.workspace_id = c.workspace_id
where c.kind = 'unsure' and c.hidden_at is null
  and position(k.key in replace(lower(regexp_replace(coalesce(c.counterpart, ''), '[[:space:]·‧․.,()\[\]{}<>「」『』''"“”‘’\-–_/]', '', 'g')), '노동조합', '노조')) > 0;

do $$
declare
  expected integer := -1;  -- ← census의 'rule hit' 건수로 바꾼다(-1이면 멈춘다)
  actual integer;
begin
  select count(*) into actual from sweep_ids;
  if expected < 0 or actual <> expected then
    raise exception 'CALL_UNSURE_SWEEP_COUNT_MISMATCH: expected %, actual %', expected, actual;
  end if;
end
$$;

with moved as (
  delete from public.app_call_personal c
  where c.id in (select id from sweep_ids) and c.kind = 'unsure' and c.hidden_at is null
  returning c.*
)
insert into public.app_feed_items (id, workspace_id, source, day, occurred_at, title, summary, points, counterpart, speaker_split,
  raw_text, raw_count, source_ref, drive_url, hidden_at, model, judged_at, moved_at, refilled_at, created_at, updated_at)
select m.id, m.workspace_id, 'call', m.day, m.occurred_at, m.title, m.summary, m.points, m.counterpart, m.speaker_split,
  m.raw_text, 0, m.source_ref, m.drive_url, m.hidden_at, m.model, m.judged_at, now(), null, m.created_at, now()
from moved m;

-- 확인: 옮긴 건수가 expected와 같고 개인 통화함에 남은 id가 없어야 한다.
do $$
begin
  if exists (select 1 from public.app_call_personal c where c.id in (select id from sweep_ids))
     or (select count(*) from public.app_feed_items f where f.id in (select id from sweep_ids) and f.source = 'call' and f.refilled_at is null and f.moved_at is not null)
        <> (select count(*) from sweep_ids) then
    raise exception 'CALL_UNSURE_SWEEP_POSTCHECK_FAILED';
  end if;
end
$$;
commit;
