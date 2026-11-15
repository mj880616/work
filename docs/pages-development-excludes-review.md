# 📱 폰 가능 — Pages 개발폴더 게시 제외

PR #517. 최종 head의 자동 검사·독립 검토·병합은 CC가 확인한다.

## 문제와 변경

GitHub Pages는 저장소 root를 Jekyll로 빌드한다. 2026-10-13 main `3f0b8c249eaec98744f46e239bab746795a3804c`의 실제 [Pages 실행](https://github.com/mj880616/work/actions/runs/38343057103) artifact에도 개발문서·검사·운영 스크립트·DB/Edge·네이티브 앱·Worker 소스가 포함돼 있었다.

새 `_config.yml`의 `exclude`에 `docs`, `tests`, `scripts`, `supabase`, `android-app`, `windows-app`, `cloudflare`, `AGENTS.md`, `CLAUDE.md`를 지정한다. 저장소 원본을 삭제하지 않고 게시 artifact에서 제외한다. Jekyll theme·plugins·URL·baseurl, 공개 페이지·분석자료·앱·Cloudflare·workflow는 변경하지 않는다.

## 실제 빌드 대조

기준 main과 후보를 실제 동일 이미지로 빌드했다.

- 이미지: `ghcr.io/actions/jekyll-build-pages@sha256:6791ebfd912185ed59bfb5fb102664fa872496b79f87ff8b9cfba292a7345041`
- `github-pages v232`, Jekyll 3.10.0, source read-only mount, 외부 output mount, UID 1000, 공용 CA read-only mount·TLS 검증 유지
- 두 빌드에 같은 repository·base revision·`PAGES_ENV=dotcom`·빈 token 조건 사용
- baseline 1,278 regular files → candidate 379 regular files. 지정 제외에 해당하는 899개만 제거됐다.
- 보존 379개 **모두 bytes 일치**. 예상 밖 누락·추가·변경·제외 파일 누출·symlink 0.
- `AGENTS.md`/`CLAUDE.md` 원문뿐 아니라 생성 `.html`도 제외된다. `_config.yml` 자체도 artifact에 없다.
- 공개 `analysis/`의 regular file 108개(MD·JSON·생성 HTML·templates), 사용자용 `review/260914-press-article-redline/index.html`, Web1·Web2·포털·아스날·공용 자산·공개 첨부를 보존했다. `analysis`의 114 tar entries에는 디렉터리 6개가 포함되므로 파일 수와 혼동하지 않는다.

이 개수는 해당 base의 측정값이다. 새 고정 숫자 smoke 계약으로 쓰지 않으며 다음 main에서는 실제 경로 계약으로 다시 계산한다.

## metadata 한계와 원격 artifact

원격 `github-pages` artifact ID `11787498202` ZIP 16,727,014 bytes를 다운로드했고 SHA256 `0f45fa4c39d2f2d9bacfe9e55931a95a2c8f6ac74304d4fddc4cc36b50281db1`을 확인했다. tar는 1,475 entries·1,278 regular files·symlink 0이다.

로컬 baseline과 원격 artifact의 경로는 모두 같고 1,148파일은 bytes가 같다. 생성 HTML 130개에는 외부 GitHub metadata 조회 불가에 따른 canonical·description 등 차이가 있다. `PAGES_ENV=dotcom`에서 자산 base path는 `/work/`로 재현했지만 fallback canonical은 HTTP이며 원격과 완전 동등한 metadata를 재현한 것은 아니다.

이 한계 때문에 candidate HTML을 skip하거나 normalize하지 않았다. **모든 보존 HTML은 동일 조건의 local baseline와 bytes 전체를 대조했다.** source config에 URL·theme·metadata 보정값을 추가하지 않았다. 병합 후 정확한 main SHA의 실제 Pages artifact에서 제외·보존 경로와 생성 HTML metadata를 추가 확인한다.

## 의존성과 실행 확인

- 보존 파일의 HTML/CSS/JS/JSON 참조 709개 대조: 새 broken local dependency 0.
- 709개는 검증 도구가 추출한 정적 리터럴 참조의 수다. HTML 안 inline script·side-effect import·계산 경로 전체를 파싱하지 않으며, JS `fetch`의 문서 기준 URL과 module import의 모듈 기준 URL을 모두 실행 의미대로 해석한 검사는 아니다. 그러므로 전체 runtime 의존성이 완전히 검증됐다는 뜻으로 쓰지 않는다. 보존 파일 전체의 bytes 대조와 아래 대표 화면의 실제 요청·콘솔 검사를 함께 근거로 삼는다.
- 기존 `press/index.html`의 `../2025-10-02-seohae-rail-cba/index.html` 링크 1개는 양쪽 baseline/candidate에서 동일하게 없음. 이번 범위에서 수정하지 않음.
- Chromium 390/1280에서 Web1 root, 공개 p shell, 공개 review, 분석 생성 HTML·template, 포털, 아스날, Web2 익명 로그인 이동·mock 인증 홈을 대조했다.
- 실제 공개 기자회견 페이지의 동적 `file-dropzone.js`, 민자철도 질문 페이지의 동적 helper도 양쪽 출력에서 확인했다.
- 최종 조합은 baseline 22화면·candidate 22화면(각각 11종 × 390/1280), pageerror·console error·로컬 404 모두 0. 초기 fixture 오류 로그는 별도로 보존했다.
- production API는 모두 fixture로 처리하거나 차단했다. 실계정·운영 token·DB/Edge/Cloudflare 호출 없음.
- 외부 AnchorJS는 공식 4.1.0 bytes를 fixture로 제공하고 기존 SRI SHA256과 일치함을 검사했다. 읽생기 아이콘은 다른 제품의 외부 자산이라 fixture로 처리했다. 포털의 root favicon 경로는 기존 Worker의 포털 매핑을 로컬 서버에서 재현했다.
- 초기 검증 도구의 login.html 가정, sandbox iframe에 session 초기화 적용, AnchorJS fixture의 마지막 개행으로 발생한 SRI 오류를 기록하고 도구만 바로잡았다. 제품 코드·인증 경계·integrity 설정은 수정하지 않았다.
- Node public metadata·익명 인증 gate 27/27, publication 내용·신뢰 정책 10/10 통과.
- 기존 cache checker는 명시 base로 431개 운영 참조 확인, cache 버전 변경 필요 없음. 첫 실행의 base 인자 누락과 임시 dependency symlink에 따른 도구 오류를 보존했고 repository source에 symlink를 남기지 않았다.

## 게시와 복구

최종 head 검사·독립 검토 뒤 CC가 위임 범위에서 병합한다. root `_config.yml` 병합은 Pages 게시 구성을 바꾸지만 Cloudflare 배포 trigger 경로에는 해당하지 않는다. 수동 workflow 실행·DB/Edge 변경·운영 token 등록은 필요 없다.

병합 후 exact main SHA의 Pages 실행 성공과 artifact manifest를 대조한다. 문제가 생기면 이 exclude 설정만 되돌리는 PR로 복구한다. 저장소 자료·원문·분석자료·앱 소스를 reset/clean/삭제하지 않는다.

ENV-8 중 Pages 개발폴더 제외 범위다. Actions Node24·Cloudflare 도구 고정·중복 Pages 게시 판단·기타 ENV 후속은 별도 범위로 유지한다.

## main 통합 기록

#518과 #515가 반영된 main `01399e9beea7db47bbe03c3fd88f49c6fa16fb16`을 같은 branch에 정상 merge했다. ENV-8 충돌은 main의 #515 설명·성공 기록과 #517 Pages 기록을 함께 보존해 해결했다. `_config.yml` blob은 독립 검토를 받은 e9a17fd와 동일하며, 제외·숨김 경로와 설정 파일을 별도로 구분한 공개 빌드 입력의 Git blob 대조에서도 변경이 없다. 이 입력 동일성에 따라 Docker·전체 browser 검사를 반복하지 않는다. 앞의 실제 artifact·브라우저 수치는 원래 검증한 출력의 결과이며, 통합 head의 자동 검사와 병합 뒤 실제 Pages artifact 확인은 별도로 기록한다.
