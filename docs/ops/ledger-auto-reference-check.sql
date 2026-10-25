-- 원장 자동 기록 중 "업무와 먼 기록(바깥 기사·해외 사례·외국 단체 소개 등 참고 자료)" 의심 목록 — 읽기 전용 확인용 (select만).
-- LEDGER-첫화면정리 PR 2. 사용: Supabase SQL Editor에 붙여 넣어 실행 → 결과 목록을 보고, 원장 화면에서 기록을 열어
-- ⋯ [틀린 기록으로 표시] → '원장에 둘 일이 아니에요'로 직접 폐기한다(이 파일은 아무것도 바꾸지 않는다. insert/update/delete/함수 호출 없음).
-- 자동 기록 지시문·거르기 규칙을 고치기 전에 이미 들어온 기록이 대상이다. 고치거나 지우지 않는다.
-- 개인정보·비밀값은 이 파일에 없다(결과는 명진 화면 SQL Editor에만 보인다).
--
-- 보는 법(열):
--   suspect_score  의심 점수(높을수록 먼저). 아래 네 가지를 센다. 0이어도 자동 기록이면 목록에는 나온다(맨 아래).
--     +2 담당조직·Web2 프로젝트·Web2 사업 보고에 연결된 곳이 하나도 없음(우리 업무에 닿는 고리가 없음)
--     +1 근거 출처가 업데이트(basket)·노트(note)뿐(담당조직 기록·사업 보고·프로젝트 기록 근거가 없음)
--     +1 제목·요약에 기사/해외 소식 말투(기사·보도·뉴스·해외·외국·글로벌·발표·공개·출시)
--     +1 제목에 영어 대문자 이름이 두 번 이상(외국 단체·회사 이름 모양)
--   orgs / source_kinds  연결된 원장 조직 이름들 / 근거 출처 종류들(basket, note, work, meeting, org_update, project_update)
-- 필요하면 아래 주석 한 줄을 풀어 특정 워크스페이스만 본다.

with auto_records as (
  select r.id, r.workspace_id, r.ledger_id, r.kind, r.title, r.summary, r.date_start, r.validity, r.created_at
  from public.app_ledger_records r
  where r.validity in ('current', 'needs_check', 'fulfilled')
    and r.scope = 'work'
    and exists (
      select 1 from public.app_ledger_record_changes c
      where c.record_id = r.id and c.workspace_id = r.workspace_id and c.route = 'auto' and c.action = 'created'
    )
    -- and r.workspace_id = '<워크스페이스 id>'
),
link_info as (
  select a.id as record_id,
         string_agg(distinct o.name, ', ') filter (where o.name is not null) as orgs,
         count(*) filter (where l.target_organization_id is not null or l.target_project_id is not null or l.target_meeting_id is not null) as work_links
  from auto_records a
  left join public.app_ledger_links l on l.record_id = a.id and l.workspace_id = a.workspace_id
  left join public.app_ledger_organizations o on o.id = l.target_organization_id and o.workspace_id = a.workspace_id
  group by a.id
),
source_info as (
  select a.id as record_id,
         string_agg(distinct split_part(s.location, ':', 2), ', ') filter (where s.location like 'web2:%') as source_kinds,
         count(*) filter (where s.location like 'web2:org_update:%' or s.location like 'web2:meeting:%' or s.location like 'web2:project_update:%') as team_sources
  from auto_records a
  left join public.app_ledger_record_sources rs on rs.record_id = a.id and rs.workspace_id = a.workspace_id
  left join public.app_ledger_sources s on s.id = rs.source_id and s.workspace_id = a.workspace_id
  group by a.id
)
select
  (case when coalesce(li.work_links, 0) = 0 then 2 else 0 end
   + case when coalesce(si.team_sources, 0) = 0 then 1 else 0 end
   + case when (a.title || ' ' || a.summary) ~ '(기사|보도|뉴스|해외|외국|글로벌|발표|공개|출시)' then 1 else 0 end
   + case when array_length(regexp_split_to_array(a.title, '[A-Z][A-Za-z0-9-]{1,}'), 1) > 2 then 1 else 0 end) as suspect_score,
  a.ledger_id,
  a.kind,
  a.title,
  a.date_start,
  a.created_at::date as recorded_on,
  li.orgs,
  si.source_kinds
from auto_records a
left join link_info li on li.record_id = a.id
left join source_info si on si.record_id = a.id
order by suspect_score desc, a.created_at desc
limit 500;
