import {test} from 'node:test';
import assert from 'node:assert/strict';
import {countColors,compareColors,checkBaseline} from './hardcoded-colors.mjs';
test('direct colors never exceed baseline',()=>assert.deepEqual(checkBaseline().errors,[]));
test('new hex or rgb colors in existing and new files fail',()=>{
 const baseline={'ui.css':1};
 for(const color of ['#abc','#abcd','#abcdef','#abcdef12','rgb(1,2,3)','rgba(1,2,3,.2)']){
  const count=countColors('ui.css','a{color:#fff;background:'+color+'}');
  assert.equal(count,2);assert.equal(compareColors({'ui.css':count},baseline).errors.length,1);
  assert.equal(compareColors({'new.js':countColors('new.js','const color="'+color+'"')},baseline).errors.length,1);
 }
});
test('decreases pass and request baseline refresh',()=>{
 const result=compareColors({'ui.css':0},{'ui.css':1});assert.deepEqual(result.errors,[]);assert.equal(result.reduced.length,1);
});
test('only approved exclusions skip colors',()=>{
 assert.equal(countColors('base-ui.css',':root{--kptu-bg:#fff} #abc{color:#123}'),1);
 for(const name of ['theme-tokens.css','page-design-core.js','public-page-editor.js'])assert.equal(countColors(name,'color:#fff'),0);
 assert.equal(countColors('other.js','const color="#fff"'),1);
});

// D-3b 의도된 예외: 기존 var(--kptu-*, 색) 대체값은 그대로 센다.
// Google 상표 #4285f4와 calendar-plus.js의 Google 일정 원래 색/foreground,
// calendar-month-view.js의 일정 대비 글자, calendar-day-overflow.js의 일정 색은 유지한다.
// team.js의 MEETING_COLORS 12색은 회의 색 띠로 유지한다.
// base-ui.css의 rgba(18,26,35,.46)는 창 뒤 반투명 바탕이다.
// page-design-core.js/public-page-editor.js는 사용자 콘텐츠 색이므로 검사 제외를 유지한다.
// base-ui.css의 #f3f0f7 보라 바탕은 지시서의 유지 대상이다.
// D-3b 사용자 결정: 아래 색은 의도된 예외이며 검사 개수에는 계속 포함한다.
// native-auth-bridge.js/calendar-return-bridge.js: 테마 파일이 닿지 않는 독립 문서.
// public-page-auth.js: 앱 로더가 불러오지 않는 공개 인증 화면.
// web1-board.js:18·19/web1-press.js:61: 별도 srcdoc iframe 문서 안 글자.
// app.js:56 진단 버튼 그림자, base-ui.css:76 작은 버튼 그림자: 기존 모양 유지.
// project-suborganization-links.js/project-task-link.js/project-templates.js/
// project-update-actions.js/task-notes.js: 현재 앱 로더가 불러오지 않는 모듈.
// 사용처 확인 후 제거 여부는 D-6에서 판단하며 이번에는 색을 유지한다.
