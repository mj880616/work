// UI-작은알림 (2026-10-28 명진 요청 08:28): 브라우저 기본 알림창('desk.bokdoong.com 내용:') 대신 쓰는 공용 부품 두 가지.
// ① notify(text,{undo}) — 화면 아래(하단바 위) 작은 알림 한 줄. 몇 초 뒤 조용히 사라지고, 되돌릴 수 있는 일이면 [되돌리기]를 같이 둔다.
//    한 번에 하나만 보인다(새 알림이 앞 알림을 갈아 끼움). 앞 알림의 [되돌리기]는 그때 같이 사라진다.
// ② askConfirm(anchor,{text,ok}) — 되돌릴 수 없는 일만 묻는 작은 확인창. 누른 자리 근처에 뜨고 하단바에 가리지 않는다. Promise<boolean>.
//    Esc·바깥 누르기·폰 뒤로가기 = 취소. 브라우저 기본 confirm과 달리 화면을 멈추지 않는다.
// 둘 다 화면에만 있고 아무것도 저장하지 않는다. 노트·사진·업데이트 등 다른 화면도 이 파일을 그대로 가져다 쓴다(자료실이 처음).
import {placeAnchored,clearAnchored} from './anchored-popup.js';

export const NOTICE_MS=5000,NOTICE_UNDO_MS=6000,NOTICE_ERROR_MS=8000;
// 알림이 떠 있는 시간: 오류는 조금 길게, 되돌리기가 있으면 누를 틈을 준다.
export function noticeMs({error=false,undo=false,ms}={}){if(Number.isFinite(ms)&&ms>0)return ms;return error?NOTICE_ERROR_MS:undo?NOTICE_UNDO_MS:NOTICE_MS}
// 알림 글자는 한 줄로. 줄바꿈·겹친 빈칸은 한 칸으로 줄인다(긴 설명은 note로 따로 작게).
export function noticeText(text){return String(text??'').replace(/\s+/g,' ').trim()}

let host=null,timer=0,seq=0;
function ensureHost(doc){
  if(host?.isConnected)return host;
  host=doc.createElement('div');host.id='kptuNotice';host.className='kptu-notice';host.hidden=true;
  host.setAttribute('role','status');host.setAttribute('aria-live','polite');
  doc.body.append(host);return host;
}
// {undo:async()=>…, undoLabel, note, error, ms}. 반환: {close} — 화면이 먼저 알림을 거둘 때.
export function notify(text,{undo=null,undoLabel='되돌리기',note='',error=false,ms,doc=globalThis.document}={}){
  const line=noticeText(text);if(!doc||!line)return {close(){}};
  const box=ensureHost(doc),token=++seq;clearTimeout(timer);
  box.replaceChildren();box.classList.toggle('error',!!error);
  if(error){box.setAttribute('role','alert');box.removeAttribute('aria-live')}else{box.setAttribute('role','status');box.setAttribute('aria-live','polite')}
  const span=doc.createElement('span');span.className='kptu-notice-text';span.textContent=line;box.append(span);
  const close=()=>{if(token!==seq)return;clearTimeout(timer);box.hidden=true;box.replaceChildren()};
  if(undo){
    const b=doc.createElement('button');b.type='button';b.className='kptu-notice-undo';b.textContent=undoLabel;
    b.addEventListener('click',()=>{if(token!==seq)return;close();void undo()},{once:true});box.append(b);
  }
  if(note){const small=doc.createElement('small');small.className='kptu-notice-note';small.textContent=noticeText(note);box.append(small)}
  const x=doc.createElement('button');x.type='button';x.className='kptu-notice-close';x.setAttribute('aria-label','알림 닫기');x.textContent='✕';x.addEventListener('click',close,{once:true});box.append(x);
  box.hidden=false;
  timer=setTimeout(close,noticeMs({error,undo:!!undo,ms}));
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
