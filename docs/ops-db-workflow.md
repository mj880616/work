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

## 다음 DB 변경의 사용자 순서 (폰)

1. PR의 규칙 변경·SQL·테스트를 커맨드센터에서 검토하고 사용자 승인 후 merge한다. Codex는 merge하지 않는다.
2. 커맨드센터 실행 승인 뒤 GitHub 앱에서 저장소 Actions를 연다. 수동 실행·environment 승인 버튼이 보이지 않으면 폰 브라우저의 저장소 Actions를 사용한다(필요하면 데스크톱 사이트).
3. **Approved DB migration workflow** → **Run workflow** → branch **main**, mode **check**, version 비움 → 실행. plan의 main SHA·SQL을 읽고 **Review deployments**에서 `production-edge`를 승인한다. 최근 기록을 커맨드센터와 확인한다.
4. 새 변경의 migration·rollback·snapshot·summary·확인 SQL을 main에 준비하고 커맨드센터 승인을 받는다. mode **dry-run**, 새 변경의 **14자리 version**으로 실행한다. plan의 일상어 3줄·파일 경로·SHA256·SQL 끝 `rollback;`을 읽고 environment를 승인한다.
5. dry-run 성공·사후 version 없음·사후 검사 결과를 커맨드센터에 전달한다. `수동 확인 필요`면 snapshot/baseline 대조를 별도로 끝낸다. 실패·불명확하면 apply로 넘어가지 않는다.
6. 커맨드센터 적용 승인 후 **apply**와 같은 version으로 새 실행을 시작한다. 새 plan의 main SHA·파일 해시·원문 SQL 끝 `commit;`·백업 SQL을 다시 확인하고 environment를 승인한다. dry-run 이후 main 파일이 달라졌으면 새 파일로 dry-run부터 다시 한다.
7. 적용 후 백업 표 이름/행 수·사후 기록·판정을 확인해 전달한다. 실패·응답 유실·수동 확인 필요 때 자동 재실행하지 않는다. 적용되었을 수 있으므로 커맨드센터가 먼저 상태를 판단한다.
8. 되돌리기는 짝 rollback 파일을 커맨드센터에서 검토·승인한 뒤 **rollback**과 같은 version으로 실행·environment 승인한다. rollback도 직전 백업을 만든다. 새 칸 사용 등의 guard가 실패하면 데이터를 지워 통과시키지 않는다.

`20261010120000` BASKET-1은 이미 적용된 기록이다. 예시 summary가 추가되어도 apply/dry-run 대상이 아니며 사전 기록 검사에서 거부된다. tx-probe 재시험이 필요하면 커맨드센터 승인 후 version을 비워 실행하고 두 판정이 모두 예인지 확인한다.

## 2단계 모드와 파일 검사

- dry-run/apply: `supabase/migrations/<version>_*.sql` 정확히 1개. 첫 줄 `begin;`, 마지막 줄 `commit;`, 마지막 본문에 같은 version/name의 history INSERT 정확히 한 행. dry-run은 마지막 commit만 rollback으로 바꿔 1회 실행하고 version이 여전히 없는지 확인한다. 백업은 만들지 않는다.
- rollback: `docs/<version>_*.rollback.sql` 정확히 1개, 같은 이름의 migration과 summary 필수. begin/commit 안에서 해당 version의 history DELETE 정확히 한 행. 사전에 version/name 한 행이 있어야 한다. apply/dry-run은 version이 이미 있으면 거부한다.
- symlink·여러 파일·파일 짝 불일치·비정상 식별자·큰 파일은 승인 전에 거부한다. plan에는 일상어 3줄, 파일 경로·SHA256·줄 수, 위험 검사 결과, 실행 SQL 전문, 사전·사후 SQL과 백업 SQL을 표시한다. run은 plan이 기록한 main SHA를 checkout해 같은 검사를 반복한다.
- SQL 주석(중첩 포함), 문자열·dollar block을 구분해 검사한다. 대소문자·줄바꿈·주석으로 명령을 숨길 수 없다. 일반 SQL 파서가 아니라 보수적인 허용 범위다. 동적 EXECUTE/CALL/COPY, 실행형 DO(읽기 guard 외), 중간 트랜잭션 종료, 대소문자 구분/Unicode 이스케이프 식별자 등 지원 밖 문법은 거부한다.

차단 목록(세 모드 공통): `drop table`, `drop schema`, `truncate`, 최상위 WHERE 없는 DELETE/UPDATE, `alter role`, `create/alter/drop extension`, `grant … to anon|public|authenticated`, 주석 외 `rtw_` 언급, 허용된 history INSERT/DELETE 외 `supabase_migrations` 쓰기. DROP CASCADE·RLS 비활성화·파일/외부 호출·동적 실행도 거부한다. 외래 키의 `ON DELETE CASCADE`는 DROP CASCADE와 구분한다.

rollback 짝 파일의 허용 범위: `drop column`, `drop constraint`, `drop index public.<name>`, `alter policy`, 해당 version(선택적으로 같은 name)의 `schema_migrations` 한 행 DELETE. guard, timeout, lock, 제약 복원도 허용하지만 일반 자료 INSERT/UPDATE/DELETE·표 생성·새 권한 부여는 허용하지 않는다. BASKET-1 원문 rollback은 변경 없이 검사를 통과한다. 이 정적 검사는 정책 의미까지 증명하지 않으므로 권한·RLS 변경은 커맨드센터 검토 대상이다.

## summary.md 형식

`docs/<version>_<migration-name>.summary.md`를 아래 형식의 **정확히 3줄**로 작성한다(제목·빈 줄 없이). version/name은 migration과 일치해야 한다. 원문 자료·비밀값을 쓰지 않는다.

```text
무엇이 바뀌나: 사용자가 겪을 변화를 쉬운 말로 설명합니다.
잘못되면: 실패했을 때 자료·화면에 생길 일을 설명합니다.
되돌리는 법: 짝 rollback과 사용 제한·백업 복구 경로를 설명합니다.
```

기록용 예시: [BASKET-1 summary](20261010120000_basket1_notes_links.summary.md). summary는 필수이고 rollback/snapshot 준비에 관한 AGENTS.md 규칙도 계속 적용된다.

## 사전·사후 확인과 출력

같은 이름의 `docs/<version>_<name>.precheck.sql`·`.postcheck.sql`은 선택 사항이다. 한 개의 SELECT 또는 WITH SELECT만 허용하며 `read_only: true`로 요청한다. 쓰기 CTE·여러 요청·위험 함수는 거부한다.

- precheck 결과는 정확히 `item`, `value` 두 칸, 최대 64행. item은 100자 이하, value는 128자 이하 집계 숫자·해시·예/아니오·최근 migration 메타데이터만 허용한다. 개인 자료·임의 텍스트·추가 칸은 출력 없이 실패한다. 길거나 NULL인 결과는 이 제한에 맞게 SQL을 설계한다.
- postcheck는 item과 `ok`/`expected`/`value` 중 한 칸, 값은 boolean 또는 예/아니오만 허용한다. 아니오면 job 실패지만 이미 적용한 변경을 자동 취소하지 않는다.
- baseline NULL을 쓰는 postcheck는 실행하지 않고 **수동 확인 필요**로 표시한다. precheck 값을 자동 주입하지 않는다. 커맨드센터가 snapshot·별도 승인된 읽기 SQL로 대조한다.
- 오류는 가능한 경우 SQLSTATE 코드와 고정 문구만 표시한다. 원문 메시지·SQL·행 데이터는 출력하지 않는다. 원문 SQL을 표시하는 곳은 비밀값 없는 plan뿐이다. 요청 재시도·응답 artifact 저장은 없다.

## 백업과 정리

apply/rollback 직전, SQL의 ALTER TABLE/UPDATE/DELETE가 대상으로 하는 public 표를 추출한다. 각 표를 `ops_backup."<version>_<table>_<run_id>"`로 CTAS 복사한다. 이름이 PostgreSQL 63바이트 제한을 넘으면 승인 전에 실패한다. 새 표/인덱스만 만드는 SQL 등에는 이 기준의 기존 표 백업이 없을 수 있다.

백업은 별도 begin/commit 요청 한 번이다. 스키마가 없으면 생성하고 PUBLIC·anon·authenticated의 스키마 권한을 명시적으로 revoke한다. 복사 표에도 같은 역할의 모든 권한을 revoke하여 기본 권한 상속을 차단한다. 백업 동안 원본에는 share lock을 잡는다. 표 이름·행 수만 summary에 표시하며 GitHub 로그·artifact에는 복사 데이터를 남기지 않는다. 백업 또는 행 수 확인이 실패하면 적용 요청을 보내지 않는다.

백업은 **자료 사본**이며 원래 제약·인덱스·RLS·시퀀스·소유권을 복원하는 완전한 DB 백업이 아니다. 스키마 복구는 짝 rollback/snapshot으로 판단한다. 백업 commit과 실제 적용 사이에는 다른 세션의 쓰기가 가능하므로 사용 중 자료 복구는 별도 검토가 필요하다. 자료를 무작정 원본에 덮어쓰지 않는다.

백업 표는 성공·실패 모두 **자동 삭제하지 않는다**. 같은 run_id의 재실행은 사본을 덮어쓰지 않고 이름 충돌로 실패한다. 정리는 커맨드센터가 대상·보존 필요를 검토한 뒤 **별도 승인 SQL**로 사용자가 수행한다. 예시는 표 이름을 실제 summary와 대조한 후 SQL Editor의 새 창에서 사용한다(이 workflow는 DROP TABLE을 차단한다).

```sql
begin;
drop table ops_backup."<version>_<table>_<run_id>";
commit;
```

응답 유실·강제 종료 때도 자동 재실행하지 않는다. 백업은 남았을 수 있고 적용도 완료되었을 수 있다. plan의 예상 백업 이름·main SHA, run의 마지막 확인 단계로 커맨드센터가 상태를 확인한다.
