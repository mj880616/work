# ENV-4 로더 캐시 버전 검사

📱 폰 가능 — 코드·CI 검사만. DB·Edge·배포 작업 없음.

## 검사 대상과 방식

`scripts/check-loader-cache.mjs`는 PR의 merge-base와 head 파일을 Git에서 읽는다. 운영 HTML을 시작점으로 로컬 파일 참조를 따라가며 목록을 만든다. 기능 파일 이름 목록을 별도로 관리하지 않는다.

- Web2: `app/index.html` → `app/app.js` → `app/loader-v2.js` → `app/view-loader.js`·기능 모듈. `routeStyles`·`module()` 인자의 문자열도 읽는다.
- HTML의 script/link/img/source, modulepreload, inline script, JS의 로컬 파일 경로 문자열·동적 src 지정·HTML 템플릿의 src/href, CSS의 `@import`·`url()`을 읽는다. `app/login/index.html` → `app/styles.css` → CSS 경로도 포함한다.
- Web1도 HTML·JS에서 같은 `?v=` 방식으로 파일을 불러오므로 포함한다. `/work/assets/...`와 `/assets/...`는 저장소 루트 경로로 해석한다.
- tests/docs/scripts 및 도구·서버 디렉터리와 `app/legacy/`의 HTML은 운영 시작점에서 제외한다. 제외 디렉터리도 실제 운영 로더가 참조하면 따라간다. 다른 파일에서 참조되지 않는 비활성 JS는 대상이 아니다.

변경된 파일을 참조하는 **모든 남은 운영 참조**의 `v`가 기준 시점에 그 파일을 불러오던 모든 버전과 달라야 한다. 다른 로더로 참조를 옮기거나 다른 페이지가 쓰던 옛 버전을 재사용해도 실패한다. 중복 preload나 CSS 참조 중 하나라도 예전 값이면 실패한다. 버전 문자열은 날짜·숫자 모두 가능하며 숫자 증가 여부 대신 URL 변경 여부를 확인한다. `v` 삭제·빈 값은 갱신으로 인정하지 않는다.

기능 버전을 올리면서 로더 파일이 바뀌면 그 로더를 불러오는 곳도 같은 검사를 받아 HTML까지 연쇄 검증한다. 삭제 파일의 참조가 남으면 실패하며, 참조까지 제거했으면 통과한다. 새 파일 경로에는 예전 캐시가 없으므로 기존 버전 갱신을 요구하지 않는다. 실패 메시지는 변경 파일과 버전을 올려야 하는 참조 파일을 함께 출력한다.

## 실행

```sh
npm ci --prefix scripts --ignore-scripts --no-audit --no-fund
node --test scripts/check-loader-cache.test.mjs
node scripts/check-loader-cache.mjs --base origin/main
node scripts/check-loader-cache.mjs --base <merge-base-SHA> --head <PR-head-SHA>
```

`--head` 생략 시 작업 폴더(미커밋 파일 포함)를 검사한다. 종료 코드: 통과 0, 누락 1, 잘못된 SHA·실행 오류 2. Windows CRLF 차이만으로 텍스트 파일이 바뀌었다고 판단하지 않는다.

CI는 모든 main 대상 PR에서 실행한다(경로 필터 없음). `contents: read`, checkout 인증정보 보관 안 함, 비밀값 없음. JS 문자열은 Acorn 토큰 분석기로 읽어 정규식·주석·템플릿을 구분한다. 검사 전용 의존성은 `scripts/package-lock.json`에 고정하고 설치 스크립트를 비활성화한다. 운영 앱 의존성은 바뀌지 않는다. PR 제목이나 브랜치명을 셸 코드로 삽입하지 않고 SHA를 환경변수로 받는다.

## 한계와 후속 점검

- 정적 문자열 검사이며 브라우저 실행 분석기가 아니다. 실행 조건이 꺼진 분기라도 도달 가능한 파일 안에 경로 문자열이 있으면 보수적으로 포함하므로 과검사할 수 있다. 주석은 제외한다.
- 변수 조합·보간으로 만드는 파일명/버전, `<base>`로 상대경로를 바꾸는 새 로더 구조는 자동 추론하지 않는다. 로더 표현 방식 변경 시 검사와 테스트도 함께 갱신해야 한다. JS 토큰 분석 오류는 검사 실패로 처리한다.
- 외부 절대 URL, 서비스워커 내부 캐시, 기존부터 `?v=`가 없는 참조는 버전 갱신 검사의 범위 밖이다. 기존 서로 다른 버전을 일괄 통일하는 검사가 아니다. 새 `v`를 다른 과거 PR에서 사용한 적 있는지는 검사하지 않는다.
- HTTP 캐시 헤더·실제 배포·로그인 사용자 동작은 검증하지 않는다. CI 통과가 배포 완료를 뜻하지 않는다.

실제 #326(`a754ab6a` → `5cb89cc8`) 변경에는 비활성 앱 파일·테스트·문서만 있으므로 통과해야 한다. 기본 회귀 사례는 버전 갱신 통과/누락 실패, 상위 로더 누락, 비활성 파일, 문서, 중복 참조, Web1 경로, CSS import, 삭제, CRLF, 실제 임시 Git 저장소의 CLI 종료 코드다.
