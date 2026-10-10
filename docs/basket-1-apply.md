# 📱 폰 경로 C — BASKET-1 적용 대기

무엇이 바뀌나: 메모에 첨부·보관·AI 제외·처리정보 칸과 자료실 연결 칸을 추가한다. 기존 글·연결·화면은 그대로다.
잘못되면: 저장이나 연결이 거절될 수 있다. 적용 중 오류는 한 묶음 전체를 취소하며, 새 기능은 열지 않는다.
되돌리는 법: 새 칸이 아직 사용되지 않았다면 준비한 rollback을 승인받아 실행한다. 이미 쓴 내용이 있으면 먼저 보존하고 별도 복구안을 만든다.

## 범위와 정지 지점

시작 `origin/main`: `cec93f25d1056f08fdc75cd8d6d8b269c09632fa`(#468), 2026-10-10 원격 fetch 확인. 브랜치 `codex/basket-1-db`, [PR #469](https://github.com/mj880616/work/pull/469). **클라우드는 SQL·문서·로컬 테스트·PR까지만 준비했고 운영 DB 접속·적용·Supabase 로그인은 하지 않았다. 운영 적용 직전 정지 상태다.** merge는 커맨드센터에서 결정한다.

기준은 [AGENTS.md §6·§7·폰 경로 C](../AGENTS.md), [설계 3.1·4·8~11절](basket-design.md)이다. `rtw_*`와 관련 객체, Edge·화면·workflow, 기존 조직 기록 표를 바꾸지 않는다. `db push`·`migration repair`는 영구 금지다. BASKET-2는 이 DB의 운영 사후 판정 전 활성화하지 않는다.

## 적용 파일과 순서

모든 SQL은 PR merge 뒤 **승인한 main SHA의 파일 원문**을 사용한다. 채팅·터미널에서 잘린 출력으로 적용하지 않는다.

| 순서 | 파일 | 판정 |
| --- | --- | --- |
| 1 | [상세 snapshot](20261010120000_basket1_notes_links.snapshot.sql) | SELECT만. 현재 칸·기본값·제약·인덱스·RLS·표/열 grant를 저장·내보내기. 원문 데이터는 출력하지 않는다. 커맨드센터가 아래 기대값 및 기존 migration 원문과 대조한다. |
| 2 | [사전 확인](20261010120000_basket1_notes_links.precheck.sql) | SELECT만, 16행 요약. 폰 화면에는 요약 결과를 캡처한다. 표별 5개 지문과 기존 notes/links 행 수, 위반·기록을 확인한다. |
| 3 | 커맨드센터 실행 승인 | snapshot·행 수 캡처·rollback 파일 확보 후 승인. 불일치·누락이면 실행하지 않는다. |
| 4 | [migration](../supabase/migrations/20261010120000_basket1_notes_links.sql) | 파일 1개, 독립 `begin;`~`commit;`. version `20261010120000`, name `basket1_notes_links`. 조각 사이 확인은 해당 없음. |
| 5 | [사후 확인](20261010120000_basket1_notes_links.postcheck.sql) | SELECT만, 13행. `baseline`의 네 NULL을 사전 notes 수·links 수·notes/grants 전체 값·record_links/grants 전체 값으로 바꿔 실행. **전부 `예`**여야 한다. |
| 복구 | [같은 이름 rollback](20261010120000_basket1_notes_links.rollback.sql) | 아래 사용 조건을 지키고 별도 승인 후 실행. |

사후 `baseline` 입력 예(로컬 합성 데이터일 뿐 운영 값 아님): `values (1::bigint,6::bigint,'1:c1e488b30589fa3c45d7d80fe02ddcad'::text,'1:c1e488b30589fa3c45d7d80fe02ddcad'::text)`. NULL을 남기면 grant/행 수 결과는 `아니오`다. 사용자가 수치를 모르는 채 통과시킬 수 없다. 사전·사후 사이 조직·할 일 입력을 잠시 멈춰 행 수를 정확히 대조한다.

### 사용자 실행 4단계

1. SQL Editor **새 쿼리 창(+)**에 해당 main 파일 전체를 붙여 넣는다.
2. 대상 프로젝트(공유 운영 프로젝트인지 본인이 확인), 첫 줄 `begin;`, 마지막 줄 **`commit;`**를 확인한다. 확인 SQL은 첫 `select`/`with`와 파일 끝을 확인한다.
3. 커맨드센터 승인한 적용 또는 복구 SQL만 실행한다. **Success**를 확인한다.
4. 결과를 캡처한다. 사후 확인 캡처를 커맨드센터에 넘겨 판정을 받는다.

붙여넣기 잘림·오류·Success 불명일 때 반복 실행하지 않는다. 새 창에서 사후 확인으로 기록/스키마를 확인한다. 오류가 난 같은 창의 열린 트랜잭션은 명시적으로 `rollback;`으로 종료한 뒤 사전 확인부터 재승인한다. 사후 확인 실패도 자동 rollback을 뜻하지 않는다.

## 기대 snapshot과 결과

상세 정의 기준: [메모·연결 최초 migration](../supabase/migrations/20260927103344_task_impl2_notes_record_links.sql)과 [회의 대상 확장](../supabase/migrations/20260928123601_task_meeting_followup_record_links.sql). 아래 지문은 이 두 원문을 실제 로컬 Postgres 17.6에 적용해 만든 **비운영 기준 snapshot**이다. 운영 조회 결과로 주장하지 않는다. 지문은 `개수:md5(정렬한 정의)`이며 RLS 값·정책 조건·역할, 표 grant·개별 열 grant까지 포함한다. DB 버전·표 소유자·ACL 순서 차이도 지문에 영향을 줄 수 있다. 차이는 자동 무시하지 않고 상세 snapshot을 커맨드센터가 대조해 승인한 SQL/기준을 갱신해야 한다.

| 사전 항목 | 기대값 |
| --- | --- |
| notes/columns (6칸) | `6:8c636706051b60212bb9297f4233158b` |
| notes/constraints | `3:2c20eb8d93c35da90e9ba319b5307c9f` |
| notes/indexes | `1:28e71ef28b6e12383caea909b8f4b05c` |
| notes/RLS/policy | `2:7723636ecf5420f1a0a7d2e8ae6dd743` |
| record_links/columns (13칸) | `13:2523b639f7f6393bd62e957f0b1a1be7` |
| record_links/constraints | `13:d111072af0aa8a94465e510c7d06e72e` |
| record_links/indexes | `7:a471b1af65c447e9299d51feaee04d3b` |
| record_links/RLS/policy | `2:5f391820edca6cba65231cb386940f2e` |
| notes/grants・record_links/grants | 로컬 기준 각각 `1:c1e488b30589fa3c45d7d80fe02ddcad`. 실제 사전값을 별도 보존해 사후값과 동일함을 확인. anon·PUBLIC 없음, authenticated SELECT/INSERT/UPDATE/DELETE만(재위임 없음), 열 grant 없음. 기존 service_role 권한 보존. |
| rows (notes/links) | 실제 현재 행 수를 보존. 과거 0건·조직 기록 3건을 가정하지 않는다. |
| raw violations (=0) | **0**. 새 첨부는 빈 배열이므로 기존 글이 모두 1~20,000자인지 검사. 공백·개행도 글자 수에 포함한다. |
| target violations (=0) | **0**. 기존 대상 정확히 하나. |
| missing prerequisites (=0) | **0**. 최초 메모/연결 및 회의 확장 migration version/name 기록이 각각 1행. |
| this version (=0) | **0**. 이미 적용된 경우 재실행 중단. |
| recent migrations | 최근 3개 version/name. RTW 기록도 나올 수 있으며 수정하지 않는다. |

사후 13개 결과는 모두 **예**: notes 새 칸/기본값/NOT NULL(10칸), 원문·첨부·metadata 제약, notes 정책·인덱스 보존, links 문서 칸(14칸)·FK CASCADE·정확히 한 대상/중복 제약·인덱스·owner 정책, 양쪽 grant 지문 보존, 기존 행 수 불변, 새 칸 미사용, migration version/name 정확히 1행. 상세 정의 전체를 지문으로 비교하므로 같은 이름의 틀린 제약·정책도 통과하지 않는다.

## DB와 서버 검증 경계

- `attachments jsonb NOT NULL DEFAULT []`: 메모당 **20개**(이번 구현의 기술 상한), 각 객체의 키는 `drive_file_id`, `file_name`, `mime_type`, `size_bytes` 네 개만. ID는 영숫자/`_`/`-` 1~255자, 이름 1~255자, MIME은 공백 없는 type/subtype(각 1~127자), byte는 정수 1~104857600(100 MiB). 파일 본문·base64는 거절한다. 파일명·MIME을 신뢰해 실행하거나 파일 형식을 확정하지 않는다.
- 실제 Drive 파일 존재·소유·접근·휴지통 상태, 같은 메모의 같은 Drive ID 중복, 내용/MIME 일치 및 업로드 검증은 **서버 몫**이다. 이 단계에 서버 구현을 넣지 않는다. JSON 구조 검사를 실제 파일 검증으로 설명하지 않는다.
- 원문은 `raw_text NOT NULL`, 20,000자 이하이며 **1자 이상 또는 첨부 1개 이상**. 첨부만 저장할 때 빈 문자열을 허용하고 자동 임시 글자를 넣지 않는다. 기존 공백·개행 보존 및 길이 계산을 유지한다. 공백만 있는 내용의 사용자 입력 판정은 후속 서버에서 하며 기존 데이터를 임의로 고치지 않는다.
- `metadata jsonb NOT NULL DEFAULT {}`: 객체만. 허용 키·타입·중첩·개수·크기·옛 ID·처리정보 신뢰성은 서버에서 제한한다. 본문 사본을 넣지 않는다.
- `archived_at timestamptz NULL`, `ai_export_allowed boolean NOT NULL DEFAULT true`. 보관·AI 제외만 저장. 표시 상태는 설계 4절대로 계산하며 notes에 status를 추가하지 않는다.
- 기존 links `status`=`suggested/confirmed`(기본 confirmed), `report_kind`=`business/organization` 또는 NULL은 이미 설계와 일치해 **변경 없음**. 자료 연결에 가짜 `library` report_kind를 만들지 않는다. 제안→확정 권한·기존 confirmed의 재제안 방지는 후속 서버 처리다.
- 문서 FK·대상/중복 제약·document 부분 인덱스 추가, owner-only USING 유지, WITH CHECK에 같은 workspace·owner 문서 검사를 추가한다. Google 출처/tasklist/task state와 기존 프로젝트·조직·회의·메모 검사를 그대로 유지한다. grant·새 함수·함수 실행권한은 추가하지 않는다. 기존 authenticated 표 CRUD로 새 칸을 다루되 같은 RLS를 거친다.

## rollback 사용 조건

적용 직후 새 칸이 기본값 그대로이며 문서 연결이 없는 경우만 쓴다. 잠금 안에서 검사 후 원래 raw_text·3종 대상·5칸 unique 제약과 owner 정책을 복원하고 새 칸·새 인덱스·이번 migration 기록만 제거한다. 옛 데이터·기록은 지우지 않는다. 원래 grants와 notes 정책은 건드리지 않는다.

첨부·metadata·보관·AI 제외·문서 연결·첨부만 있는 메모 중 하나라도 있으면 rollback은 **`BASKET-1 rollback blocked`로 중단**한다. 통과시키려고 신규 자료를 삭제하거나 설정을 초기화하지 않는다. 새 입력을 잠시 멈추고 원문/첨부 ID/처리정보/확정 이력/새 연결을 비공개 백업·snapshot으로 확보한 뒤 커맨드센터에서 별도 데이터 복구 계획을 승인한다. 원문 1자 제약을 맞추려고 임시 글자를 넣지 않는다. rollback 뒤 상세 snapshot과 사전 확인으로 원래 스키마·행 수·grant 지문 및 this version=0을 대조한다.

## 담당조직 기록 이관 계획 — BASKET-2 전용, 이번에는 실행 안 함

원장 26(감사)·24(canonical 구조 통합)는 아직 대기다. 이 스키마 준비에서는 조직 ID·담당 배정·동기화 트리거를 바꾸지 않는다. **BASKET-2 컷오버 전에** 26 감사 결과와 24 범위를 함께 확인해 현재 조직 ID→canonical 조직 ID 대응을 확정한다. 그 결과 없이 조직 매핑을 추정하지 않는다.

옛 ID는 `metadata.legacy_suborganization_update_id`(문자열), 출처 표는 `metadata.legacy_source='app_suborganization_updates'`로 남긴다. 조직·workspace는 옛 행의 organization을 canonical 대응표에 조인해 결정한다. 원문·occurred_at·created_at·updated_at을 그대로 보존하고 `ai_export_allowed=true`를 기본으로 하되 민감한 기록의 제외 여부는 이관 승인 때 확인한다. 실제 열/NULL/시각 정의는 운영 SELECT snapshot으로 재확인한다. 빈 글·20,000자 초과·매핑 누락·중복 ID·기존 매핑과 원문/시각 차이는 모두 컷오버 중단 조건이다. **충돌(이관 초안만): 기존 조직 화면은 raw_text 외 detail_text도 표시한다.** 아래 raw_text 단독 대응으로 nonempty detail_text를 빠뜨리면 기록 보존 원칙과 충돌하므로 그 부분은 이관하지 않는다. BASKET-2에서 detail_text 건수·의미·원문 중복 여부를 감사해 보존 대응을 확정해야 한다. metadata에 본문 사본을 넣는 우회도 금지한다. 값이 하나라도 있으면 아래 guard가 전체 초안을 중단한다. 이번 스키마 확장에는 영향 없다.

다음은 **문서 안의 미실행 SQL 초안**이다. migration/적용 파일에 포함되지 않는다. 아래 `approved_org_map`은 조직 ID 변경이 없다고 감사·승인한 경우의 identity 대응 초안이다. 24에서 ID가 바뀐다면 승인한 실제 대응으로 바꾼다. `approved_source`의 시각 칸도 운영 snapshot에서 대조한다. 옛 표에 updated_at이 없으면 created_at을 기술적 updated_at으로 사용하고 metadata에 원래 수정 시각 칸이 없었다는 표시를 남긴다. 지금은 대응표를 만들거나 옛 표를 잠그지 않는다.

```sql
-- DRAFT ONLY. Identity organization map requires 26/24 approval first.
-- Execute as ONE transaction, with app input paused and both old/new tables locked.
-- Before writes: reject source duplicates, missing mapping, invalid raw_text,
-- and existing metadata ID matches whose workspace/text/timestamps differ.
-- A안 결정(2026-10-10): raw_text + 빈 줄 + '상세: ' + detail_text, 20,000자 초과 시 이관 중단·보고
-- BASKET-2b에서 감사·이관 승인 후 반영. 아래 detail_text 차단 guard와 초안은 계속 미실행.
-- Insert only missing notes; never overwrite previously migrated/edited notes.
do $draft$
begin
  if exists (select 1 from public.app_suborganization_updates u
             where coalesce(to_jsonb(u)->>'detail_text','') <> '') then
    raise exception 'BASKET-2 cutover blocked: approve detail_text preservation mapping first';
  end if;
end
$draft$;
with approved_org_map as (
  -- Only valid when audit approves keeping all existing organization IDs.
  select id as old_organization_id,id as organization_id,workspace_id
  from public.app_suborganizations
), approved_source as (
  select u.id,m.workspace_id,m.organization_id,u.raw_text,u.occurred_at,u.created_at,
         coalesce((to_jsonb(u)->>'updated_at')::timestamptz,u.created_at) as updated_at,
         (to_jsonb(u)->>'updated_at') is not null as had_updated_at
  from public.app_suborganization_updates u
  join approved_org_map m on m.old_organization_id=u.organization_id
), inserted as (
  insert into public.app_notes(workspace_id,raw_text,occurred_at,created_at,updated_at,metadata)
  select s.workspace_id,s.raw_text,s.occurred_at,s.created_at,s.updated_at,
         jsonb_build_object('legacy_source','app_suborganization_updates',
                            'legacy_suborganization_update_id',s.id::text,
                            'legacy_had_updated_at',s.had_updated_at)
  from approved_source s
  where not exists (
    select 1 from public.app_notes n
    where n.metadata->>'legacy_source'='app_suborganization_updates'
      and n.metadata->>'legacy_suborganization_update_id'=s.id::text)
  returning id,workspace_id,metadata
), mapped as (
  select id,workspace_id,metadata from inserted
  union all
  select id,workspace_id,metadata from public.app_notes
  where metadata->>'legacy_source'='app_suborganization_updates'
)
insert into public.app_record_links(workspace_id,note_id,organization_id,status,report_kind)
select m.workspace_id,m.id,s.organization_id,'confirmed','organization'
from mapped m join approved_source s
  on m.metadata->>'legacy_suborganization_update_id'=s.id::text
 and m.workspace_id=s.workspace_id
on conflict on constraint app_record_links_unique do nothing;
-- Then require exactly one mapped note and confirmed/organization link per old ID;
-- pre-existing suggested/wrong report_kind links stop cutover rather than hiding mismatch.
```

재실행은 옛 ID로 노트 INSERT를 생략하고 연결은 기존 unique 제약으로 중복을 막는다. notes의 metadata에는 unique가 없으므로 **쓰기 중단+단일 트랜잭션+옛/새 표 잠금**을 필수로 둔다. 두 이관 작업의 동시 실행을 허용하지 않는다. 충돌 연결을 DO NOTHING으로 숨겼다고 성공 판정하지 않고 마지막 정확히 1건·confirmed/organization 대조를 요구한다. 승인한 이관 대상 ID 목록·대응표·건수·원문/시각 대조 결과는 비공개로 보관하고 공개 저장소에 운영 ID나 원문을 기록하지 않는다.

컷오버 순서: 26·24 감사/ID 대응 승인 → 최신 옛 행 snapshot·백업 → 입력 잠시 중단 → 최종 증분 포함 잠금 이관 → 옛 ID별 노트/조직 확정 연결 1건·원문·시각·건수 대조 → 조직 직접 입력/기록 목록/홈 이번 주 업데이트/최근 조직 선택/Drive 조직 사본을 같은 변경 묶음으로 전환 → 옛 표 쓰기 중단·새 입력 개방 → 재실행·새 입력·읽기 회귀 확인. 이중 쓰기·옛 표 삭제는 하지 않는다.

실패하면 새 입력을 열지 않고 옛 경로로 돌아간다. 새 입력 개방 후 문제라면 신규 메모도 보존해 별도 복구한다. BASKET-1 rollback을 이관 이후 복구 수단으로 쓰지 않는다. 이번 단계에는 이관 실행·옛 표 쓰기 중단·화면 전환이 전혀 없다.

## 로컬 검증

기존 `tests/auth-handoff`의 embedded-postgres 17.6 새 임시 클러스터(127.0.0.1만)에서 기존 두 migration → 이번 적용 → rollback → 재적용을 실제 실행한다. 의존 표·owner helper·문서 RLS는 기존 테스트 방식의 합성 fixture이므로 운영 전체 스키마 재현이라고 주장하지 않는다. 기존 행/시각·ACL 불변과 원래 칸/제약/인덱스/정책 완전 복원, 새 칸 사용 후 rollback 거절·원자성, 잘못된 JSON/범위·다른 workspace·다른 사용자·anon/PUBLIC 거절, 기존 할 일·메모→프로젝트/조직/회의 및 문서 연결·중복·cascade, 사전/사후 SELECT SQL도 실행한다.

실행: `cd tests/auth-handoff && npm ci --no-audit --no-fund && npm test`, 루트에서 `node --test tests/security/*.test.mjs`. 정적 테스트도 SELECT 전용·transaction 끝·migration 기록·금지 영역/ACL 변경 없음·폰 migration 길이를 검사한다. CI 및 최종 SHA는 PR 완료 보고를 따른다.

검증 결과(2026-10-10): 마지막 전체 로컬 DB 실행 **34/34**, 보안 정적/node **269/269**, `git diff --check` 및 새 테스트 JS 구문 검사 통과. BASKET-1 적용→rollback→재적용과 기존 Google 할 일/메모→회의·프로젝트·조직 연결 회귀 통과. 검토에서 찾은 JSONPath lax 중첩 배열 우회를 strict 최상위 객체 검사로 수정하고 중첩/혼합 배열·20개 상한 경계 재검증.

범위 밖 관측: 전체 병렬 DB 테스트 중 기존 TASK-29와 record-links가 종료 시 `terminating connection due to administrator command`로 각각 실패한 실행이 있었다. 시작 SHA의 clean main 전체 DB suite도 4번째 실행에서 record-links의 같은 종료 오류를 재현했다(첫 3회 통과). TASK-29는 clean main 단독 30회 모두 통과해 그 파일의 단독 재현은 되지 않았다. 기존 테스트를 수정·삭제·건너뛰지 않았으며 마지막 전체 재실행은 통과했다. 새 BASKET-1 테스트는 pg client의 실제 end까지 기다린 뒤 임시 클러스터를 정지한다. CI 재발 가능성은 별도 위험으로 보고한다.

## 적용 기록(2026-10-10)

- 사전 확인 16줄 모두 기대값과 일치(메모 0건·연결 7건, 위반 0, 선행 기록 정상, 이번 version 없음).
- 첫 시도 1: 사전 확인이 남은 같은 창에 붙여넣어 두 SQL이 섞임 → 구문 오류로 실행 전 중단, 변경 없음.
- 첫 시도 2: 글자 일부가 선택된 상태라 버튼이 “Run selected” → 일부만 실행, 사후 확인에서 새 칸 없음 확인. 사전 확인 재실행 결과가 처음과 완전히 같아 변경 없음 확인.
- 세 번째 실행: 새 탭·선택 해제(버튼 “Run”)·begin;/commit; 확인 후 Success. 사후 확인 13항목 모두 “예”.
- 폰 경로 C 교훈: 단계마다 새 탭(＋), 붙여넣은 뒤 입력칸 끝을 한 번 눌러 선택 해제하고 버튼이 “Run”인지 확인, 결과는 Export의 CSV 복사로 텍스트 전달.
