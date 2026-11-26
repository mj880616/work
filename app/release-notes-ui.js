// UI-업데이트기록입구(요청함 10/30): '업데이트 기록' 화면(?view=updates). #updatesView의 유일한 그리기 주인.
// 입구는 계정 메뉴(PC 오른쪽 위·폰 [메뉴]의 계정 칸) [내 프로필] 바로 아래 [업데이트 기록] 한 줄(topbar-actions.js)이고,
// 화면 전환·뒤로가기는 라우터(KPTURouter) 한 주인이 맡는다. 옛 내 프로필 맨 아래 칸은 없앴다(같은 기록 두 곳 금지).
// UPDATE-운영자전용기록업데이트소식 PR1: 읽는 것은 서버 기록 하나(app_release_notes_read — 운영자만, 서버가 거절). 기기 저장 없음. 글자는 textContent로만 넣는다.
// 운영자가 아닌 계정이 주소로 들어오면 서버에 묻지 않고 '운영자만 볼 수 있어요' 한 줄.
import {shortDate,PAGE_SIZE,searchNotes,searchWords} from './release-notes-model.mjs';
import {highlightParts} from './global-search-model.mjs';
import {readReleaseNotes,canReadReleaseNotes} from './release-notes-read.js';
import {waitHtml,failHtml,emptyHtml} from './wait-state.js';
import {draftLines,linesFromText,draftProblem,withdrawPlan,withdrawNote,WITHDRAW_TEXT,noteState,resendPlan,resendNote,RESEND_TEXT,looseNews} from './update-news-model.mjs';
import {newsRow} from './update-news-ui.js';
import {openFormModal} from './small-form-modal.js';
import {askConfirm,notify} from './small-notice.js';
// S71-31 RELNOTE-머리줄정리: 찾기는 맨 위 칸이 겸하고(폰은 머리 줄 돋보기를 누르면 그 자리에서 칸이 열림), [+](직접 쓰기)는 맨 위 줄 단추 자리(screen-find.js).
import {registerScreenFind,refreshScreenFind,toolsBox} from './screen-find.js';

// UI-업데이트기록찾기(요청함 11/02): 치는 대로 이 화면 안에서만 거르고(서버 호출 없음) 낱말을 칠한다.
// S71-31(명진 11/26 "낱말로 찾기랑 직접 쓰기 한줄로 / 낱말로 찾기는 찾기로"): 화면 안 찾기 칸은 없애고 맨 위 칸 '업데이트 기록에서 찾기'(용어 기준표)가 겸한다.
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
  // UPDATE-운영자전용기록업데이트소식 PR3: 줄마다 [보내기](이용자에게 업데이트 소식으로). 소식 서버를 못 읽으면 없다.
  // S67-73(명진 11/21 "보내기 버튼이 보냄으로 바뀌어야지"): 이미 보낸 기록은 따로 '보냄' 꼬리표를 달지 않고 같은 버튼이 [보냄]으로 바뀐다.
  // S68-14(명진 11/22 "보낸 후 거둬들일 수가 없음"): [보냄]을 누르면 그 기록이 든 소식을 거둔다(같은 버튼 하나, 새 버튼 없음).
  // S68-46(명진 11/23 "기본 자동으로 보내고 수동으로는 회수 가능하게"): 새 기록은 서버가 자동으로 보내 처음부터 [보냄]이고, 거둔 기록은 [다시 보내기].
  if(news.admin){
    const send=el('button','rn-send mini');send.type='button';send.dataset.rnSend=note.v;if(note.file)send.dataset.rnFile=note.file;paintSend(send);
    head.append(send);
  }
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

// ── UPDATE-운영자전용기록업데이트소식 PR3(시안 PR 2638 ①②④ + 명진 11/15 13:37): 운영자 쪽 '업데이트 소식' 보내기·고치기·거두기·시작 날짜.
// 쓰기는 서버(app_update_news_*)가 운영자만 받는다. 새 소식 알림·점·숫자는 없다(이용자는 메뉴 › 업데이트 소식을 눌러야만 본다).
const news={admin:null,notes:[],root:null};
const rpc=(name,body={})=>window.KPTURuntime.api('/rest/v1/rpc/'+name,{method:'POST',body,singleFlight:false});
async function loadAdmin(){
  try{const value=await rpc('app_update_news_admin');news.admin=value&&Array.isArray(value.items)?value:null}catch{news.admin=null}
  return news.admin;
}
// 기록 줄 버튼 하나의 모양: 보낸 기록이면 [보냄](누르면 거두기), 거둔 기록이면 [다시 보내기], 아니면 [보내기].
// 처음 그릴 때·보낸 뒤·거둔 뒤·다시 보낸 뒤 모두 이 함수만 쓴다. 자동 소식은 기록 파일 이름으로 맞춘다(noteState).
const noteOf=btn=>({v:btn.dataset.rnSend,file:btn.dataset.rnFile||''});
function paintSend(btn){
  const v=btn.dataset.rnSend,state=noteState(news.admin?.items,noteOf(btn));
  btn.textContent=state==='sent'?'보냄':state==='withdrawn'?'다시 보내기':'보내기';btn.classList.toggle('rn-sent',state==='sent');
  btn.setAttribute('aria-label',state==='sent'?`${v} 이용자에게 보냄 · 눌러서 거두기`:state==='withdrawn'?`${v} 거둔 소식 다시 보내기`:`${v} 이용자에게 보내기`);
}
// 거두기 하나: 소식 id들을 기존 서버 함수(app_update_news_withdraw, 운영자만)로 거두고 같은 afterWrite로 다시 그린다.
async function withdrawNews(anchor,ids,note=''){
  if(!ids.length||!await askConfirm(anchor,{text:WITHDRAW_TEXT,note,ok:'거두기',danger:true}))return;
  try{for(const id of ids)await rpc('app_update_news_withdraw',{p_id:id});void afterWrite('거뒀어요')}
  catch(error){await loadAdmin();refreshMarks();notify(failLine(error),{record:false,error:true})}
}
// 다시 보내기 하나: 거둔 소식 id들을 서버 함수(app_update_news_resend, 운영자만)로 다시 보이게 하고 같은 afterWrite로 다시 그린다.
async function resendNews(anchor,ids,note=''){
  if(!ids.length||!await askConfirm(anchor,{text:RESEND_TEXT,note,ok:'다시 보내기'}))return;
  try{for(const id of ids)await rpc('app_update_news_resend',{p_id:id});void afterWrite('다시 보냈어요')}
  catch(error){await loadAdmin();refreshMarks();notify(failLine(error),{record:false,error:true})}
}
function refreshMarks(){
  news.root?.querySelectorAll('[data-rn-send]').forEach(paintSend);
  paintNews();
}
const failLine=error=>/OPERATOR_FEATURE_REQUIRED|42501/.test(String(error?.message||error))?'운영자만 보낼 수 있어요':'보내지 못했어요. 잠시 뒤 다시 해 주세요';
async function afterWrite(text){await loadAdmin();refreshMarks();notify(text,{record:false})}

// 보내기 창: 기록 줄에서 열면 그 기록 글이 채워진다('폰에서 볼 것'은 기본으로 뺌). [+ 다른 기록 묶기]로 여러 기록을 한 소식으로. 보내기 전에 문구를 고친다.
// item이 있으면 직접 쓴 소식 수정(기록 줄에 없는 소식 줄의 [수정]).
// S71-31: 시작 날짜는 화면에서 정하지 않는다(서버에 저장된 값이 그대로 쓰인다) — 창 안 '시작 날짜도 정하기' 칸을 뺐다.
function openSend({versions=[],item=null,trigger}={}){
  let picked=[...versions],edited=false,withChecks=false;
  const notesOf=()=>picked.map(v=>news.notes.find(n=>n.v===v)).filter(Boolean);
  let title,area,chips,adder;
  const regen=()=>{if(!edited)area.value=draftLines(notesOf(),{withChecks}).map(line=>'· '+line).join('\n')};
  const paintChips=()=>{
    chips.replaceChildren(...picked.map(v=>{const chip=el('button','un-chip mini',`${v} ×`);chip.type='button';chip.setAttribute('aria-label',`${v} 빼기`);chip.onclick=()=>{picked=picked.filter(x=>x!==v);paintChips();regen()};return chip}));
    const head=el('option',null,'+ 다른 기록 묶기');head.value='';
    adder.replaceChildren(head,...news.notes.slice(0,60).filter(n=>!picked.includes(n.v)).map(n=>{const o=el('option',null,`${n.v} · ${n.changes[0]}`);o.value=n.v;return o}));
    adder.value='';
  };
  openFormModal({id:'updateNewsSend',title:item?'업데이트 소식 수정':'이용자에게 업데이트 소식 보내기',okLabel:item?'수정':'보내기',trigger,
    foot:'로그인한 모든 이용자에게 보여요. 보낸 뒤에도 수정하거나 거둘 수 있어요.',
    fill(body){
      title=el('input');Object.assign(title,{type:'text',placeholder:'제목(선택)',maxLength:80});title.setAttribute('aria-label','제목(선택)');
      area=el('textarea');area.dataset.autogrow='';area.setAttribute('aria-label','보낼 글(줄마다 한 가지)');area.addEventListener('input',()=>{edited=true});
      body.append(title,area);
      if(item){title.value=item.title||'';area.value=(item.lines||[]).map(line=>'· '+line).join('\n');picked=[...(item.sources||[])];edited=true}
      const opt=el('label','sfm-opt');const box=el('input');box.type='checkbox';box.onchange=()=>{withChecks=box.checked;regen()};
      opt.append(box,document.createTextNode("'폰에서 볼 것' 줄도 같이 보내기"));
      chips=el('div','un-chips');adder=el('select','un-adder');adder.setAttribute('aria-label','다른 기록 묶기');
      adder.onchange=()=>{if(adder.value&&!picked.includes(adder.value)){const v=adder.value;picked.push(v);if(edited){const add=draftLines([news.notes.find(n=>n.v===v)].filter(Boolean),{withChecks});area.value=[area.value.trim(),...add.map(l=>'· '+l)].filter(Boolean).join('\n')}paintChips();regen()}};
      const bundle=el('div','un-bundle');bundle.append(chips,adder);
      if(!item)body.append(opt);
      body.append(bundle);
      paintChips();regen();
      return 'textarea';
    },
    async onSubmit(){
      const lines=linesFromText(area.value),problem=draftProblem({title:title.value,lines});
      if(problem)return problem;
      try{await rpc('app_update_news_save',{p_id:item?.id??null,p_title:title.value.trim()||null,p_lines:lines,p_sources:picked.slice(0,30)})}catch(error){return failLine(error)}
      void afterWrite(item?'수정했어요':'보냈어요');
      return true;
    }});
}
// S71-31(명진 11/26 "이용자에게 보이는 시작날짜랑 바꾸기 삭제 불필요" / "보낸 소식 260 이용자에게 보이는 그대로도 삭제"):
// 위쪽 시작 날짜 줄·[바꾸기] 창과 접히는 '보낸 소식 N · 이용자에게 보이는 그대로' 줄을 없앴다. 기록에서 나간 소식은 기록 줄 버튼([보냄]/[다시 보내기])이 맡고,
// 기록 줄에 없는 소식(직접 쓴 것)만 목록 위에 줄로 남겨 [수정]·[거두기]·[다시 보내기]를 그대로 둔다. [+] 직접 쓰기는 맨 위 줄 단추 자리.
const addBox=toolsBox('updates','updates');
addBox.innerHTML='<button type="button" class="icon-btn un-add" data-un-write aria-label="직접 쓰기" title="직접 쓰기"></button>';
function paintNews(){
  const box=news.root?.querySelector('[data-un-admin]');
  const add=addBox.querySelector('[data-un-write]');
  if(add)add.hidden=!news.admin;
  if(!box)return;
  const admin=news.admin;
  const loose=admin?looseNews(admin.items,news.notes):[];
  if(!loose.length){box.hidden=true;box.replaceChildren();return}
  box.hidden=false;
  const list=el('div','un-list');
  for(const item of loose){
    const extra=[];
    if(item.withdrawn_at){
      const again=el('button','mini','다시 보내기');again.type='button';again.dataset.unResend=item.id;
      extra.push(el('span','un-date','거둠'),again);
    }else{
      extra.push(el('span','un-date',`읽음 ${item.reads??0}/${admin.users??0}`));
      const edit=el('button','mini','수정');edit.type='button';edit.dataset.unEdit=item.id;
      const pull=el('button','mini','거두기');pull.type='button';pull.dataset.unWithdraw=item.id;
      extra.push(edit,pull);
    }
    const row=newsRow(item,extra);if(item.withdrawn_at)row.classList.add('is-withdrawn');
    list.append(row);
  }
  box.replaceChildren(list);
}
async function onNewsClick(event){
  const send=event.target.closest?.('[data-rn-send]');
  if(send){
    event.preventDefault();event.stopPropagation();
    const v=send.dataset.rnSend,note=noteOf(send),state=noteState(news.admin?.items,note);
    if(state==='sent'){const plan=withdrawPlan(news.admin?.items,note);await withdrawNews(send,plan.ids,withdrawNote(plan.others));return true}
    if(state==='withdrawn'){const plan=resendPlan(news.admin?.items,note);await resendNews(send,plan.ids,resendNote(plan.others));return true}
    openSend({versions:[v],trigger:send});return true;
  }
  if(event.target.closest?.('[data-un-write]')){openSend({trigger:event.target});return true}
  const edit=event.target.closest?.('[data-un-edit]');
  if(edit){const item=news.admin?.items.find(i=>i.id===edit.dataset.unEdit);if(item)openSend({item,trigger:edit});return true}
  const again=event.target.closest?.('[data-un-resend]');
  if(again){await resendNews(again,[again.dataset.unResend]);return true}
  const pull=event.target.closest?.('[data-un-withdraw]');
  if(pull){
    await withdrawNews(pull,[pull.dataset.unWithdraw]);
    return true;
  }
  return false;
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
  news.root=root;
  drawing=canReadReleaseNotes().then(yes=>yes?Promise.all([readReleaseNotes(),loadAdmin()]).then(([list])=>list):'denied').then(list=>{
    if(list==='denied'){root.innerHTML=emptyHtml('운영자만 볼 수 있어요');return}
    if(!list){root.innerHTML=failHtml({retry:'data-rn-retry'});return}
    drawn=true;
    if(!list.notes.length){root.innerHTML=emptyHtml();return}
    news.notes=list.notes;
    const all=list.notes.map(note=>({note,changes:note.changes,checks:note.checks}));
    const count=el('p','rn-count');count.setAttribute('role','status');count.hidden=true;
    const box=el('div','rn-list');
    const more=el('button','rn-more mini','이전 기록 더 보기');more.type='button';
    let items=all,words=[],shown=0;
    const page=()=>{
      for(const item of items.slice(shown,shown+PAGE_SIZE))box.append(noteRow(item,list.current,words));
      shown=Math.min(items.length,shown+PAGE_SIZE);more.hidden=shown>=items.length;
    };
    const apply=()=>{
      words=searchWords(find.text);
      items=searchNotes(list.notes,find.text)??all;
      shown=0;box.replaceChildren();
      count.hidden=!words.length;
      count.textContent=words.length?(items.length?`찾은 기록 ${items.length}개`:'찾는 기록이 없어요'):'';
      page();
    };
    find.apply=apply;
    more.addEventListener('click',page);
    observer?.disconnect();
    observer=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)&&!more.hidden)page()},{rootMargin:'0px 0px 120px 0px'}):null;
    observer?.observe(more);
    page();
    const admin=el('div','un-admin');admin.dataset.unAdmin='';
    root.replaceChildren(admin,count,box,more);
    paintNews();
    if(find.text)apply();
    refreshScreenFind();
  }).finally(()=>{drawing=null});
  return drawing;
}

// 맨 위 칸 찾기: 목록을 그린 뒤에만(운영자가 아니거나 못 읽었으면 칸이 이 화면 찾기가 아니다). 글자는 이 탭 메모리만.
const find={text:'',apply:null};
registerScreenFind('updates',{label:'업데이트 기록에서 찾기',active:()=>window.KPTURouter?.current==='updates'&&!!find.apply,value:()=>find.text,
  apply:raw=>{const next=String(raw??'');if(next===find.text)return;find.text=next;find.apply?.()}});

install();
document.querySelector('#updatesView')?.addEventListener('click',event=>{if(event.target.closest?.('[data-rn-retry]')){void draw();return}void onNewsClick(event)});
addBox.addEventListener('click',event=>{void onNewsClick(event)});
window.KPTURouter?.on?.('updates',()=>draw());
void draw();
