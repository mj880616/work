(()=>{
  const KEY='kptu_startup_diag_v1',MAX=20;
  const startedAt=performance.now(),requests=[];
  let finalized=false;
  function safeRead(){try{return JSON.parse(localStorage.getItem(KEY)||'[]')}catch{return[]}}
  function save(sample){
    try{
      const rows=safeRead();
      rows.unshift(sample);
      localStorage.setItem(KEY,JSON.stringify(rows.slice(0,MAX)));
    }catch{}
  }
  function endpointLabel(raw){
    try{
      const u=new URL(raw,location.origin),p=u.pathname;
      if(p==='/auth/v1/user')return 'auth-user';
      if(p.includes('/auth/v1/token'))return 'auth-refresh';
      if(p.includes('/app_workspace_members'))return 'workspace-member';
      if(p.includes('/app_spaces'))return 'projects';
      if(p.includes('/app_project_milestones'))return 'milestones';
      if(p.includes('/app_tasks'))return 'tasks';
      if(p.includes('/app_documents'))return 'documents';
      return p.split('/').filter(Boolean).slice(-1)[0]||'request';
    }catch{return 'request'}
  }
  const startup=window.__KPTU_STARTUP__={
    startedAt,
    marks:{htmlStart:0,appJs:startedAt},
    request(raw,duration,status=0){
      if(finalized)return;
      requests.push({name:endpointLabel(raw),ms:Math.round(Number(duration)||0),status:Number(status)||0});
    },
    mark(name,detail={}){
      this.marks[name]=performance.now();
      window.dispatchEvent(new CustomEvent('kptu:startup-mark',{detail:{name,at:this.marks[name],...detail}}));
    },
    finalize(outcome='ready'){
      if(finalized)return;
      finalized=true;
      const marks=Object.fromEntries(Object.entries(this.marks).map(([k,v])=>[k,Math.round(v)]));
      const sample={
        at:new Date().toISOString(),
        outcome,
        totalMs:Math.round(performance.now()),
        marks,
        requests:[...requests],
        connection:navigator.connection?.effectiveType||null
      };
      save(sample);
      this.latest=sample;
    }
  };
  window.KPTUStartupDiagnostics={
    latest:()=>startup.latest||safeRead()[0]||null,
    history:()=>safeRead(),
    clear:()=>{try{localStorage.removeItem(KEY)}catch{}},
    async copy(){
      const text=JSON.stringify({latest:this.latest(),history:this.history().slice(0,5)},null,2);
      await navigator.clipboard.writeText(text);
      return text;
    }
  };
  function maybeDebugButton(){
    if(new URLSearchParams(location.search).get('startup-debug')!=='1'||document.querySelector('#startupDiagCopy'))return;
    const b=document.createElement('button');
    b.id='startupDiagCopy';b.type='button';b.textContent='로딩 기록 복사';
    b.style.cssText='position:fixed;right:12px;bottom:12px;z-index:9999;padding:8px 10px;border:1px solid #cfd6dc;border-radius:8px;background:#fff;color:#263f5f;font:700 12px sans-serif;box-shadow:0 4px 16px rgba(20,33,48,.12)';
    b.onclick=async()=>{try{await window.KPTUStartupDiagnostics.copy();b.textContent='복사됨'}catch{b.textContent='복사 실패'}};
    document.body.appendChild(b);
  }
  window.__KPTU_MARK_APP_UI_READY__=({usable=false}={})=>{
    const app=document.querySelector('#appView');app?.classList.add('kptu-ui-ready');
    startup.mark(usable?'homeUsable':'uiReadyOnly');
    startup.finalize(usable?'home-usable':'ui-ready');
    window.dispatchEvent(new Event('kptu:app-ui-ready'));
    maybeDebugButton();
  };
  import('./loader-v2.js?v=169').catch(err=>{
    console.error(err);startup.finalize('error');window.__KPTU_MARK_APP_UI_READY__?.();
    document.body.insertAdjacentHTML('beforeend','<pre style="padding:16px;color:#a33b45">앱 초기화 오류: '+String(err.message||err)+'</pre>');
  });
})();
