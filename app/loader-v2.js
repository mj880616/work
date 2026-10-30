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
    import('./press-feedback.js'),
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
    import('./date-field.js'),
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

  const showFeatureError=(err,retry=null)=>{
    console.error('view feature load failed',err);
    // UI-기다림표시통일: 실패는 공용 부품(wait-state.js) — 빨간 작은 글자 '불러오지 못했습니다' + 작은 [다시](민트 상자 쓰지 않음).
    let box=document.querySelector('#deferredFeatureError');
    if(!box){box=document.createElement('div');box.id='deferredFeatureError';box.setAttribute('role','alert');document.querySelector('#appView .app-nav')?.after(box)}
    box.className='wait-fail-host';
    box.replaceChildren(wait.failEl({onRetry:retry?()=>{box.remove();retry()}:()=>location.reload()}));
    box.firstElementChild?.removeAttribute('role');
  };

  const wait=await import('./wait-state.js');
  await import('./view-loader.js');
  const viewLoader=window.KPTUViewLoader;
  const params=new URLSearchParams(location.search);
  const rawRequested=params.get('view')||(params.get('project')?'projects':'home');
  // MTG-프로젝트합치기 ①: 사업영역 관리는 화면이 아니라 사업 보고 위의 창이다. 옛 주소(?view=projects, ?project=)는 사업 보고를 열고 창을 띄운다.
  await import('./area-window.js');
  const areasAtStart=viewLoader.normalize(rawRequested)==='projects'||(viewLoader.normalize(rawRequested)==='meetings'&&params.get('areas')==='1');
  const requested=areasAtStart?'meetings':viewLoader.normalize(rawRequested);
  startup?.mark('routeResolved',{route:'authenticated',view:requested});

  const staticShellViews=new Set(['home','basket','calendar','tasks','journal','diary','library','meetings','pages','team']);
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
    loadThen(view,()=>{
      if(control.dataset?.view||control.dataset?.goto||control.dataset?.hdvGoto)window.KPTURouter?.go?.(view,{source:'delegated'});
      else control.click();
    },()=>control.click());
  },true);
  // UI-기다림표시통일: 메뉴 화면 프로그램을 처음 받는 동안 글자 없이 위쪽 가는 줄 하나(0.4초 안에 끝나면 안 보임). 민트 상자 쓰지 않음.
  // 실패하면 공용 실패 줄(showFeatureError)과 [다시]. 위 위임 클릭과 openView(⋯ 메뉴처럼 #appView 밖에서 화면을 여는 곳)가 같은 길을 쓴다.
  function loadThen(view,then,retry){
    let status=document.querySelector('#deferredFeatureStatus');
    if(!status){const t=document.createElement('template');t.innerHTML=wait.barHtml();status=t.content.firstElementChild;status.id='deferredFeatureStatus';document.querySelector('#appView .app-nav')?.after(status)}
    document.querySelector('#deferredFeatureError')?.remove();
    return viewLoader.load(view).then(()=>{status.remove();then()}).catch(err=>{status.remove();showFeatureError(err,retry)});
  }
  // BIZ-버튼줄정리: 공용 메뉴 판(anchored-menu, body에 붙음)의 항목이 화면을 열 때 쓰는 길 — 위 [data-view] 위임 클릭과 같은 기다림·실패 표시.
  const openView=name=>{const view=viewLoader.normalize(name);const go=()=>window.KPTURouter?.go?.(view,{source:'delegated'});if(viewLoader.isLoaded(view)){go();return Promise.resolve()}return loadThen(view,go,()=>openView(view))};

  // withView: 화면이 아닌 묶음(사업영역 관리 창의 'projects')을 같은 기다림 줄·실패 줄 [다시]로 불러온 뒤 then을 부른다.
  const withView=(name,then)=>viewLoader.isLoaded(name)?Promise.resolve().then(then):loadThen(name,then,()=>withView(name,then));
  window.KPTUDeferredFeatures={load:()=>viewLoader.loadAll(),loadView:viewLoader.load,openView,withView};
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
  // MTG-노트북녹음: 노트북 [녹음]·녹음 띠의 주인(앱 껍데기 한 곳). 첫 화면 뒤 한 번 붙여 메뉴를 옮겨도 녹음이 이어진다. 기다리지 않는다.
  import('./meeting-recorder.js').catch(err=>console.warn('meeting recorder load failed',err?.name||'Error'));
  const {startVersionNotice}=await import('./version-notice.js');
  startVersionNotice(window.__KPTU_APP_SCRIPT_URL__);
  // 사업영역 관리 창으로 시작하면(옛 주소·새로고침) 창과 그 목록(·주소의 사업영역)까지 다 그린 뒤에 첫 화면을 드러낸다
  // (드러낸 뒤에 창이 늦게 덮거나 목록이 다시 그려져 줄이 밀리지 않게 — 시작 순서: 필요한 자료 → 한 번 드러내기).
  if(areasAtStart&&result?.ok){
    // 폰 뒤로가기 기록(창 → 상세)을 창이 뜨기 전에 붙인다(상세가 따로 주소 기록을 쌓지 않게).
    await import('./mobile-modal-history.js').catch(()=>{});
    try{await viewLoader.load('projects');await window.KPTUAreaWindow?.open({id:params.get('project')||null})}
    catch(err){console.warn('area window open failed',err?.name||'Error')}
  }
  window.__KPTU_MARK_APP_UI_READY__?.({usable:result?.ok===true});
  import('./mobile-modal-history.js').catch(()=>{});
  // APP-폰앱새로 ②: 폰 앱(KPTUAndroid)의 [공유]로 받은 것을 정리함 확인 줄로 넣는다. 앱이 아니면 아무것도 하지 않는다. 첫 화면이 뜬 뒤 붙인다(시작 화면 이동과 겹치지 않게). 기다리지 않는다.
  import('./basket-share.js').catch(err=>console.warn('share intake load failed',err?.name||'Error'));
  // APP-폰앱새로 ③: 폰 앱이면 위젯 자동 로그인 다리(phone-widget-auth.js)를 붙인다. 로그인된 화면에서만 여기까지 온다. 앱이 아니면 아무것도 하지 않는다.
  if(/KPTUAndroid/i.test(navigator.userAgent||''))import('./phone-widget-auth.js').catch(err=>console.warn('widget auth load failed',err?.name||'Error'));
  // MTG-폰녹음: 폰 앱이면 [녹음](앱이 녹음, 화면이 꺼져도 계속)을 붙인다. 앱이 rec:hello에 답해야(0.3.3+) 버튼이 보인다. 기다리지 않는다.
  if(/KPTUAndroid/i.test(navigator.userAgent||''))import('./phone-recorder.js').catch(err=>console.warn('phone recorder load failed',err?.name||'Error'));
  const defer=window.requestIdleCallback?((fn,opts)=>window.requestIdleCallback(fn,opts)):((fn)=>setTimeout(fn,200));
  // OD-미리받기: 첫 화면이 다 뜬 뒤 한가할 때 원드라이브 연결 확인·이번 달 목록·작은 그림 몇 장을 뒤에서 받아 둔다(기다리지 않음, 화면 없음).
  // UI-기다림표시통일 ⑤: 첫 화면이 다 뜬 뒤 쉬는 틈에 메뉴 화면 프로그램을 미리 받아 둔다(받기만, 실행 안 함 — 처음 눌러도 '불러오는 중'이 거의 안 보이게).
  // 기기 저장 없음: 브라우저 기본 캐시만 쓴다.
  defer(()=>viewLoader.warm?.(),{timeout:8000});
  defer(()=>import('./od-warm.js').catch(err=>console.warn('onedrive warm load failed',err?.name||'Error')),{timeout:5000});
})().catch(err=>{
  console.error(err);
  document.body?.classList.remove('kptu-session-pending');
  window.__KPTU_MARK_APP_UI_READY__?.();
  document.body.insertAdjacentHTML('beforeend','<pre style="padding:16px;color:var(--kptu-danger)">앱 초기화 오류: '+String(err.message||err)+'</pre>');
});
