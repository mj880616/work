(()=>{
'use strict';
const ORGS=window.PRIVATE_RAIL_ORGS||[];
if(!ORGS.length)return;
const API='https://xmlkxfjeagycwttklxjw.supabase.co/functions/v1/pc0921-board?board=private_rail';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const key=slug=>'rail_org_'+slug;
const states=new Map();
let adminPw=null;
const stateFor=o=>{const v=states.get(o.slug);return v&&typeof v==='object'?{...o,...v,history:Array.isArray(v.history)?v.history:o.history}:{...o}};
const dateLabel=v=>{if(!v)return'';const d=new Date(v.length===10?v+'T00:00:00+09:00':v);return Number.isNaN(d.getTime())?v:new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'numeric',day:'numeric'}).format(d)};
function css(){const s=document.createElement('style');s.textContent=`
.org-status-section{margin-top:26px}.org-status-head{display:flex;justify-content:space-between;align-items:end;gap:12px;margin:0 2px 11px}.org-status-head h2{font-size:20px;margin:0}.org-status-head span{font-size:12px;color:var(--muted)}.org-status-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.org-status-card{background:#fff;border:1px solid var(--line);border-radius:15px;display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:stretch;overflow:hidden}.org-status-link{display:block;padding:15px 15px 13px;text-decoration:none;color:inherit;min-width:0}.org-status-link:hover{background:#f8fafc}.org-status-name{font-size:14px;font-weight:900;color:var(--navy);margin-bottom:5px}.org-status-summary{font-size:13px;line-height:1.48;color:#43505d}.org-status-meta{margin-top:7px;font-size:10px;color:#85909b;font-weight:700}.org-status-edit{align-self:center;margin-right:11px;border:1px solid #d4dde5;background:#fff;color:var(--blue);border-radius:8px;padding:6px 9px;font:inherit;font-size:10px;font-weight:900;cursor:pointer}.org-status-edit:hover{background:#f3f7fa}.org-status-loading{grid-column:1/-1;background:#fff;border:1px dashed #cbd3dc;border-radius:14px;padding:18px;color:var(--muted);font-size:13px}@media(max-width:650px){.org-status-grid{grid-template-columns:1fr}.org-status-card{grid-template-columns:minmax(0,1fr) auto}}
`;document.head.appendChild(s)}
function mount(){
  const old=document.getElementById('bargaining');if(old)old.remove();
  const cards=document.getElementById('taskCards');const host=cards?.closest('.section');if(!host)return null;
  let section=document.getElementById('orgStatusSection');if(section)return section;
  section=document.createElement('section');section.className='org-status-section';section.id='orgStatusSection';
  section.innerHTML='<div class="org-status-head"><h2>조직별 현재 상황</h2><span>카드 선택 → 상세·주간 업데이트</span></div><div class="org-status-grid" id="orgStatusGrid"><div class="org-status-loading">조직 현황을 불러오는 중입니다.</div></div>';
  host.insertAdjacentElement('afterend',section);return section;
}
function render(){const grid=document.getElementById('orgStatusGrid');if(!grid)return;grid.innerHTML=ORGS.map(o=>{const s=stateFor(o);return `<article class="org-status-card"><a class="org-status-link" href="./org.html?org=${encodeURIComponent(o.slug)}"><div class="org-status-name">${esc(o.name)}</div><div class="org-status-summary">${esc(s.summary)}</div><div class="org-status-meta">기준 ${esc(dateLabel(s.updated_at||s.updated))}</div></a><button type="button" class="org-status-edit" data-org-edit="${esc(o.slug)}">수정</button></article>`}).join('')}
async function load(){try{const r=await fetch(API,{cache:'no-store'});if(!r.ok)throw new Error('load');const rows=await r.json();if(Array.isArray(rows))rows.forEach(x=>{const k=String(x.item_key||'');if(k.startsWith('rail_org_')&&x.value&&typeof x.value==='object')states.set(k.slice(9),x.value)})}catch(e){}render()}
function password(){if(adminPw)return adminPw;const p=prompt('마스터 비밀번호를 입력하세요.');if(p===null)return null;adminPw=p.trim();return adminPw}
async function save(o,next){const pw=password();if(pw===null)return false;try{const r=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({item_key:key(o.slug),value:next,master_password:pw})});let data={};try{data=await r.json()}catch{}if(!r.ok){if(r.status===403&&data.error==='password'){adminPw=null;alert('마스터 비밀번호가 올바르지 않습니다.');return false}throw new Error('save')}states.set(o.slug,next);render();return true}catch(e){alert('저장하지 못했습니다. 다시 시도해 주세요.');return false}}
async function quickEdit(slug){const o=ORGS.find(x=>x.slug===slug);if(!o)return;const cur=stateFor(o);const text=prompt(`${o.name} 현재 상황 한 줄`,cur.summary||'');if(text===null||!text.trim())return;const next={...cur,summary:text.trim(),updated_at:new Date().toISOString()};await save(o,next)}
css();mount();render();load();
document.addEventListener('click',e=>{const b=e.target.closest('[data-org-edit]');if(!b)return;e.preventDefault();e.stopPropagation();quickEdit(b.dataset.orgEdit)});
setInterval(()=>{if(document.visibilityState==='visible')load()},30000);
})();
