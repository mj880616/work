// S67-64 UI-윗줄한줄(2026-11-21 사용자 시안 D3 + D2 제목 글씨): 폰(~760px) 화면 윗줄 맨 앞의 WORK ON 아이콘(누르면 홈).
// 그림은 앱 아이콘(app/app-icon.svg) 하나. 모양·크기·보이는 폭은 ui-standard.css 'S67-64 UI-윗줄한줄' 묶음 한 곳.
// 이 글자(HEAD_MARK_HTML)가 원본이다: 앱 머리줄(.mobile-shell-header)은 index.html에 같은 글자로 있고(S70-57부터 사업 관리도 앱 머리줄을 씀)
// (시험 tests/head-mark.test.mjs가 같음을 본다), 홈 날짜 머리줄은 journal.js가 이 값을 그대로 넣는다.
// 누르기는 라우터의 공용 data-goto 길(app-router.js)이 받는다. DOM·네트워크·기기 저장소 없음.
export const HEAD_MARK_HTML = '<a class="head-mark" href="./?view=home" data-goto="home" aria-label="홈"><img src="./app-icon.svg" width="20" height="20" alt=""></a>';
