# 사용자 승인형 DB workflow — 2단계

📱 폰 가능 — 사용자 GitHub 앱 또는 브라우저에서 실행·승인한다. Codex·AI는 파일·테스트·PR만 준비한다.

## 목적과 승인 경로

운영 DB는 RTW와 공유하므로 기존 migration 일괄 적용 도구를 사용하지 않는다. main의 지정 migration 한 개만 검토·시험·백업 후 적용하는 버튼이다. 임의 SQL·ref 입력은 없다. `supabase db push`·`migration repair`·`supabase link`를 사용하지 않는다. 규칙 원문은 AGENTS.md이며 기존 SQL Editor·폰 경로 C는 유지한다.

- workflow: `.github/workflows/db-migration-apply.yml`, `workflow_dispatch`만.
- 실행 코드: main 고정. plan이 main SHA를 기록하고 run은 그 SHA를 사용한다. 다른 branch에서 dispatch하면 입력 검증이 실패한다.
- 승인: 커맨드센터 승인 → 사용자 dispatch → plan summary의 SQL 전문·main SHA 확인 → 사용자 `production-edge` 승인.
- 열쇠 A안(2026-10-10): 기존 environment `production-edge`의 비밀값 `SUPABASE_ACCESS_TOKEN`과 변수 `SUPABASE_PROJECT_REF`를 그대로 사용한다. 새 environment·새 비밀값·토큰 재입력은 필요하지 않다. 웹 세션·Codex 클라우드에 운영 토큰을 등록하지 않는다.
- 기존 `production-edge`에 필요한 승인자가 설정되어 있어야 승인 대기가 작동한다. 승인자 설정은 사용자가 관리하며 이번 PR은 설정을 변경하지 않는다.

공식 [SQL query endpoint](https://supabase.com/docs/reference/api/v1-run-a-query)는 `POST https://api.supabase.com/v1/projects/{ref}/database/query`다. [인증 문서](https://supabase.com/docs/reference/api/introduction)에 따라 Bearer access token을 헤더에 넣는다. 공개 문서의 명시적 트랜잭션 보장 대신 사용자 실행 결과를 근거로 2단계를 준비했다. 엔드포인트는 experimental/Beta이므로 이번 성공은 미래 동작의 영구 보장이 아니다.

2026-10-10 사용자 실측: check **#1 성공**(최근 기록 `20261010120000 basket1_notes_links`), tx-probe **#2 취소 보장 예·오류 시 전체 취소 예**, 시험 표 잔존 없음. Codex가 운영에서 측정한 결과가 아니다. 이후 probe가 아니오·미확인이라면 적용을 멈추고 B안(별도 실행 경로)을 재검토한다.

## 승인 한 번 흐름 (DB-승인형확장, 2026-10-21)

목표: 운영 DB 적용을 **커맨드센터(CC)가 workflow 시작 → 사용자 `production-edge` 승인 한 번**으로 끝낸다. environment·비밀값(`SUPABASE_ACCESS_TOKEN`)·변수(`SUPABASE_PROJECT_REF`)는 그대로이며 새 비밀값은 없다.

### 입력

- mode `dry-run` 또는 `apply`, version 칸에 **migration 파일 이름**(`<version>_<name>.sql`) 또는 14자리 version. 파일 이름이면 저장소의 실제 이름과 같아야 한다.
- 짝 파일 5개가 모두 있어야 한다: `docs/<version>_<name>.precheck.sql`·`.snapshot.sql`·`.postcheck.sql`·`.rollback.sql`·`.summary.md`. 하나라도 없으면 승인 전(plan)에서 거절한다(확장 규칙). 기존 엄격 규칙만으로 통과하는 파일은 precheck에 `-- expect:` 줄이 있고 5개가 모두 있을 때만 같은 흐름으로 돈다(그 밖에는 이전 흐름 그대로).

### 순서 (apply, 승인 뒤 한 번의 실행)

1. 사전 기록 확인: 같은 version이 이미 있으면 **멈춤**(쓰기 없음).
2. precheck(`read_only`) 실행 → 기대값 검사. 파일 머리 주석의 `-- expect: <항목> = <값>` 줄이 기준이고, 줄이 없는 항목은 모두 `예`여야 한다. 값은 `예`·`아니오`·정수·`a~b` 범위·`기록`(값만 남기고 판정 안 함). `-- expect: policy * = 기록`처럼 끝의 ` *`는 그 이름으로 시작하는 항목 전부. 하나라도 다르면 **멈춤**(쓰기 없음).
3. snapshot(`read_only`) 실행 → 결과를 workflow artifact `db-snapshot-<run_id>`(30일 보관)로 저장. **공개 저장소라 artifact도 공개로 본다.** 그래서 snapshot SQL은 승인 전에 시스템 카탈로그(pg_class·pg_policy·pg_proc·information_schema 등)와 migration 기록만 읽는지 검사한다. 앱 표·사용자 함수·통계 보기(pg_stats 등)·`*_to_xml`을 읽으면 거절한다. summary에는 행 수와 SHA256만 쓴다.
4. 시험 적용: 파일의 마지막 `commit;`만 `rollback;`으로 바꿔 실행 → 기록 없음 확인 → precheck를 다시 돌려 값이 그대로인지 확인. 다르면 **멈춤**(실제 적용 안 함).
5. 기존 표 백업(이전과 같음, 이번 파일이 만든 새 표는 제외).
6. 적용: 파일 원문(자체 `begin;`…`commit;`) 한 번 → 기록 1행 확인.
7. postcheck(`read_only`): `예/아니오` 항목은 `예`, 그 밖의 값은 `-- expect:` 줄 또는 **precheck의 같은 이름 항목과 같은 값**이어야 한다. 비교 기준이 없으면 실패. 실패하면 **멈춤**.
8. job summary에 각 단계 결과와 **되돌리기 안내**(snapshot artifact 이름·rollback 파일 경로·SQL Editor 순서)를 남긴다. **rollback은 자동으로 실행하지 않는다.** 되돌릴지는 사용자가 정한다.

dry-run은 1~4단계만 한다(실제 적용 없음). 요청 재시도는 없다.

출력 제한: precheck·postcheck의 값 중 집계(숫자·해시·예/아니오·migration 기록)가 아닌 값은 summary에 `#` + SHA-256 앞 16자로만 표시한다(비교는 메모리 안 원래 값으로). 항목 이름은 100자 이하 글자·숫자·공백·`_/()=:+.,·-`만. 토큰·프로젝트 값이 들어 있으면 실패.

### 승인 없는 dry-run에 대해

dry-run도 운영 DB에 접속해야 하고, 그 열쇠(`SUPABASE_ACCESS_TOKEN`)는 승인자가 걸린 `production-edge` environment에만 있다. "새 비밀값 없음·GitHub 설정 변경 없음" 조건에서는 승인 없이 운영 dry-run을 돌릴 수 없다. 대신 (1) **승인 전 plan 단계**가 비밀값 없이 정적 검사·짝 파일·snapshot 검사·SQL 전문 표시를 하고, (2) **apply 한 번의 승인 안에 dry-run이 먼저 들어 있다**(4단계). 따로 dry-run만 보고 싶으면 mode `dry-run`으로 실행하되 승인이 한 번 더 필요하다. 승인 없는 운영 dry-run을 원하면 승인자 없는 별도 environment에 같은 토큰을 넣어야 하는데(사용자 설정), 그러면 저장소 쓰기 권한이 있는 누구나 운영 DB에 시험 쓰기(잠금 포함)를 보낼 수 있으므로 권하지 않는다.

### 확장 규칙 (엄격 규칙이 거절한 apply/dry-run 파일)

엄격 규칙(아래 "2단계 모드와 파일 검사")을 먼저 적용하고, 거절되면 확장 규칙(`scripts/ops/db-migration-expanded.mjs`)으로 다시 본다. 확장 규칙은 정책·표 권한·트리거·함수를 받되 **권한이 넓어질 수 있는 모양은 계속 거절**한다. 거절하면 plan summary에 고정 사유 한 줄만 쓴다(SQL·자료 없음).

허용: 새 public 표(같은 파일에서 RLS 켜기 필수), 인덱스, ALTER TABLE(아래 제외), 새 표에 대한 정책(대상 `authenticated`·`service_role`만), restrictive 정책(좁히기만 함), 새 표·새 함수에 대한 `authenticated`·`service_role` 권한 부여, 모든 REVOKE(좁히기), public·private 함수(언어 sql/plpgsql, 같은 파일에서 PUBLIC·anon 실행권 회수 필수, SECURITY DEFINER는 search_path 고정 필수), 이번 파일의 함수를 쓰는 public 표 트리거, 읽기 전용 DO 확인, WHERE 있는 UPDATE/DELETE, migration 기록 INSERT(마지막 문장, version/name 일치).

거절 목록(시험: `tests/security/db-migration-expanded.test.mjs`):

| 무엇 | 사유 코드 |
| --- | --- |
| anon·PUBLIC(또는 authenticated·service_role 밖 역할)에 표·열·함수·스키마 권한 부여 | `grant-anon-public` |
| 역할 멤버십 부여, 스키마 전체(`all tables in schema`)·schema·sequence 권한 | `grant-bulk` |
| WITH GRANT OPTION | `grant-option` |
| 이번 파일에서 만들지 않은 기존 표·함수에 권한 추가 | `grant-existing` |
| RLS 끄기·force 해제 | `rls-disable` |
| RLS를 켜지 않은 새 public 표(기본 anon 권한 노출) | `table-without-rls` |
| PUBLIC·anon 실행권 회수 없는 새·교체 함수(SECURITY DEFINER 포함) | `function-revoke-missing` |
| SECURITY DEFINER인데 search_path 고정 없음 | `function-definer-path` |
| 실행권 부여가 회수보다 먼저 | `function-grant-order` |
| 함수 본문의 DDL·권한 변경·동적 EXECUTE·세션 설정 | `function-body` |
| 기존 정책 ALTER, 또는 DROP POLICY가 아래 "정책 교체" 조건을 벗어남(짝 없음·표 바뀜·항상 참 조건·빈 식 등) | `policy-drop-alter` |
| 정책 교체의 rollback 파일에 원래 정책을 되살리는 DROP+CREATE 없음 | `policy-rollback` |
| 기존 표에 새 permissive 정책 | `policy-existing-table` |
| 정책 대상이 anon·PUBLIC이거나 대상 생략(기본 PUBLIC) | `policy-roles` |
| `using (true)`·`with check (true)` | `policy-true` |
| 트리거 끄기, 소유자 변경 | `trigger-disable`, `owner-change` |
| view·schema·sequence·type·ALTER FUNCTION·DROP(정책·함수·인덱스 등) | `unknown-statement` |
| drop table/schema·truncate·role·extension·default privileges·copy·call·dblink·파일 읽기·set role | `blocked-command` |
| CREATE TABLE … AS(자료 복사), WHERE 없는 UPDATE/DELETE, rtw_ 언급, 중간 commit | `create-table-as`, `where-missing`, `rtw`, `transaction-control` |
| 짝 파일 없음, snapshot이 카탈로그 밖을 읽음 | `pair-missing`, `snapshot-rows` |

### 정책 교체 (OPS-DB워크플로정책교체)

같은 파일 안에서 `drop policy <이름> on public.<표>;`로 지운 정책을 같은 이름·같은 표로 다시 `create policy`하는 교체는, 권한을 높이지 않을 때만 받는다. 새 정책은 이렇게 보인다.

- 정적 검사(plan 단계): 대상 역할이 `authenticated`만이고 `TO`가 있다(anon·PUBLIC·`service_role`·생략 거절). 명령(`FOR`)에 맞는 `USING`/`WITH CHECK` 식이 있고 비어 있지 않으며 `true`·`1 = 1` 같은 항상 참 조건이 없다. 지운 정책마다 다시 만드는 짝이 있어야 한다(없거나 이름·표가 다르면 거절). 짝 파일 5개가 모두 있어야 하고, rollback 파일이 같은 정책을 `drop policy` 뒤 `create policy`로 되살려야 한다(`policy-rollback`).
- 운영 비교(run 단계, 쓰기 전): 파일만으로는 "이전 정의"를 알 수 없으므로 승인 뒤 맨 처음에 읽기 전용으로 운영 `pg_catalog.pg_policies`에서 그 정책의 roles·cmd·permissive를 읽어 비교한다. 새 역할이 이전보다 넓지 않고(이전이 PUBLIC이면 그 안), 새 명령이 이전보다 넓지 않고(이전이 ALL이면 그 안, 아니면 같아야 함), permissive/restrictive가 같고, rollback 파일이 되살리는 정의가 운영의 이전 정의와 같아야 한다. 운영에 정책이 없거나 둘 이상이거나 읽기·형식 오류가 나면 거절하고 아무것도 쓰지 않는다. 운영 DB 쓰기는 늘지 않는다(읽기 1회 추가).
- 조건식 안 내용이 이전보다 좁은지는 자동 판정하지 않는다. 식 변경은 plan summary에 SQL 전문이 보이므로 커맨드센터가 diff로 검토한다.

정적 검사는 "더 좁아지는지"를 증명하지 못한다(예: 새 표 정책의 조건식 의미, SECURITY DEFINER 함수가 돌려주는 자료). 그래서 plan summary에 정책·권한·트리거·DEFINER 함수 수를 따로 표시하고 CC가 PR에서 본다. rollback 모드의 규칙은 바뀌지 않았다.

### 사용자 순서 (승인 한 번)

1. CC가 PR(migration·짝 파일 5개)을 merge하고, Actions **Approved DB migration workflow**를 branch `main`, mode `apply`, version 칸에 파일 이름으로 시작한다.
2. 사용자는 GitHub 알림(또는 Actions의 그 실행)에서 **Review deployments** → `production-edge` 체크 → **Approve and deploy**를 누른다. 누르기 전 plan summary의 일상어 3줄·파일 이름·`commit;`으로 끝나는 SQL을 보고 싶으면 같은 화면 위쪽 summary를 연다.
3. 실행이 끝나면 CC가 summary(사전 확인·시험 적용·적용·사후 확인 표)와 snapshot artifact를 확인해 결과를 알려 준다. 사용자가 할 일은 없다.
4. 실패하면 CC가 멈춘 단계와 되돌리기 필요 여부를 알려 준다. 되돌리기는 사용자가 결정하고, 결정하면 CC가 안내하는 rollback 파일을 SQL Editor 새 창에서 실행한다(자동 실행 없음).

### 바뀌지 않은 것

check·tx-probe, rollback 모드와 그 규칙, main 고정·plan의 SHA 기록, `production-edge` 승인, 비밀값·변수, 동시 실행 1개, 5분 제한, 요청 재시도 없음, 백업 방식, 짝 파일이 모자란 기존 migration의 이전 흐름, SQL Editor 경로(폰 경로 C).

## 1단계 모드 (동작 유지)

check·tx-probe에서는 version을 비운다. 값이 있으면 plan에서 거부한다.

### check

HTTP 요청 1회, `read_only: true`. 아래 SQL만 실행하며 결과의 version/name을 최대 3행 표시한다. 다른 응답 필드는 버린다. 3행 초과·잘못된 형식·HTTP/파싱 실패는 job 실패다.

```sql
select version,name from supabase_migrations.schema_migrations order by version desc limit 3;
```

### tx-probe

`<run_id>`는 GitHub 실행 ID(숫자)만 허용한다. 시험 표는 `private.ops_tx_probe_<run_id>`이며 정수 칸 1개, 데이터 없음. private 스키마가 없거나 권한이 없으면 실패하며 스키마·권한을 새로 만들지 않는다. 기존 운영 표·RTW 객체에는 쓰지 않는다.

요청1:

```sql
begin; create table private.ops_tx_probe_<run_id>(x int); rollback;
```

요청2(`read_only: true`):

```sql
select to_regclass('private.ops_tx_probe_<run_id>') is null as rolled_back;
```

`rolled_back=false`면 요청3으로 아래 정리를 실행하고 job 실패(`트랜잭션 취소 미보장`). 이 경우 요청4·5는 실행하지 않는다.

```sql
drop table if exists private.ops_tx_probe_<run_id>;
```

요청1·2 통과 시 요청4(의도한 중간 오류):

```sql
begin; create table private.ops_tx_probe_<run_id>(x int); select 1/0; commit;
```

요청5(`read_only: true`):

```sql
select to_regclass('private.ops_tx_probe_<run_id>') is null as rolled_back;
```

표가 남으면 동일한 `drop table if exists`로 정리 후 실패한다. 요청·확인 실패로 표 존재 여부가 불명확해도 같은 시험 표의 정리를 1회 시도한다. HTTP 요청 재시도는 없다. 정리 요청의 실패·응답 유실은 `수동 정리 필요`와 표 이름만 표시한다. GitHub 강제 취소·runner 종료로 정리 코드가 실행되지 않을 수도 있으므로 실행을 중도 취소했다면 같은 표를 커맨드센터에서 확인·정리한다. 위 조건부 정리 SQL도 승인 전 plan summary에 모두 표시한다.

## 판정 기준과 출력 제한

- **취소 보장: 예** — 요청1이 성공하고 요청2가 정확히 boolean `true` 1행을 반환.
- **오류 시 전체 취소: 예** — 요청4에서 SQLSTATE `22012` 또는 `division by zero` SQL 오류를 확인하고 요청5가 정확히 boolean `true` 1행을 반환.
- 취소·정리 SQL의 성공 응답은 반환 행이 없는 배열만 인정한다. 배열 안 SQL 오류(code/message 포함)나 예상 밖 결과도 실패다.
- 일반 인증·서버·통신 오류, 잘못된 응답, 요청4의 예상 밖 성공은 통과 근거가 아니다. 미실행·미확인도 `아니오`로 표시하며 이유를 함께 적는다.
- 두 판정 모두 `예`인 실행만 job 성공. 결과는 GitHub summary에 두 판정으로 표시한다.
- 토큰·프로젝트 변수를 `::add-mask::`로 등록한다. 응답은 메모리에서만 파싱하며 요청 본문·응답·원문 오류·스택을 로그나 artifact에 저장하지 않는다. check는 migration 메타데이터만, 2단계는 제한된 집계·해시·판정·백업 이름/행 수만 출력한다.
- 응답은 64 KiB, HTTP 요청은 30초, 각 job은 5분 제한. 고정 concurrency 그룹 1개·`cancel-in-progress: false`, GitHub 권한은 `contents: read`만.
- HTTP 공용 함수는 `scripts/ops/db-query.mjs`, 진입점은 `scripts/ops/db-workflow.mjs`, 2단계 파일 검사는 `db-migration-plan.mjs`, 실행·백업은 `db-migration-run.mjs`다. 외부 패키지 없이 Node fetch를 사용한다. 가짜 HTTP 서버와 로컬 임시 Postgres로 검증하며 개발 세션에서 운영 호출을 하지 않는다.

## 커맨드센터가 결과 읽는 법 (OPS-DB결과API, 2026-10-30)

run 화면 요약(`$GITHUB_STEP_SUMMARY`)은 REST API로 못 읽고 job 로그 다운로드는 클라우드 세션에서 막힐 수 있다. 그래서 `db-workflow.mjs`는 끝날 때(성공·멈춤·오류, plan 거절 포함) 판정 핵심을 job 주석 1개로도 낸다. 성공은 `notice`, 그 밖은 `error`.

1. `GET /repos/mj880616/work/actions/runs/{run_id}/jobs` → 이름이 `run`(plan 거절이면 `plan`)인 job의 `id`. job id가 곧 check-run id다.
2. `GET /repos/mj880616/work/check-runs/{id}/annotations` → `title`이 `DB <모드> <version> ok|stopped`인 항목의 `message`.
3. `message` 줄: 모드·version·결과(성공/멈춤/오류) · 단계 · 이유 · 오류(비밀값 없는 요약, 실행기 자체 검사 실패면 "원인 분류") · `아니오(사전|사후): 항목 · 값 · 기대` · 쓰기·적용 요청 전송 여부. 4000바이트를 넘으면 뒤 줄은 잘리고 요약에서 본다.

주석은 요약과 같은 거르기(safeLabel·display·escapeSummary·queryErrorSummary)를 거친 글만 담고, 마지막에 토큰·프로젝트 값이 들어 있으면 글 전체를 고정 문구로 바꾼다. 요약과 같이 공개 저장소 범위로 공개된다고 본다. SQL·행 값·자료 제목·프로필 글은 없다.

## 다음 DB 변경의 사용자 순서 (폰)

1. PR의 규칙 변경·SQL·테스트를 커맨드센터에서 검토하고 사용자 승인 후 merge한다. Codex는 merge하지 않는다.
2. 커맨드센터 실행 승인 뒤 GitHub 앱에서 저장소 Actions를 연다. 수동 실행·environment 승인 버튼이 보이지 않으면 폰 브라우저의 저장소 Actions를 사용한다(필요하면 데스크톱 사이트).
3. **Approved DB migration workflow** → **Run workflow** → branch **main**, mode **check**, version 비움 → 실행. plan의 main SHA·SQL을 읽고 **Review deployments**에서 `production-edge`를 승인한다. 최근 기록을 커맨드센터와 확인한다.
4. 새 변경의 migration·rollback·snapshot·summary·확인 SQL을 main에 준비하고 커맨드센터 승인을 받는다. mode **dry-run**, 새 변경의 **14자리 version**으로 실행한다. plan의 일상어 3줄·파일 경로·SHA256·SQL 끝 `rollback;`을 읽고 environment를 승인한다.
5. dry-run SQL 취소 완료·사후 version 없음·사전 집계 관측값 비교·선택된 원래 상태 검사 결과를 커맨드센터에 전달한다. `검증 미완료`·`수동 확인 필요`면 job은 성공 처리하지 않으며 snapshot/baseline 대조를 별도로 끝낸다. 실패·불명확하면 apply로 넘어가지 않는다.
6. 커맨드센터 적용 승인 후 **apply**와 같은 version으로 새 실행을 시작한다. 새 plan의 main SHA·파일 해시·원문 SQL 끝 `commit;`·백업 SQL을 다시 확인하고 environment를 승인한다. dry-run 이후 main 파일이 달라졌으면 새 파일로 dry-run부터 다시 한다.
7. 적용 후 백업 표 이름/행 수·사후 기록·판정을 확인해 전달한다. 실패·응답 유실·수동 확인 필요 때 자동 재실행하지 않는다. 적용되었을 수 있으므로 커맨드센터가 먼저 상태를 판단한다.
8. 되돌리기는 짝 rollback 파일을 커맨드센터에서 검토·승인한 뒤 **rollback**과 같은 version으로 실행·environment 승인한다. rollback도 직전 백업을 만든다. 새 칸 사용 등의 guard가 실패하면 데이터를 지워 통과시키지 않는다.

`20261010120000` BASKET-1은 이미 적용된 기록이다. 예시 summary가 추가되어도 apply/dry-run 대상이 아니며 사전 기록 검사에서 거부된다. tx-probe 재시험이 필요하면 커맨드센터 승인 후 version을 비워 실행하고 두 판정이 모두 예인지 확인한다.

## 2단계 모드와 파일 검사

- dry-run/apply: `supabase/migrations/<version>_*.sql` 정확히 1개. 첫 줄 `begin;`, 마지막 줄 `commit;`, 마지막 본문에 같은 version/name의 history INSERT 정확히 한 행. dry-run은 마지막 commit만 rollback으로 바꿔 1회 실행하고 version이 여전히 없는지 확인한다. 백업은 만들지 않는다.
- rollback: `docs/<version>_*.rollback.sql` 정확히 1개, 같은 이름의 migration과 summary 필수. begin/commit 안에서 해당 version의 history DELETE 정확히 한 행. 사전에 version/name 한 행이 있어야 한다. apply/dry-run은 version이 이미 있으면 거부한다.
- symlink·여러 파일·파일 짝 불일치·비정상 식별자·큰 파일은 승인 전에 거부한다. plan에는 일상어 3줄, 파일 경로·SHA256·줄 수, 위험 검사 결과, 실행 SQL 전문, 사전·사후 SQL과 백업 SQL을 표시한다. run은 plan이 기록한 main SHA를 checkout해 같은 검사를 반복한다.
- 읽기 guard(DO)에서 쓸 수 있는 함수는 if/exists/count/length/num_nonnulls/coalesce/to_regclass와, 저장된 제약 문구를 공백 무시로 비교하기 위한 순수 문자열 함수 `btrim`·`regexp_replace`뿐이다.
- SQL 주석(중첩 포함), 문자열·dollar block을 구분해 검사한다. 대소문자·줄바꿈·주석으로 명령을 숨길 수 없다. 일반 SQL 파서가 아니라 보수적인 허용 범위다. 동적 EXECUTE/CALL/COPY, 실행형 DO(읽기 guard 외), 중간 트랜잭션 종료, 대소문자 구분/Unicode 이스케이프 식별자 등 지원 밖 문법은 거부한다.

차단 목록(세 모드 공통): `drop table`, `drop schema`, `truncate`, 최상위 WHERE 없는 DELETE/UPDATE, `alter role`, `create/alter/drop extension`, 아래 예외 외 `grant … to anon|public|authenticated`, 주석 외 `rtw_` 언급, 허용된 history INSERT/DELETE 외 `supabase_migrations` 쓰기. DROP CASCADE·RLS 비활성화·파일/외부 호출(`dblink` 등)·동적 `EXECUTE`/CALL/COPY도 계속 거부한다. 권한 문법의 `GRANT/REVOKE EXECUTE`만 아래 조건에서 구분해 허용한다. 외래 키의 `ON DELETE CASCADE`는 DROP CASCADE와 구분한다.

### 제한된 함수 허용 (2026-10-11 사용자 결정 A안)

apply/dry-run에서 다음 조건을 모두 검사하며, 지원 밖 문법·본문 추출 실패는 승인 전에 거부한다.

1. `CREATE [OR REPLACE] FUNCTION public.<name>(...)` 또는 `private.<name>(...)`만 허용한다. 다른 스키마·`rtw_` 이름은 거부한다. 함수 이름·인자 형식까지 파싱해 overload별 서명을 기록한다. 함수명·인자 이름 등 식별자는 PostgreSQL의 이름 잘림을 피하도록 소문자 ASCII·63바이트 이하로 제한한다.
2. 정의에 `SECURITY INVOKER`와 `SET search_path`를 각각 정확히 한 번 명시해야 한다. SECURITY 생략·DEFINER·search_path 생략·중복 설정·`FROM CURRENT`는 거부한다. search_path 허용 값은 **빈 문자열 `''`**, **`public, pg_temp`(이 순서)** 두 개뿐이다. `SET search_path = ...`와 `SET search_path TO ...`를 인정하며 주석·공백은 구분한다. 다른 값·한 문자열 `'public, pg_temp'`는 지원하지 않는다.
3. `LANGUAGE sql` 또는 `plpgsql`만 허용한다. `AS $$...$$` 또는 `AS $tag$...$tag$` 본문 한 개만 추출한다. 문자열 본문·SQL 표준 BEGIN ATOMIC 본문·중첩 dollar block·닫히지 않은 구분자/문자열/주석은 거부한다. SQL 본문 마지막 세미콜론 생략은 인정한다. 본문에도 기존 위험 검사를 적용하며, 각 UPDATE/DELETE의 WHERE는 같은 명령의 최상위에 있어야 한다. 다른 명령·CTE 바깥의 WHERE로 대신할 수 없다. 본문 안 DDL·권한 변경·트랜잭션 종료·세션 SET·migration 기록 접근도 지원하지 않는다.
4. `GRANT EXECUTE ON FUNCTION <signature> TO authenticated`만 허용한다. 같은 파일에서 해당 서명의 함수를 먼저 정의하고, 해당 정의 뒤·GRANT 전에 `REVOKE ALL`(또는 `EXECUTE`) `ON FUNCTION <signature> FROM public, anon`을 해야 한다. 두 역할의 revoke는 별도 명령으로 나눌 수 있으며 두 개 모두 필요하다. 명시적 GRANT가 없어도 PostgreSQL 기본 PUBLIC 실행권한이 남지 않도록 모든 생성 함수에 두 역할 revoke를 요구한다. 다른 함수·다른 overload·anon/public/service_role 등 다른 역할·여러 역할·ALL 권한·WITH GRANT OPTION·스키마 전체 함수 GRANT는 거부한다.
5. `ALTER FUNCTION`, `COMMENT ON FUNCTION` 및 위 문법 외 함수 명령은 허용하지 않는다. 같은 서명을 한 파일에서 여러 번 정의하는 것도 거부한다. 정적 검사가 실제 운영의 기존 함수 본문·ACL·기본 권한·RLS를 증명하지는 않으므로 OR REPLACE와 권한은 커맨드센터에서 snapshot과 대조한다. OR REPLACE 뒤 함수 DROP은 이전 정의를 복원하지 않으므로 기존 함수 교체의 복구는 별도 승인과 snapshot 검토가 필요하다.

같은 파일에서 먼저 정의한 **정확한 함수 서명**에는 `REVOKE ALL`(또는 `EXECUTE`) `ON FUNCTION <signature> FROM service_role`도 추가로 허용한다. REVOKE 대상은 PUBLIC·anon·service_role 세 역할뿐이며 한 명령으로 함께 또는 별도 명령으로 회수할 수 있다. PUBLIC/anon 두 역할 회수는 계속 필수이고 service_role 회수는 선택적 추가 지원이다. 기존 두 역할만 회수하는 migration의 문법 호환성을 유지한다. `GRANT EXECUTE ... TO authenticated` 조건은 그대로이며 service_role·다른 역할·여러 역할에 대한 GRANT를 새로 허용하지 않는다. 다른 함수/overload·정의 전 권한 변경·스키마 전체 함수·짝 rollback의 권한 변경도 계속 거절한다.

[과거 read-only snapshot](security/sec1-auth-handoff-snapshot.md)은 postgres/public 신규 함수에 anon·authenticated·service_role EXECUTE가 기본 부여되는 hosted ACL을 기록한다. 현재 운영 기본값을 새로 확인한 기록은 아니다. 이 조건에서 신규 RPC를 authenticated 전용으로 준비할 때는 해당 함수에 service_role 회수까지 명시하고, 실제 적용 전 신규 서명 부재·default ACL/역할 상속·적용 뒤 실제 EXECUTE 권한을 대조한다. 정적 guard의 통과만으로 함수의 운영 신규 여부, service_role 기본/상속 실행권한 부재 또는 전체 authenticated-only 경계가 증명되지는 않는다. 기존 표·업로드 함수의 service_role 권한, role/default privileges, 정책은 이 지원으로 변경하지 않는다.

서명 문법은 인자 이름(선택)·`IN`(선택)·아래 기본 자료형 및 `[]` 배열 한 겹으로 제한한다. 별칭은 PostgreSQL에서 같은 자료형인 경우만 정규화한다. OUT/INOUT/VARIADIC·DEFAULT·형식 길이/정밀도·사용자 정의 자료형·schema-qualified 자료형·RETURNS TABLE은 지원하지 않으며 거부한다. 반환은 같은 기본형(또는 `void`), 선택적 SETOF만 인정한다. LANGUAGE/SECURITY/SET/AS 외 선택 사항은 STABLE/IMMUTABLE/VOLATILE 중 하나와 STRICT뿐이다.

자료형: `integer`(`int`, `int4`), `bigint`(`int8`), `smallint`(`int2`), `boolean`(`bool`), `text`, `uuid`, `json`, `jsonb`, `bytea`, `numeric`(`decimal`), `real`(`float4`), `double precision`(`float8`), `date`, `timestamp`(`timestamp without time zone`), `timestamptz`(`timestamp with time zone`).

```sql
create function public.ops_example(p_value integer) returns integer
language sql security invoker set search_path = ''
as $$select p_value + 1;$$;
revoke all on function public.ops_example(integer) from public, anon;
grant execute on function public.ops_example(integer) to authenticated;
```

위 두 역할 예시는 계속 지원한다. hosted 기본 실행권한까지 회수하는 신규 함수는 위 REVOKE 줄을 다음처럼 쓴다(같은 정의 뒤·authenticated GRANT 전).

```sql
revoke all on function public.ops_example(integer) from public, anon, service_role;
```

위 조각만 단독 실행하지 않는다. 실제 migration은 begin/commit·일치하는 history INSERT·짝 rollback·snapshot·일상어 summary를 함께 준비해 사용자 승인 절차를 따른다. 예시 함수는 테스트 자료이며 이번 PR에서 운영 migration을 만들거나 실행하지 않는다.

rollback 짝 파일의 허용 범위: `drop column`, `drop constraint`, `drop index public.<name>`, `alter policy`, 해당 version(선택적으로 같은 name)의 `schema_migrations` 한 행 DELETE. 추가로 **`DROP FUNCTION [IF EXISTS] <짝 migration에서 만든 정확한 서명>`**만 허용한다. 짝 migration 원문을 apply 규칙으로 다시 검증하고 추출한 스키마·함수명·인자 자료형과 대조한다. 짝 없는 함수·다른 overload·CASCADE·여러 함수 일괄 DROP·다른 함수 명령은 거부한다. guard, timeout, lock, 제약 복원도 허용하지만 일반 자료 INSERT/UPDATE/DELETE·표/함수 생성·새 권한 부여는 허용하지 않는다. BASKET-1·BASKET-2 원문 migration/rollback은 변경 없이 검사를 통과한다. 이 정적 검사는 정책 의미까지 증명하지 않으므로 권한·RLS 변경은 커맨드센터 검토 대상이다.

## summary.md 형식

`docs/<version>_<migration-name>.summary.md`를 아래 형식의 **정확히 3줄**로 작성한다(제목·빈 줄 없이). version/name은 migration과 일치해야 한다. 원문 자료·비밀값을 쓰지 않는다.

```text
무엇이 바뀌나: 사용자가 겪을 변화를 쉬운 말로 설명합니다.
잘못되면: 실패했을 때 자료·화면에 생길 일을 설명합니다.
되돌리는 법: 짝 rollback과 사용 제한·백업 복구 경로를 설명합니다.
```

기록용 예시: [BASKET-1 summary](20261010120000_basket1_notes_links.summary.md). summary는 필수이고 rollback/snapshot 준비에 관한 AGENTS.md 규칙도 계속 적용된다.

## 사전·사후 확인과 출력

같은 이름의 `docs/<version>_<name>.precheck.sql`·`.postcheck.sql`·`.dry-run.postcheck.sql`은 선택 사항이다. 한 개의 SELECT 또는 WITH SELECT만 허용하며 기존 검사를 그대로 거쳐 `read_only: true`로 요청한다. 쓰기 CTE·여러 요청·위험 함수는 거부한다. plan에는 해당 mode에서 선택한 확인 SQL의 경로·SHA256·전문을 표시한다.

- `read_only: true` 요청은 실행 역할이 postgres가 아닐 수 있다(Supabase 읽기 전용 역할 추정, 2026-10-14 사진글자 dry-run). 확인 SQL은 `current_user`·`information_schema`(표 소유자 기준으로 숨김)에 기대지 말고 `pg_catalog`과 명시한 실행 역할을 사용한다.
- precheck 결과는 정확히 `item`, `value` 두 칸, 1~64행이며 item 키는 중복될 수 없다. item은 100자 이하, value는 128자 이하 집계 숫자·해시·예/아니오·최근 migration 메타데이터만 허용한다. 개인 자료·임의 텍스트·추가 칸은 출력 없이 실패한다. 길거나 NULL인 결과는 이 제한에 맞게 SQL을 설계한다.
- dry-run은 적용용 `.postcheck.sql`을 실행하지 않는다. SQL의 마지막 rollback과 사후 migration 기록 부재를 확인한 뒤, precheck를 같은 읽기 전용 SQL로 다시 실행하여 item 집합과 값을 비교한다. 행 순서는 무관하고 변경·추가·누락·중복은 실패다. **사전 집계 관측값 보존**만 확인하며 DB 전체 자료가 동일하다고 판정하지 않는다.
- `.dry-run.postcheck.sql`이 있으면 집계 비교 뒤 원래 함수·스키마 등 추가 판정을 실행한다. item과 `ok`/`expected`/`value` 중 한 칸, 값은 boolean 또는 예/아니오만 허용한다. 아니오면 원래 상태 검사 실패다. SQL 취소 완료와 사후 검사 완료는 별개로 표시한다. BASKET link view `20261012100000`은 #506의 이전 RPC 본문 MD5·invoker·고정 search_path·summary 칸과 edit RPC 부재 검사를 이 파일에도 보존한다. 기존 apply postcheck는 그대로 유지한다.
- apply와 rollback의 `.postcheck.sql` 선택·판정은 유지한다. postcheck는 item과 `ok`/`expected`/`value` 중 한 칸, 값은 boolean 또는 예/아니오만 허용한다. 아니오면 job 실패지만 이미 적용한 변경을 자동 취소하지 않는다. rollback은 기존 독립 mode 제약을 유지하며 이전 함수를 CREATE/OR REPLACE로 복원하는 #506 rollback은 버튼에서 지원하지 않는다. 해당 복구는 별도 승인된 SQL Editor 경로다.
- baseline NULL인 선택된 확인 SQL은 실행하지 않고 **수동 확인 필요**로 표시한다. dry-run에서도 기존 적용용 postcheck의 baseline NULL은 정적 검사로 수동 snapshot 요구만 유지한다(SQL은 선택·실행하지 않음). dry-run 사전 집계가 없거나 NULL이면 SQL 취소·기록 부재는 확인해도 **검증 미완료**다. 내부 결과는 `ok: true, verification: 'incomplete'`로 SQL 수행 결과를 보존하지만 CLI는 exit 1이며 apply 준비 완료를 뜻하지 않는다. precheck 값을 자동 주입하지 않는다. 커맨드센터가 snapshot·별도 승인된 읽기 SQL로 대조한다.
- migration/check/tx-probe/cleanup 오류는 관측한 HTTP 정수 상태(100~599), 고정 내부 종류, 검증된 SQLSTATE와 실행 단계만 표시한다. JSON 파싱 실패·64 KiB 응답 상한도 이미 받은 번호를 유지하며 관측하지 못한 번호는 **HTTP 상태 미확인**이다. HTTP 200에서도 API의 SQL 오류는 기존 규칙대로 실패한다. 번호로 commit·성공 여부를 판정하지 않는다. 쓰기 요청 전송과 migration 실행 요청 전송을 구분하며 결과 불명 시 커맨드센터 확인·복구 안내를 유지한다. 원문 메시지·cause·SQL·행 데이터·URL·헤더·토큰은 보존하거나 출력하지 않는다. 원문 SQL을 표시하는 곳은 비밀값 없는 plan뿐이다. 요청 재시도·자동 rollback·응답 artifact 저장은 없다.

## 백업과 정리

apply/rollback 직전, SQL의 ALTER TABLE/UPDATE/DELETE가 대상으로 하는 public 표를 추출한다. 각 표를 `ops_backup."<version>_<table>_<run_id>"`로 CTAS 복사한다. 이름이 PostgreSQL 63바이트 제한을 넘으면 승인 전에 실패한다. 새 표/인덱스/함수만 만드는 SQL 등에는 이 기준의 기존 표 백업이 없을 수 있다. 함수 정의 본문은 이 시점에 호출하지 않으므로 백업 대상 표로 추출하지 않는다. 대상이 없으면 기존처럼 **“대상 public 표 없음”**을 summary에 표시하고 진행한다. 함수 본문·권한의 이전 상태는 별도 snapshot으로 준비한다.

백업은 별도 begin/commit 요청 한 번이다. 스키마가 없으면 생성하고 PUBLIC·anon·authenticated의 스키마 권한을 명시적으로 revoke한다. 복사 표에도 같은 역할의 모든 권한을 revoke하여 기본 권한 상속을 차단한다. 백업 동안 원본에는 share lock을 잡는다. 표 이름·행 수만 summary에 표시하며 GitHub 로그·artifact에는 복사 데이터를 남기지 않는다. 백업 또는 행 수 확인이 실패하면 적용 요청을 보내지 않는다.

백업은 **자료 사본**이며 원래 제약·인덱스·RLS·시퀀스·소유권을 복원하는 완전한 DB 백업이 아니다. 스키마 복구는 짝 rollback/snapshot으로 판단한다. 백업 commit과 실제 적용 사이에는 다른 세션의 쓰기가 가능하므로 사용 중 자료 복구는 별도 검토가 필요하다. 자료를 무작정 원본에 덮어쓰지 않는다.

백업 표는 성공·실패 모두 **자동 삭제하지 않는다**. 같은 run_id의 재실행은 사본을 덮어쓰지 않고 이름 충돌로 실패한다. 정리는 커맨드센터가 대상·보존 필요를 검토한 뒤 **별도 승인 SQL**로 사용자가 수행한다. 예시는 표 이름을 실제 summary와 대조한 후 SQL Editor의 새 창에서 사용한다(이 workflow는 DROP TABLE을 차단한다).

```sql
begin;
drop table ops_backup."<version>_<table>_<run_id>";
commit;
```

응답 유실·강제 종료 때도 자동 재실행하지 않는다. 백업은 남았을 수 있고 적용도 완료되었을 수 있다. plan의 예상 백업 이름·main SHA, run의 마지막 확인 단계로 커맨드센터가 상태를 확인한다.
