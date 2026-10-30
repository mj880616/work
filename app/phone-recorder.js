// MTG-폰녹음(요청함 10/30 10:56): 폰 앱(웹2 앱 0.3.3+) 안에서만 사업 보고 위쪽 줄 [녹음]·녹음 띠·'끝나지 않은 녹음' 줄을 그린다.
// 녹음은 앱이 한다(화면이 꺼지거나 다른 앱을 써도 계속, 알림줄 '녹음 중 12:34 [일시정지][멈추고 정리]'). 순서·서버 호출은 phone-recorder-core.mjs.
// - 주인: 이 모듈 하나가 #phoneRecordBtn·#phoneRecBand·#phoneRecPendingLine을 그린다(노트북 녹음 meeting-recorder.js가 그리는 버튼·띠와 따로).
// - 앱 다리(KPTUAppShell, 허용 Origin 최상위 화면에만 보임)에 'rec:hello'를 보내 답이 와야(0.3.3+) [녹음]이 보인다. 웹 브라우저·옛 앱에서는 아무것도 보이지 않는다.
// - 기기 저장 없음(웹): 녹음 조각은 앱 전용 공간에만 있고 올린 뒤 앱이 지운다. 이 화면은 브라우저 저장 공간을 쓰지 않는다.
import {createPhoneRecorder} from './phone-recorder-core.mjs';
import {clockText,stepParts,pendingText} from './meeting-recorder-model.mjs';
import {notify} from './small-notice.js';

const BRIDGE='KPTUAppShell';
const FN='/functions/v1/meeting-transcribe';

export function mountPhoneRecorder(win=window){
  const doc=win.document;
  if(win.KPTUPhoneRecorder)return win.KPTUPhoneRecorder;
  if(!/KPTUAndroid/i.test(win.navigator?.userAgent||''))return null;
  const bridge=win[BRIDGE];
  if(!bridge||typeof bridge.postMessage!=='function'||typeof bridge.addEventListener!=='function')return null;
  if(!doc.querySelector('link[data-phone-rec-style]')){const l=doc.createElement('link');l.rel='stylesheet';l.href='./phone-recorder.css';l.dataset.phoneRecStyle='1';doc.head.appendChild(l)}
  const $=s=>doc.querySelector(s);
  const rt=()=>win.KPTURuntime;
  const ws=()=>rt()?.context?.read?.()?.workspace?.id||'';
  const send=t=>{try{bridge.postMessage(t)}catch{/* 다리가 사라진 화면 */}};
  // 사업 보고 위쪽 줄 [녹음]([+ 사업 보고] 왼쪽, 노트북 [녹음]과 같은 자리)과 '끝나지 않은 녹음' 줄을 이 모듈이 한 번 붙인다(index.html은 노트북 것만 둔다).
  function mountSlots(){
    const add=$('#newMeetingBtn');
    if(add&&!$('#phoneRecordBtn')){const b=doc.createElement('button');b.id='phoneRecordBtn';b.className='secondary';b.type='button';b.hidden=true;b.textContent='녹음';add.before(b)}
    const list=$('#meetingList');
    if(list&&!$('#phoneRecPendingLine')){const d=doc.createElement('div');d.id='phoneRecPendingLine';d.className='rec-pending';d.hidden=true;list.before(d)}
  }
  mountSlots();

  const core=createPhoneRecorder({
    send,
    workspace:ws,
    call:(action,body,extra={})=>rt().api(`${FN}?action=${action}`,{method:'POST',body,singleFlight:false,...extra}),
    fetchPiece:async token=>{
      const r=await fetch(new URL(`__rec/${encodeURIComponent(token)}`,doc.baseURI),{cache:'no-store',credentials:'omit'});
      if(!r.ok)throw new Error('piece_read_failed');
      return r.blob();
    },
    openDraft:async({text,jobs,startedAt,minutes})=>{
      const loader=win.KPTUDeferredFeatures?.loadView||win.KPTUViewLoader?.load;
      if(loader)await loader('meetings');
      const entry=win.KPTUReportEntry;
      if(!entry?.open)throw stop('사업 보고 화면을 열지 못했어요. [다시]를 누르세요.');
      const opened=await entry.open({kind:'meeting',at:startedAt,trigger:$('#phoneRecordBtn')||doc.activeElement});
      if(opened===false)throw stop('사업 보고 창을 열지 못했어요. [다시]를 누르세요.');
      const draft=win.KPTUMeetingTranscriptDraft;
      if(!draft?.fill)throw stop('초안 칸을 찾지 못했어요. [다시]를 누르세요.');
      await draft.fill({text,jobs,name:`폰 녹음${minutes?` · ${minutes}분`:''}`});
    },
    notify,
    paint,
  });
  function stop(text){const e=new Error('');e.recText=text;e.recRetry=true;return e}

  // ---- 그리기(이 모듈만) ----
  const drawn=new WeakMap();
  const setHtml=(el,html)=>{if(drawn.get(el)!==html){el.innerHTML=html;drawn.set(el,html)}};
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
  let doneTimer=0;
  function band(){
    let el=$('#phoneRecBand');if(el)return el;
    el=doc.createElement('div');
    el.id='phoneRecBand';el.className='rec-band';el.setAttribute('role','region');el.setAttribute('aria-label','폰 녹음');el.hidden=true;
    el.innerHTML='<span class="rec-dot" aria-hidden="true"></span><span class="rec-label"></span><time class="rec-time"></time><span class="rec-note" role="status" aria-live="polite"></span><span class="rec-actions"></span>';
    el.addEventListener('click',onClick);
    doc.body.prepend(el);
    return el;
  }
  function paint(view=core?.view){
    if(!view)return;
    const el=band(),state=view.state,on=state!=='idle';
    el.hidden=!on;el.dataset.state=state;
    doc.body.classList.toggle('phone-rec-on',on);
    let l='',t='',m='',a='';
    const sec=(core?.elapsedMs?.()||0)/1000;
    if(state==='starting'){l='녹음 준비 중';m=esc('마이크를 허락해 주세요.')}
    else if(state==='recording'||state==='paused'){
      l=state==='paused'?'일시정지':'녹음 중';t=clockText(sec);
      const q=view.native?.queued||0;
      m=view.note&&q?esc(`${view.note} · 조각 ${q}개`):'';
      a=`<button type="button" class="rec-btn" data-prec="pause">${state==='paused'?'이어 녹음':'일시정지'}</button><button type="button" class="rec-btn rec-stop" data-prec="stop">멈추고 정리</button><button type="button" class="rec-btn rec-discard" data-prec="discard">버리기</button>`;
    }else if(state==='finishing'||state==='done'){
      l=state==='done'?'정리 끝':'정리 중';
      m=stepParts(view.step).map(p=>p.state==='now'?`<strong>${p.label}</strong>`:`<span class="rec-step-${p.state}">${p.label}</span>`).join('<span aria-hidden="true"> › </span>')+(view.note?` <span class="rec-sub">${esc(view.note)}</span>`:'');
      a=state==='done'?'<button type="button" class="rec-btn" data-prec="close">닫기</button>':'';
      if(state==='done'&&!doneTimer)doneTimer=setTimeout(()=>{doneTimer=0;core.close()},8000);
    }else if(state==='error'){
      l='녹음 정리 멈춤';m=esc(view.error);
      a=`${view.canRetry?'<button type="button" class="rec-btn" data-prec="retry">다시</button>':''}<button type="button" class="rec-btn" data-prec="close">닫기</button>`;
    }
    const label=el.querySelector('.rec-label'),time=el.querySelector('.rec-time');
    if(label.textContent!==l)label.textContent=l;
    if(time.textContent!==t)time.textContent=t;
    setHtml(el.querySelector('.rec-note'),m);setHtml(el.querySelector('.rec-actions'),a);
    const btn=$('#phoneRecordBtn');
    if(btn){
      btn.hidden=!view.supported;
      const live=state==='recording'||state==='paused'||state==='starting';
      btn.disabled=!['idle','done','error'].includes(state)||view.busy;
      btn.textContent=live?'녹음 중':'녹음';
      btn.setAttribute('aria-pressed',String(live));
    }
    const line=$('#phoneRecPendingLine');
    if(line){
      const list=view.pending||[];
      line.hidden=!list.length;
      if(!list.length)setHtml(line,'');
      else{
        const first=list[0];
        setHtml(line,`<span class="rec-pending-text">끝나지 않은 ${first.local?'폰 ':''}녹음 · ${esc(pendingText(first))}${list.length>1?` 외 ${list.length-1}건`:''}</span><button type="button" class="rec-btn" data-prec-resume="${esc(first.session_id)}">이어서 정리</button><button type="button" class="rec-btn rec-discard" data-prec-discard="${esc(first.session_id)}">버리기</button>`);
      }
    }
  }
  function onClick(e){
    const b=e.target.closest('[data-prec]');if(!b)return;
    const what=b.dataset.prec;
    if(what==='pause')core.pause();
    else if(what==='stop')void core.stopAndFinish();
    else if(what==='discard')void core.discardLive();
    else if(what==='retry')core.retry();
    else if(what==='close')core.close();
  }

  doc.addEventListener('click',e=>{
    if(e.target.closest('#phoneRecordBtn')){e.preventDefault();void core.start();return}
    const r=e.target.closest('[data-prec-resume]');
    if(r){e.preventDefault();core.resume(r.dataset.precResume);return}
    const d=e.target.closest('[data-prec-discard]');
    if(d){e.preventDefault();core.discardPending(d.dataset.precDiscard)}
  });
  bridge.addEventListener('message',ev=>core.receive(typeof ev?.data==='string'?ev.data:''));
  // 앱으로 돌아오면(화면 켬·알림에서 엶) 상태를 다시 묻는다. 녹음 중 1초마다 시계만 다시 그린다.
  doc.addEventListener('visibilitychange',()=>{if(doc.visibilityState==='visible')void core.hello()});
  setInterval(()=>{if(['recording','paused'].includes(core.view.state)&&doc.visibilityState!=='hidden')paint()},1000);
  win.addEventListener('kptu:session-changed',e=>{if(!e.detail?.session)core.reset()});
  win.addEventListener('kptu:view-changed',e=>{if(e.detail?.view==='meetings'){mountSlots();paint();void core.loadPending()}});

  const api={state:()=>core.view.state,core};
  win.KPTUPhoneRecorder=api;
  void core.hello();
  return api;
}

if(typeof window!=='undefined'&&window.document)mountPhoneRecorder(window);
