import {newSince,noticeText} from './release-notes-model.mjs';
import {readReleaseNotes,canReadReleaseNotes} from './release-notes-read.js';
import {putNotice,removeNotice} from './notice-bar.js';
import {askConfirm} from './small-notice.js';
// S69-34: 계정 메뉴 '앱 정보'(app-info.js)가 같은 판 정보·같은 확인·같은 다시 읽기를 쓴다(따로 만들지 않음). 확인은 누를 때만(60초 간격 없음).
export const appVersionNow={current:null,check:async()=>null,reload:async()=>false};
// Open tabs compare the deployed entry point with the app script they actually loaded.
// Any deployed ?v= other than the running one is new (the Pages build makes it a content hash;
// a rollback is a new deployment too). A dismissed value is not offered again in this tab.
export function startVersionNotice(scriptUrl){
  const script=new URL(scriptUrl),entry=new URL('./index.html',script);
  const version=raw=>/^[A-Za-z0-9._-]{1,64}$/.test(raw||'')?raw:null;
  const current=version(script.searchParams.get('v'));
  if(current===null)return;
  appVersionNow.current=current;
  // UI-업데이트안내 → UPDATE-운영자전용기록업데이트소식(사용자 11/15 13:37): 새 판 안내 줄은 운영자에게만 띄운다(이용자에게는 창·줄 없음,
  // 새 판은 다음에 열 때 조용히 반영). 운영자 판정은 서버 허용 표(app_my_features)이고, 바뀐 것 세기는 서버 기록(app_release_notes_read, 운영자만)에서 한다.
  // 이 화면이 열릴 때 마지막 기록 버전명(known)을 한 번 기억하고(메모리만), 새 판이 뜨면 서버 기록에서 known 뒤로 생긴 것만 센다. 못 읽으면 지금 문구 그대로.
  // S70-52 APP-새판알림안뜸: 운영자인지 한 번만 묻고 그 답을 탭이 살아 있는 내내 썼다. 열 때 그 한 번이 실패하면(잠깐 끊김·서버 오류·시간 초과 —
  // my-features.js는 실패를 기억하지 않고 다음 물음에 다시 묻는다) 그 탭·폰 앱은 며칠을 켜 두어도 새 판 안내가 뜨지 않았다.
  // 그래서 '운영자다'를 아직 모르면 새 판을 볼 때마다 서버에 다시 묻는다(새 판이 보일 때만, 한 번에 하나). 판정은 여전히 서버 허용 표다.
  let operator=false,waiting=null,asking=null;
  const readNotes=()=>readReleaseNotes({fresh:true});
  let known=null,described=null;
  const readKnown=()=>void readNotes().then(list=>{if(list&&known===null&&waiting===null)known=list.current});
  function askOperator(){
    if(operator||asking)return;
    asking=canReadReleaseNotes().then(yes=>{
      asking=null;if(!yes||stopped)return;
      operator=true;
      if(waiting)show(waiting);else if(started)readKnown();
    });
  }
  let started=false;
  setTimeout(()=>{started=true;if(operator)readKnown()},3000);
  async function describe(deployed){
    if(described===deployed)return;described=deployed;
    const list=await readNotes(),text=noticeText(newSince(list,known));
    const status=box?.querySelector('[role="status"]');
    if(status&&latest===deployed&&status.textContent!==text)status.textContent=text;
  }
  const dismissed=new Set(),drafts=new Map();
  let flight=null,lastCheck=-Infinity,latest=current,box=null,stopped=false;
  const visible=()=>document.visibilityState==='visible';
  const fields='input:not([type="hidden"]),textarea,select,[contenteditable="true"],[role="radiogroup"]';
  const value=el=>el.matches('[role="radiogroup"]')?String([...el.querySelectorAll('[role="radio"]')].findIndex(b=>b.getAttribute('aria-checked')==='true')):el.type==='checkbox'||el.type==='radio'?String(el.checked):el.isContentEditable?el.innerHTML:el.value;
  const editable=el=>el?.matches?.(fields)&&el.closest('.modal,[role="dialog"]');
  function opened(event){
    const modal=event.detail?.modal;
    if(!modal)return;
    closed(event);
  }
  function closed(event){
    const modal=event.detail?.modal;
    for(const el of drafts.keys())if(modal?.contains(el))drafts.delete(el);
  }
  function remember(event){
    // Explicitly closed/cancelled editors discard their baseline; folded details keep it.
    for(const el of drafts.keys())if(!el.isConnected||el.closest('.hidden'))drafts.delete(el);
    const el=event.target.closest?.('[role="radiogroup"]')||event.target;
    if(!editable(el))return;
    const before=['focusin','pointerdown','keydown','click'].includes(event.type);
    let state=drafts.get(el);
    if(!state)state={initial:before?value(el):el.type==='checkbox'||el.type==='radio'?String(el.defaultChecked):el.defaultValue??value(el),touched:false};
    const group=el.matches('[role="radiogroup"]');
    if(!state.touched&&['focusin','pointerdown','keydown'].includes(event.type))state.initial=value(el);
    if(['input','change'].includes(event.type)||(group&&(event.type==='click'||(event.type==='keydown'&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)))))state.touched=true;
    drafts.set(el,state);
  }
  function allowReload(){
    const changed=[];
    for(const [el,state] of drafts){
      if(!el.isConnected){drafts.delete(el);continue}
      const modal=el.closest('.modal,[role="dialog"]');
      if(state.touched&&modal&&!el.closest('.hidden')&&modal.getAttribute('aria-hidden')!=='true'&&value(el)!==state.initial)changed.push(el);
    }
    // Project detail owns its existing confirmDiscard flow; cancellation prevents reload.
    const projectDraft=changed.some(el=>el.closest('#ps3Body'));
    const detail={projectDraft,otherDraft:changed.some(el=>!el.closest('#ps3Body'))};
    if(!window.dispatchEvent(new CustomEvent('kptu:before-reload',{cancelable:true,detail})))return false;
    return detail.otherDraft?'ask':true;
  }
  // S48-28: 쓰던 내용이 있으면 공용 작은 확인창으로 묻는다(브라우저 기본 확인창 대신, 화면을 멈추지 않음). 예 = true.
  const askDiscard=anchor=>askConfirm(anchor,{text:'저장하지 않은 내용이 있습니다. 저장하지 않고 최신화할까요?',ok:'저장 안 함',danger:true});
  async function reloadAllowed(anchor){const ok=allowReload();return ok==='ask'?askDiscard(anchor):ok}
  // APP-당겨서새로고침: 폰 앱 '당겨서 새로고침'도 같은 확인을 쓴다(phone-pull-refresh.js). 확인 길을 하나로 둔다.
  // 그쪽은 답을 바로(동기로) 받아야 하므로, 물어야 하면 일단 막고(false) 작은 확인창에서 [버리기]를 고르면 같은 표시로 새로고침한다.
  window.KPTUReloadGuard={allow(){
    const ok=allowReload();if(ok!=='ask')return ok;
    void askDiscard(null).then(yes=>{if(!yes)return;try{window.KPTUAppShell?.postMessage?.('reopen:mark:pull')}catch{}location.reload()});
    return false;
  }};
  // UI-앱안알림 1단계: 자리·높이(body 여백, 폰 머리줄·PC 메뉴 보정)는 공용 알림 줄(notice-bar.js)이 맡는다. 업데이트 안내는 그 손님 하나(4절 순서 4).
  function remove(){
    if(box)removeNotice('version');
    box=null;
  }
  function show(deployed){
    if(deployed===current||dismissed.has(deployed)||stopped)return;
    if(!operator){waiting=deployed;askOperator();return}
    latest=deployed;
    if(box){void describe(deployed);return}
    // HOME-모바일정리①: 화면 맨 위 얇은 한 줄(아이콘 + 안내 + 글자 버튼 [새로고침] + ✕). PC·폰 같은 모양.
    box=document.createElement('aside');box.id='versionNotice';box.className='kptu-notice-line';box.setAttribute('aria-label','새 버전 안내');
    box.innerHTML='<svg class="kptu-notice-line-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M16 10a6 6 0 1 1-1.8-4.3M16 3.5v3.2h-3.2"/></svg><span role="status">새 버전이 있어요</span><button type="button" class="kptu-notice-line-action" data-version-reload>최신화</button><button type="button" class="kptu-notice-line-close" data-version-dismiss aria-label="닫기">✕</button>';
    box.querySelector('[data-version-dismiss]').onclick=()=>{dismissed.add(latest);remove()};
    box.querySelector('[data-version-reload]').onclick=async e=>{if(!await reloadAllowed(e.currentTarget))return;try{window.KPTUAppShell?.postMessage?.('reopen:mark:version')}catch{}location.reload()};
    putNotice('version',{priority:40,element:box});
    void describe(deployed);
  }
  function deployedVersion(html){
    const doc=new DOMParser().parseFromString(html,'text/html'),matches=[];
    for(const tag of doc.querySelectorAll('script[src]')){
      try{
        const url=new URL(tag.getAttribute('src'),entry);
        if(url.origin===script.origin&&url.pathname===script.pathname)matches.push(version(url.searchParams.get('v')));
      }catch{}
    }
    return matches.length===1?matches[0]:null;
  }
  // 지금 배포된 판(index.html이 부르는 app.js의 ?v=). 못 읽으면 null(던지지 않음).
  appVersionNow.check=async()=>{try{const res=await fetch(entry.href,{cache:'no-store'});return res.ok?deployedVersion(await res.text()):null}catch{return null}};
  appVersionNow.reload=async anchor=>{if(!await reloadAllowed(anchor))return false;try{window.KPTUAppShell?.postMessage?.('reopen:mark:version')}catch{}location.reload();return true};
  function check(){
    if(stopped||!visible()||navigator.onLine===false)return;
    if(flight)return flight;
    if(Date.now()-lastCheck<60*1000)return; // APP-낭비줄이기 ①: 창에 돌아올 때마다 index.html(36KB)을 다시 받지 않게 최소 간격 60초(10분 타이머는 그대로)
    lastCheck=Date.now();
    flight=(async()=>{
      try{
        const res=await fetch(entry.href,{cache:'no-store'});
        if(!res.ok)return;
        const deployed=deployedVersion(await res.text());
        if(deployed!==null)show(deployed);
      }catch{} // Offline and malformed deployments must not interrupt the app.
    })().finally(()=>{flight=null});
    return flight;
  }
  askOperator();
  const timer=setInterval(check,10*60*1000);
  document.addEventListener('visibilitychange',check);
  window.addEventListener('focus',check);
  const events=['focusin','pointerdown','keydown','click','input','change'];
  for(const type of events)document.addEventListener(type,remember,true);
  window.addEventListener('kptu:dialog-opened',opened);window.addEventListener('kptu:dialog-closed',closed);
  for(const modal of document.querySelectorAll('.modal:not(.hidden)'))opened({detail:{modal}});
  const owner=window.KPTURuntime.session.read()?.user?.id;
  function sessionChanged(event){
    if(owner&&event.detail?.session?.user?.id===owner)return;
    stopped=true;clearInterval(timer);remove();drafts.clear();
    document.removeEventListener('visibilitychange',check);window.removeEventListener('focus',check);
    for(const type of events)document.removeEventListener(type,remember,true);
    window.removeEventListener('kptu:dialog-opened',opened);window.removeEventListener('kptu:dialog-closed',closed);
    window.removeEventListener('kptu:session-changed',sessionChanged);
  }
  window.addEventListener('kptu:session-changed',sessionChanged);
}
