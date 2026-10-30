// UI-작은알림 (2026-10-28 명진 요청 08:28·10:52): 브라우저 기본 알림창('desk.bokdoong.com 내용:') 대신 쓰는 공용 부품.
// ① notify(text,{undo,label}) — 화면 위쪽(맨 위 줄 바로 아래, 목록 위) 가운데 작은 알림 한 줄. 폰 하단바·손가락에 가리지 않는다.
//    2초 뒤 저절로 사라지고, 알림 위에 마우스·손가락이 있거나 키보드 초점이 안에 있는 동안은 사라지지 않는다(오류는 5초).
//    한 번에 하나만 보인다(새 알림이 앞 알림을 갈아 끼움). 되돌릴 수 있는 일이면 [되돌리기]를 같이 두고, 되돌리기 기록(③)에도 올린다.
// ② askConfirm(anchor,{text,ok}) — 되돌릴 수 없는 일만 묻는 작은 확인창. 누른 자리 근처에 뜨고 하단바에 가리지 않는다. Promise<boolean>.
//    Esc·바깥 누르기·폰 뒤로가기 = 취소. 브라우저 기본 confirm과 달리 화면을 멈추지 않는다.
// ③ 되돌리기 기록(UNDO_LIMIT=10개) + PC Ctrl+Z(맥 ⌘Z). 가장 최근 것부터 하나씩 되돌리고 '되돌렸어요: 폴더 옮기기 3개'처럼 한 줄 알린다.
//    글 쓰는 칸(input·textarea·select·contenteditable·노트 편집기 .ed-editor·[data-own-undo] 안)에서는 건드리지 않아 글자 되돌리기가 그대로다.
//    HWP 편집기는 iframe 안이라 키가 여기까지 오지 않는다. 기록은 이 화면 메모리에만 있다: 새로고침·다른 화면으로 이동·로그인 바뀜이면 비운다.
//    기기에 아무것도 저장하지 않는다. 대상은 서버에서 되살릴 수 있는 일(휴지통 삭제·옮기기·이름·종류 바꾸기 등)만 올린다.
//
// 다른 화면이 붙여 쓰는 법(자료실 등):
//   (가) 알림과 함께: notify('옮겼어요 3개',{label:'폴더 옮기기 3개',undo:async()=>{…서버에 되돌리기 요청…; return 결과}})
//       → [되돌리기] 버튼과 Ctrl+Z가 같은 undo를 부른다(한 번만 실행됨).
//   (나) 알림 없이 기록만: const id=recordUndo({label:'이름 바꾸기',undo}); 나중에 필요 없어지면 dropUndo(id).
//   (다) 이미 쓰는 공용 되돌리기 알림 offerUndoNotice(basket-record-delete.js)는 이 기록에 저절로 올라간다.
//   undo가 돌려줄 수 있는 값: 없음·true·{status:'restored'|'ok'} = 되돌림 성공 → '되돌렸어요: label'.
//     false·{status:'failed'|'unknown'…, message} 또는 throw = '되돌리지 못했어요: label'(message가 있으면 그 글).
//     {status:'conflict'|'stale'} = 그사이 다른 기기·다른 곳에서 바뀜 → 덮어쓰지 않고 '다른 곳에서 바뀌어 되돌리지 않았어요: label'.
//     {silent:true} = 화면이 직접 결과를 알렸음(이 부품은 아무 말도 하지 않음).
import {placeAnchored,clearAnchored} from './anchored-popup.js';

export const NOTICE_MS=2000,NOTICE_UNDO_MS=2000,NOTICE_ERROR_MS=5000,UNDO_LIMIT=10;
// 알림이 떠 있는 시간: 2초(명진 결정 10:52). 오류는 읽을 틈을 주려고 조금 길게. 올려 두면(마우스·손가락·초점) 그동안은 멈춘다.
export function noticeMs({error=false,undo=false,ms}={}){if(Number.isFinite(ms)&&ms>0)return ms;return error?NOTICE_ERROR_MS:undo?NOTICE_UNDO_MS:NOTICE_MS}
// 알림 글자는 한 줄로. 줄바꿈·겹친 빈칸은 한 칸으로 줄인다(긴 설명은 note로 따로 작게).
export function noticeText(text){return String(text??'').replace(/\s+/g,' ').trim()}

// 올려 두는 동안 멈추는 시계: 마우스가 실제로 움직여 올라오거나(가만히 있는 커서 밑에 알림이 새로 떠도 멈추지 않음),
// 손가락이 누르고 있거나, 초점이 안에 있으면 멈추고, 떠나면 ms를 처음부터 다시 잰다. box에서 떼어 낼 때 stop()을 부른다.
// 되돌리기 알림·작은 알림은 글 부분이 아래 목록 누르기를 막지 않게(pointer-events:none) 버튼에서만 이 신호가 온다.
export function holdTimer(box,ms,onDone){
  let t=0,over=false,focus=false,stopped=false;const ac=new AbortController(),o={signal:ac.signal};
  const arm=()=>{clearTimeout(t);if(!stopped&&!over&&!focus)t=setTimeout(()=>{if(!stopped){stop();onDone()}},ms)};
  const stop=()=>{stopped=true;clearTimeout(t);ac.abort()};
  const hold=()=>{over=true;clearTimeout(t)},leave=()=>{if(!over)return;over=false;arm()};
  box.addEventListener('pointermove',e=>{if(e.pointerType==='mouse'&&!(e.movementX||e.movementY))return;if(e.pointerType==='mouse')hold()},o);
  box.addEventListener('pointerdown',hold,o);
  box.addEventListener('pointerup',e=>{if(e.pointerType!=='mouse')leave()},o);
  box.addEventListener('pointercancel',leave,o);
  box.addEventListener('pointerout',e=>{if(e.relatedTarget&&box.contains(e.relatedTarget))return;leave()},o);
  box.addEventListener('focusin',()=>{focus=true;clearTimeout(t)},o);
  box.addEventListener('focusout',e=>{if(e.relatedTarget&&box.contains(e.relatedTarget))return;focus=false;arm()},o);
  arm();return {stop,restart:arm};
}

// ③ 되돌리기 기록. 화면 메모리 배열 하나뿐(기기 저장 없음).
const undoStack=[];let undoSeq=0,undoBusy=false,undoView=null;
const routerView=()=>globalThis.window?.KPTURouter?.current??null;
export const undoLabel=text=>noticeText(text).split(/(?<=[.!?。])\s/)[0].replace(/[.。]$/,'')||'방금 한 일';
function makeEntry({label,undo}){let ran=false;return {id:++undoSeq,label:undoLabel(label),run:async()=>{if(ran)return {silent:true};ran=true;return undo()}}}
function pushEntry(entry){
  if(undoView!==routerView()){undoStack.length=0;undoView=routerView()}
  undoStack.push(entry);while(undoStack.length>UNDO_LIMIT)undoStack.shift();
  return entry.id;
}
export function recordUndo({label,undo}={}){return typeof undo==='function'?pushEntry(makeEntry({label,undo})):0}
export function dropUndo(id){const i=undoStack.findIndex(e=>e.id===id);if(i>=0)undoStack.splice(i,1)}
export function clearUndo(){undoStack.length=0}
export const undoLabels=()=>undoStack.map(e=>e.label);
const FAIL=/fail|unknown|error|missing|blocked|denied/i,CONFLICT=/conflict|stale|changed/i;
// undo 결과를 알림 한 줄로. 반환 {text,error} 또는 null(말하지 않음).
export function undoResultLine(label,result){
  if(result?.silent)return null;
  const status=String(result?.status??'');
  if(CONFLICT.test(status))return {text:`다른 곳에서 바뀌어 되돌리지 않았어요: ${label}`,error:true};
  if(result===false||FAIL.test(status))return {text:result?.message||`되돌리지 못했어요: ${label}`,error:true};
  return {text:`되돌렸어요: ${label}`,error:false};
}
async function runEntry(entry,doc){
  dropUndo(entry.id);undoBusy=true;let result;
  try{result=await entry.run()}catch{result=false}finally{undoBusy=false}
  const line=undoResultLine(entry.label,result);
  if(line)notify(line.text,{error:line.error,doc});
}
// 가장 최근 기록 하나를 되돌린다(Ctrl+Z). 되돌린 게 있으면 true. 앞 되돌리기가 끝나기 전 누름은 무시한다.
export async function undoLast({doc=globalThis.document}={}){
  if(undoBusy)return true;
  const entry=undoStack.at(-1);if(!entry)return false;
  await runEntry(entry,doc);return true;
}
// 글 쓰는 칸 안이면 그 칸의 글자 되돌리기를 그대로 둔다.
const OWN_UNDO='input,textarea,select,[contenteditable]:not([contenteditable="false"]),.ed-editor,[data-own-undo]';
export function isUndoKey(e){return !!(e&&(e.ctrlKey||e.metaKey))&&!e.shiftKey&&!e.altKey&&String(e.key).toLowerCase()==='z'}
export function ownsUndo(target){return !!(target&&typeof target.closest==='function'&&target.closest(OWN_UNDO))}
if(typeof globalThis.document?.addEventListener==='function'&&!globalThis.__kptuUndoKeyBound){
  globalThis.__kptuUndoKeyBound=true;
  document.addEventListener('keydown',e=>{
    if(!isUndoKey(e)||e.defaultPrevented||e.isComposing||ownsUndo(e.target)||ownsUndo(document.activeElement))return;
    if(!undoStack.length&&!undoBusy)return;
    e.preventDefault();void undoLast();
  });
  globalThis.addEventListener?.('kptu:view-changed',e=>{if(e.detail?.view!==undoView)clearUndo()});
  globalThis.addEventListener?.('kptu:session-changed',clearUndo);
}

// 화면들이 같이 쓰는 #toast(app/index.html 한 칸)도 같은 규칙: 위쪽·2초·올려 두면 멈춤. 글은 부르는 쪽이 먼저 넣고 holdToast(el)를 부른다.
// 시계가 하나라 앞 화면의 시계가 뒤 알림을 일찍 지우지 않는다. 작은 알림(#kptuNotice)과 같은 자리라 하나가 뜨면 다른 하나는 내린다.
let toastClock=null;
export function holdToast(el,{ms}={}){
  if(!el)return;toastClock?.stop();
  if(host&&!host.hidden){clock?.stop();clock=null;host.hidden=true;host.replaceChildren()}
  el.classList.remove('hidden');
  toastClock=holdTimer(el,Number.isFinite(ms)&&ms>0?ms:NOTICE_MS,()=>{toastClock=null;el.classList.add('hidden')});
}

// 위쪽 작은 알림([되돌리기] 등)을 넣을 곳: 맨 뒤에 열린 창(.modal, role=dialog) 안이라 창의 포커스 순환이 [되돌리기]에 닿는다.
// PC 칸에 붙인 창(role=region: 사업영역·할 일·담당조직·사업 보고 상세)은 창이 아니다. 그 칸이 열린 창 안에 있으면 그 칸에 넣고(같은 층),
// 창 밖(밑의 화면)에 있으면 넣지 않는다: 밑의 화면 칸은 화면에 붙어 따라오는 칸(sticky)이라 알림이 그 층에 갇혀 위에 뜬 창
// (#areaWindow) 머리줄 밑에 깔렸다(UI-칸안스크롤하나로, CI task-inline-unify 1280). 열린 창이 없으면 맨 뒤의 붙인 칸, 없으면 body.
export function noticeHost(doc=globalThis.document){
  const open=[...doc.querySelectorAll('.modal:not(.hidden)')],docked=m=>m.getAttribute('role')==='region';
  const top=open.filter(m=>!docked(m)).at(-1);
  if(top)return open.filter(m=>docked(m)&&top.contains(m)).at(-1)||top;
  return open.at(-1)||doc.body;
}

let host=null,clock=null,seq=0;
// 되돌리기 알림(offerUndoNotice)이 뜰 때 앞서 떠 있던 작은 알림·#toast를 내린다(같은 자리라 [되돌리기]를 가리지 않게). 뒤에 뜨는 것은 CSS가 한 줄 아래로.
export function hideSmallNotices(doc=globalThis.document){
  const shared=doc?.getElementById?.('toast');if(shared&&!shared.classList.contains('hidden')){toastClock?.stop();toastClock=null;shared.classList.add('hidden')}
  if(host&&!host.hidden){clock?.stop();clock=null;host.hidden=true;host.replaceChildren()}
}
function ensureHost(doc){
  if(host?.isConnected)return host;
  host=doc.createElement('div');host.id='kptuNotice';host.className='kptu-notice';host.hidden=true;
  host.setAttribute('role','status');host.setAttribute('aria-live','polite');
  doc.body.append(host);return host;
}
// {undo:async()=>…, label, undoLabel, note, error, ms}. 반환: {close} — 화면이 먼저 알림을 거둘 때.
// undo가 있으면 되돌리기 기록에도 올린다(record:false면 올리지 않음). label은 '되돌렸어요: …'에 쓰는 말(없으면 알림 글 첫 문장).
// [되돌리기]를 누르든 Ctrl+Z든 undo는 한 번만 돌고, 끝나면 결과 한 줄(되돌렸어요/되돌리지 못했어요/다른 곳에서 바뀜)을 이 부품이 알린다.
export function notify(text,{undo=null,label='',undoLabel:buttonLabel='되돌리기',note='',error=false,ms,record=true,doc=globalThis.document}={}){
  const line=noticeText(text);if(!doc||!line)return {close(){}};
  const box=ensureHost(doc),token=++seq;clock?.stop();clock=null;
  const shared=doc.getElementById?.('toast');if(shared&&!shared.classList.contains('hidden')){toastClock?.stop();toastClock=null;shared.classList.add('hidden')}
  box.replaceChildren();box.classList.toggle('error',!!error);
  if(error){box.setAttribute('role','alert');box.removeAttribute('aria-live')}else{box.setAttribute('role','status');box.setAttribute('aria-live','polite')}
  const span=doc.createElement('span');span.className='kptu-notice-text';span.textContent=line;box.append(span);
  const close=()=>{if(token!==seq)return;clock?.stop();clock=null;box.hidden=true;box.replaceChildren()};
  if(undo){
    const entry=makeEntry({label:label||line,undo});if(record)pushEntry(entry);
    const b=doc.createElement('button');b.type='button';b.className='kptu-notice-undo';b.textContent=buttonLabel;
    b.addEventListener('click',()=>{if(token!==seq||undoBusy)return;close();void runEntry(entry,doc)},{once:true});box.append(b);
  }
  if(note){const small=doc.createElement('small');small.className='kptu-notice-note';small.textContent=noticeText(note);box.append(small)}
  const x=doc.createElement('button');x.type='button';x.className='kptu-notice-close';x.setAttribute('aria-label','알림 닫기');x.textContent='✕';x.addEventListener('click',close,{once:true});box.append(x);
  box.hidden=false;
  clock=holdTimer(box,noticeMs({error,undo:!!undo,ms}),close);
  return {close};
}

// 작은 확인창. anchor 근처에 뜨고(없으면 화면 가운데 아래), 하단바 위로 자리를 잡는다.
let ask=null;
export function askConfirm(anchor,{text,ok='확인',cancel='취소',danger=false,note='',doc=globalThis.document}={}){
  if(!doc)return Promise.resolve(false);
  ask?.finish(false);
  return new Promise(resolve=>{
    const panel=doc.createElement('div');panel.className='kptu-ask';panel.setAttribute('role','alertdialog');panel.setAttribute('aria-modal','false');
    const msg=doc.createElement('p');msg.className='kptu-ask-text';msg.id='kptuAskText';msg.textContent=String(text??'').trim();panel.setAttribute('aria-labelledby',msg.id);panel.append(msg);
    if(note){const n=doc.createElement('small');n.className='kptu-ask-note';n.textContent=noticeText(note);panel.append(n)}
    const row=doc.createElement('div');row.className='kptu-ask-actions';
    const no=doc.createElement('button');no.type='button';no.className='secondary';no.textContent=cancel;
    const yes=doc.createElement('button');yes.type='button';yes.className=danger?'danger':'primary';yes.textContent=ok;
    row.append(no,yes);panel.append(row);doc.body.append(panel);
    const back=anchor instanceof Element&&anchor.isConnected?anchor:null;
    const place=()=>{
      if(!back){panel.classList.add('kptu-ask-center');return}
      placeAnchored(panel,back,{maxWidth:300,maxHeight:220,minHeight:0});
      // 폰 하단바 위로: 확인창 아래 끝이 하단바에 걸리면 그만큼 올린다.
      const bar=doc.querySelector('.mobile-tabs'),barTop=bar&&bar.getClientRects().length?bar.getBoundingClientRect().top:innerHeight;
      const r=panel.getBoundingClientRect(),limit=Math.min(innerHeight,barTop)-8;
      if(r.bottom>limit)Object.assign(panel.style,{top:Math.max(8,limit-r.height)+'px',bottom:'auto'});
    };
    place();
    const state={kptuAsk:++seq};history.pushState({...(history.state||{}),...state},'',location.href);
    let done=false;
    const finish=(value,fromBack=false)=>{
      if(done)return;done=true;ask=null;
      doc.removeEventListener('keydown',onKey,true);doc.removeEventListener('pointerdown',onOutside,true);globalThis.removeEventListener?.('popstate',onPop);
      clearAnchored(panel);panel.remove();
      if(!fromBack&&history.state?.kptuAsk===state.kptuAsk)history.back();
      if(back?.isConnected)back.focus({preventScroll:true});
      resolve(value);
    };
    const onKey=e=>{if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();finish(false)}};
    const onOutside=e=>{if(!panel.contains(e.target))finish(false)};
    const onPop=e=>{if(e.state?.kptuAsk!==state.kptuAsk)finish(false,true)};
    doc.addEventListener('keydown',onKey,true);doc.addEventListener('pointerdown',onOutside,true);globalThis.addEventListener?.('popstate',onPop);
    no.addEventListener('click',()=>finish(false));yes.addEventListener('click',()=>finish(true));
    ask={finish};
    (danger?no:yes).focus({preventScroll:true});
  });
}
