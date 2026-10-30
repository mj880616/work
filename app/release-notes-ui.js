// UI-업데이트기록입구(요청함 10/30): '업데이트 기록' 화면(?view=updates). #updatesView의 유일한 그리기 주인.
// 입구는 계정 메뉴(PC 오른쪽 위·폰 [메뉴]의 계정 칸) [내 프로필] 바로 아래 [업데이트 기록] 한 줄(topbar-actions.js)이고,
// 화면 전환·뒤로가기는 라우터(KPTURouter) 한 주인이 맡는다. 옛 내 프로필 맨 아래 칸은 없앴다(같은 기록 두 곳 금지).
// 읽는 것은 배포물 app/release-notes.json 하나(빌드가 만든 공개 파일). 서버·기기 저장 없음. 글자는 textContent로만 넣는다.
import {shortDate,PAGE_SIZE} from './release-notes-model.mjs';
import {readReleaseNotes} from './release-notes-read.js';
import {waitHtml,failHtml,emptyHtml} from './wait-state.js';

const el=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!=null)node.textContent=text;return node};

function noteRow(note,current){
  const row=el('details','rn-note');
  if(note.v===current)row.open=true;
  const head=el('summary','rn-head');
  head.append(el('span','rn-ver',note.v),el('span','rn-date',shortDate(note.date)));
  if(note.v===current)head.append(el('span','rn-now','지금'));
  else head.append(el('span','rn-one',note.changes[0]));
  const body=el('div','rn-body'),list=el('ul','rn-changes');
  for(const line of note.changes)list.append(el('li',null,line));
  body.append(list);
  if(note.checks.length){
    const check=el('p','rn-check');
    check.append(el('span','rn-check-label','폰에서 볼 것'),document.createTextNode(' '+note.checks.join(' · ')));
    body.append(check);
  }
  row.append(head,body);
  return row;
}

function install(){
  if(document.getElementById('updatesView'))return;
  document.getElementById('appView')?.insertAdjacentHTML('beforeend','<section id="updatesView" class="view-panel hidden" aria-label="업데이트 기록"><div class="panel rn-view" data-rn-root></div></section>');
}

let drawn=false,drawing=null;
function draw(){
  const root=document.querySelector('#updatesView [data-rn-root]');
  if(!root||drawn)return Promise.resolve();
  if(drawing)return drawing;
  root.innerHTML=waitHtml();
  drawing=readReleaseNotes().then(list=>{
    if(!list){root.innerHTML=failHtml({retry:'data-rn-retry'});return}
    drawn=true;
    if(!list.notes.length){root.innerHTML=emptyHtml();return}
    const box=el('div','rn-list');
    let shown=0;
    const more=el('button','rn-more mini','이전 기록 더 보기');more.type='button';
    const page=()=>{for(const note of list.notes.slice(shown,shown+PAGE_SIZE))box.append(noteRow(note,list.current));shown=Math.min(list.notes.length,shown+PAGE_SIZE);more.hidden=shown>=list.notes.length};
    more.addEventListener('click',page);
    page();
    root.replaceChildren(box,more);
  }).finally(()=>{drawing=null});
  return drawing;
}

install();
document.querySelector('#updatesView')?.addEventListener('click',event=>{if(event.target.closest?.('[data-rn-retry]'))void draw()});
window.KPTURouter?.on?.('updates',()=>draw());
void draw();
