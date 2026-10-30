// MTG-프로젝트합치기 ③(명진 10/29 시안 승인): 사업 보고 목록 맨 위 '사업영역 안 단 보고 n건 [달기]' → 작은 창 '사업영역 달기 · n건'.
// - 그리는 곳: 줄은 team.js paintUntagged 하나(#areaUntaggedLine, renderMeetings가 부름). 이 파일은 [달기] 창만 맡는다. 창은 공용 고르기 창(choice-sheet.js:
//   PC는 [달기] 바로 아래 작은 창, 폰은 아래에서 올라오는 판, Esc·뒤로가기·바깥 누르기로 닫힘) 하나를 그대로 쓴다.
// - 줄마다 날짜·제목·사업영역 고르기 ▾. 옛 보고는 첫 연결 사업영역을 미리 골라 두고('연결'), 그 밖에는 이미 있는 사업영역 AI 추천 길
//   (ai-assist area_suggest, PR 1405)을 줄마다 차례로 불러 첫 추천을 미리 골라 둔다('AI'). 추천이 없거나 한도면 '고르기' 그대로. 서버는 추천을 저장하지 않는다.
// - [저장] 한 번: 고른 줄마다 기존 사업 보고 저장 길(app_meetings REST PATCH, 소유자 RLS·같은 업무공간 조건)로 business_area_id·updated_at만 보낸다.
//   서버·DB 변경 없음, 기기 저장 없음. 저장 뒤 목록을 다시 읽어 줄이 사라지고 꼬리표가 바로 바뀐다.
// - MTG-사업영역없음(요청 10/30 07:51): 고르기 목록 '고르기' 바로 아래 [없음](회색). 고르면 business_area_id=null·business_area_none=true로 저장해
//   '안 단 보고'에서 빠진다. 사업영역을 고르면 business_area_none=false를 함께 보낸다. 칸(20261030090000)이 없는 서버면 [없음]을 두지 않는다.
//   [없음]은 미리 고르지 않는다(연결·AI 추천은 사업영역 id만).
import {createChoiceSheet} from './choice-sheet.js';
import {untaggedInWeek,presetArea,reportDay,AREA_NONE,hasAreaNone,areaBody} from './business-area-model.mjs';
import {loadReportPlaces} from './report-places-sheet.js';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const AI_ROWS=8;                                             // 창 하나에서 AI에 묻는 줄 수(한도 아끼기)
const AI_STOP=new Set(['monthly_limit','daily_limit','not_ready','offline','session_required','auth_unavailable']);
let sheet=null,active=null,run=0;
const NONE_LABEL='없음';                                      // [없음] 고르기 줄(빈 화면 문구 아님)

const titleOf=m=>String(m?.title||m?.series_name||'').replace(/\s+/g,' ').trim()||'제목 없음';
const dayOf=m=>{const d=reportDay(m);return d?`${Number(d.slice(5,7))}.${Number(d.slice(8,10))}`:''};

function optionsHtml(places,withNone){
  return (withNone?`<option value="${AREA_NONE}" class="area-tag-none">${NONE_LABEL}</option>`:'')+(places?.projects||[]).map(x=>`<option value="${esc(x.project.id)}">${'　'.repeat(Math.max(0,x.depth||0))}${esc(x.project.name||'이름 없는 사업영역')}</option>`).join('');
}
function rowHtml(m,options){
  const id=esc(m.id),title=titleOf(m);
  return `<div class="area-tag-row" data-area-tag-row="${id}"><span class="area-tag-day">${esc(dayOf(m))}</span><span class="area-tag-title" title="${esc(title)}">${esc(title)}</span><span class="area-tag-pick"><select class="area-tag-select" data-area-tag-select="${id}" aria-label="${esc(title)} 사업영역"><option value="">고르기</option>${options}</select><span class="area-tag-mark" data-area-tag-mark hidden></span></span></div>`;
}
function ensureSheet(){
  if(sheet)return sheet;
  sheet=createChoiceSheet({id:'reportAreaTagSheet',titleId:'reportAreaTagSheetTitle',historyKey:'kptuReportAreaTag',
    canOpen:()=>!!active,choices:()=>loadReportPlaces().then(p=>{if(active)active.places=p}),
    render:()=>{const options=optionsHtml(active?.places,!!active?.withNone);return {title:`사업영역 달기 · ${active?.list.length||0}건`,html:`<div class="area-tag-list">${(active?.list||[]).map(m=>rowHtml(m,options)).join('')}</div><div class="area-tag-foot"><span class="area-tag-status" data-area-tag-status role="status"></span><button type="button" class="primary area-tag-save" data-area-tag-save>저장</button></div>`}},
    onSelect:()=>{},
    onError:error=>active?.onMessage?.(error?.message||'사업영역을 불러오지 못했어요.')});
  const el=document.getElementById('reportAreaTagSheet');
  el.classList.add('area-tag-sheet');
  el.addEventListener('change',e=>{const s=e.target.closest?.('[data-area-tag-select]');if(!s||!active)return;active.touched.add(s.dataset.areaTagSelect);s.classList.toggle('is-none',s.value===AREA_NONE);mark(s,'')});
  el.addEventListener('click',e=>{if(e.target.closest?.('[data-area-tag-save]'))void save()});
  // 창이 닫히면(저장·×·Esc·뒤로가기·바깥) 남은 AI 추천 묻기를 멈춘다.
  el.addEventListener('close',()=>{run++;active=null});
  return sheet;
}
const known=id=>!!active?.places?.projects?.some(x=>String(x.project.id)===String(id));
function selectOf(id){return document.querySelector(`#reportAreaTagSheet [data-area-tag-select="${CSS.escape(String(id))}"]`)}
function mark(select,from){const m=select?.parentElement?.querySelector('[data-area-tag-mark]');if(!m)return;m.textContent=from==='ai'?'AI':from==='link'?'연결':'';m.hidden=!from;m.title=from==='ai'?'AI 추천으로 미리 골랐어요':from==='link'?'이 보고에 연결된 사업영역이에요':''}
function preset(m,aiId=''){
  const s=selectOf(m.id);if(!s||active.touched.has(String(m.id))||s.value)return false;
  const p=presetArea(m,aiId,known);if(!p.id)return false;
  s.value=p.id;mark(s,p.from);return true;
}

// 미리 고르기: 연결에서 먼저, 남은 줄은 AI 추천을 차례로(창이 닫히거나 한도면 멈춤).
async function suggestAll(mine){
  const left=active.list.filter(m=>!preset(m));let asked=0;
  for(const m of left){
    if(mine!==run||!active||asked>=AI_ROWS)return;
    const title=titleOf(m),text=[m.transcript_text,m.decisions,m.notes,String(m.next_plan||'').trim()&&`다음 할 일: ${m.next_plan}`].map(x=>String(x||'').trim()).filter(Boolean).join('\n').slice(0,3000);
    if(!text&&title==='제목 없음')continue;
    asked++;
    let r;try{const {callAiAssist}=await import('./basket-ai-summary.js');r=await callAiAssist({kind:'area_suggest',title:title.slice(0,200),text})}catch{r={ok:false,code:'internal_error'}}
    if(mine!==run||!active)return;
    if(!r?.ok){if(AI_STOP.has(r?.code))return;continue}
    const first=(Array.isArray(r.data?.suggestions)?r.data.suggestions:[]).find(x=>x&&typeof x.id==='string'&&known(x.id));
    if(first)preset(m,first.id);
  }
}

function status(text){const el=document.querySelector('#reportAreaTagSheet [data-area-tag-status]');if(el)el.textContent=text}
async function saveOne(rt,workspace,id,value,withNone){
  const area=areaBody(value,withNone);
  const rows=await rt.api(`/rest/v1/app_meetings?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${encodeURIComponent(workspace)}&select=*`,{method:'PATCH',body:{...area,updated_at:new Date().toISOString()},prefer:'return=representation'});
  const row=Array.isArray(rows)&&rows.length===1?rows[0]:null;
  if(!row||String(row.id)!==String(id)||row.workspace_id!==workspace||String(row.business_area_id||'')!==String(area.business_area_id||'')||(withNone&&row.business_area_none!==area.business_area_none))throw new Error('저장 결과를 확인하지 못했어요.');
}
async function save(){
  const a=active;if(!a||a.saving)return;
  const picks=a.list.map(m=>({m,area:selectOf(m.id)?.value||''})).filter(x=>x.area);
  if(!picks.length){status('고른 사업영역이 없어요.');return}
  const rt=window.KPTURuntime,workspace=rt?.context?.read?.()?.workspace?.id;
  if(!rt?.api||!workspace){status('로그인 상태를 확인하지 못했어요.');return}
  a.saving=true;run++;const button=document.querySelector('#reportAreaTagSheet [data-area-tag-save]');if(button){button.disabled=true;button.setAttribute('aria-busy','true')}status('');
  const failed=[];
  for(const {m,area} of picks){try{await saveOne(rt,workspace,m.id,area,a.withNone&&hasAreaNone(m))}catch(err){console.warn('area tag save failed',err?.message||err);failed.push(m)}}
  a.saving=false;if(button){button.disabled=false;button.removeAttribute('aria-busy')}
  const saved=picks.length-failed.length;
  if(saved){try{await window.__KPTU_RELOAD_MEETINGS__?.()}catch(err){console.warn('meeting list refresh failed',err)}window.dispatchEvent(new CustomEvent('kptu:meetings-changed'))}
  if(active!==a)return;
  if(failed.length){
    // 저장된 줄은 창에서 빼고, 못 한 줄만 남긴다(다시 [저장]).
    for(const {m} of picks)if(!failed.includes(m))document.querySelector(`#reportAreaTagSheet [data-area-tag-row="${CSS.escape(String(m.id))}"]`)?.remove();
    a.list=a.list.filter(m=>!picks.some(p=>p.m===m)||failed.includes(m));
    status(`${failed.length}건은 저장하지 못했어요. 다시 눌러 주세요.`);return;
  }
  await sheet.close();a.onSaved(saved);
}

// trigger: [달기] 버튼. meetings·from: 사업 보고 화면이 가진 목록과 보고 있는 주(월요일).
export async function openAreaTag(trigger,{meetings,from,onSaved=()=>{},onMessage=()=>{}}={}){
  const list=untaggedInWeek(meetings,from);if(!list.length)return;
  active={list,places:null,touched:new Set(),saving:false,onSaved,onMessage,withNone:list.every(hasAreaNone)};
  const mine=++run;
  await ensureSheet().open('tag',trigger);
  if(mine===run&&active?.places)void suggestAll(mine);
}
window.addEventListener('kptu:session-changed',()=>{run++;if(active)void sheet?.close();active=null});
