# 작업 세션 공통 시작·끝 절차 (OPS-작업양식, 2026-11-26 사용자 결정)

지시서는 이 문서를 가리키고 **과제·영역·겹치는 파일·완료 기준만** 적는다. 규칙 원문은 `AGENTS.md`와 `docs/command-center-ops.md`이고, 여기에는 순서만 둔다.

## 1. 시작

0. `AGENTS.md` 1절 '새 세션·새 계정이 시작할 때 확인할 것' 3가지를 먼저 한다.
1. 저장소 연결: `add_repo(owner=mj880616, repo=work, access=push)` (이미 연결돼 있으면 건너뜀).
2. 새 폴더에 받기: `git clone --depth 50 https://github.com/mj880616/work <새 폴더>`. 기억한 SHA를 믿지 말고 받은 `origin/main`을 기준으로 한다.
3. 커밋 작성자 메일: `git config user.email "172895968+mj880616@users.noreply.github.com"`(GitHub noreply 주소. 개인 메일 금지, `AGENTS.md` 3절).
4. 브랜치: 최신 `main`에서 만든다. 지시서가 "○○ PR 브랜치 위에서 시작"이라고 하면 그 PR head에서 만든다(줄 세우기, `AGENTS.md` 2절). 관련 브랜치·열린 PR이 있으면 이어서 쓴다.
5. 영역 확인: 지시서 첫 줄의 영역(`docs/command-center-ops.md` 1-1절, 경로 패턴은 `scripts/cc/lanes.json`) 밖 파일은 만지지 않는다. 다른 영역 파일을 꼭 고쳐야 하면 멈추고 보고한다.
6. 묻기 전에 결정 장부(1-3절)를 먼저 찾는다. 확정 동작 ID(`docs/design/standard-interactions.md`)를 만들거나 고치면 그 ID 이름의 시험을 넣는다(1-2절).
7. 첫 의미 있는 진행에서 push하고 **PR을 초안(draft)으로** 연다. 본문은 `.github/pull_request_template.md` 양식을 채운다. 그 뒤로도 의미 있는 진행마다 커밋·push.

## 2. 하지 않는 것

- `main` 직접 push, merge(merge는 CC), rebase·force push(main이 앞서면 merge만).
- production 접근: DB 쓰기·migration 적용·Edge 배포·비밀값(`AGENTS.md` 1·6·7·8절). DB가 있는 작업은 DB(짝 파일·시험) PR을 먼저, 화면·Edge는 뒤 PR.
- 로컬 브라우저 E2E(Playwright) 실행 — CI에 맡긴다. 로컬은 단위 시험·DB 시험만(`docs/web-session-testing.md`).
- 전용 포트 밖 서버·`pkill`(자기 PID만 끈다), 손으로 쓴 `?v=`(`AGENTS.md` 4절 캐시 버전).
- 범위 밖 수정·한 번 정리용 화면 버튼(`AGENTS.md` 4절). 찾은 것은 PR 본문 '범위 밖 발견사항'에.
- 토큰·이메일·개인정보·남의 기록 내용을 코드·문서·로그·PR에 쓰기(`AGENTS.md` 3절).
- 같은 명령이 두 번 실패하면 반복하지 말고 멈춰서 원인을 보고한다.

## 3. 끝

1. 지시서 완료 기준의 자동 시험을 로컬(단위)에서 돌려 통과를 본다. 요구를 지키는 시험이 없으면 시험부터 더한다.
2. 화면이 바뀌면 `app/release-notes/YYYYMMDD-HHMM-작업이름.json`과 PC(1280)·폰(412) 고치기 전·후 사진(가짜 데이터만)을 붙인다.
3. 마지막 push 뒤 CI **첫 결과**를 확인한다(gh api REST). 최종 CI 확인과 merge는 CC.
4. PR 본문을 양식대로 채운다: 완료보고 12항목(`AGENTS.md` 10절) + 영역 + 확정 동작 ID + **원장 반영** 절(행 이름·상태·한 줄 요약·사용자 결정). `docs/roadmap.md`는 고치지 않는다.
5. 초안을 해제(ready)한다: `gh api -X POST repos/mj880616/work/pulls/<번호>/ccr/ready_for_review`.
6. CC는 넣기 전에 `node scripts/cc/merge-check.mjs <PR 번호>`로 넣기 점검을 돌린다(쓰기 없음).
x 명진 결정
