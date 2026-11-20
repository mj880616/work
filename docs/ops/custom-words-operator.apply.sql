begin;
-- APP-기록+이름바꾸기(S67-44, docs/design/girok-custom-words.md 5절): 운영자(명진) 작업공간의 내 프로필에 '지금 화면 이름 그대로'를 고친 이름으로 넣는다.
-- 2026-11-20 명진: "나는 커스텀한 결과 지금처럼 쓰는 거임" — 미리 만든 묶음이 아니라 명진 한 사람의 설정 값이다. 코드에 계정·이름을 넣지 않고 이 SQL로만 넣는다.
-- SQL Editor(폰 경로 C) 전용, 실행은 CC. 앞 단계: 20261120210000_profile_custom_words 적용 + custom-words-operator.precheck.sql 모든 칸 '예'.
-- 대상: 운영자 허용 표에 'calls'·'telegram'이 둘 다 켜진 작업공간 정확히 하나의 owner 한 명. 값은 메뉴·분류 이름 목록뿐(기록 내용 없음).
-- 다른 사람 행은 건드리지 않는다. 이미 값이 있으면(화면에서 저장했으면) 멈춘다(덮어쓰지 않음). 짝: custom-words-operator.rollback.sql
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
declare
  ws_count int; owner_count int; target uuid; changed int;
begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261120210000' and name = 'profile_custom_words') <> 1 then
    raise exception 'CUSTOM_WORDS_OPERATOR_MIGRATION_MISSING; stop';
  end if;
  select count(*) into ws_count from (
    select workspace_id from public.app_operator_features where feature in ('calls', 'telegram')
    group by workspace_id having count(distinct feature) = 2) t;
  if ws_count <> 1 then raise exception 'CUSTOM_WORDS_OPERATOR_WORKSPACE_NOT_ONE; stop'; end if;
  select count(*), min(m.user_id::text)::uuid into owner_count, target
    from public.app_workspace_members m
    where m.role = 'owner' and m.workspace_id = (
      select workspace_id from public.app_operator_features where feature in ('calls', 'telegram')
      group by workspace_id having count(distinct feature) = 2);
  if owner_count <> 1 or target is null then raise exception 'CUSTOM_WORDS_OPERATOR_OWNER_NOT_ONE; stop'; end if;
  update public.app_profiles
     set custom_words = '{"menu_biz": "사업 관리", "report": "사업 보고", "area": "사업영역", "menu_org": "조직 관리", "org_one": "담당조직", "org_report": "조직 보고", "workplace": "투쟁사업장", "kind_meeting": "회의", "kind_policy": "정책", "kind_negotiation": "교섭", "kind_press": "언론", "kind_assembly": "국회", "kind_struggle": "투쟁", "kind_education": "교육", "kind_other": "기타"}'::jsonb
   where user_id = target and custom_words is null;
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'CUSTOM_WORDS_OPERATOR_NOT_EMPTY_OR_NO_PROFILE; stop'; end if;
end
$$;
commit;
