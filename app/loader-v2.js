(async()=>{
  await import('./native-auth-bridge.js?v=4');
  if(window.__KPTU_NATIVE_BRIDGE__)return;
  await import('./calendar-return-bridge.js?v=2');
  if(window.__KPTU_CALENDAR_BRIDGE__)return;
  await import('./runtime-client.js?v=1');
  await import('./auth-handoff-client.js?v=1');
  await import('./auth-bootstrap.js?v=1');
  await import('./app-router.js?v=2');
  if(!document.querySelector('#workspaceUiCss')){const l=document.createElement('link');l.id='workspaceUiCss';l.rel='stylesheet';l.href='./workspace-ui.css?v=5';document.head.appendChild(l)}
  await import('./session-resilience.js?v=6');
  await import('./brand-logo.js?v=2');
  await import('./auth-service.js?v=1');
  await import('./capabilities.js?v=1');
  await import('./pwa.js?v=3');

  const authenticated=await window.KPTURuntime.session.ensure();
  if(!authenticated){
    if(new URLSearchParams(location.search).has('invite')){
      location.replace(window.KPTUAuth.loginUrl(location.href));
      return;
    }
    await import('./public-workspace.js?v=2');
    return;
  }

  await import('./meeting-multi-tasks.js?v=6');
  await import('./team.js?v=8');
  const waitForTeamState=async()=>{
    const rt=window.KPTURuntime;
    const settled=()=>{
      if(!rt.session.read())return true;
      const bootstrap=document.querySelector('#bootstrapView');
      const app=document.querySelector('#appView');
      return !!bootstrap&&!bootstrap.classList.contains('hidden')||!!app&&!app.classList.contains('hidden');
    };
    if(settled())return;
    await new Promise(resolve=>{
      let done=false;
      const finish=()=>{if(done)return;done=true;observer.disconnect();clearTimeout(timeout);resolve()};
      const observer=new MutationObserver(()=>{if(settled())finish()});
      ['bootstrapView','appView'].forEach(id=>{const el=document.getElementById(id);if(el)observer.observe(el,{attributes:true,attributeFilter:['class']})});
      const timeout=setTimeout(finish,3000);
    });
  };
  await waitForTeamState();
  try{
    const user=await window.KPTURuntime.api('/auth/v1/user');
    const memberships=await window.KPTURuntime.api(`/rest/v1/app_workspace_members?user_id=eq.${user.id}&select=workspace_id,role&limit=1`);
    window.KPTUCapabilities.setContext({user,membership:memberships?.[0]||null});
  }catch(e){console.warn('capability context skipped',e)}

  await Promise.all([
    import('./forum-flow-polish.js?v=2'),
    import('./public-page-links.js?v=1'),
    import('./calendar-move.js?v=1'),
    import('./team-member-overview-bootstrap.js?v=2'),
    import('./profile-workplace-edit-mode.js?v=1'),
    import('./suborganization-filters.js?v=2'),
    import('./meeting-assignee-picker.js?v=2'),
    import('./due-date-calendar.js?v=1')
  ]);
  await import('./access-approval.js?v=3');
  await import('./access-approval-copyfix.js?v=1');
  await import('./access-approval-stability.js?v=1');
  await Promise.all([import('./home-cleanup.js?v=3'),import('./home-dashboard-v2.js?v=2')]);
  window.__KPTU_MARK_APP_UI_READY__?.();
  document.querySelector('#authPreloadStyle')?.remove();
  await import('./member-default-role.js?v=3');
  await import('./myspace-return.js?v=2');
  await import('./meeting-file-route.js?v=1');
  await import('./page-design-core.js?v=3');
  await Promise.all([
    import('./photo-room.js?v=1'),
    import('./project-access.js?v=5'),
    import('./password-reset.js?v=1'),
    import('./calendar-health.js?v=3'),
    import('./calendar-persistence.js?v=8'),
    import('./task-workflow.js?v=3'),
    import('./task-layout.js?v=5'),
    import('./home-task-controls.js?v=2'),
    import('./profile-settings.js?v=2&wd=2'),
    import('./workplace-detail.js?v=2'),
    import('./project-files.js?v=4'),
    import('./library-upload.js?v=3'),
    import('./page-editor-fix.js?v=2'),
    import('./page-builder.js?v=1&designer=2'),
    import('./page-shortcut.js?v=1'),
    import('./page-management.js?v=1'),
    import('./page-inline-viewer.js?v=2')
  ]);
  const loadAuthenticatedAi=async()=>{
    await import('./meeting-round-detail.js?v=5');
    await import('./workplace-ai-report.js?v=1');
    await import('./workflow-ai-v3.js?v=1');
    await import('./meeting-ai-ingest-client.js?v=1&text=1');
  };
  await loadAuthenticatedAi();
  await import('./google-calendar-return-status.js?v=1');
  await import('./meeting-buttons-compact.js?v=3');
  await import('./photo-upload-fix.js?v=1');
  await import('./task-project-routing.js?v=1');
  await import('./project-update-actions.js?v=3');
  await import('./project-task-link.js?v=6');
  await import('./project-v2.js?v=1');
  await import('./project-operating-model.js?v=1');
  await import('./project-templates.js?v=1');
  await import('./project-deeplink.js?v=1');
  await import('./project-delete.js?v=1');
  await import('./project-task-guide-cleanup.js?v=1');
  let projectSystemLoaded=false;
  const loadProjectSystem=async()=>{
    if(projectSystemLoaded)return false;
    try{
      const u=await window.KPTURuntime.api('/auth/v1/user');
      const ms=await window.KPTURuntime.api(`/rest/v1/app_workspace_members?user_id=eq.${u.id}&select=workspace_id&limit=1`);
      const wid=ms?.[0]?.workspace_id;if(!wid)return false;
      const rows=await window.KPTURuntime.api(`/rest/v1/app_spaces?workspace_id=eq.${wid}&select=id,metadata&limit=100`);
      const useV2=!rows?.length||rows.some(x=>x?.metadata?.project_system==='v2'||x?.metadata?.legacy_snapshot===true);
      if(!useV2)return false;
      await import('./project-system-v2.js?v=1');
      await import('./project-hide-legacy.js?v=1');
      await import('./project-type-labels.js?v=4');
      await import('./project-modal-scroll-lock.js?v=3');
      await import('./project-empty-workstream-guard.js?v=2');
      await import('./project-modal-polish.js?v=1');
      await import('./project-archive.js?v=1');
      projectSystemLoaded=true;return true;
    }catch(e){console.warn('project system v2 activation skipped',e);return false}
  };
  await loadProjectSystem();
  await import('./task-completed-label.js?v=2');
  await import('./task-notes.js?v=2');
  await import('./collaboration-center.js?v=5');
  await import('./notification-center-ui.js?v=5');
  await import('./task-assignment-visibility.js?v=4');
  await import('./calendar-plus.js?v=4');
  await import('./calendar-defaults.js?v=1');
  await import('./calendar-interactions-v2.js?v=2');
  await import('./calendar-mobile-ui.js?v=2');
  await import('./suborganizations.js?v=1');
  await import('./suborganization-planned-assignee.js?v=1');
  await import('./profile-workplace-sync.js?v=1');
  await import('./profile-workplace-legacy.js?v=1');
  await import('./project-suborganization-links.js?v=1');
  await import('./team-profile-view.js?v=1');
  await import('./global-action-buttons.js?v=1');
  await import('./task-child-project-guard.js?v=1');
  await import('./task-status-state.js?v=1');
  await import('./home-task-expand.js?v=2');
  await import('./home-task-expand-retry.js?v=1');
  await import('./google-tasks.js?v=2');
  await import('./push-notifications-ui.js?v=2');
  await import('./calendar-day-overflow.js?v=1');
  await import('./mobile-safe-area.js?v=1');
  await import('./mobile-modal-history.js?v=1');
  await import('./mobile-swipe-navigation.js?v=2');
})().catch(err=>{
  console.error(err);
  window.__KPTU_MARK_APP_UI_READY__?.();
  document.querySelector('#authPreloadStyle')?.remove();
  document.body.insertAdjacentHTML('beforeend','<pre style="padding:16px;color:#a33b45">앱 초기화 오류: '+String(err.message||err)+'</pre>');
});
