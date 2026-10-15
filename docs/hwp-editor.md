# HWP 편집기(rhwp) 반입·업데이트 기준

원장 행: `HWP-편집기`. 1단계 시험판 [#553](https://github.com/mj880616/work/pull/553).

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
- 편집기는 같은 origin iframe에서 돈다. 외부 연결은 CSP로, 기기 저장·Web2 로그인 정보 접근은 `app/hwp-lab/studio-guard.js`로 막는다.
