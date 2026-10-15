# HWP 편집기(rhwp) 반입·업데이트 기준

원장 행: `HWP-편집기`. 1단계 시험판 [#553](https://github.com/mj880616/work/pull/553), 2단계 열기·Drive 저장 [#554](https://github.com/mj880616/work/pull/554).

## 1. 지금 고정한 버전

| 항목 | 값 |
| --- | --- |
| 버전(한 곳에서 관리) | `scripts/hwp-lab/rhwp-pin.json` — rhwp `0.8.7` |
| 편집기 본체 | github.com/edwardkim/rhwp 태그 `v0.8.7`(커밋 `1a76570e`)의 `rhwp-studio`를 외부 웹폰트 끄고 빌드 |
| WASM 엔진 | npm `@rhwp/core@0.8.7`(sha512 확인) |
| 임베드 SDK | npm `@rhwp/editor@0.8.7`(sha512 확인). 이 패키지는 iframe SDK뿐이라 본체는 위처럼 따로 빌드한다 |
| 반입 위치 | `app/hwp-lab/rhwp-0.8.7/`(출처 `SOURCE.md`, 파일 해시 `SHA256SUMS`, 라이선스 `LICENSE`·`THIRD_PARTY_LICENSES.md`) |
| 저장 형식 | HWP만. HWPX 원본도 HWP로 내보낸다(2026-10-15 사용자 결정) |

`tests/hwp-lab-pin.test.mjs`가 pin 버전·`app/hwp-lab.js` 경로·반입 폴더·`SOURCE.md`가 서로 같은지, 반입 파일이 `SHA256SUMS`와 같은지(직접 고치지 않았는지), 편집기 HTML의 외부 차단 CSP와 저장소 guard가 그대로인지 매번 검사한다.

## 2. 새 버전이 있는지 확인하는 방법

- `npm view @rhwp/editor version` 과 `npm view @rhwp/core version`(두 값이 같은 버전일 때만 올린다)
- 저장소 태그: `git ls-remote --tags https://github.com/edwardkim/rhwp.git`
- 변경 내역: rhwp 저장소 `CHANGELOG.md`에서 HWP 저장·표·글꼴·보안 관련 항목을 본다.

정기 확인은 HWP-편집기 단계를 시작할 때마다 한 번씩 한다. 올리는 것은 필요할 때만(깨짐 수정, 보안 수정 등) 한다.

## 3. 올리는 순서

1. 작업 브랜치에서 `scripts/hwp-lab/rhwp-pin.json`의 `version`·`tag`·`commit`(태그가 가리키는 커밋), `editorIntegrity`·`coreIntegrity`(`npm view <패키지>@<버전> dist.integrity`)를 고친다.
2. `bash scripts/hwp-lab/build-rhwp-studio.sh` → `app/hwp-lab/rhwp-<새 버전>/`이 생긴다. 한 번 더 실행해 `SHA256SUMS`가 같은지(재현) 본다.
3. 옛 `app/hwp-lab/rhwp-<옛 버전>/` 폴더를 지우고, `app/hwp-lab.js`의 `RHWP` 경로를 새 버전으로 바꾼다. `hwp-lab.js?v=`부터 캐시 버전 연쇄를 올린다(`AGENTS.md` 4절).
4. 시험 HWP 검사 재실행: `node --test tests/hwp-lab-pin.test.mjs`, `npx playwright test tests/app-e2e/hwp-lab.spec.mjs`(390·1280 열기·입력·HWP 다운로드, HWPX→HWP, 외부 요청 0, 저장소 흔적 0). 시험 파일은 `tests/fixtures/hwp-lab/`(직접 만든 빈 문서, `scripts/hwp-lab/make-samples.mjs`).
5. 빌드 결과에 `https://` 외부 주소를 부르는 새 경로가 생겼는지, 편집기 HTML에서 CSP·guard가 지워지지 않았는지 `finalize-rhwp-studio.mjs` 결과와 검사로 확인한다. browser-storage-audit도 통과해야 한다.
6. 배포 뒤 폰에서 실제 주간보고 HWP를 열어 깨짐을 보고, 내보낸 HWP를 한컴오피스(또는 한컴 뷰어)에서 연다(PR 댓글의 폰 시험 순서).
7. 원장 `HWP-편집기` 행과 이 문서 1절을 같은 PR에서 고친다.

## 4. 알려진 한계

- 반입본은 약 43MiB이며 저장소 이력에 남는다. 버전을 올릴 때마다 비슷한 크기가 더해진다.
- 한컴 전용 글꼴은 내장 오픈소스 글꼴로 대체되어 글자 모양·폭이 조금 다를 수 있다.
- 2단계부터 편집기는 sandbox iframe(allow-same-origin 없음)에서 돈다(5절). 외부 연결은 CSP로, 기기 저장은 `app/hwp-lab/studio-guard.js`로 막는다.
- 편집기 안 복사·붙여넣기 중 시스템 클립보드 연동은 sandbox에서 막힐 수 있다.

## 5. 2단계: 칸막이와 Drive 저장(#554)

- 칸막이: `app/hwp-frame.js`가 `sandbox="allow-scripts"` iframe을 만든다. 편집기 문서는 고유 origin(`null`)이라 Web2 창(parent·top)·로그인 정보·저장소·쿠키에 닿지 못하고, CSP가 Supabase를 포함한 다른 주소 호출을 막는다. 연결 메시지 1회(문서 없음, 전용 MessagePort 전달)만 `*`로 보내고 파일은 그 port로만 오간다. 연결이 확인되지 않으면 열지 않는다. 검사: `tests/app-e2e/hwp-lab.spec.mjs`.
- 편집기 파일(모듈 JS·CSS·WASM·글꼴)은 다른 origin에서 읽는 셈이라 응답에 `Access-Control-Allow-Origin`이 필요하다. GitHub Pages는 모든 파일에 `*`를 붙이고 Cloudflare Worker(`cloudflare/bokdoong-router.mjs`)는 원본 헤더를 그대로 넘긴다. 이 헤더가 없어지면 편집기가 열리지 않을 뿐 데이터는 바뀌지 않는다. 그때 대안은 편집기 전용 주소(예: 별도 하위 도메인)와 Worker 헤더 추가이며 운영 변경이 필요하다.
- 열기: 자료실 ⋯ 메뉴·바구니 첨부의 [편집] → `document-actions` `hwp-open`(파일·업무공간은 서버가 DB에서 정함, 30MB까지, Drive `headRevisionId`·`md5Checksum`을 함께 받음).
- 저장(2026-10-15 결정): [새 파일로 저장]이 기본. 자료실은 `library-files`로 새 자료(제목 "… (수정)"), 바구니는 `basket-files`로 같은 메모 첨부. [원본에 덮어쓰기]는 HWP 원본만: `hwp-overwrite`가 열 때 본 버전과 같은지 확인 → 내 드라이브 루트 "Web2 편집 백업" 폴더에 `<이름> 편집 전 백업 YYYY-MM-DD HHmm.hwp` 사본 → 사본 md5 확인 → 버전 재확인 → 덮어쓰기. 같은 원본을 바구니·자료실이 함께 쓰면 확인 1회(`confirm_shared`). 백업은 지우지 않는다.
- 덮어쓰기 뒤 자료실 `file_size`·메모 첨부 `size_bytes`는 갱신하지 않는다(DB 쓰기 없음). Drive 파일이 기준이다.
- 결과 불명(시간 초과·5xx·응답 이상)은 다시 보내지 않고 해당 저장 버튼을 잠근 뒤 확인을 안내한다.
