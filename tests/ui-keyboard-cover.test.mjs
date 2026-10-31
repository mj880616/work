import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
// UI-자판가림(2026-10-31): 폰 자판이 열리면 화면 아래에 붙은 줄은 모두 숨고(쓰는 칸이 든 줄만 남음), 칸은 자판 위로 올라온다.
// 규칙은 한 곳: 감지·칸 표시·올리기는 app/accessibility-dialog.js, 숨김 목록은 app/ui-standard.css 맨 아래 UI-자판가림 절.
// 이 시험은 app/*.css 전체에서 화면 아래에 붙는(position fixed/sticky + bottom) 규칙을 모두 찾아,
// 숨김 목록에 들었거나 아래 '숨기지 않는 까닭' 표에 있는지 본다. 새 붙박이 줄이 목록 밖으로 생기면 실패한다.
const read=f=>readFileSync(new URL('../app/'+f,import.meta.url),'utf8');
const css=read('ui-standard.css'),js=read('accessibility-dialog.js');
const section=css.slice(css.indexOf('UI-자판가림(2026-10-31'));
const hideRule=(section.match(/body\.kptu-mobile-keyboard :is\(([\s\S]*?)\):not\(:has\(\[data-keyboard-field\]\)\)\{ display:none !important; \}/)||[])[1]||'';
const staticRule=(section.match(/body\.kptu-mobile-keyboard :is\(([^)]*(?:\([^)]*\))*[^)]*)\)\{ position:static; \}/)||[])[1]||'';

// 숨김 목록 밖에 두는 것과 그 까닭(셀렉터 앞부분으로 찾음).
const exempt=[
 ['.modal','팝업 창 바탕(칸이 그 안에 있음). 자판 위에서 끝나게 bottom만 맞춘다'],
 ['.modal-action-footer','팝업 아래 버튼 줄: 자판이 열리면 data-keyboard-open으로 제자리 흐름(base-ui.css)'],
 ['.kptu-select-inset','보이지 않는 높이 재기 막대'],
 ['.kptu-select-menu','고르기 메뉴(누를 때만 열림)'],
 ['.home-choice-sheet','고르기 시트(칸이 그 안에 있음)'],
 ['.topline-add-menu','메뉴'],['.ql-menu','메뉴'],['.quick-links-panel','PC 바로가기 창'],
 ['.diary-viewer','전체 화면 보기'],['#appView :is(#diaryView,#photosView) .diary-viewer','전체 화면 보기'],
 ['#appView :is(#diaryView,#photosView) .diary-od-modal','팝업 창'],['.diary-lv-menu','메뉴'],
 ['.modal.ed-window','쓰기 창: 자판 위에서 끝남(--kptu-keyboard-inset), 아래 버튼 줄은 ed-window.css가 숨김'],
 ['.feed-menu','메뉴'],['.gs-row-menu','메뉴'],['.gt-task-menu','메뉴'],
 ['#appView #hwpView .hwp-lab[data-focus]','전체 화면 편집'],['.hwp-bar-panel','메뉴'],
 [':is(.lu-more-panel,.lu-folder-menu)','메뉴'],['.lu-drop-overlay','끌어 놓기 표시'],['.lu-move-picker','고르기 시트'],
 ['.html-frame-full','전체 화면 보기'],['.od-link-menu','메뉴'],['.ps3-record-menu','메뉴'],['.rb-menu','메뉴'],
 ['.radar-row-menu','메뉴'],['.account-panel','계정 창'],['.mobile-menu','전체 메뉴'],
 ['.basket-photo-view','전체 화면 보기'],['.task-inline-menu','메뉴'],['.task-due-popup','달력 팝업'],['.basket-link-menu','메뉴'],
];
function bottomRules(){
 const out=[];
 for(const f of readdirSync(new URL('../app/',import.meta.url)).filter(f=>f.endsWith('.css'))){
  const src=read(f).replace(/\/\*[\s\S]*?\*\//g,'');
  for(const m of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)){
   const body=m[2];if(!/position:\s*(fixed|sticky)/.test(body))continue;
   const b=body.match(/(?:^|;)\s*bottom:\s*([^;]+)/),inset=body.match(/(?:^|;)\s*inset:\s*([^;]+)/);
   if(!(b&&!/auto/.test(b[1]))&&!inset)continue;
   out.push({file:f,selector:m[1].trim().replace(/\s+/g,' ')});
  }
 }
 return out;
}
const norm=s=>s.replace(/\s+/g,'');
const listed=sel=>[hideRule,staticRule].some(rule=>norm(rule).includes(norm(sel).replace(/:not\(\[hidden\]\)$/,'').replace(/^#appView#calendarView\.calendar-toolbar#newEventBtn,.*$/,'#calendarView.calendar-toolbar#newEventBtn')));

test('감지 한 곳: 쓰는 칸 표시, 자판 위로 올리기, 손으로 스크롤은 그대로',()=>{
 assert.match(js,/data-keyboard-field/);
 assert.match(js,/function revealField\(/);
 assert.match(js,/scrollIntoView\(\{block:tall\?'start':'nearest'/);
 // 여유는 그때그때 잰다: 위쪽 붙박이 머리줄(팝업 제목 줄 등) 아래, 자판 위 1~2줄. 쓴 뒤 칸에 남기지 않는다.
 assert.match(js,/function barAt\(field,x,y\)/);
 assert.match(js,/top\+=8;bottom-=40;/);
 assert.match(js,/field\.style\.scrollMarginTop='';field\.style\.scrollMarginBottom='';/);
 // 올리기는 칸에 초점이 갈 때·자판이 열리거나 커질 때만(화면 스크롤 이벤트로는 다시 끌어오지 않음).
 assert.match(js,/if\(keyboardOpen&&editing&&\(opened\|\|\(moved&&field\)\|\|height<shownHeight-1\)\)revealField\(field\)/);
 // 한글 상자(iframe) 안에서 쓸 때도 자판으로 본다.
 assert.match(js,/\[contenteditable="true"\],iframe'/);
});

test('숨김 목록 한 곳: 쓰는 칸이 든 줄만 남기고, 화면마다 따로 숨기는 옛 규칙은 없음',()=>{
 assert.ok(hideRule,'UI-자판가림 숨김 규칙이 있어야 함');
 for(const dock of ['.mobile-tabs','#newEventBtn','.home-quick[data-home-quick]','.schedule-switch','.save-row-sticky','.photos-act','.photos-rail','.feed-undo'])assert.ok(hideRule.includes(dock),dock);
 assert.doesNotMatch(css,/body\.kptu-mobile-keyboard #appView \.schedule-switch\{ display:none; \}/);
 assert.doesNotMatch(css,/body\.kptu-mobile-keyboard #appView :is\(#calendarView[^{]*\{ display:none; \}/);
 assert.match(section,/body\.kptu-mobile-keyboard \.modal:not\(\.ed-window\)\{ bottom:var\(--kptu-keyboard-inset,0px\); \}/);
});

test('전수: 화면 아래에 붙는 규칙은 모두 숨김·제자리 목록이나 까닭 표에 있음',()=>{
 const rules=bottomRules();assert.ok(rules.length>20);
 const missing=[];
 for(const {file,selector} of rules){
  if(listed(selector))continue;
  if(exempt.some(([sel])=>norm(selector).startsWith(norm(sel))))continue;
  missing.push(file+' | '+selector);
 }
 assert.deepEqual(missing,[],'자판이 열릴 때 칸을 덮을 수 있는 아래 붙박이: ui-standard.css UI-자판가림 목록에 더하거나 까닭을 적는다');
});
