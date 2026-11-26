// UPDATE-운영자전용기록업데이트소식 PR3(시안 PR 2638 ③⑤ + 사용자 11/15 13:37): 이용자용 '업데이트 소식' 화면(?view=whatsnew). #whatsnewView의 유일한 그리기 주인.
// 입구는 계정 메뉴(PC 오른쪽 위·폰 [메뉴]의 계정 칸) '업데이트 소식' 한 줄뿐이다. 새 소식 알림·점·숫자·창은 어디에도 없다 — 눌러 들어와야만 보인다.
// 읽는 것은 서버 app_update_news_list(로그인 이용자, 운영자가 정한 시작 날짜 이후·거두지 않은 것) 하나이고, 화면을 열면 app_update_news_seen으로
// 읽음만 남긴다(운영자 '읽음 n/m'). 기기 저장 없음. 글자는 textContent로만 넣는다.
import {shortDay} from './update-news-model.mjs';
import {waitHtml,failHtml,emptyHtml} from './wait-state.js';
import {word} from './brand/brand.mjs';

const el=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!=null)node.textContent=text;return node};
const rt=()=>window.KPTURuntime;

/** 소식 한 줄(이용자 화면·운영자 '보낸 소식'이 같이 쓴다). extra는 머리 줄 오른쪽에 붙일 노드들. */
export function newsRow(item,extra=[]){
  const row=el('article','un-item');
  const head=el('div','un-head');
  head.append(el('b','un-title',word(item.title)||word(item.lines?.[0])||''),el('span','un-date',shortDay(item.sent_at)),...extra);
  const list=el('ul','un-lines');
  for(const line of (item.title?item.lines:item.lines?.slice(1))||[])list.append(el('li',null,word(line)));
  row.append(head);
  if(list.childElementCount)row.append(list);
  return row;
}

function install(){
  if(document.getElementById('whatsnewView'))return;
  document.getElementById('appView')?.insertAdjacentHTML('beforeend','<section id="whatsnewView" class="view-panel hidden" aria-label="업데이트 소식"><div class="panel un-view" data-un-root></div></section>');
}

let drawing=null;
function draw(){
  const root=document.querySelector('#whatsnewView [data-un-root]');
  if(!root)return Promise.resolve();
  if(drawing)return drawing;
  if(!root.childElementCount)root.innerHTML=waitHtml();
  drawing=Promise.resolve().then(()=>rt().api('/rest/v1/rpc/app_update_news_list',{method:'POST',body:{},singleFlight:false})).then(items=>{
    if(!Array.isArray(items)){root.innerHTML=failHtml({retry:'data-un-retry'});return}
    if(!items.length){root.innerHTML=emptyHtml('아직 소식이 없어요');return}
    const box=el('div','un-list');
    for(const item of items)box.append(newsRow(item));
    root.replaceChildren(box);
    void rt().api('/rest/v1/rpc/app_update_news_seen',{method:'POST',body:{},singleFlight:false}).catch(()=>{});
  }).catch(()=>{root.innerHTML=failHtml({retry:'data-un-retry'})}).finally(()=>{drawing=null});
  return drawing;
}

install();
document.querySelector('#whatsnewView')?.addEventListener('click',event=>{if(event.target.closest?.('[data-un-retry]'))void draw()});
window.KPTURouter?.on?.('whatsnew',()=>draw());
void draw();
