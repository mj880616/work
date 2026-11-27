# 주요 화면 기준 사진 (DESIGN-검증하네스 ③)

화면 시험 대부분은 동작만 확인해서, 한 화면(공용 CSS·공용 부품)을 고칠 때 다른 화면이 틀어져도 잡지 못했다. 이 시험은 주요 화면 20개를 PC 1280px·폰 412px에서 사진으로 찍고, 저장소에 넣어 둔 기준 사진과 한 점씩 비교한다.

- 시험: `tests/app-e2e/visual-baseline.spec.mjs` (화면 20개 × 2폭 = 40개)
- 기준 사진: `tests/app-e2e/visual-baseline.spec.mjs-snapshots/<화면>-<pc|phone>-chromium-linux.png`
- 도는 곳: `App browser E2E check`(app-e2e-check.yml). 전체 시험(main push·매일·공용 부품 PR)에는 늘 들어가고, PR에서는 화면 CSS(`app/*.css`)나 기준 사진·이 시험을 고쳤을 때 함께 고른다(`scripts/ci/e2e-select.mjs`).

## 고정한 것

| 흔들림 원인 | 고정 방법 |
| --- | --- |
| 시각 | `openHome`(tests/app-e2e/helpers/home-entry.mjs)이 브라우저 시계를 2026-10-06 10:00(한국)으로 멈춘다. 시간대 `Asia/Seoul`, 언어 `ko-KR`. |
| 자료 | 가짜 서버(`openHome`)만 쓴다. 자료실 자료 6개·폴더 2개는 시험 안에서 날짜를 고정해 지어낸다. 운영 서버는 부르지 않는다. |
| 글꼴 | 모든 글자를 저장소 안 글꼴(`app/hwp-lab/rhwp-0.8.7/studio/fonts/NotoSansKR-Regular·Bold.woff2`)로 그린다. 기기별 시스템 글꼴에 따라 바뀌지 않는다. |
| 움직임 | 애니메이션·전환 끔, 입력 커서 숨김, 스크롤 막대 숨김, 마우스는 왼쪽 위 구석. |
| 늦게 오는 것 | 화면 칸이 보이고, 글꼴을 다 받고, 네트워크가 조용해진 뒤 찍는다. `toHaveScreenshot`은 연달아 찍은 두 장이 같을 때까지 기다린다. |

흔들리면 화면을 빼거나 재시도·대기 시간을 늘리지 않는다(AGENTS.md 9절). 날짜·글꼴·늦게 오는 자료 같은 원인을 찾아 고정한다.

## 화면 목록과 고른 이유

최근 merge된 PR 제목 1000개(2026-10-28 이후)에서 화면 이름이 나온 횟수와, `docs/design-decisions.md`·`docs/design/standard-interactions.md`에서 지적이 많았던 화면 위주로 골랐다.

| 사진 이름 | 화면 | 고른 이유 |
| --- | --- | --- |
| home | 홈(업무일지) | 첫 화면. PR 제목 42건, 빠른 입력·주간 보고 재료 줄이 자주 바뀜 |
| calendar | 일정 › 달력 | 일정 PR 41건, 폰 목록·PC 주 보기 모양 지적 잦음 |
| tasks | 일정 › 할 일 | 31건, 기한 묶음·줄 높이 지적 |
| diary | 일정 › 하루 기록 | 일정 묶음 전환 줄(달력·할 일·하루 기록) 확인 |
| note | 노트 | 107건으로 가장 많음. 폴더 줄·아래 입력칸 |
| forget | 잊지 말기 | 31건, 노트와 같은 화면 틀을 같이 씀 |
| library | 자료실 | 75건. 최근 파일·폴더 묶음 모양(자료 6개 지어냄) |
| photos | 사진 | 96건, 머리 줄·⋯ 메뉴 회귀가 잦았음 |
| files | 파일 | 100건, 드라이브 연결 줄·목록 |
| reading | 저장한 글 | 23건, 아래 분류 칩 줄 |
| team | 조직 관리 | 64건, 두 칸 목록·기록 칸 |
| reports | 사업 관리(사업 보고·이번 주 주간 보고) | 사업 보고 45건·BIZ 32건, 주간 보고 표 |
| areas | 사업영역 관리 창 | 12건, 사업 관리 위 창 |
| brief | 브리핑 룸 | 24건, 첫 안내·두 칸 |
| news | 읽을 거리 | 28건, 위 분류 칩 줄 |
| calls | 통화 | 운영자 메뉴(서버 허용) 화면 틀 |
| telegram | 텔레그램 소식 | 14건, 날짜 칩 줄 |
| arsenal | 아스날 | 긴 목록·경기 카드 글자 밀도 |
| profile | 내 프로필(설정) | 21건, 설정 줄 모양 |
| menu-edit | 메뉴 수정 창 | 메뉴 관련 80건, 하단바·위 메뉴 한 목록 |

## 기준 사진 갱신 (의도한 디자인 변경)

1. 화면을 고친 PR을 올리면 CI의 기준 사진 시험이 틀린다. 실패한 갈래마다 artifact `visual-diff-<갈래 번호>`가 올라온다.
   - `visual-diff/`: `<화면>-expected.png`(기준), `-actual.png`(이번), `-diff.png`(차이 빨간 표시)
   - `visual-update/`: 이번 사진을 기준 사진 이름으로 바꾼 것(새로 더한 화면의 첫 사진 포함)
2. 의도한 변경이 맞으면 저장소 맨 위에서 명령 한 줄로 받아 넣는다(`<run-id>`는 실패한 실행 번호):

   ```bash
   rm -rf /tmp/vd && gh run download <run-id> -R mj880616/work -p 'visual-diff-*' -D /tmp/vd && cp /tmp/vd/*/visual-update/*.png tests/app-e2e/visual-baseline.spec.mjs-snapshots/
   ```

3. 바뀐 기준 사진을 같은 PR에 커밋한다. PR 본문 판정 칸에 전후 사진(`expected`·`actual`)을 붙인다.

기준 사진은 CI 리눅스(ubuntu-24.04, Playwright 1.55.0 chromium)에서 만든 것만 넣는다. 다른 기기(맥·윈도·다른 Playwright 판)에서 `--update-snapshots`로 만든 사진은 글자 가장자리·그림 글자가 달라 CI에서 틀린다.

로컬에서 돌리면(`python3 tests/app-e2e/helpers/static-server.py 8123 &` 뒤 `npx playwright test tests/app-e2e/visual-baseline.spec.mjs --browser=chromium`) 기기가 달라 틀리는 것이 정상이다. 찍힌 사진과 차이는 `test-results/`에서 본다. 로컬에서 `--update-snapshots`로 바뀐 기준 사진은 커밋하지 않는다.

## 화면을 더할 때

`visual-baseline.spec.mjs`의 `SCREENS` 표에 한 줄(이름·여는 법·다 열린 곳)을 더하고 위 표에 고른 이유를 적는다. 첫 CI 실행은 기준 사진이 없어 틀리고, `visual-update/`에 그 화면 사진이 올라온다. 위 2~3 단계로 넣는다.
