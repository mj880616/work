# 사용자 승인형 DB workflow — 1단계

📱 폰 가능 — 사용자 GitHub 앱 또는 브라우저에서 실행·승인한다. Codex·AI는 파일·테스트·PR만 준비한다.

## 목적과 승인 경로

운영 DB는 RTW와 공유하므로 기존 migration 일괄 적용 도구를 사용하지 않는다. 이번은 연결 확인과 빈 시험 표의 취소 동작 측정만 준비한다. DB 적용 입력·version 입력·임의 SQL 입력은 없다.

- workflow: `.github/workflows/db-migration-apply.yml`, `workflow_dispatch`만.
- 실행 코드: main 고정. plan이 main SHA를 기록하고 run은 그 SHA를 사용한다. 다른 branch에서 dispatch하면 입력 검증이 실패한다.
- 승인: 커맨드센터 승인 → 사용자 dispatch → plan summary의 SQL 전문·main SHA 확인 → 사용자 `production-edge` 승인.
- 열쇠 A안(2026-10-10): 기존 environment `production-edge`의 비밀값 `SUPABASE_ACCESS_TOKEN`과 변수 `SUPABASE_PROJECT_REF`를 그대로 사용한다. 새 environment·새 비밀값·토큰 재입력은 필요하지 않다. 웹 세션·Codex 클라우드에 운영 토큰을 등록하지 않는다.
- 기존 `production-edge`에 필요한 승인자가 설정되어 있어야 승인 대기가 작동한다. 승인자 설정은 사용자가 관리하며 이번 PR은 설정을 변경하지 않는다.

공식 [SQL query endpoint](https://supabase.com/docs/reference/api/v1-run-a-query)는 `POST https://api.supabase.com/v1/projects/{ref}/database/query`다. [인증 문서](https://supabase.com/docs/reference/api/introduction)에 따라 Bearer access token을 헤더에 넣는다. 공개 문서에 명시적 트랜잭션 보장이 설명되어 있지 않아 이번 probe로 실측한다. 엔드포인트는 experimental/Beta이므로 이번 성공은 미래 동작의 영구 보장이 아니다.

## 두 모드

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
- 토큰·프로젝트 변수를 `::add-mask::`로 등록한다. 응답은 메모리에서만 파싱하며 요청 본문·응답·원문 오류·스택을 로그나 artifact에 저장하지 않는다. check의 migration 메타데이터 외 DB 데이터는 출력하지 않는다.
- 응답은 64 KiB, HTTP 요청은 30초, 각 job은 5분 제한. 고정 concurrency 그룹 1개·`cancel-in-progress: false`, GitHub 권한은 `contents: read`만.
- HTTP 공용 함수는 `scripts/ops/db-query.mjs`, 모드·SQL·판정은 `scripts/ops/db-workflow.mjs`. 외부 패키지 없이 Node fetch를 사용한다. 가짜 HTTP 서버로 검증하며 개발 세션에서 운영 호출을 하지 않는다.

## 폰 첫 사용

1. PR의 규칙 변경·SQL·테스트를 커맨드센터에서 검토하고 사용자 승인 후 merge한다. Codex는 merge하지 않는다.
2. 커맨드센터 실행 승인 뒤 GitHub 앱에서 저장소 Actions를 연다. 수동 실행·environment 승인 버튼이 보이지 않으면 폰 브라우저의 저장소 Actions를 사용한다(필요하면 데스크톱 사이트).
3. **Approved DB connection and transaction probe** → **Run workflow** → branch **main**, mode **check** → 실행.
4. plan 완료 후 실행 화면 Summary에서 SQL 전문·main SHA를 확인한다. **Review deployments**에서 `production-edge`를 승인한다. check 결과의 최대 3행을 확인한다.
5. 커맨드센터의 probe 실행 승인 뒤 같은 절차로 mode **tx-probe**를 실행한다. 승인 전 plan에 나온 시험 표 이름·정리 SQL도 확인한다.
6. run summary의 두 판정·정리 상태를 커맨드센터에 전달한다. `아니오`·미확인·실패면 2단계로 진행하지 않는다. 정리 실패가 있으면 해당 시험 표만 별도 확인·정리한다.

## 2단계 조건과 예정 범위

사용자 운영 probe에서 두 판정 모두 **예**일 때만 별도 PR·승인으로 `dry-run`·`apply`·`rollback`을 추가한다. 한 판정이라도 아니오거나 확인 불가이면 B안(별도 실행 경로)을 재검토한다. 이번 workflow에는 세 모드가 입력값으로도 없다. AGENTS.md §7의 기존 SQL Editor·폰 경로 C·영구 금지는 그대로다.

2단계 예정 사항:

- 14자리 version, main 파일 1개, begin/commit·migration 기록 일치, 일상어 summary 3줄·SHA256·줄 수 검증.
- 위험 명령 차단: `drop table`, `drop schema`, `truncate`, WHERE 없는 DELETE/UPDATE, `alter role`, anon/public 대상 GRANT, `rtw_` 객체 언급, `db_*` 확장 설치 등. 대소문자·공백 차이로 우회되지 않게 검사한다.
- rollback 짝 파일에만 `drop column`·`drop constraint`·`drop index`·해당 version의 `schema_migrations` 한 행 DELETE 허용. 그 밖의 위험 명령은 차단한다.
- 읽기 전용 사전·사후 집계/해시 검사, baseline 처리, 운영 데이터 미출력, 비공개 스키마의 표 사본 백업과 복구 경로.
- 마지막 commit만 rollback으로 바꾸는 dry-run, 원문 1회 적용·재시도 없음, 사용자 dispatch·environment 승인. `supabase db push`·`migration repair`·`supabase link`를 사용하지 않는다.
