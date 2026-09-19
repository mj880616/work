(async()=>{
  const startup=window.__KPTU_STARTUP__;
  startup?.mark('loaderStart');
  await import('./native-auth-bridge.js?v=4');
  if(window.__KPTU_NATIVE_BRIDGE__)return;
  await import('./calendar-return-bridge.js?v=2');
  if(window.__KPTU_CALENDAR_BRIDGE__)return;

  await import('./runtime-client.js?v=3');
  await Promise.all([
    import('./auth-handoff-client.js?v=1'),
    import('./auth-bootstrap.js?v=1'),
    import('./app-router.js?v=6'),
    import('./accessibility-dialog.js?v=1'),
    import('./native-back-guard.js?v=1'),
    import('./session-resilience.js?v=6'),
    import('./auth-service.js?v=1'),
    import('./capabilities.js?v=2'),
    import('./pwa.js?v=3')
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
    await import('./public-workspace.js?v=8');
    await import('./mobile-swipe-navigation.js?v=4');
    startup?.mark('allInitialModulesComplete');
    return;
  }

  await import('./topbar-actions.js?v=4');
  window.__KPTU_AUTHENTICATED_BOOT_SESSION__=window.KPTURuntime.session.read();
  await import('./team.js?v=22');
  const teamState=await window.__KPTU_TEAM_READY__;
  delete window.__KPTU_AUTHENTICATED_BOOT_SESSION__;
  if(teamState==='bootstrap'){await import('./access-approval.js?v=4');return}
  if(teamState!=='workspace')return;

  const context=window.__KPTU_BOOT_CONTEXT__;
  if(context)window.KPTUCapabilities.setContext({user:context.user,membership:context.membership});
  startup?.mark('routeResolved',{route:'authenticated'});
  const mobileNavigationReady=import('./mobile-swipe-navigation.js?v=4');
  startup?.mark('homeRendererStart');
  await import('./home-dashboard-v2.js?v=7');
  startup?.mark('homeRendererReady');
  const [homeResult]=await Promise.all([window.__KPTU_HOME_READY__,mobileNavigationReady]);

  let featurePromise=null,featuresReady=false;
  const showFeatureError=err=>{
    console.error('deferred feature load failed',err);
    let box=document.querySelector('#deferredFeatureError');
    if(!box){box=document.createElement('div');box.id='deferredFeatureError';box.className='notice';box.setAttribute('role','alert');document.querySelector('#appView .app-nav')?.after(box)}
    box.textContent='이 기능을 불러오지 못했습니다. 네트워크를 확인한 뒤 새로고침해 주세요.';
  };
  const loadFeatures=()=>featurePromise||(featurePromise=(async()=>{
    await window.__KPTU_START_TEAM_DATA__();
    await import('./project-system-v3.js?v=4');
    await import('./team-member-overview.js?v=2'); await window.__KPTU_TEAM_MEMBER_OVERVIEW_READY__;
    await import('./team-member-management.js?v=2'); await window.__KPTU_TEAM_MEMBER_MANAGEMENT_READY__;
    await Promise.all([import('./forum-flow-polish.js?v=2'),import('./public-page-links.js?v=1'),import('./calendar-move.js?v=1'),import('./due-date-calendar.js?v=1')]);
    await import('./access-approval.js?v=4'); window.KPTUTeamMemberManagement?.limitApprovalRoles();
    await Promise.all([import('./member-default-role.js?v=3'),import('./myspace-return.js?v=3'),import('./page-design-core.js?v=3')]);
    await import('./task-workflow.js?v=6'); await window.__KPTU_TASK_WORKFLOW_READY__;
    await import('./task-row-view.js?v=1');
    await import('./task-layout.js?v=7'); await window.__KPTU_TASK_LAYOUT_READY__;
    await import('./profile-settings.js?v=6'); await window.__KPTU_PROFILE_SETTINGS_READY__;
    await Promise.all([import('./photo-room.js?v=4'),import('./password-reset.js?v=1'),import('./calendar-health.js?v=3'),import('./workplace-detail.js?v=3'),import('./library-upload.js?v=6')]);
    await window.__KPTU_PHOTO_ROOM_READY__;
    await import('./page-list-controller.js?v=2'); await window.__KPTU_PAGE_LIST_READY__;
    await import('./page-save-controller.js?v=3'); await window.__KPTU_PAGE_SAVE_READY__;
    const loadPageBuilder=async detail=>{window.removeEventListener('kptu:page-editor-opened',lazyPageBuilderOpen);await import('./page-builder.js?v=2');await window.__KPTU_PAGE_BUILDER_READY__;await window.KPTUPageBuilder?.open?.(detail||{})};
    const lazyPageBuilderOpen=e=>loadPageBuilder(e.detail).catch(showFeatureError);
    window.addEventListener('kptu:page-editor-opened',lazyPageBuilderOpen);
    await import('./page-shortcut.js?v=2'); await window.__KPTU_PAGE_SHORTCUT_READY__;
    await import('./page-management.js?v=2'); await window.__KPTU_PAGE_MANAGEMENT_READY__;
    await import('./media-workflow.js?v=2'); await window.__KPTU_MEDIA_WORKFLOW_READY__;
    await import('./page-inline-viewer-v2.js?v=1'); await window.__KPTU_PAGE_INLINE_VIEWER_READY__;
    await import('./meeting-round-detail.js?v=6'); await window.__KPTU_MEETING_ROUND_DETAIL_READY__;
    await import('./google-calendar-return-status.js?v=1');
    await import('./collaboration-center.js?v=9'); await window.__KPTU_COLLABORATION_READY__;
    await import('./calendar-plus.js?v=5'); await window.__KPTU_CALENDAR_PLUS_READY__;
    await import('./calendar-persistence.js?v=10'); await window.__KPTU_CALENDAR_PERSISTENCE_READY__;
    await import('./calendar-interactions-v2.js?v=3'); await window.__KPTU_CALENDAR_INTERACTIONS_READY__;
    await import('./calendar-mobile-ui.js?v=3'); await window.__KPTU_CALENDAR_MOBILE_UI_READY__;
    await import('./calendar-day-overflow.js?v=2'); await window.__KPTU_CALENDAR_DAY_OVERFLOW_READY__;
    await import('./suborganizations.js?v=2'); await window.__KPTU_SUBORGANIZATIONS_READY__;
    await import('./suborganization-filters.js?v=3'); await window.__KPTU_SUBORGANIZATION_FILTERS_READY__;
    await import('./team-profile-view.js?v=3'); await window.__KPTU_TEAM_PROFILE_READY__;
    await Promise.all([import('./google-tasks.js?v=3'),import('./mobile-modal-history.js?v=1'),import('./mobile-swipe-navigation.js?v=4')]);
    featuresReady=true;
    startup?.mark('allInitialModulesComplete');
    Promise.all([import('./workplace-ai-report.js?v=1'),import('./workflow-ai-v3.js?v=2'),import('./meeting-ai-ingest-client.js?v=1&text=1'),import('./meeting-ai-paste-ui.js?v=1')]).catch(showFeatureError);
  })().catch(err=>{featurePromise=null;showFeatureError(err);throw err}));
  window.KPTUDeferredFeatures={load:loadFeatures};
  document.addEventListener('click',event=>{
    const control=event.target.closest?.('#appView [data-view],#appView [data-goto],#appView [data-hdv-goto],#appView [data-hdv-project],#newTaskBtn,#newEventBtn,#newDocumentBtn,#newMeetingBtn,#newProjectBtn,#newPageBtn,[data-edit-page]');
    if(!control||featuresReady)return;
    const view=control.dataset.view||control.dataset.goto;
    if(view==='home')return;
    event.preventDefault();event.stopImmediatePropagation();
    let status=document.querySelector('#deferredFeatureStatus');
    if(!status){status=document.createElement('div');status.id='deferredFeatureStatus';status.className='notice';status.setAttribute('role','status');document.querySelector('#appView .app-nav')?.after(status)}
    status.textContent='기능을 불러오는 중입니다…';
    loadFeatures().then(()=>{status.remove();if(view)window.KPTURouter?.go?.(view,{source:'delegated'});else control.click()}).catch(()=>status.remove());
  },true);

  const requested=new URLSearchParams(location.search).get('view');
  if(requested&&requested!=='home')await loadFeatures();
  window.__KPTU_MARK_APP_UI_READY__?.({usable:homeResult?.ok===true});
  if(!requested||requested==='home'){
    const defer=window.requestIdleCallback||((fn)=>setTimeout(fn,200));
    defer(()=>loadFeatures().catch(()=>{}),{timeout:2500});
  }
})().catch(err=>{
  console.error(err);
  window.__KPTU_MARK_APP_UI_READY__?.();
  document.body.insertAdjacentHTML('beforeend','<pre style="padding:16px;color:#a33b45">앱 초기화 오류: '+String(err.message||err)+'</pre>');
});
