# ENV-4 로더 캐시 버전 검사

📱 폰 가능 — 코드·CI 검사만. DB·Edge·배포 작업 없음.

> 2026-10-18 갱신(CI-버전자동화 3단계 #635 이후). 예전 "바뀐 파일을 부르는 쪽 `?v=`를 올렸는지" 검사는 없어졌다. 지금 검사는 "저장소에 손으로 쓴 `?v=`가 없는지"다. 규칙 원문은 `AGENTS.md` §4 캐시 버전, 설계는 `docs/design/ci-version-automation.md`.

## 지금 방식

- 저장소의 HTML·JS·CSS는 번호 없는 경로로 서로를 부른다(예: `import('./view-loader.js')`).
- `?v=`는 GitHub Pages 배포 때 `scripts/build-pages.mjs`가 파일 내용 해시(SHA-256 앞 10자)로 붙이고, 같은 결과물에서 `app/asset-manifest.json`을 만든다. 잎부터 계산하므로 기능 모듈이 바뀌면 `view-loader.js` → `loader-v2.js` → `app.js` → `index.html`의 해시가 저절로 바뀐다. 사람이 번호를 올리지 않는다.

## 검사 대상과 방식

`scripts/check-loader-cache.mjs`(workflow `loader-cache-check.yml`, job 이름 `loader-cache`)는 PR의 merge-base와 head 파일을 Git에서 읽고 두 가지를 본다.

1. **손으로 쓴 `?v=` 금지**: `tests`·`docs`·`scripts`·`supabase`·`android-app`·`windows-app`·`cloudflare`·`.github`·`app/legacy/` 밖의 모든 HTML·JS·CSS에서, 저장소 안 파일을 가리키는 참조에 `?v=`가 있으면 실패한다. 어느 로더도 부르지 않는 파일도 검사한다(옛 번호가 남지 않게).
2. **삭제한 파일을 아직 부름**: 운영 HTML에서 시작해 참조를 따라갔을 때, 기준 시점에 있던 파일이 head에서 지워졌는데 아직 부르는 곳이 있으면 실패한다.

예외(`?v=`를 그대로 둬도 됨): 다른 주소(`https://…`), 저장소에 없는 파일(예: `personal/portal`의 `/favicon.ico?v=…`), `${…}`가 든 동적 경로, 폴더 이름에 판 번호가 든 외부 라이브러리(`rhwp-0.8.7/`, `mermaid-11.17.2/` 등) 안쪽, JSON 파일 안 주소(`app/windows-manifest.json`의 아이콘).

참조를 읽는 방법(아래 `graph()`는 빌드 스크립트도 그대로 쓴다):

- HTML의 script/link/img/source의 src·href, inline script의 문자열, JS의 문자열·템플릿(Acorn 토큰 분석, 주석 제외), CSS의 `@import`·`url()`.
- `/work/…`와 `/…`로 시작하는 경로는 저장소 루트 경로로 읽는다.

## 함께 도는 검사

| 검사 | 위치 | 하는 일 |
| --- | --- | --- |
| 빌드 결과 검사 | `pages-build-check.yml`(PR), `pages-deploy.yml`(main) | `build-pages.mjs` 결과의 모든 `?v=`가 대상 파일 해시와 같은지, 목록이 결과 파일과 같은지, Worker가 목록의 Web2 자산을 `immutable`로 판정하는지(`scripts/check-pages-build.mjs`) |
| 정확한 경로 계약 | `scripts/check-app-smoke-contract.mjs` | 시작 파일들이 `?v=` 없는 정확한 경로(`./loader-v2.js` 등)로 서로를 부르는지 |

## 실행

```sh
npm ci --prefix scripts --ignore-scripts --no-audit --no-fund
node --test scripts/check-loader-cache.test.mjs
node scripts/check-loader-cache.mjs --base origin/main
node scripts/check-loader-cache.mjs --base <merge-base-SHA> --head <PR-head-SHA>
```

`--head` 생략 시 작업 폴더(미커밋 파일 포함)를 검사한다. 종료 코드: 통과 0, 위반 1, 잘못된 SHA·실행 오류 2.

CI는 모든 main 대상 PR에서 실행한다(경로 필터 없음). `contents: read`, checkout 인증정보 보관 안 함, 비밀값 없음. 검사 전용 의존성은 `scripts/package-lock.json`에 고정하고 설치 스크립트를 비활성화한다. 게시 자동 merge 관문(`scripts/publication-pr-policy.mjs`)이 이 job 이름(`loader-cache`)을 필수 검사로 기다린다.

## 한계

- 정적 문자열 검사다. 변수 조합·보간으로 만드는 파일명은 읽지 않는다(빌드도 건드리지 않는다).
- JS 안 문자열이 저장소 파일 경로와 같으면(예: `'./app.js'`) 빌드가 그 문자열에도 `?v=`를 붙인다. 경로 문자열을 비교·표시용으로 쓰지 않는다(`app/ARCHITECTURE.md`).
- HTTP 캐시 헤더·실제 배포는 이 검사가 보지 않는다. CI 통과가 배포 완료를 뜻하지 않는다.
