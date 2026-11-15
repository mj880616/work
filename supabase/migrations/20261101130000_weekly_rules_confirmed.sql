begin;
-- WEEKLY-규칙합의 (명진 11/01 01:22·01:27·01:29): 주간보고 규칙을 '확정'(명진이 확인한 것)과 '후보'(AI가 고침 기록에서 만든 것)로 나눈다.
-- 규칙은 주간 요청 표 행의 draft -> 'rules' 칸(JSON)에 있다. 새 표·새 칸은 없고, 운영자(명진) 작업공간의 규칙 칸 한 곳만 새 모양으로 바꾼다.
--   새 모양: {"v":2, "at", "week", "lines":[확정 규칙], "candidates":[후보], "retired":[폐기]}
--   - lines: 명진이 확인한 규칙 14줄(문체 규칙이며 업무 내용·개인정보 없음). AI 초안은 이것만 본다.
--   - candidates: 지금 있던 규칙 줄(고침 기록에서 자동 정리된 것) 전부. 지우지 않고 후보로 되돌린다.
--   - retired: 옛 규칙 '정책·연구 사업은 진행이 없으면 제외'(명진이 폐기). 옛 줄 가운데 같은 뜻(정책·연구·제외/빼)의 줄도 폐기로 옮긴다.
-- 대상: app_operator_features 의 'calls' 작업공간(운영자 하나) 안에서 규칙 칸이 있는 가장 나중 주의 행 하나뿐. 다른 작업공간·다른 행은 건드리지 않는다.
-- draft_saved_at 을 지금으로 바꿔, 열려 있던 화면의 옛 사본이 이 값을 덮어쓰지 못하게(조건부 저장이 실패하고 다시 읽음) 한다.
-- 권한·정책·함수·트리거·제약은 바꾸지 않는다. 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다.
-- 되돌리기: 짝 rollback(SQL Editor 전용) — 후보·폐기 줄을 옛 모양(lines 하나)으로 되돌리고 확정 14줄을 뺀 뒤 기록 1행을 지운다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_weekly_exec_requests in share row exclusive mode;

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261101130000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261024001000' and name = 'weekly_draft') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261029090000' and name = 'operator_features') <> 1
     or to_regclass('public.app_operator_features') is null
     or (select count(distinct f.workspace_id) from public.app_operator_features f where f.feature = 'calls') <> 1 then
    raise exception 'WEEKLY_RULES_CONFIRMED_PREREQUISITE_CHANGED; stop';
  end if;
  if not exists (select 1 from public.app_weekly_exec_requests q
       where q.workspace_id = (select f.workspace_id from public.app_operator_features f where f.feature = 'calls')
         and (q.draft -> 'rules') is not null) then
    raise exception 'WEEKLY_RULES_CONFIRMED_NO_RULES_ROW; stop';
  end if;
  if exists (select 1 from public.app_weekly_exec_requests q
       where (q.draft -> 'rules' ->> 'v') = '2') then
    raise exception 'WEEKLY_RULES_CONFIRMED_ALREADY_SPLIT; stop';
  end if;
  if (select jsonb_typeof(q.draft -> 'rules' -> 'lines') from public.app_weekly_exec_requests q
       where q.workspace_id = (select f.workspace_id from public.app_operator_features f where f.feature = 'calls')
         and (q.draft -> 'rules') is not null
       order by q.week_start desc limit 1) is distinct from 'array' then
    raise exception 'WEEKLY_RULES_CONFIRMED_RULES_SHAPE; stop';
  end if;
end
$$;

update public.app_weekly_exec_requests r
  set draft = jsonb_set(r.draft, '{rules}', jsonb_strip_nulls(jsonb_build_object(
        'v', 2,
        'at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'week', r.draft -> 'rules' -> 'week',
        'lines', jsonb_build_array(
          jsonb_build_object('text', '날짜는 월.일. 꼴로 통일한다.', 'from', 'added'),
          jsonb_build_object('text', '일정은 날짜와 핵심 행사명·상태를 간결하게 쓴다.', 'from', 'added'),
          jsonb_build_object('text', '시간·장소·참석 인원은 핵심 정보일 때만 적는다.', 'from', 'added'),
          jsonb_build_object('text', '끝난 일은 결과와 현재 의미가 있을 때 남기고, 최근 일이면 남길 수도 있다.', 'from', 'added'),
          jsonb_build_object('text', '지난 일정과 종료된 투쟁은 다음 주 초안에서 가급적 반복하지 않는다.', 'from', 'added'),
          jsonb_build_object('text', '예정·검토·추진·확정 상태를 구분해 쓴다.', 'from', 'added'),
          jsonb_build_object('text', '예상이나 검토 중인 내용은 확정된 사실처럼 쓰지 않는다.', 'from', 'added'),
          jsonb_build_object('text', '날짜·차수·수치가 다른 자료와 맞지 않으면 확인 후 반영한다.', 'from', 'added'),
          jsonb_build_object('text', '회의·투쟁의 연속 경과는 날짜순으로 묶어 한 줄에 정리한다.', 'from', 'added'),
          jsonb_build_object('text', '요약에는 한 줄로, 세부 보고에는 구체적으로 쓰고, 같은 문장을 그대로 되풀이하지 않는다.', 'from', 'added'),
          jsonb_build_object('text', '초안에 없는 과거 경과는 현재 진행 상황을 이해하는 데 필요할 때만 보탠다.', 'from', 'added'),
          jsonb_build_object('text', '기관·조직의 고유 명칭은 필요한 범위에서 정확히 쓰고 불필요한 설명은 덜어낸다.', 'from', 'added'),
          jsonb_build_object('text', '내 담당 사업은 사업 요약표에 모두 들어간다(이 주 기록이 없어도 칸 유지).', 'from', 'added'),
          jsonb_build_object('text', '문장은 핵심 행동이나 결과부터 쓰고 군더더기 표현을 줄인다.', 'from', 'added')),
        'candidates', (select coalesce(jsonb_agg(jsonb_build_object('text', x.t) order by x.n), '[]'::jsonb)
          from (select e.n, btrim(case jsonb_typeof(e.v) when 'string' then e.v #>> '{}' else e.v ->> 'text' end) as t
                from jsonb_array_elements(r.draft -> 'rules' -> 'lines') with ordinality e(v, n)) x
          where coalesce(x.t, '') <> '' and not (x.t ~ '정책' and x.t ~ '연구' and x.t ~ '(제외|빼)')),
        'retired', jsonb_build_array(jsonb_build_object('text', '정책·연구 사업은 진행이 없으면 제외한다.'))
          || (select coalesce(jsonb_agg(jsonb_build_object('text', x.t) order by x.n), '[]'::jsonb)
          from (select e.n, btrim(case jsonb_typeof(e.v) when 'string' then e.v #>> '{}' else e.v ->> 'text' end) as t
                from jsonb_array_elements(r.draft -> 'rules' -> 'lines') with ordinality e(v, n)) x
          where coalesce(x.t, '') <> '' and x.t ~ '정책' and x.t ~ '연구' and x.t ~ '(제외|빼)')))),
      draft_saved_at = now()
  where r.id = (select q.id from public.app_weekly_exec_requests q
                where q.workspace_id = (select f.workspace_id from public.app_operator_features f where f.feature = 'calls')
                  and (q.draft -> 'rules') is not null
                order by q.week_start desc limit 1);

-- 사후 확인: 새 모양 행이 정확히 하나, 그 행이 운영자 작업공간에 있고 확정 14줄. 다르면 전체 취소.
do $$
begin
  if (select count(*) from public.app_weekly_exec_requests q where (q.draft -> 'rules' ->> 'v') = '2') <> 1
     or (select count(*) from public.app_weekly_exec_requests q
           where (q.draft -> 'rules' ->> 'v') = '2'
             and q.workspace_id = (select f.workspace_id from public.app_operator_features f where f.feature = 'calls')
             and jsonb_array_length(q.draft -> 'rules' -> 'lines') = 14
             and jsonb_typeof(q.draft -> 'rules' -> 'candidates') = 'array'
             and jsonb_array_length(q.draft -> 'rules' -> 'retired') >= 1) <> 1 then
    raise exception 'WEEKLY_RULES_CONFIRMED_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261101130000', 'weekly_rules_confirmed', array['WEEKLY-규칙합의: operator workspace latest draft.rules -> v2 (14 confirmed lines, old lines kept as candidates, one retired rule); data only, no schema, privilege or policy change']);
commit;
