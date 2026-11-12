# S60-12b FORGET-넣기되돌리기 — 조사 기록

## 원인
- 잊지 말기 [무시]·[이미 함]은 `offerUndoNotice`(2초 [되돌리기])를 띄우지만, [조직]·[사업]은 `newsKeep`·`candidateReport`가 `newsMark`/`decideCandidate`를 undo 없이 불러 알림 글만 남는다.
- 넣은 기록의 id도 버린다: `saveOrg`·`saveArea`가 `saveOrganizationUpdate`·`saveBusinessRecord`의 돌려받은 줄(return=representation)을 쓰지 않는다.

## 고칠 곳
- `app/forget-list.js`: 넣은 줄 id를 받아 두고, 알림을 '○○ 기록에 넣었어요 · [되돌리기]'로. [되돌리기] = 기존 소유자 삭제 길(`deleteOrgUpdate`·`deleteBusinessRecord`)로 그 한 줄 삭제 → 소식 줄 `decideNews(…,'suggested')` / 후보 `reopenCandidate(…,'done')`로 처리 전으로.
- 삭제는 됐는데 되살리기가 실패하면 그대로 알린다.
- DB·Edge 변경 없음.
