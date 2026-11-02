// UI-업데이트기록입구(요청함 10/30): '업데이트 기록' 화면(?view=updates). #updatesView의 유일한 그리기 주인.
// 입구는 계정 메뉴(PC 오른쪽 위·폰 [메뉴]의 계정 칸) [내 프로필] 바로 아래 [업데이트 기록] 한 줄(topbar-actions.js)이고,
// 화면 전환·뒤로가기는 라우터(KPTURouter) 한 주인이 맡는다. 옛 내 프로필 맨 아래 칸은 없앴다(같은 기록 두 곳 금지).
// 읽는 것은 배포물 app/release-notes.json 하나(빌드가 만든 공개 파일). 서버·기기 저장 없음. 글자는 textContent로만 넣는다.
import {shortDate,PAGE_SIZE,searchNotes,searchWords} from './release-notes-model.mjs';
import {highlightParts} from './global-search-model.mjs';
import {readReleaseNotes} from './release-notes-read.js';
import {waitHtml,failHtml,emptyHtml} from './wait-state.js';

// UI-업데이트기록찾기(요청함 11/02): 목록 위 검색 칸 하나. 치는 대로 이 화면 안에서만 거르고(서버 호출 없음) 낱말을 칠한다.
// 찾는 동안은 맞는 줄만 펼쳐 보인다. 목록은 20개씩 그리고, 아래로 내려 [이전 기록 더 보기]가 보이면 다음 20개를 더 그린다.
const el=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!=null)node.textContent=text;return node};
function marked(tag,className,text,words){
  const node=el(tag,className);
  if(!words.length){node.textContent=text;return node}
  for(const part of highlightParts(text,words))node.append(part.mark?el('mark','rn-mark',part.text):document.createTextNode(part.text));
  return node;
}

function noteRow(item,current,words){
  const {note}=item,searching=words.length>0;
  const row=el('details','rn-note');
  if(note.v===current||searching)row.open=true;
  const head=el('summary','rn-head');
  head.append(marked('span','rn-ver',note.v,words),marked('span','rn-date',shortDate(note.date),words));
  if(note.v===current)head.append(el('span','rn-now','지금'));
  else head.append(marked('span','rn-one',item.changes[0]??item.checks[0],words));
  const body=el('div','rn-body');
  if(item.changes.length){
    const list=el('ul','rn-changes');
    for(const line of item.changes)list.append(marked('li',null,line,words));
    body.append(list);
  }
  if(item.checks.length){
    const check=el('p','rn-check');
    check.append(el('span','rn-check-label','폰에서 볼 것'),document.createTextNode(' '));
    item.checks.forEach((line,i)=>{if(i)check.append(document.createTextNode(' · '));check.append(marked('span',null,line,words))});
    body.append(check);
  }
  row.append(head,body);
  return row;
}

function install(){
  if(document.getElementById('updatesView'))return;
  document.getElementById('appView')?.insertAdjacentHTML('beforeend','<section id="updatesView" class="view-panel hidden" aria-label="업데이트 기록"><div class="panel rn-view" data-rn-root></div></section>');
}

let drawn=false,drawing=null,observer=null;
function draw(){
  const root=document.querySelector('#updatesView [data-rn-root]');
  if(!root||drawn)return Promise.resolve();
  if(drawing)return drawing;
  root.innerHTML=waitHtml();
  drawing=readReleaseNotes().then(list=>{
    if(!list){root.innerHTML=failHtml({retry:'data-rn-retry'});return}
    drawn=true;
    if(!list.notes.length){root.innerHTML=emptyHtml();return}
    const all=list.notes.map(note=>({note,changes:note.changes,checks:note.checks}));
    const search=el('input','rn-search');
    Object.assign(search,{type:'search',placeholder:'낱말로 찾기',autocomplete:'off',enterKeyHint:'search'});
    search.setAttribute('aria-label','업데이트 기록 찾기');
    const count=el('p','rn-count');count.setAttribute('role','status');count.hidden=true;
    const box=el('div','rn-list');
    const more=el('button','rn-more mini','이전 기록 더 보기');more.type='button';
    let items=all,words=[],shown=0;
    const page=()=>{
      for(const item of items.slice(shown,shown+PAGE_SIZE))box.append(noteRow(item,list.current,words));
      shown=Math.min(items.length,shown+PAGE_SIZE);more.hidden=shown>=items.length;
    };
    const apply=()=>{
      words=searchWords(search.value);
      items=searchNotes(list.notes,search.value)??all;
      shown=0;box.replaceChildren();
      count.hidden=!words.length;
      count.textContent=words.length?(items.length?`찾은 기록 ${items.length}개`:'찾는 기록이 없어요'):'';
      page();
    };
    search.addEventListener('input',apply);
    more.addEventListener('click',page);
    observer?.disconnect();
    observer=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)&&!more.hidden)page()},{rootMargin:'0px 0px 120px 0px'}):null;
    observer?.observe(more);
    page();
    root.replaceChildren(search,count,box,more);
  }).finally(()=>{drawing=null});
  return drawing;
}

install();
document.querySelector('#updatesView')?.addEventListener('click',event=>{if(event.target.closest?.('[data-rn-retry]'))void draw()});
window.KPTURouter?.on?.('updates',()=>draw());
void draw();
