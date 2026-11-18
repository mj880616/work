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
// - S52-01 ③b UI-사업영역조직고르기창: 줄마다의 사업영역 칸은 작은 단추([고르기] / 고른 이름 '상위 › 하위' / 회색 '없음')이고, 누르면 모든 화면과 같은
//   고르기 창(area-org-picker.js, 하나만 고르기: 맨 위 '고르기'·'없음', 큰 묶음만 + 꺾쇠, 찾기·자주 쓴 것)이 이 창 위에 뜬다(뒤로가기는 위 창부터).
//   단추가 값(data-value: 사업영역 id | AREA_NONE | '')을 갖고, 저장 길은 그대로다.
import {createChoiceSheet} from './choice-sheet.js';
import {readMeetingBody} from './report-list-read.js';
import {untaggedInWeek,presetArea,reportDay,AREA_NONE,hasAreaNone,areaBody,rememberedAreaRows} from './business-area-model.mjs';
import {loadReportPlaces,areaNameIn} from './report-places-sheet.js';
import {openAreaOrgPicker,dismissAreaOrgPicker,usedKeysNow,catalogAreas} from './area-org-picker.js';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const AI_ROWS=8;                                             // 창 하나에서 AI에 묻는 줄 수(한도 아끼기)
const AI_STOP=new Set(['monthly_limit','daily_limit','ai_monthly_cap','not_ready','offline','session_required','auth_unavailable']);
let sheet=null,active=null,run=0;
const NONE_LABEL='없음';                                      // [없음] 고르기 줄(빈 화면 문구 아님)

const titleOf=m=>String(m?.title||m?.series_name||'').replace(/\s+/g,' ').trim()||'제목 없음';
const dayOf=m=>{const d=reportDay(m);return d?`${Number(d.slice(5,7))}.${Number(d.slice(8,10))}`:''};

// The row's 사업영역 button: its value is data-value (사업영역 id | AREA_NONE | ''), its text the chosen name ('상위 › 하위'), '없음' or '고르기'.
const valueOf=b=>b?.dataset.value||'';
function paintPick(b,value){
  if(!b)return;b.dataset.value=value||'';const name=value===AREA_NONE?NONE_LABEL:value?(areaNameIn(active?.places,value)||'사업영역'):'선택';
  const text=document.createElement('span');text.className='area-tag-select-text';text.textContent=name;b.replaceChildren(text);b.title=value&&value!==AREA_NONE?name:'';b.classList.toggle('is-none',value===AREA_NONE);b.classList.toggle('is-empty',!value);
}
function rowHtml(m){
  const id=esc(m.id),title=titleOf(m);
  return `<div class="area-tag-row" data-area-tag-row="${id}"><span class="area-tag-day">${esc(dayOf(m))}</span><span class="area-tag-title" title="${esc(title)}">${esc(title)}</span><span class="area-tag-pick"><button type="button" class="secondary area-tag-select is-empty" data-area-tag-select="${id}" data-value="" aria-haspopup="dialog" aria-label="${esc(title)} 사업영역"><span class="area-tag-select-text">선택</span></button><span class="area-tag-mark" data-area-tag-mark hidden></span></span></div>`;
}
async function pickFor(button){
  const a=active,id=button.dataset.areaTagSelect;if(!a||a.saving)return;
  const used=await usedKeysNow().catch(()=>[]);if(active!==a||!button.isConnected)return;
  const value=valueOf(button),top=[{key:'',name:'선택'},...(a.withNone?[{key:AREA_NONE,name:NONE_LABEL,attrs:'data-area-none data-aop-muted'}]:[])];
  await openAreaOrgPicker({kind:'area',trigger:button,used,multi:false,top,title:'사업영역 선택',areas:catalogAreas(a.places?.projects||[]),
    selected:value===AREA_NONE?[AREA_NONE]:value?['p:'+value]:[],
    onCommit:keys=>{if(active!==a||!button.isConnected)return;const k=[...keys][0]||'';a.touched.add(id);paintPick(button,k===AREA_NONE?AREA_NONE:k.startsWith('p:')?k.slice(2):'');mark(button,'')}});
}
function ensureSheet(){
  if(sheet)return sheet;
  sheet=createChoiceSheet({id:'reportAreaTagSheet',titleId:'reportAreaTagSheetTitle',historyKey:'kptuReportAreaTag',
    canOpen:()=>!!active,choices:()=>loadReportPlaces().then(p=>{if(active)active.places=p}),
    render:()=>{return {title:`사업영역 달기 · ${active?.list.length||0}건`,html:`<div class="area-tag-list">${(active?.list||[]).map(m=>rowHtml(m)).join('')}</div><div class="area-tag-foot"><span class="area-tag-status" data-area-tag-status role="status"></span><button type="button" class="primary area-tag-save" data-area-tag-save>저장</button></div>`}},
    onSelect:()=>{},
    onError:error=>active?.onMessage?.(error?.message||'사업영역을 불러오지 못했어요.'),
    // UI-창잘림·끌어옮기기: 고르기 칸까지 한 줄에 들어가게 넓은 창(폭은 공용 부품이 정하고 화면 안으로 맞춘다).
    width:420});
  const el=document.getElementById('reportAreaTagSheet');
  el.classList.add('area-tag-sheet');
  el.addEventListener('click',e=>{const pick=e.target.closest?.('[data-area-tag-select]');if(pick){if(!pick.disabled)void pickFor(pick);return}if(e.target.closest?.('[data-area-tag-save]'))void save()});
  // 창이 닫히면(저장·×·Esc·뒤로가기·바깥) 남은 AI 추천 묻기를 멈춘다.
  el.addEventListener('close',()=>{run++;active=null;dismissAreaOrgPicker()});
  return sheet;
}
const known=id=>!!active?.places?.projects?.some(x=>String(x.project.id)===String(id));
function selectOf(id){return document.querySelector(`#reportAreaTagSheet [data-area-tag-select="${CSS.escape(String(id))}"]`)}
function mark(select,from){const m=select?.parentElement?.querySelector('[data-area-tag-mark]');if(!m)return;m.textContent=from==='ai'?'AI':from==='link'?'연결':'';m.hidden=!from;m.title=from==='ai'?'AI 추천으로 미리 선택했어요':from==='link'?'이 보고에 연결된 사업영역이에요':''}
function preset(m,aiId=''){
  const s=selectOf(m.id);if(!s||active.touched.has(String(m.id))||valueOf(s))return false;
  const p=presetArea(m,aiId,known);if(!p.id)return false;
  paintPick(s,p.id);mark(s,p.from);return true;
}

// 미리 고르기: 연결에서 먼저, 남은 줄은 AI 추천을 차례로(창이 닫히거나 한도면 멈춤).
async function suggestAll(mine){
  const rt=window.KPTURuntime,workspace=rt?.context?.read?.()?.workspace?.id;if(!rt?.api||!workspace)return;
  const left=active.list.filter(m=>!preset(m));let asked=0;
  for(const m of left){
    if(mine!==run||!active||asked>=AI_ROWS)return;
    // S48-64: 특이사항(=[회의] 칸 '회의록 전문')은 맨 뒤 300자만(전사 전문이 추천 재료를 밀어내지 않게).
    const body=await readMeetingBody(rt.api,workspace,m.id); // APP-낭비줄이기 ①: 목록은 본문 열을 받지 않으므로 추천 직전 이 줄의 글을 읽는다
    if(mine!==run||!active)return;
    const title=titleOf(m),text=[body.transcript_text,body.decisions,String(m.next_plan||'').trim()&&`다음 할 일: ${m.next_plan}`,String(body.notes||'').slice(0,300)].map(x=>String(x||'').trim()).filter(Boolean).join('\n').slice(0,3000);
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
  return row;
}

// BIZ-사업영역기억(11/10): 같은 회의명에서 전에 고른 사업영역·[없음]을 아직 안 단 새 보고에 붙여 저장한다(규칙은 business-area-model.mjs
// rememberedAreaRows 한 곳). 저장 길은 위 saveOne(app_meetings PATCH, 소유자 RLS·같은 업무공간 조건) 그대로 — 새 DB 칸·기기 저장 없음.
// 저장된 줄은 화면이 가진 줄(meetings 안의 객체)에 서버 답(사업영역·[없음]·updated_at)을 옮겨 적는다. 돌려주는 것 = 저장한 줄 수.
// 같은 줄을 두 번 보내지 않게 보내는 중인 줄은 건너뛴다. 하나가 실패해도 나머지는 계속(실패한 줄은 다음 읽기 때 다시, 지금처럼 '안 단 보고'에는 안 뜸).
const remembering=new Set();
export async function applyRememberedAreas(meetings,{api,workspace}={}){
  if(!api||!workspace)return 0;
  let saved=0;
  for(const {meeting:m,value} of rememberedAreaRows(meetings)){
    const id=String(m.id??'');if(!id||remembering.has(id))continue;
    remembering.add(id);
    try{const row=await saveOne({api},workspace,id,value,hasAreaNone(m));m.business_area_id=row.business_area_id??null;if(Object.hasOwn(row,'business_area_none'))m.business_area_none=row.business_area_none;if(row.updated_at)m.updated_at=row.updated_at;saved++}
    catch(err){console.warn('remembered area save failed',err?.message||err)}
    finally{remembering.delete(id)}
  }
  return saved;
}
async function save(){
  const a=active;if(!a||a.saving)return;
  const picks=a.list.map(m=>({m,area:valueOf(selectOf(m.id))})).filter(x=>x.area);
  if(!picks.length){status('선택한 사업영역이 없어요.');return}
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
