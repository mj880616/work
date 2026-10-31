import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// UI-저장자리: 저장 버튼은 창(칸)의 오른쪽 아래, 순서는 [취소] 왼쪽 → [저장] 맨 오른쪽.
// 화면 만드는 글을 정적으로 읽어, 새로 추가된 저장 줄이 규칙을 어기지 않는지 지킨다. 실제 위치는 tests/app-e2e/save-button-rule.spec.mjs.
const read=f=>readFileSync(new URL('../app/'+f,import.meta.url),'utf8');
const css=read('ui-standard.css'),base=read('base-ui.css');
// 단추 하나(<button ...>글</button>)를 순서대로 뽑는다.
const buttons=html=>[...html.matchAll(/<button\b([^>]*)>([^<]*)<\/button>/g)].map(m=>({attrs:m[1],text:m[2].trim()}));
// 줄 하나(save-row 또는 modal-action-footer)의 안쪽 글을 뽑는다.
const rows=(src,cls)=>[...src.matchAll(new RegExp('<div class="[^"]*\\b'+cls+'\\b[^"]*"[^>]*>([\\s\\S]*?)<\\/div>','g'))].map(m=>m[1]);

test('저장 줄 CSS: 오른쪽 정렬, 맨 아래 고정 줄은 자판이 올라오면 숨김, 왼쪽 단추는 따로 지정',()=>{
 assert.match(css,/\.save-row\{[^}]*justify-content:flex-end/);
 assert.match(css,/\.save-row\s*>\s*\.save-row-start[^{]*\{[^}]*margin-right:auto/);
 assert.match(css,/\.save-row-sticky\{[^}]*position:sticky[^}]*bottom:calc\(var\(--kptu-mobile-tab-height/);
 // 자판이 열리면 숨는 것은 UI-자판가림 한 목록(tests/ui-keyboard-cover.test.mjs)에 든다.
 assert.match(css,/body\.kptu-mobile-keyboard :is\([^{]*\.save-row-sticky,[^{]*\):not\(:has\(\[data-keyboard-field\]\)\)\{ display:none !important; \}/);
 assert.match(base,/\.modal-action-footer\{[^}]*justify-content:flex-end/);
});
test('예전 떠 있는 [저장](float-save)은 없다',()=>{
 for(const f of ['diary.js','basket.js','basket-notes.js','accessibility-dialog.js'])assert.doesNotMatch(read(f),/float-?save|floatSave/i,f);
});
test('일기·노트·업데이트·일지·창 쓰기 칸: 줄 안에서 [저장]이 맨 오른쪽, [취소]가 그 앞',()=>{
 const files=['diary.js','basket.js','basket-notes.js','journal.js','ed-window.js','profile-settings.js','workplace-detail.js','workplace-report.js'];
 let checked=0;
 for(const f of files){
  for(const inner of rows(read(f),'save-row')){
   const list=buttons(inner);const si=list.findIndex(b=>/^저장/.test(b.text));if(si<0)continue;
   checked++;
   assert.equal(si,list.length-1,f+': [저장]이 줄의 맨 오른쪽이어야 함');
   const ci=list.findIndex(b=>/^취소$/.test(b.text));
   if(ci>=0)assert.equal(ci,si-1,f+': [취소]는 [저장] 바로 앞');
  }
 }
 assert.ok(checked>=3,'검사한 저장 줄이 너무 적음: '+checked);
});
test('팝업 아래 줄(modal-action-footer): 가장 오른쪽(마지막) 단추가 [저장] 계열(primary), 상태 글은 단추 앞',()=>{
 let checked=0;
 for(const line of read('index.html').split('\n')){
  const at=line.indexOf('class="modal-action-footer"');if(at<0)continue;
  const tail=line.slice(at,line.indexOf('</div></div></div>',at)+6);
  const list=buttons(tail);checked++;
  assert.ok(list.length>=1,'버튼 없음');
  assert.match(list.at(-1).attrs,/\bprimary\b/,'마지막 단추는 primary');
  assert.match(list.at(-1).text,/저장|등록/);
  assert.ok(tail.indexOf('class="status"')<tail.indexOf('<button'),'상태 글은 단추 줄 위');
 }
 assert.ok(checked>=4,'검사한 팝업 줄이 너무 적음: '+checked);
});
test('Enter / Ctrl+Enter 저장 표시(data-enter-save-submit)는 일기·창 저장 단추에 그대로 있다',()=>{
 assert.match(read('diary.js'),/data-diary-save data-enter-save-submit/);
 assert.match(read('ed-window.js'),/saveButton\.dataset\.enterSaveSubmit = ''/);
});
