# 웹 세션 DB 시험 환경

Claude Code 웹·Codex 웹 같은 클라우드 세션(root로 실행)에서 저장소의 실제 PostgreSQL 시험(`tests/auth-handoff/`)을 돌리는 방법이다. production·Supabase에는 접근하지 않는다.

## 언제 쓰나

- `tests/auth-handoff/*.test.mjs`처럼 `embedded-postgres`(PostgreSQL 17.6)를 띄우는 시험을 돌릴 때.
- 시험은 각자 임시 클러스터(임의 포트, 시험 뒤 삭제)를 직접 띄운다. 이 스크립트는 그 방식을 그대로 두고, root 거부 문제만 풀기 위해 일반 사용자로 실행한다.

## 명령

```bash
scripts/web-session-db-test.sh setup                       # 사용자 생성 + 로케일 + npm ci (여러 번 실행해도 안전)
scripts/web-session-db-test.sh test                        # tests/auth-handoff 전체 (npm test)
scripts/web-session-db-test.sh test db-workflow-backup.test.mjs   # 시험 파일 지정
scripts/web-session-db-test.sh start | status | stop       # 직접 쓰는 독립 PostgreSQL (en_US.UTF-8)
scripts/web-session-db-test.sh clean                       # 남은 postgres 프로세스·임시 폴더 정리
```

- `test`는 필요하면 `setup`을 먼저 한다.
- `start`는 이미 떠 있으면 새로 만들지 않는다. `127.0.0.1`에서만 열리고 비밀번호 없는 trust 인증이므로 비밀값이 없다. 접속: `host=127.0.0.1 port=54329 user=postgres`.
- 환경변수: `WEB_TEST_USER`(기본 `pgtest`), `WEB_TEST_PORT`(기본 `54329`), `WEB_TEST_DIR`(기본 `/tmp/web-session-pg`).
- 시험이 쓰는 `tests/auth-handoff/node_modules`는 시험 사용자 소유로 바뀐다(gitignore 대상).

## 자주 나는 실패와 해결

| 증상 | 원인 | 해결 |
| --- | --- | --- |
| `initdb: cannot be run as root` | root로 직접 시험 실행 | 스크립트로 실행(일반 사용자로 전환) |
| `EPERM ... chmod .../native/bin/postgres` | `node_modules`가 root 소유 | `setup` 다시 실행(소유자 변경) |
| 로케일 `en_US.UTF-8` 없음 | 컨테이너에 로케일 미생성 | `setup`이 `localedef`로 생성. 실패하면 `/usr/share/i18n/locales/en_US` 확인 |
| `port 54329 is in use` | 다른 프로세스가 포트 사용 | `WEB_TEST_PORT=54400 scripts/web-session-db-test.sh start` |
| 시험이 멈추거나 임시 폴더 남음 | 중간에 강제 종료 | `scripts/web-session-db-test.sh clean` |
| `cannot read ...` | 저장소 상위 폴더가 일반 사용자에게 막힘 | 폴더 권한(`o+x`) 확인 |

## 웹 세션에서 실패하는 시험과 이유

아래 시험은 웹 세션(npm 레지스트리·외부 도구 접근이 막히고 의존성이 설치되지 않은 환경)에서만 실패한다. 시험은 그대로 두며, 실패해도 코드 결함이 아니다. (2026-10-25 clean main에서 확인)

| 시험 | 웹 세션 실패 이유 | CI |
| --- | --- | --- |
| `tests/edge-isolation/ai-assist.test.mjs` (`real ai-assist graph checks/bundles with functions-only sources`) | `deno`가 없다(`spawnSync deno ENOENT`). Deno를 직접 받아 `DENO_BIN`으로 지정해도 `deno bundle`이 npm 레지스트리(`@esbuild/linux-x64`)를 받으려다 DNS 오류로 멈춘다. 그래프 검사까지는 통과한다 | `authz-security-check.yml`의 `static-authz-regression`이 Deno v2.9.6을 설치해 실행 |
| `tests/basket-link-postgres-browser.test.mjs` | 파일 머리말대로 "로컬 증명 전용"이다. `playwright`·`embedded-postgres`·`pg`를 설치해 두어야 하며(`Cannot find package 'playwright'`), 설치·건너뜀을 시험이 하지 않는다 | 어느 workflow에도 등록되어 있지 않다(의도). 필요할 때 의존성을 설치한 로컬에서만 실행 |
| `scripts/check-app-smoke-contract.test.mjs` | `acorn` 미설치(`Cannot find package 'acorn'`) | `app-smoke-check.yml`이 의존성 설치 후 실행 |
| `tests/app-e2e/*.spec.mjs` (예: `save-other-active`) | 위 "하지 않는 일"대로 웹 세션에서 돌리지 않는다 | `app-e2e-check.yml`의 `browser-e2e` |

## 하지 않는 일

- **Playwright 브라우저 E2E(`tests/app-e2e/`)는 웹 세션에서 돌리지 않는다.** CI(`browser-e2e` 등)에서 검증한다.
- production·Supabase 조회·적용, 운영 토큰 등록은 하지 않는다(AGENTS.md §1).
