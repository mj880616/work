# S60-12b FORGET-넣기되돌리기 — 조사 기록

## 원인
- 잊지 말기 [무시]·[이미 함]은 `offerUndoNotice`(2초 [되돌리기])를 띄우지만, [조직]·[사업]은 `newsKeep`·`candidateReport`가 `newsMark`/`decideCandidate`를 undo 없이 불러 알림 글만 남는다.
- 넣은 기록의 id도 버린다: `saveOrg`·`saveArea`가 `saveOrganizationUpdate`·`saveBusinessRecord`의 돌려받은 줄(return=representation)을 쓰지 않는다.

## 고칠 곳
- `app/forget-list.js`: 넣은 줄 id를 받아 두고, 알림을 '○○ 기록에 넣었어요 · [되돌리기]'로. [되돌리기] = 기존 소유자 삭제 길(`deleteOrgUpdate`·`deleteBusinessRecord`)로 그 한 줄 삭제 → 소식 줄 `decideNews(…,'suggested')` / 후보 `reopenCandidate(…,'done')`로 처리 전으로.
- 삭제는 됐는데 되살리기가 실패하면 그대로 알린다.
- DB·Edge 변경 없음.

## 같은 종류 전수(넣은 뒤 되돌리기)

| 화면·버튼 | 전 | 이 PR 뒤 | 비고 |
| --- | --- | --- | --- |
| 잊지 말기 소식 줄 [조직] | 알림 글만 | 2초 [되돌리기] = 조직 기록 한 줄 삭제 + 소식 줄 처리 전 | |
| 잊지 말기 소식 줄 [사업] | 알림 글만 | 2초 [되돌리기] = 사업 기록 한 줄 삭제 + 소식 줄 처리 전 | |
| 잊지 말기 챙길 것·텔레그램 후보 [조직]·[사업] | 알림 글만 | 2초 [되돌리기] = 기록 삭제 + 후보 처리 전(done → open) | |
| 잊지 말기 [무시]·[이미 함]·[내 일 아님] | 되돌리기 있음 | 그대로 | |
| 텔레그램 소식·통화 줄 '조직 연결'(feed-link.js saveLinkBox → feed-data.js linkOrganization) | 되돌리기 없음 | 그대로(범위 밖 보고) | 고르기 → 요약 상자 → [저장] 두 단계라 한 번 잘못 누름으로는 넣어지지 않음. 되돌리려면 그 줄의 조직 연결(organization_id)도 이전 값으로 돌려야 해 telegram-feed.js·call-feed.js를 함께 고쳐야 함 → 별도 과제 제안 |
| 업데이트 → 조직·사업(기록할 곳) | 저장 뒤 되돌리기 없음, 바구니 [연결 해제]에 되돌리기 있음 | 그대로 | 요청함의 'UI-기록할곳되돌리기'는 고르기 창 '최근 고른 곳' 기억이며 저장 되돌리기가 아님 |

- 이미 들어가 있던 같은 원래 줄(DB 고유 색인 409, 돌려받은 줄 없음)이면 이번에 넣은 것이 아니므로 [되돌리기]를 띄우지 않는다(남의 기록을 지우지 않게).
- 화면: 폰 412 `forget-save-undo-412.png`, PC 1280 `forget-save-undo-1280.png`(시험 화면, 지어낸 이름).
