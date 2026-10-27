(async()=>{
  const startup=window.__KPTU_STARTUP__;
  startup?.mark('loaderStart');
  const runtimeReady=import('./runtime-client.js');
  await Promise.all([
    import('./native-auth-bridge.js'),
    import('./calendar-return-bridge.js')
  ]);
  if(window.__KPTU_NATIVE_BRIDGE__||window.__KPTU_CALENDAR_BRIDGE__)return;
  await runtimeReady;
  // Scrub/finish a handoff before OAuth bootstrap can inspect mixed URL input.
  await import('./auth-handoff-client.js');
  await Promise.all([
    import('./auth-bootstrap.js'),
    import('./auth-service.js')
  ]);

  const lockPrivateUi=()=>{
    document.body?.classList.add('kptu-session-pending');
    document.body?.classList.remove('kptu-workspace-shell');
    for(const id of ['appView','accessDeniedView','bootView']){
      const el=document.getElementById(id);
      if(!el)continue;
      el.classList.add('hidden');
      el.setAttribute('aria-hidden','true');
      el.inert=true;
      if(id!=='bootView'){
        el.replaceChildren();
        el.remove();
      }
    }
    document.querySelectorAll('.modal,[role="dialog"]').forEach(el=>{
      el.classList.add('hidden');
      el.setAttribute('aria-hidden','true');
      el.inert=true;
    });
    window.KPTURuntime.context?.clear?.();
    window.__KPTU_RESET_PRIVATE_STATE__?.();
    window.__KPTU_BOOT_CONTEXT__=null;
    delete window.__KPTU_BOOT_MEMBERSHIP_PROMISE__;
    delete window.__KPTU_AUTHENTICATED_BOOT_SESSION__;
  };
  const loginUrl=()=>window.KPTUAuth.loginUrl(location.href);
  const redirectToLogin=()=>{
    lockPrivateUi();
    location.replace(loginUrl());
  };
  const sessionOwner=value=>{
    if(value?.user?.id)return value.user.id;
    try{
      const part=String(value?.access_token||'').split('.')[1];
      if(!part)return '';
      const normalized=part.replace(/-/g,'+').replace(/_/g,'/');
      return JSON.parse(atob(normalized+'='.repeat((4-normalized.length%4)%4)))?.sub||'';
    }catch{return ''}
  };
  window.KPTUAuthGate={lock:lockPrivateUi,loginUrl,redirect:redirectToLogin};

  startup?.mark('sessionCheckStart');
  const authenticated=await window.KPTURuntime.session.ensure().catch(()=>false);
  startup?.mark('sessionCheckComplete',{authenticated});
  if(!authenticated){
    startup?.mark('routeResolved',{route:'login'});
    redirectToLogin();
    return;
  }

  const bootSession=window.KPTURuntime.session.read();
  const bootOwner=sessionOwner(bootSession);
  const handleIdentityChange=next=>{
    const nextOwner=sessionOwner(next);
    if(next&&nextOwner&&nextOwner===bootOwner)return;
    lockPrivateUi();
    if(next&&nextOwner)location.reload();
    else location.replace(loginUrl());
  };
  window.addEventListener('kptu:session-changed',event=>handleIdentityChange(event.detail?.session||null));
  window.addEventListener('storage',event=>{
    if(event.key!==window.KPTURuntime.config.sessionKey)return;
    handleIdentityChange(window.KPTURuntime.session.read());
  });
  window.addEventListener('pageshow',async event=>{
    if(!event.persisted)return;
    lockPrivateUi();
    const valid=await window.KPTURuntime.session.ensure().catch(()=>false);
    if(!valid){location.replace(loginUrl());return}
    location.reload();
  });
  await Promise.all([
    import('./action-labels.js'),
    import('./app-router.js'),
    import('./accessibility-dialog.js'),
    import('./enter-save.js'),
    import('./native-back-guard.js'),
    import('./session-resilience.js'),
    import('./capabilities.js'),
    import('./pwa.js')
  ]);
  document.body?.classList.remove('kptu-session-pending');
  const bootView=document.querySelector('#bootView');
  if(bootView){
    ['accessDeniedView','appView'].forEach(id=>document.querySelector('#'+id)?.classList.add('hidden'));
    bootView.inert=false;
    bootView.classList.remove('hidden');
    bootView.setAttribute('aria-hidden','false');
    startup?.mark('authenticatedShellVisible');
  }
  window.__KPTU_AUTHENTICATED_BOOT_SESSION__=bootSession;
  const bootUserId=bootSession?.user?.id||'';
  if(bootUserId){
    startup?.mark('workspacePrefetchStart');
    startup?.mark('membershipCheckStart');
    const membershipPath='/rest/v1/app_workspace_members?user_id=eq.'+encodeURIComponent(bootUserId)+'&select=workspace_id,role,workspace:app_workspaces(id,slug,name)&limit=1';
    window.__KPTU_BOOT_MEMBERSHIP_PROMISE__=window.KPTURuntime.api(membershipPath)
      .then(rows=>{startup?.mark('workspacePrefetchComplete');startup?.mark('membershipCheckComplete');return {ok:true,rows}})
      .catch(error=>{startup?.mark('workspacePrefetchFailed');startup?.mark('membershipCheckFailed');return {ok:false,error}});
  }
  await Promise.all([
    import('./topbar-actions.js'),
    import('./context-menu.js'),
    import('./select-menu.js'),
    import('./team.js')
  ]);
  const teamState=await window.__KPTU_TEAM_READY__;
  delete window.__KPTU_AUTHENTICATED_BOOT_SESSION__;
  delete window.__KPTU_BOOT_MEMBERSHIP_PROMISE__;
  if(teamState!=='workspace')return;

  // SET-보기선택서버저장: 화면 선택(테마·메뉴 접힘 등)은 서버 프로필에서 한 번 읽는다. 업무공간 소유자로 확인된 뒤에만 읽고(비구성원은 데이터 요청 없음),
  // 앱 화면을 공개(kptu-shell-ready)하기 전에 기다려 테마를 한 번 적용한다. 실패·지연이면 기본값(올리브)으로 연다. 늦게 온 값으로 다시 덮지 않는다.
  const viewPrefs=await import('./view-prefs.js').then(async m=>{await m.viewPrefs.load();return m.viewPrefs}).catch(()=>null);
  const savedTheme=viewPrefs?.get('theme');
  if(savedTheme){document.documentElement.setAttribute('data-theme',savedTheme);window.dispatchEvent(new CustomEvent('kptu:theme-applied'))}

  const context=window.KPTURuntime.context?.read?.()||window.__KPTU_BOOT_CONTEXT__;
  if(context)window.KPTUCapabilities.setContext({user:context.user,membership:context.membership});
  // ORG-사본자동갱신: 저장 뒤 Drive 읽기용 사본 자동 갱신(화면 표시 없음).
  await import('./drive-summary.js').catch(err=>console.warn('drive summary refresh load failed',err?.name||'Error'));
  // 원장 Drive 사본 자동 갱신(원장이 바뀌면 10분 묶어 한 번, 열 때 하루 넘었으면 한 번, LEDGER-자동기록). 기다리지 않는다.
  import('./ledger-export.js').catch(err=>console.warn('ledger export load failed',err?.name||'Error'));
  // LEDGER-자동기록 3단계: 저장 뒤 원장 자동 기록 호출(몇 분 묶어 한 번, 화면 표시 없음). 기다리지 않는다.
  import('./ledger-auto.js').catch(err=>console.warn('ledger auto load failed',err?.name||'Error'));
  // MTG-기록겹침거르기 3단계: 프로젝트 기록·사업 보고 저장 직후 겹침 알림(저장 뒤 확인, 실패하면 아무것도 안 보임). 기다리지 않는다.
  import('./overlap-check.js').catch(err=>console.warn('overlap check load failed',err?.name||'Error'));

  const showFeatureError=err=>{
    console.error('view feature load failed',err);
    let box=document.querySelector('#deferredFeatureError');
    if(!box){box=document.createElement('div');box.id='deferredFeatureError';box.className='notice';box.setAttribute('role','alert');document.querySelector('#appView .app-nav')?.after(box)}
    box.textContent='이 기능을 불러오지 못했습니다. 네트워크를 확인한 뒤 새로고침해 주세요.';
  };

  await import('./view-loader.js');
  const viewLoader=window.KPTUViewLoader;
  const params=new URLSearchParams(location.search);
  const rawRequested=params.get('view')||(params.get('project')?'projects':'home');
  const requested=viewLoader.normalize(rawRequested);
  startup?.mark('routeResolved',{route:'authenticated',view:requested});

  const staticShellViews=new Set(['home','basket','calendar','tasks','journal','diary','projects','library','meetings','pages','team']);
  await viewLoader.prepare(requested);
  window.KPTURouter?.noteAlias?.(rawRequested);
  const app=document.querySelector('#appView');
  if(staticShellViews.has(requested)){
    app?.classList.add('kptu-shell-ready');
    window.KPTURouter?.go?.(requested,{scroll:false,source:'startup',updateUrl:false,allowUnloaded:true});
    startup?.mark('requestedShellVisible',{view:requested});
  }

  const controlView=control=>{
    const explicit=control?.dataset?.view||control?.dataset?.goto||control?.dataset?.hdvGoto;
    if(explicit)return viewLoader.normalize(explicit);
    if(control?.id==='quickTaskBtn'||control?.id==='newTaskBtn')return 'tasks';
    if(control?.id==='newEventBtn')return 'calendar';
    if(control?.id==='newDocumentBtn')return 'library';
    if(control?.id==='newMeetingBtn')return 'meetings';
    if(control?.id==='newProjectBtn')return 'projects';
    return null;
  };
  document.addEventListener('click',event=>{
    const control=event.target.closest?.('#appView [data-view],#appView [data-goto],#appView [data-hdv-goto],#appView [data-hdv-project],#quickTaskBtn,#newTaskBtn,#newEventBtn,#newDocumentBtn,#newMeetingBtn,#newProjectBtn');
    const view=controlView(control);
    if(!control||!view||viewLoader.isLoaded(view))return;
    event.preventDefault();event.stopImmediatePropagation();
    let status=document.querySelector('#deferredFeatureStatus');
    if(!status){status=document.createElement('div');status.id='deferredFeatureStatus';status.className='notice';status.setAttribute('role','status');document.querySelector('#appView .app-nav')?.after(status)}
    status.textContent='기능을 불러오는 중입니다…';
    viewLoader.load(view).then(()=>{
      status.remove();
      if(control.dataset?.view||control.dataset?.goto||control.dataset?.hdvGoto)window.KPTURouter?.go?.(view,{source:'delegated'});
      else control.click();
    }).catch(err=>{status.remove();showFeatureError(err)});
  },true);

  window.KPTUDeferredFeatures={load:()=>viewLoader.loadAll(),loadView:viewLoader.load};
  startup?.mark('requestedViewLoadStart',{view:requested});
  let result={ok:false,view:requested};
  try{
    result=await viewLoader.load(requested);
    if(!staticShellViews.has(requested)){
      app?.classList.add('kptu-shell-ready');
      window.KPTURouter?.go?.(requested,{scroll:false,source:'startup',updateUrl:false});
    }
    startup?.mark('requestedViewReady',{view:requested});
  }catch(err){
    showFeatureError(err);
    startup?.mark('requestedViewFailed',{view:requested});
  }
  // SEARCH-전체검색: 첫 화면을 그린 뒤 검색칸(PC 상단 줄)·메뉴 검색 입구를 붙인다. 기다리지 않는다.
  viewLoader.load('search').catch(err=>console.warn('search load failed',err?.name||'Error'));
  const {startVersionNotice}=await import('./version-notice.js');
  startVersionNotice(window.__KPTU_APP_SCRIPT_URL__);
  window.__KPTU_MARK_APP_UI_READY__?.({usable:result?.ok===true});
  import('./mobile-modal-history.js').catch(()=>{});
  const defer=window.requestIdleCallback||((fn)=>setTimeout(fn,200));
})().catch(err=>{
  console.error(err);
  document.body?.classList.remove('kptu-session-pending');
  window.__KPTU_MARK_APP_UI_READY__?.();
  document.body.insertAdjacentHTML('beforeend','<pre style="padding:16px;color:var(--kptu-danger)">앱 초기화 오류: '+String(err.message||err)+'</pre>');
});
