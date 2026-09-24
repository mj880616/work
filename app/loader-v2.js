(async()=>{
  const startup=window.__KPTU_STARTUP__;
  startup?.mark('loaderStart');
  const runtimeReady=import('./runtime-client.js?v=4');
  await Promise.all([
    import('./native-auth-bridge.js?v=4'),
    import('./calendar-return-bridge.js?v=3')
  ]);
  if(window.__KPTU_NATIVE_BRIDGE__||window.__KPTU_CALENDAR_BRIDGE__)return;
  await runtimeReady;
  await Promise.all([
    import('./auth-handoff-client.js?v=1'),
    import('./auth-bootstrap.js?v=1'),
    import('./app-router.js?v=7'),
    import('./accessibility-dialog.js?v=1'),
    import('./native-back-guard.js?v=1'),
    import('./session-resilience.js?v=6'),
    import('./auth-service.js?v=1'),
    import('./capabilities.js?v=2'),
    import('./pwa.js?v=5')
  ]);

  startup?.mark('sessionCheckStart');
  const authenticated=await window.KPTURuntime.session.ensure();
  startup?.mark('sessionCheckComplete',{authenticated});
  if(!authenticated){
    startup?.mark('routeResolved',{route:'public'});
    if(new URLSearchParams(location.search).has('invite')){
      location.replace(window.KPTUAuth.loginUrl(location.href));
      return;
    }
    await import('./public-workspace.js?v=11');
    await import('./mobile-swipe-navigation.js?v=4');
    startup?.mark('publicModulesComplete');
    return;
  }

  const bootSession=window.KPTURuntime.session.read();
  const bootView=document.querySelector('#bootView');
  if(bootView){
    ['authView','bootstrapView','appView'].forEach(id=>document.querySelector('#'+id)?.classList.add('hidden'));
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
  let coreStylesPromise=null;
  const ensureCoreStyles=()=>coreStylesPromise||(coreStylesPromise=new Promise(resolve=>{
    if(document.querySelector('link[data-kptu-core-styles]')){resolve();return}
    const link=document.createElement('link');
    link.rel='stylesheet';link.href='./core.css?v=1';link.dataset.kptuCoreStyles='1';
    link.onload=()=>resolve();link.onerror=()=>resolve();
    document.head.appendChild(link);
  }));
  await Promise.all([
    ensureCoreStyles(),
    import('./topbar-actions.js?v=6'),
    import('./team.js?v=41')
  ]);
  const teamState=await window.__KPTU_TEAM_READY__;
  delete window.__KPTU_AUTHENTICATED_BOOT_SESSION__;
  delete window.__KPTU_BOOT_MEMBERSHIP_PROMISE__;
  if(teamState==='bootstrap'){await import('./access-approval.js?v=5');return}
  if(teamState!=='workspace')return;

  const context=window.KPTURuntime.context?.read?.()||window.__KPTU_BOOT_CONTEXT__;
  if(context)window.KPTUCapabilities.setContext({user:context.user,membership:context.membership});

  const mobileNavigationReady=import('./mobile-swipe-navigation.js?v=4').catch(err=>{console.error('mobile navigation load failed',err);return null});
  const showFeatureError=err=>{
    console.error('view feature load failed',err);
    let box=document.querySelector('#deferredFeatureError');
    if(!box){box=document.createElement('div');box.id='deferredFeatureError';box.className='notice';box.setAttribute('role','alert');document.querySelector('#appView .app-nav')?.after(box)}
    box.textContent='이 기능을 불러오지 못했습니다. 네트워크를 확인한 뒤 새로고침해 주세요.';
  };

  await import('./view-loader.js?v=4');
  const viewLoader=window.KPTUViewLoader;
  const params=new URLSearchParams(location.search);
  const rawRequested=params.get('view')||(params.get('project')?'projects':'home');
  const requested=viewLoader.normalize(rawRequested);
  startup?.mark('routeResolved',{route:'authenticated',view:requested});

  const staticShellViews=new Set(['home','calendar','tasks','projects','library','meetings','media','pages','team']);
  const app=document.querySelector('#appView');
  if(staticShellViews.has(requested)){
    app?.classList.add('kptu-shell-ready');
    window.KPTURouter?.go?.(requested,{scroll:false,source:'startup',updateUrl:false});
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
  window.__KPTU_MARK_APP_UI_READY__?.({usable:result?.ok===true});
  import('./mobile-modal-history.js?v=1').catch(()=>{});
  import('./push-notifications-ui.js?v=4').catch(err=>console.warn('push notification background init failed',err));
  await mobileNavigationReady;
})().catch(err=>{
  console.error(err);
  window.__KPTU_MARK_APP_UI_READY__?.();
  document.body.insertAdjacentHTML('beforeend','<pre style="padding:16px;color:#a33b45">앱 초기화 오류: '+String(err.message||err)+'</pre>');
});
