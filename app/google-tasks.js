(()=>{
  'use strict';
  if(window.__KPTU_GOOGLE_TASKS__)return;
  window.__KPTU_GOOGLE_TASKS__=true;

  const rt=window.KPTURuntime;
  let loading=false;
  let lastTasks=[];
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const endpoint=action=>`/functions/v1/google-tasks?action=${encodeURIComponent(action)}`;
  const due=v=>{
    if(!v)return '기한 미정';
    const raw=String(v).slice(0,10),d=new Date(raw+'T00:00:00');
    return Number.isNaN(d.getTime())?'기한 미정':d.toLocaleDateString('ko-KR',{month:'numeric',day:'numeric',weekday:'short'});
  };

  function style(){
    if(document.querySelector('#gtTasksStyle'))return;
    const s=document.createElement('style');s.id='gtTasksStyle';s.textContent=`
      #gtTaskSection{border-color:#dbe7d8}.gt-head{display:flex;align-items:center;justify-content:space-between;gap:8px}.gt-head-left{display:flex;align-items:center;gap:7px}.gt-source{display:inline-flex;align-items:center;justify-content:center;min-width:19px;height:19px;border-radius:6px;background:#eef6eb;color:#4d7b43;font-size:10px;font-weight:900}.gt-note{font-size:10px;color:var(--muted);font-weight:650}.gt-list{display:grid;margin-top:6px}.gt-row{display:grid;grid-template-columns:auto minmax(0,1fr);gap:9px;align-items:center;border-top:1px solid #edf0f3;padding:8px 3px;min-height:48px}.gt-mark{width:17px;height:17px;border:2px solid #78a36d;border-radius:50%;background:#fff}.gt-content{min-width:0}.gt-content b{display:block;font-size:13px;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.gt-meta{display:flex;gap:7px;align-items:center;margin-top:3px;font-size:10px;color:var(--muted);min-width:0}.gt-meta span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.gt-connect{margin-top:9px}.gt-status{padding:11px 3px;color:var(--muted);font-size:11px}.gt-reconnect{border-color:#9cb796;color:#466b40}.gt-refresh{padding:4px 7px!important;font-size:10px!important}@media(max-width:700px){.gt-row{padding:7px 2px}.gt-content b{font-size:12.5px}.gt-note{display:none}}
    `;document.head.appendChild(s);
  }

  function section(){
    const root=document.querySelector('#tlTaskSections');if(!root)return null;
    let sec=document.querySelector('#gtTaskSection');
    if(!sec){
      sec=document.createElement('section');sec.id='gtTaskSection';sec.className='tl-task-section';
      sec.innerHTML='<div class="gt-head"><div class="gt-head-left"><h3 style="margin:0;font-size:17px">Google 할 일</h3><span class="gt-source">G</span><span class="gt-note">Workspace 할 일과 별도 · 읽기 전용</span></div><button class="mini gt-refresh" type="button" data-gt-refresh>새로고침</button></div><div id="gtTaskBody" class="gt-status">불러오는 중…</div>';
      root.appendChild(sec);
      sec.querySelector('[data-gt-refresh]').onclick=()=>load(true);
    }
    return sec;
  }

  function renderTasks(tasks){
    const sec=section(),body=sec?.querySelector('#gtTaskBody');if(!body)return;
    if(!tasks.length){body.className='gt-status';body.innerHTML='미완료 Google 할 일이 없습니다.';return}
    body.className='gt-list';
    body.innerHTML=tasks.map(t=>`<div class="gt-row" data-google-task="${esc(t.id)}"><span class="gt-mark" aria-hidden="true"></span><div class="gt-content"><b>${esc(t.title||'제목 없음')}</b><div class="gt-meta"><span>${esc(t.taskListTitle||'Google Tasks')}</span><span>${esc(due(t.due))}</span>${t.notes?`<span>${esc(t.notes)}</span>`:''}</div></div></div>`).join('');
  }

  function renderConnect(message='Google 할 일을 함께 보려면 Google 계정 권한을 연결해 주세요.'){
    const sec=section(),body=sec?.querySelector('#gtTaskBody');if(!body)return;
    body.className='gt-status';
    body.innerHTML=`<div>${esc(message)}</div><button class="secondary gt-connect gt-reconnect" type="button" data-gt-connect>Google 할 일 연결</button>`;
    body.querySelector('[data-gt-connect]').onclick=connect;
  }

  function renderError(message){
    const sec=section(),body=sec?.querySelector('#gtTaskBody');if(!body)return;
    body.className='gt-status';
    body.innerHTML=`<span style="color:#a33b45">${esc(message)}</span>`;
  }

  async function connect(){
    try{
      if(!rt?.session||!(await rt.session.ensure()))return;
      const platform=window.__KPTU_NATIVE_BRIDGE__?'android':'web';
      const d=await rt.api(endpoint('start')+'&platform='+platform);
      if(d?.url)location.href=d.url;
    }catch(e){renderError(e.message||String(e))}
  }

  async function load(force=false){
    if(loading)return;
    const sec=section();if(!sec)return;
    if(!force&&lastTasks.length){renderTasks(lastTasks);return}
    if(!rt?.session||!(await rt.session.ensure()))return;
    loading=true;
    const body=sec.querySelector('#gtTaskBody');if(body){body.className='gt-status';body.textContent='Google 할 일을 불러오는 중…'}
    try{
      const d=await rt.api(endpoint('tasks'));
      if(d?.needs_reconnect){lastTasks=[];renderConnect(d.warning||'Google 할 일을 보려면 Google 계정을 한 번 다시 연결해 주세요.');return}
      if(d?.error)throw new Error(d.error);
      lastTasks=d?.tasks||[];
      renderTasks(lastTasks);
    }catch(e){
      const msg=String(e?.message||e);
      if(/연결되지|재인증|TASKS_SCOPE_REQUIRED/i.test(msg))renderConnect();
      else renderError(msg);
    }finally{loading=false}
  }

  async function boot(){
    style();
    section();
    if(window.KPTURouter?.on)window.KPTURouter.on('tasks',()=>load(true));
    window.addEventListener('focus',()=>{if(!document.querySelector('#tasksView')?.classList.contains('hidden'))load(true)});
    window.addEventListener('kptu:session-changed',()=>{lastTasks=[];setTimeout(()=>load(true),300)});
    if(window.KPTURouter?.current==='tasks'||window.KPTURouter?.detect?.()==='tasks')load(true);
    else setTimeout(()=>load(false),500);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
