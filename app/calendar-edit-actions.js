const EA_SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const EA_KEY='sb_publishable_X-0lXJztIQUriUidBZ1PLQ_QemTRSpA';
const EA_SESSION='kptu_collab_session_v1';
let eaAppId=null,eaGoogleEventId=null,eaGoogleCalendarId=null;

function eaSession(){try{return JSON.parse(localStorage.getItem(EA_SESSION)||'null')}catch{return null}}
function eaToken(){return eaSession()?.access_token||''}
async function eaRest(path,{method='GET',body=null}={}){
  const token=eaToken();
  if(!token)throw new Error('로그인이 필요합니다.');
  const r=await fetch(EA_SB+path,{method,headers:{apikey:EA_KEY,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===null?null:JSON.stringify(body)});
  const t=await r.text();let d=null;try{d=t?JSON.parse(t):null}catch{d=t}
  if(!r.ok)throw new Error(d?.message||d?.error_description||d?.hint||('요청 실패 '+r.status));
  return d;
}
async function eaGoogle(body){
  const token=eaToken();
  if(!token)throw new Error('로그인이 필요합니다.');
  const r=await fetch(EA_SB+'/functions/v1/google-calendar',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const d=await r.json().catch(()=>({}));
  if(!r.ok||d.error)throw new Error(d.error||'Google Calendar 요청 실패');
  return d;
}
function eaToast(msg){const t=document.querySelector('#toast');if(!t)return;t.textContent=msg;t.classList.remove('hidden');clearTimeout(eaToast.t);eaToast.t=setTimeout(()=>t.classList.add('hidden'),2200)}
function eaSetStatus(id,msg,err=false){const e=document.querySelector(id);if(e){e.textContent=msg||'';e.className='status'+(err?' error':'')}}
function eaClose(id){const m=document.querySelector(id);if(m){m.classList.add('hidden');m.setAttribute('aria-hidden','true')}}

function eaStyleCreateModal(){
  const card=document.querySelector('#eventModal .modal-card');
  if(!card||card.dataset.eaCreateStyled)return;
  card.dataset.eaCreateStyled='1';
  card.classList.add('ea-create-card');
  const eyebrow=card.querySelector('.modal-head .eyebrow');
  const h=card.querySelector('.modal-head h2');
  if(eyebrow)eyebrow.textContent='NEW EVENT';
  if(h)h.textContent='새 일정 등록';
  const head=card.querySelector('.modal-head');
  if(head&&!card.querySelector('.ea-create-note'))head.insertAdjacentHTML('afterend','<div class="ea-create-note"><b>새 일정</b><span>빈 날짜를 선택했거나 + 버튼으로 새 일정을 등록하는 화면입니다.</span></div>');
}
function eaStyleEditModals(){
  const app=document.querySelector('#caeModal .modal-card');
  if(app&&!app.dataset.eaEditStyled){
    app.dataset.eaEditStyled='1';app.classList.add('ea-edit-card');
    const head=app.querySelector('.modal-head');
    if(head&&!app.querySelector('.ea-edit-note'))head.insertAdjacentHTML('afterend','<div class="ea-edit-note"><b>기존 일정 수정</b><span>등록된 일정의 내용을 바꾸거나 삭제할 수 있습니다.</span></div>');
    const save=app.querySelector('#caeSave');
    if(save){const row=document.createElement('div');row.className='ea-edit-actions';const del=document.createElement('button');del.id='caeDelete';del.type='button';del.className='ea-delete';del.textContent='일정 삭제';row.appendChild(del);row.appendChild(save);app.querySelector('#caeStatus')?.insertAdjacentElement('beforebegin',row);del.onclick=eaDeleteApp}
  }
  const google=document.querySelector('#ceModal .modal-card');
  if(google&&!google.dataset.eaEditStyled){
    google.dataset.eaEditStyled='1';google.classList.add('ea-edit-card');
    const head=google.querySelector('.modal-head');
    if(head&&!google.querySelector('.ea-edit-note'))head.insertAdjacentHTML('afterend','<div class="ea-edit-note"><b>기존 Google 일정 수정</b><span>Google Calendar에 저장된 일정입니다. 수정하거나 삭제할 수 있습니다.</span></div>');
    const save=google.querySelector('#ceSave');
    if(save){const row=document.createElement('div');row.className='ea-edit-actions';const del=document.createElement('button');del.id='ceDelete';del.type='button';del.className='ea-delete';del.textContent='일정 삭제';row.appendChild(del);row.appendChild(save);google.querySelector('#ceReauth')?.insertAdjacentElement('beforebegin',row);del.onclick=eaDeleteGoogle}
  }
}
async function eaDeleteApp(){
  if(!eaAppId)return eaSetStatus('#caeStatus','삭제할 일정을 확인할 수 없습니다.',true);
  if(!confirm('이 일정을 삭제할까요? 삭제하면 되돌릴 수 없습니다.'))return;
  const b=document.querySelector('#caeDelete');if(b)b.disabled=true;
  eaSetStatus('#caeStatus','일정 삭제 중…');
  try{
    try{await eaRest('/rest/v1/app_event_attendees?event_id=eq.'+encodeURIComponent(eaAppId),{method:'DELETE'})}catch(_){}
    await eaRest('/rest/v1/app_events?id=eq.'+encodeURIComponent(eaAppId),{method:'DELETE'});
    eaClose('#caeModal');eaAppId=null;
    await window.__KPTU_RELOAD_APP_EVENTS__?.();
    eaToast('일정을 삭제했습니다.');
  }catch(e){eaSetStatus('#caeStatus',e.message||String(e),true)}finally{if(b)b.disabled=false}
}
async function eaDeleteGoogle(){
  if(!eaGoogleEventId)return eaSetStatus('#ceStatus','삭제할 Google 일정을 확인할 수 없습니다.',true);
  if(!confirm('이 Google 일정을 삭제할까요? 삭제하면 Google Calendar에서도 사라집니다.'))return;
  const b=document.querySelector('#ceDelete');if(b)b.disabled=true;
  eaSetStatus('#ceStatus','Google 일정 삭제 중…');
  try{
    await eaGoogle({action:'delete-event',calendar_id:eaGoogleCalendarId||'primary',event_id:eaGoogleEventId});
    eaClose('#ceModal');eaGoogleEventId=null;eaGoogleCalendarId=null;
    await window.__KPTU_RELOAD_GOOGLE_EVENTS__?.();
    eaToast('Google 일정을 삭제했습니다.');
  }catch(e){eaSetStatus('#ceStatus',e.message||String(e),true)}finally{if(b)b.disabled=false}
}
function eaInstallStyles(){
  if(document.querySelector('#eaCalendarStyles'))return;
  const s=document.createElement('style');s.id='eaCalendarStyles';s.textContent=`
#eventModal .ea-create-card{border-top:5px solid #2e7451}
#eventModal .ea-create-card .modal-head .eyebrow{color:#2e7451}
#eventModal .ea-create-card #saveEventBtn{background:#2e7451}
.ea-create-note,.ea-edit-note{display:flex;align-items:flex-start;gap:9px;border-radius:10px;padding:9px 11px;margin:-2px 0 12px;font-size:11px;line-height:1.45}
.ea-create-note{background:#edf6f0;color:#466553}
.ea-create-note b{flex:0 0 auto;color:#2e7451}
.ea-create-note span,.ea-edit-note span{font-weight:500}
.ea-edit-card{border-top:5px solid #315f95}
.ea-edit-card .modal-head .eyebrow{color:#315f95}
.ea-edit-note{background:#edf3f8;color:#50677c}
.ea-edit-note b{flex:0 0 auto;color:#315f95}
.ea-edit-actions{display:grid;grid-template-columns:auto 1fr;gap:8px;align-items:center;margin-top:10px}
.ea-edit-actions .wide{width:auto;margin:0;padding:10px 14px}
.ea-delete{border:1px solid #d8a6aa;background:#fff;color:#a33b45;border-radius:9px;padding:10px 13px;font-weight:850;white-space:nowrap}
.ea-delete:disabled{opacity:.5}
@media(max-width:600px){.ea-create-note,.ea-edit-note{display:block}.ea-create-note b,.ea-edit-note b{display:block;margin-bottom:2px}.ea-edit-actions{grid-template-columns:1fr 1.7fr}.ea-edit-actions .wide,.ea-delete{min-height:42px}}
`;
  document.head.appendChild(s);
}

document.addEventListener('click',e=>{
  const app=e.target.closest?.('.cm-app[data-app-event]');
  if(app){eaAppId=app.dataset.appEvent;setTimeout(eaStyleEditModals,0);return}
  const google=e.target.closest?.('.cp-event[data-google-event]');
  if(google){eaGoogleEventId=google.dataset.googleEvent;eaGoogleCalendarId=google.dataset.googleCalendar;setTimeout(eaStyleEditModals,0);return}
  if(e.target.closest?.('#newEventBtn,#homeAddEvent,#calendarQuickAdd'))setTimeout(eaStyleCreateModal,0);
},true);

eaInstallStyles();
setTimeout(()=>{eaStyleCreateModal();eaStyleEditModals()},0);
