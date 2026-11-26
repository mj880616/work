// OPS-가입자현황(S62-29, OPS-새가입알림 ③ S62-25를 넓힘): 운영자 전용 '가입자 현황' 화면(?view=signups). #signupsView의 유일한 그리기 주인.
// 입구는 운영자 계정 메뉴의 '가입자 현황'(서버 허용 표 dev_inbox일 때만 줄을 그림)과 새 가입 폰 알림·알림 줄. 읽기는 서버 app_signup_list가
// 운영자만 받는다(아니면 42501 → '운영자만 볼 수 있어요'). 원칙(사용자 11/23): 내가 기록한 내용은 운영자가 볼 수 없다 —
// 이 화면이 그리는 칸은 이메일·가입일·마지막 사용뿐(app/signups-model.mjs COLUMNS, S68-58). 맨 위 숫자 한 줄은 같은 목록에서 센다.
// 차단(가입 막기)은 화면에 없다(AGENTS.md 5절 — 차단 명단은 SQL로만). 기기 저장 없음. 글자는 textContent로만.
import {waitHtml,failHtml,emptyHtml} from './wait-state.js';
import {COLUMNS,summarize,summaryText,cells} from './signups-model.mjs';

const el=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!=null)node.textContent=text;return node};
let drawing=null;

function install(){
  if(document.getElementById('signupsView'))return;
  document.getElementById('appView')?.insertAdjacentHTML('beforeend','<section id="signupsView" class="view-panel hidden" aria-label="가입자 현황"><div class="panel su-view"><div data-su-root></div></div></section>');
}

function table(items){
  const t=el('table','su-table');
  t.append(el('caption','su-count',summaryText(summarize(items))));
  const head=el('tr');for(const [key,label] of COLUMNS){const th=el('th',null,label);th.dataset.col=key;head.append(th)}
  const thead=el('thead');thead.append(head);const body=el('tbody');
  for(const item of items){
    const text=cells(item),tr=el('tr','su-row');
    for(const [key,label] of COLUMNS){const td=el('td','su-'+key.replace(/_.*/,''),text[key]);td.dataset.col=key;td.dataset.label=label;tr.append(td)}
    body.append(tr);
  }
  t.append(thead,body);return t;
}

function draw(){
  const root=document.querySelector('#signupsView [data-su-root]');
  if(!root)return Promise.resolve();
  if(drawing)return drawing;
  root.innerHTML=waitHtml();
  drawing=window.KPTURuntime.api('/rest/v1/rpc/app_signup_list',{method:'POST',body:{},singleFlight:false}).then(items=>{
    if(!Array.isArray(items)){root.innerHTML=failHtml({retry:'data-su-retry'});return}
    if(!items.length){root.innerHTML=emptyHtml('가입한 사람이 없어요');return}
    root.replaceChildren(table(items));
  }).catch(error=>{root.innerHTML=/42501|OPERATOR_FEATURE_REQUIRED/.test(String(error?.message||error))?emptyHtml('운영자만 볼 수 있어요'):failHtml({retry:'data-su-retry'})})
    .finally(()=>{drawing=null});
  return drawing;
}

install();
document.querySelector('#signupsView')?.addEventListener('click',event=>{if(event.target.closest('[data-su-retry]'))void draw()});
window.KPTURouter?.on?.('signups',()=>draw());
void draw();
