// MTG-프로젝트합치기 2단계: 사업 보고 쓰기·고치기 창의 [사업영역] 꼬리표 + '다음 할 일' 칸, 보기 면의 꼬리표 줄·다음 할 일 줄([할 일로]).
// 그리는 곳은 이 파일 하나다(쓰기 창 team.js, 고치기·보기 meeting-round-detail.js 가 같은 부품을 붙인다). 규칙은 business-area-model.mjs.
// 서버에 칸이 없으면(400) 칸을 숨기고 지금처럼 저장한다(설계 4절 2단계). 다음 할 일 → Google 할 일은 줄마다 누를 때만(자동 동기화 없음, 결정 ④).
// 사업영역 AI 추천(요청 10/28 19:07 ②, 설계 12.3·13절): [사업영역] 옆 작은 [AI 추천]을 누를 때만 ai-assist area_suggest(제목·결과·다음 할 일)
//   → 후보 칩 최대 3개. 칩을 눌러야 그 꼬리표로(자동 확정 없음). 서버는 저장하지 않는다. 한도·실패면 칩 없이 작은 안내 한 줄.
import {areaAvailable} from './report-links.js';
import {shownArea,nextPlanLines,nextPlanValue,NEXT_PLAN_MAX} from './business-area-model.mjs';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sheetMod=()=>import('./report-places-sheet.js');
async function areaName(id){
  if(!id)return '';
  try{const s=await sheetMod(),places=await s.loadReportPlaces();return s.areaNameIn(places,id)||'보관된 사업영역'}catch{return '사업영역'}
}

// host: 빈 칸(div). 돌려주는 것: start({meeting|areaId, plan}), suggest(id), body(), draft(), changed().
// material(): 추천 재료 {title, text}(창의 제목·결과 칸). 없으면 [AI 추천]을 두지 않는다. 다음 할 일 글은 이 부품이 덧붙인다.
export function mountAreaFields(host,{onMessage=()=>{},material=null}={}){
  if(!host)return null;
  host.classList.add('biz-area-fields');host.hidden=true;
  host.innerHTML=`<label><span>사업영역 <span class="optional">꼬리표 하나</span></span><button type="button" class="secondary field-btn" data-biz-area-pick aria-haspopup="dialog">꼬리표 없음</button></label>${material?`<div class="biz-area-suggest"><button type="button" class="mini secondary" data-biz-area-ai>AI 추천</button><span class="biz-area-sugs" data-biz-area-sugs role="status" aria-live="polite"></span></div>`:''}
<details class="biz-next-plan" data-biz-plan-box><summary>다음 할 일 <span class="optional" data-biz-plan-count></span></summary><textarea rows="3" maxlength="${NEXT_PLAN_MAX}" data-biz-plan aria-label="다음 할 일" placeholder="한 줄에 하나 — 주간보고 '이후 계획'에 들어가요"></textarea></details>`;
  const button=host.querySelector('[data-biz-area-pick]'),box=host.querySelector('[data-biz-plan-box]'),plan=host.querySelector('[data-biz-plan]'),count=host.querySelector('[data-biz-plan-count]');
  let area='',legacy=false,touched=false,base='',ready=false,editing=false,run=0;
  const paintCount=()=>{const n=nextPlanLines(plan.value).length;count.textContent=n?`${n}줄`:''};
  async function paint(){const mine=++run,name=await areaName(area);if(mine!==run)return;button.textContent=area?(legacy?`${name} (연결에서)`:name):'꼬리표 없음';button.title=legacy?'옛 보고라 첫 연결 프로젝트를 꼬리표처럼 보여 줘요. 고르면 꼬리표로 저장돼요.':''}
  button.addEventListener('click',async()=>{try{const s=await sheetMod();await s.pickBusinessArea(button,{chosen:legacy?'':area,onMessage,onPick:id=>{area=id;legacy=false;touched=true;void paint()}})}catch(e){onMessage(e?.message||'사업영역을 불러오지 못했어요.')}});
  plan.addEventListener('input',paintCount);
  // ---- AI 추천 ----
  const aiBtn=host.querySelector('[data-biz-area-ai]'),sugs=host.querySelector('[data-biz-area-sugs]');let aiRun=0;
  const SUGGEST_NOTE={short:'내용을 조금 더 쓰면 추천할 수 있어요.',secret:'비밀번호·키 같은 글이 있어 AI에 보내지 않았어요.',no_areas:'사업영역이 아직 없어요.',monthly_limit:'이번 달 AI 한도에 닿았어요.',daily_limit:'오늘 AI 횟수를 다 썼어요.',not_ready:'AI 추천은 준비 중이에요.',offline:'인터넷 연결이 없어요.'};
  const clearSugs=()=>{aiRun++;if(sugs)sugs.replaceChildren();if(aiBtn){aiBtn.disabled=false;aiBtn.removeAttribute('aria-busy')}};
  aiBtn?.addEventListener('click',async()=>{
    const mine=++aiRun,m=material?.()||{},title=String(m.title||'').replace(/\s+/g,' ').trim().slice(0,200);
    const text=[String(m.text||'').trim(),plan.value.trim()&&`다음 할 일: ${plan.value.trim()}`].filter(Boolean).join('\n').slice(0,3000);
    if(!title&&!text){sugs.textContent=SUGGEST_NOTE.short;return}
    aiBtn.disabled=true;aiBtn.setAttribute('aria-busy','true');sugs.textContent='추천 찾는 중…';
    let r;try{const {callAiAssist}=await import('./basket-ai-summary.js');r=await callAiAssist({kind:'area_suggest',title,text})}catch{r={ok:false,code:'internal_error'}}
    if(mine!==aiRun)return;
    aiBtn.disabled=false;aiBtn.removeAttribute('aria-busy');
    if(!r.ok){sugs.textContent=SUGGEST_NOTE[r.code]||'추천을 만들지 못했어요.';return}
    const list=(Array.isArray(r.data?.suggestions)?r.data.suggestions:[]).filter(x=>x&&typeof x.id==='string'&&typeof x.name==='string').slice(0,3);
    if(!list.length){sugs.textContent=SUGGEST_NOTE[r.data?.skipped]||'맞는 사업영역을 찾지 못했어요.';return}
    sugs.replaceChildren(...list.map(x=>Object.assign(document.createElement('button'),{type:'button',className:'mini secondary biz-area-chip',textContent:x.name,title:'이 사업영역으로 고르기',onclick:()=>{area=x.id;legacy=false;touched=true;clearSugs();void paint()}})));
  });
  const api={
    // 창을 열 때: meeting(고치기) 또는 areaId(새로 쓰기 미리 고름).
    start({meeting=null,areaId='',plan:text=''}={}){
      const shown=meeting?shownArea(meeting):{id:String(areaId||''),legacy:false};
      clearSugs();editing=!!meeting;area=shown.id;legacy=shown.legacy;touched=false;plan.value=meeting?String(meeting.next_plan||''):String(text||'');box.open=!!plan.value.trim();paintCount();base=api.draft();void paint();
      // 고치기: 읽은 줄(select=*)에 칸이 있는지로 정한다(새 요청 없음). 새로 쓰기: 사업 보고 화면이 읽은 줄로 정해 둔 답(noteAreaFromMeetings)을 쓴다.
      if(meeting){ready=Object.hasOwn(meeting,'business_area_id');host.hidden=!ready;return}
      void areaAvailable().then(ok=>{ready=!!ok;host.hidden=!ok},()=>{ready=false;host.hidden=true});
    },
    // [연결할 곳]에서 프로젝트를 골랐는데 꼬리표를 아직 손대지 않았으면 그 첫 프로젝트를 미리 고른다(고치기 창의 옛 꼬리표는 그대로).
    suggest(id){if(touched||(area&&!legacy))return;if(!id)return;area=String(id);legacy=false;void paint()},
    draft:()=>JSON.stringify([legacy?'':area,plan.value]),
    check:()=>{nextPlanValue(plan.value)}, // 1000자 넘으면 오류(저장 잠금 전에 부름)
    changed:()=>api.draft()!==base,
    // 저장 몸통에 더할 칸. 칸이 없으면 {}. 옛 보고에서 빌려 보인 꼬리표는 손대지 않았으면 저장하지 않는다(결정 ②).
    async body({only=false}={}){
      if(!ready&&!editing)ready=await areaAvailable().catch(()=>false); // 새로 쓰기: 확인이 아직이면 기다린다(보통 이미 정해져 있어 요청 없음)
      if(!ready)return {};
      const out={},value=nextPlanValue(plan.value);
      if(!only||api.changed()){out.business_area_id=legacy?null:(area||null);out.next_plan=value}
      return out;
    },
  };
  return api;
}

// 보기 면: '사업영역 › 세부 과제' 한 줄 + 다음 할 일 줄마다 [할 일로]. tasks: 이 보고에 이어진 Google 할 일(같은 글이면 '할 일에 있음').
export function paintAreaView(host,meeting,{tasks=[],onMessage=()=>{},onTaskMade=()=>{}}={}){
  if(!host)return;
  const has=meeting&&Object.hasOwn(meeting,'business_area_id'),shown=has?shownArea(meeting):{id:''},lines=has?nextPlanLines(meeting.next_plan):[];
  host.hidden=!has||(!shown.id&&!lines.length);if(host.hidden){host.replaceChildren();return}
  const titles=new Set((tasks||[]).map(t=>String(t?.title||'').trim()));
  host.innerHTML=`<p class="biz-area-line" data-biz-area-line>${shown.id?'사업영역 <span data-biz-area-name>…</span>':''}</p>${lines.length?`<details class="biz-next-plan" open><summary>다음 할 일 <span class="optional">${lines.length}줄</span></summary><ul class="biz-plan-list">${lines.map((line,i)=>`<li><span>${esc(line)}</span>${titles.has(line)?'<span class="optional">할 일에 있음</span>':`<button type="button" class="mini" data-biz-plan-task="${i}">할 일로</button>`}</li>`).join('')}</ul></details>`:''}`;
  if(shown.id)void areaName(shown.id).then(name=>{const el=host.querySelector('[data-biz-area-name]');if(el)el.textContent=name+(shown.legacy?' (연결에서)':'')});
  host.onclick=async e=>{
    const b=e.target.closest('[data-biz-plan-task]');if(!b||b.disabled)return;
    const title=lines[Number(b.dataset.bizPlanTask)];if(!title)return;b.disabled=true;b.textContent='넣는 중…';
    try{
      // 기존 할 일 만들기 길(google-tasks create, 사업 보고 쓰기 창의 후속 할 일과 같은 요청)을 그대로 쓴다.
      const result=await window.KPTURuntime.api('/functions/v1/google-tasks?action=create',{method:'POST',body:{action:'create',title,notes:'',due:null,links:[{meeting_id:meeting.id},...(shown.id&&!shown.legacy?[{project_id:shown.id}]:[])]}});
      b.replaceWith(Object.assign(document.createElement('span'),{className:'optional',textContent:result?.link_error?'할 일만 만듦(연결 못 함)':'할 일에 넣음'}));
      window.dispatchEvent(new CustomEvent('kptu:tasks-changed'));onTaskMade();
    }catch(err){b.disabled=false;b.textContent='할 일로';onMessage(err?.message||'할 일을 만들지 못했어요.')}
  };
}
