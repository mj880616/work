// MTG-한줄업데이트(요청함 10/29 08:59, 명진 09:01 '추천대로'): 사업 보고 [+] 메뉴 맨 위 [✎ 한 줄 업데이트] 창 하나.
// 칸: 사업영역(꼬리표, 필수 — 공용 사업영역 고르기 pickBusinessArea) · 날짜(기본 오늘, 달력) · 한 줄 · [+ 다음 할 일](눌러야 펼쳐짐) · [+ 담당조직 연결](선택) · [저장].
// 저장은 사업 보고 쓰기와 같은 app_meetings REST POST(소유자 RLS, 칸 'oneline'은 DB 검사가 다시 막는다) 한 번 + 꼬리표 사업영역 연결
// (app_meeting_set_links, 쓰기 창 [연결할 곳]과 같은 함수). 규칙은 report-oneline-model.mjs. 기기에는 아무것도 저장하지 않는다.
// 창은 <dialog>(폰 뒤로가기·Esc = 닫기). 다시 열 때마다 비운다(사업영역은 이 창이 열린 동안 고른 것만).
import {onelineBody,onelineMissing,ONELINE_MAX} from './report-oneline-model.mjs';
import {NEXT_PLAN_MAX} from './business-area-model.mjs';
import {seoulDateKey} from './meeting-time.js';
import {holdToast} from './small-notice.js';

let dialog=null,state=null,seq=0;
const $=sel=>dialog.querySelector(sel);
function ensureDialog(){
  if(dialog)return dialog;
  dialog=document.createElement('dialog');dialog.id='reportOnelineDialog';dialog.className='oneline-dialog';dialog.setAttribute('aria-labelledby','reportOnelineTitle');
  dialog.innerHTML=`<header class="oneline-head"><h2 id="reportOnelineTitle">한 줄 업데이트</h2><button type="button" class="icon-btn" data-ol-close aria-label="닫기">×</button></header>
<div class="oneline-body"><div class="oneline-row"><button type="button" class="secondary field-btn oneline-area" data-ol-area aria-haspopup="dialog" aria-label="사업영역 고르기">사업영역 ▾</button><input type="date" class="oneline-day" data-ol-day aria-label="날짜" required></div>
<textarea rows="2" maxlength="${ONELINE_MAX}" data-ol-text aria-label="한 줄" placeholder="진행 상황 한 줄 — 주간보고 사업 요약 표 '진행' 칸에 그대로 들어가요"></textarea>
<details class="biz-next-plan" data-ol-plan-box><summary>+ 다음 할 일 <span class="optional">선택</span></summary><textarea rows="2" maxlength="${NEXT_PLAN_MAX}" data-ol-plan aria-label="다음 할 일" placeholder="한 줄에 하나 — '이후 계획'에 들어가요"></textarea></details>
<button type="button" class="mini secondary oneline-orgs" data-ol-orgs aria-haspopup="dialog">+ 담당조직 연결 <span class="optional">선택</span></button></div>
<footer class="oneline-foot"><p class="status" data-ol-status role="status" aria-live="polite"></p><button type="button" class="primary" data-ol-save>저장</button></footer>`;
  document.body.append(dialog);
  dialog.addEventListener('cancel',e=>{e.preventDefault();if(!state?.saving)close()});
  dialog.addEventListener('click',e=>{
    if(e.target===dialog||e.target.closest('[data-ol-close]')){if(!state?.saving)close();return}
    if(e.target.closest('[data-ol-area]'))return pickArea();
    if(e.target.closest('[data-ol-orgs]'))return pickOrgs();
    if(e.target.closest('[data-ol-save]'))return void save();
  });
  // 한 줄 칸에서 Enter = 저장(한글 조합 중·Shift+Enter 제외). 다음 할 일 칸은 줄바꿈 그대로.
  dialog.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&e.target.matches?.('[data-ol-text]')){e.preventDefault();void save()}});
  return dialog;
}
const say=(text,error=false)=>{const el=$('[data-ol-status]');el.textContent=text||'';el.className='status'+(error?' error':'')};
function close(){if(dialog?.open)dialog.close();const t=state?.trigger;state=null;if(t?.isConnected)t.focus({preventScroll:true})}
async function paintArea(){
  const b=$('[data-ol-area]'),id=state?.areaId;if(!id){b.textContent='사업영역 ▾';b.removeAttribute('title');return}
  const run=state.run;let name='사업영역';
  try{const s=await import('./report-places-sheet.js'),places=await s.loadReportPlaces();name=s.areaNameIn(places,id)||name}catch{}
  if(state&&run===state.run&&state.areaId===id){b.textContent=name+' ▾';b.title=name}
}
async function pickArea(){
  if(!state||state.saving)return;
  const b=$('[data-ol-area]');
  try{const s=await import('./report-places-sheet.js');await s.pickBusinessArea(b,{chosen:state.areaId,onMessage:m=>say(m,true),onPick:id=>{if(!state)return;state.areaId=String(id||'');say('');void paintArea()}})}
  catch(e){say(e?.message||'사업영역을 불러오지 못했어요.',true)}
}
// 담당조직 연결(선택): 쓰기 창 [연결할 곳]과 같은 고르기 창. 담당조직만 남긴다(사업영역은 위 꼬리표가 연결된다) — 담당조직 상세의 사업 보고 목록에 보인다.
function paintOrgs(){const b=$('[data-ol-orgs]'),n=state?.orgs?.length||0;b.innerHTML=n?`담당조직 ${n}곳 연결 <span class="optional">바꾸기</span>`:'+ 담당조직 연결 <span class="optional">선택</span>'}
async function pickOrgs(){
  if(!state||state.saving)return;
  const b=$('[data-ol-orgs]');
  try{const s=await import('./report-places-sheet.js');await s.pickReportPlaces(b,{chosen:state.orgs,onMessage:m=>say(m,true),onCommit:list=>{if(!state)return;state.orgs=(list||[]).filter(t=>t?.kind==='organization').map(t=>({kind:t.kind,id:t.id}));paintOrgs()}})}
  catch(e){say(e?.message||'담당조직을 불러오지 못했어요.',true)}
}
async function save(){
  if(!state||state.saving)return;
  const rt=window.KPTURuntime,ctx=rt?.context?.read?.(),ws=ctx?.workspace?.id,user=ctx?.user?.id;
  const input={areaId:state.areaId,day:$('[data-ol-day]').value,text:$('[data-ol-text]').value,plan:$('[data-ol-plan]').value};
  let body;
  try{const miss=onelineMissing(input);if(miss)return say(miss,true);if(!rt?.api||!ws||!user)return say('로그인 상태를 확인하지 못했어요.',true);body=onelineBody({...input,workspaceId:ws,userId:user})}
  catch(e){return say(e?.message||'입력을 확인해 주세요.',true)}
  const btn=$('[data-ol-save]'),run=state.run;state.saving=true;btn.disabled=true;btn.setAttribute('aria-busy','true');say('저장 중…');
  try{
    const rows=await rt.api('/rest/v1/app_meetings',{method:'POST',body,prefer:'return=representation'});
    const row=Array.isArray(rows)&&rows.length===1?rows[0]:null;
    if(!row||row.workspace_id!==ws||row.activity_kind!=='oneline')throw new Error('저장한 한 줄을 확인하지 못했어요.');
    // 꼬리표 사업영역에 연결(사업영역 관리의 사업 보고 목록). 실패해도 한 줄은 저장된 것이다.
    let note='';
    try{const {saveReportTargets}=await import('./report-links.js');const r=await saveReportTargets(row,[{kind:'project',id:body.business_area_id},...(state?.orgs||[])]);if(!r.ok)note=' 연결은 못 했어요.';else if(r.legacy&&r.skippedOrgs)note=' 담당조직 연결은 서버 준비가 끝난 뒤에 돼요.'}catch{note=' 연결은 못 했어요.'}
    const onSaved=state?.onSaved;
    if(state&&run===state.run){state.saving=false;close()}
    await window.__KPTU_RELOAD_MEETINGS__?.();
    window.dispatchEvent(new CustomEvent('kptu:meetings-changed',{detail:{meeting_id:row.id}}));
    window.KPTUDriveSummary?.saved?.();
    onSaved?.(row);
    const box=document.querySelector('#toast');if(box){box.textContent='한 줄 업데이트를 저장했어요.'+note;holdToast(box)}
  }catch(e){
    if(state&&run===state.run){state.saving=false;btn.disabled=false;btn.removeAttribute('aria-busy');say(Number(e?.status)===400?'한 줄 업데이트는 서버 준비가 끝난 뒤에 쓸 수 있어요.':(e?.message||'저장하지 못했어요.'),true)}
  }
}

// trigger: 누른 버튼(닫힌 뒤 초점이 돌아감). areaId: 미리 고른 사업영역(사업영역 칩을 고른 채 열 때). onSaved(row): 저장 뒤.
export function openOneline(trigger,{areaId='',day='',onSaved=null}={}){
  ensureDialog();
  state={trigger,areaId:String(areaId||''),orgs:[],onSaved,run:++seq,saving:false};
  $('[data-ol-day]').value=day||seoulDateKey();$('[data-ol-text]').value='';$('[data-ol-plan]').value='';$('[data-ol-plan-box]').open=false;
  const btn=$('[data-ol-save]');btn.disabled=false;btn.removeAttribute('aria-busy');say('');paintOrgs();void paintArea();
  if(!dialog.open)dialog.showModal();
  (state.areaId?$('[data-ol-text]'):$('[data-ol-area]')).focus({preventScroll:true});
}
