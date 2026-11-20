begin;
-- S67-57: 운영자(명진) 작업공간의 고친 이름에 새 칸 두 개(소속 칸 'affiliation', 주간 칸 'weekly')를 지금 화면 글자 그대로 더한다.
-- 2026-11-20 명진: "나는 커스텀한 결과 지금처럼 쓰는 거임" / 22:38 "명진 화면 이름은 그대로 '주간 보고'". 코드에 계정·이름을 넣지 않고 이 SQL로만 넣는다.
-- SQL Editor(폰 경로 C) 전용, 실행은 CC. 앞 단계: 20261121073000_profile_custom_words_slots 적용 + custom-words-operator.apply.sql(15칸) 실행됨
--   + custom-words-operator-slots.precheck.sql 모든 칸 '예'.
-- 대상: 운영자 허용 표에 'calls'·'telegram'이 둘 다 켜진 작업공간 정확히 하나의 owner 한 명. 15칸 값은 그대로 두고 두 칸만 더한다.
-- 다른 사람 행은 건드리지 않는다. 두 칸 중 하나라도 이미 있으면(화면에서 저장했으면) 멈춘다(덮어쓰지 않음). 짝: custom-words-operator-slots.rollback.sql
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
declare
  target uuid; owner_count int; changed int;
begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261121073000' and name = 'profile_custom_words_slots') <> 1 then
    raise exception 'CUSTOM_WORDS_OPERATOR_SLOTS_MIGRATION_MISSING; stop';
  end if;
  select count(*), min(m.user_id::text)::uuid into owner_count, target
    from public.app_workspace_members m
    where m.role = 'owner' and m.workspace_id = (
      select workspace_id from public.app_operator_features where feature in ('calls', 'telegram')
      group by workspace_id having count(distinct feature) = 2);
  if owner_count <> 1 or target is null then raise exception 'CUSTOM_WORDS_OPERATOR_OWNER_NOT_ONE; stop'; end if;
  update public.app_profiles
     set custom_words = custom_words || '{"affiliation": "노조", "weekly": "주간 보고"}'::jsonb
   where user_id = target and custom_words is not null
     and not (custom_words ? 'affiliation') and not (custom_words ? 'weekly');
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'CUSTOM_WORDS_OPERATOR_SLOTS_EMPTY_OR_ALREADY_SET; stop'; end if;
end
$$;
commit;
