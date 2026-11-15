# 📱 폰 가능 · 연결 요약 브라우저·PostgreSQL 로컬 검증

실행일: 2026-10-12. Codex 클라우드의 합성 자료와 격리 PostgreSQL만 사용했다.
자동 CI 결과와 별도로 실행한 로컬 검증이다. 운영 접속·DB 적용·배포·workflow 실행은 없다.

실행 파일: [`tests/basket-link-postgres-browser.test.mjs`](../../../tests/basket-link-postgres-browser.test.mjs).
의존성은 기존 `tests/auth-handoff/package.json`의 `embedded-postgres`·`pg`, 저장소에서 해석되는 `playwright`, `/usr/bin/chromium`이다.
없으면 실패하며 설치하거나 검증을 건너뛰지 않는다. 일반 `tests/app-e2e` 구성과 workflow를 바꾸지 않았다.

```sh
node --test tests/basket-link-postgres-browser.test.mjs
```

결과: 1/1 통과, 약 4.9초. 테스트 제한 시간은 90초다.
브라우저 두 개의 독립 context/page가 실제 공통 `mountLinkSummaryEditor`와 `readLinkRecords` 모듈을 불러온다.
Runtime API만 로컬 Node 연결로 이어서 실제 SQL `app_basket_update_link_summary`를 호출한다.
조회는 note JOIN과 authenticated INVOKER/소유자 조건으로 실행한다. PostgREST HTTP 계층이나 운영 인증 경로의 검증은 이 테스트 범위에 포함되지 않는다.

확인한 동작:

- 동일한 초기 NULL 요약을 두 페이지에서 연 뒤 첫 페이지가 저장한다.
- 두 번째 페이지의 NULL 예상값은 실제 RPC에서 `SUMMARY_CHANGED`로 거절된다.
- 작성 중인 초안이 유지되고 실제 최신 요약을 표시한다.
- `최신 요약 확인` 전 저장을 눌러도 RPC를 재전송하지 않고 DB 값을 유지한다.
- 명시적으로 최신 요약을 확인한 뒤 사용자가 저장을 누를 때만 새 예상값으로 저장한다.
- 연결 확정 뒤 보관·AI 제외로 바뀐 메모도 기존 연결 요약을 수동으로 편집할 수 있다.
- 앞뒤 공백·줄바꿈·Unicode 공백·emoji·HTML처럼 보이는 텍스트를 정확하게 저장한다.
- 메모 원문·날짜·보관·AI 제외 상태가 수정되지 않으며 다른 소유자는 연결 행을 읽을 수 없다.

검증이 재전송 방지 결함을 잡는지 확인한 별도 음성 대조:

```sh
BASKET_CAS_NEGATIVE_CONTROL=1 node --test tests/basket-link-postgres-browser.test.mjs
```

결과: 예상대로 0/1 실패, 약 4.4초. 서버가 테스트용 메모리 사본에서만 확인 대기 조건을 제거한다.
명시적 최신 요약 확인 전 RPC 호출이 2회에서 3회가 되어 `saving before explicit latest-summary review must not retry the RPC` 검사가 실패했다.
저장소의 제품 코드는 변경하지 않는다. 정상 실행에서는 이 대조용 옵션을 설정하지 않는다.

`node --check tests/basket-link-postgres-browser.test.mjs`와 `git diff --check`도 통과했다.
