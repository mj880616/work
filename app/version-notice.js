// Open tabs compare the deployed entry point with the app script they actually loaded.
export function startVersionNotice(scriptUrl){
  const script=new URL(scriptUrl),entry=new URL('./index.html',script);
  const version=raw=>/^\d+$/.test(raw||'')&&Number.isSafeInteger(Number(raw))?Number(raw):null;
  const current=version(script.searchParams.get('v'));
  if(current===null)return;
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
    return !detail.otherDraft||window.confirm('저장하지 않은 내용이 있습니다. 새로고침하면서 버릴까요?');
  }
  function layout(){
    document.body.style.setProperty('--kptu-version-notice-height',`${box?.getBoundingClientRect().height||0}px`);
  }
  const observer=new ResizeObserver(layout);
  function remove(){
    if(box)observer.unobserve(box);
    box?.remove();box=null;
    document.body.classList.remove('kptu-version-notice-open');
    document.body.style.removeProperty('--kptu-version-notice-height');
  }
  function show(deployed){
    if(deployed<=current||deployed<latest||dismissed.has(deployed)||stopped)return;
    latest=deployed;
    if(box)return;
    box=document.createElement('aside');box.id='versionNotice';box.setAttribute('aria-label','새 버전 안내');
    box.innerHTML='<span role="status">새 버전이 있습니다</span><button type="button" class="primary" data-version-reload>새로고침</button><button type="button" class="ghost" data-version-dismiss aria-label="닫기">×</button>';
    box.querySelector('[data-version-dismiss]').onclick=()=>{dismissed.add(latest);remove()};
    box.querySelector('[data-version-reload]').onclick=()=>{if(allowReload())location.reload()};
    document.body.appendChild(box);document.body.classList.add('kptu-version-notice-open');
    observer.observe(box);layout();
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
  function check(){
    if(stopped||!visible()||navigator.onLine===false)return;
    if(flight)return flight;
    if(Date.now()-lastCheck<1000)return;
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
    stopped=true;clearInterval(timer);remove();observer.disconnect();drafts.clear();
    document.removeEventListener('visibilitychange',check);window.removeEventListener('focus',check);
    for(const type of events)document.removeEventListener(type,remember,true);
    window.removeEventListener('kptu:dialog-opened',opened);window.removeEventListener('kptu:dialog-closed',closed);
    window.removeEventListener('kptu:session-changed',sessionChanged);
  }
  window.addEventListener('kptu:session-changed',sessionChanged);
}
