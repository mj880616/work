// OPS-새가입알림 ③(S62-25): 운영자 전용 '가입자' 화면(?view=signups). #signupsView의 유일한 그리기 주인.
// 입구는 운영자 계정 메뉴의 '가입자'(서버 허용 표 dev_inbox일 때만 줄을 그림)와 새 가입 폰 알림·알림 줄. 읽기는 서버 app_signup_list가
// 운영자만 받는다(아니면 42501 → '운영자만 볼 수 있어요'). 돌려받는 칸은 이름·가입 시각·마지막 접속뿐(메일·기록 내용 없음).
// 결제 상태 칸(무료/체험/유료)은 결제가 들어간 뒤에 더한다. 기기 저장 없음. 글자는 textContent로만.
import {waitHtml,failHtml,emptyHtml} from './wait-state.js';

const el=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!=null)node.textContent=text;return node};
const when=value=>{const d=new Date(value);return value&&!Number.isNaN(d.getTime())?d.toLocaleString('ko-KR',{timeZone:'Asia/Seoul',year:'2-digit',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}):''};
let drawing=null;

function install(){
  if(document.getElementById('signupsView'))return;
  document.getElementById('appView')?.insertAdjacentHTML('beforeend','<section id="signupsView" class="view-panel hidden" aria-label="가입자"><div class="panel su-view"><div data-su-root></div></div></section>');
}

function table(items){
  const t=el('table','su-table');
  const head=el('tr');for(const h of ['이름','가입','마지막 접속'])head.append(el('th',null,h));
  t.append(el('caption','su-count',`${items.length}명`));
  const thead=el('thead');thead.append(head);const body=el('tbody');
  for(const item of items){
    const tr=el('tr','su-row');
    tr.append(el('td','su-name',String(item?.name||'이름 없음')),el('td','su-when',when(item?.signed_up_at)),el('td','su-when',when(item?.last_seen_at)||'—'));
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
