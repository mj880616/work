# Web1 고정 공개 페이지 내리기 (withdrawn)

`p/.custom-page-shells.json`에 등록된 6개 고정 셸(`p/<slug>/index.html`)의 메타데이터는
`scripts/generate-public-pages.mjs`가 `app_public_post` 조회 결과로 갱신한다
(`sync-public-page-meta.yml`).

## 생성기 규칙

- `slugs`: 공개 중인 페이지. 조회 결과로 제목·요약·robots를 갱신한다.
- `withdrawn`: 내린 페이지. 조회 결과와 무관하게 중립 메타(`공유 게시글`, `noindex,nofollow`)로 기록한다.
- 두 목록 합계는 6개이며 중복을 허용하지 않는다.
- `slugs`의 페이지가 빈 결과를 돌려주면 그 셸은 건드리지 않고, 이유를 로그에 남기고 종료코드 1로 끝난다.
  빈 조회를 비공개 전환 신호로 쓰지 않는다. 비공개 전환은 `withdrawn`으로만 표현한다.
- 6개를 모두 조회한 뒤에 파일을 쓴다. 조회 중 서버 오류나 RPC 미배포(`PGRST202`)가 나면 아무 파일도 쓰지 않는다.

## 페이지를 내리는 순서

1. PR로 해당 slug를 `slugs`에서 `withdrawn`으로 옮긴다. merge 후 동기화가 돌면 셸 메타가 중립으로 바뀐다.
2. 그다음 DB에서 해당 페이지를 비공개로 전환한다. 전환 방법·권한은 기존 경계를 따르며, production 변경은 로컬 세션에서만 한다.

순서를 거꾸로 하면 DB 전환부터 PR merge까지 동기화가 매번 종료코드 1로 실패하고,
그동안 공개 HTML에 제목·요약이 남는다.

## 주의

- 본문은 셸이 런타임에 `app_public_post`로 불러오므로 DB 전환 즉시 사라진다.
  셸에 직접 적힌 문구(허브 내비게이션 등)는 메타와 별개이므로 필요하면 같은 PR에서 정리한다.
- 공개 저장소이므로 git 이력에는 과거 메타가 남는다.
- `app_public_post`는 5개 slug는 `unlisted`도 허용하지만, `private-rail-forum-0929-prep`은
  `visibility='public'`일 때만 행을 돌려준다. 이 페이지는 `unlisted`로만 바꿔도 빈 결과가 되어
  동기화가 실패한다. 이 페이지를 unlisted로 돌릴 때도 먼저 `withdrawn` PR을 merge한다.
- 페이지를 다시 공개할 때는 DB에서 먼저 공개 상태로 되돌린 뒤 PR로 `withdrawn`에서 `slugs`로 옮긴다.
