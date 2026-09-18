(async()=>{
  await import('./native-auth-bridge.js?v=4');
  if(window.__KPTU_NATIVE_BRIDGE__)return;
  await import('./calendar-return-bridge.js?v=2');
  if(window.__KPTU_CALENDAR_BRIDGE__)return;
  await import('./runtime-client.js?v=3');
  await import('./auth-handoff-client.js?v=1');
  await import('./auth-bootstrap.js?v=1');
  await import('./app-router.js?v=3');
  await import('./accessibility-dialog.js?v=1');
  await import('./native-back-guard.js?v=1');
  await import('./session-resilience.js?v=6');
  await import('./auth-service.js?v=1');
  await import('./capabilities.js?v=2');
  await import('./pwa.js?v=3');

  const authenticated=await window.KPTURuntime.session.ensure();
  if(!authenticated){
    if(new URLSearchParams(location.search).has('invite')){
      location.replace(window.KPTUAuth.loginUrl(location.href));
      return;
    }
    await import('./public-workspace.js?v=7');
    await import('./mobile-swipe-navigation.js?v=3');
    return;
  }

  await import('./topbar-actions.js?v=1');
  // team.js reads the same persisted session, but its legacy init can race the dedicated-login handoff.
  // Seed its in-memory session before init so the authenticated renderer owns the first committed UI.
  window.__KPTU_AUTHENTICATED_BOOT_SESSION__=window.KPTURuntime.session.read();
  await import('./team.js?v=17');
  await window.__KPTU_TEAM_READY__;
  delete window.__KPTU_AUTHENTICATED_BOOT_SESSION__;

  try{
    const user=await window.KPTURuntime.api('/auth/v1/user');
    const memberships=await window.KPTURuntime.api(`/rest/v1/app_workspace_members?user_id=eq.${user.id}&select=workspace_id,role&limit=1`);
    window.KPTUCapabilities.setContext({user,membership:memberships?.[0]||null});
  }catch(e){console.warn('capability context skipped',e)}

  await import('./project-system-v3.js?v=2');

  await import('./team-member-overview.js?v=2');
  await window.__KPTU_TEAM_MEMBER_OVERVIEW_READY__;
  await import('./team-member-management.js?v=2');
  await window.__KPTU_TEAM_MEMBER_MANAGEMENT_READY__;

  await Promise.all([
    import('./forum-flow-polish.js?v=2'),
    import('./public-page-links.js?v=1'),
    import('./calendar-move.js?v=1'),
    import('./due-date-calendar.js?v=1')
  ]);

  await import('./access-approval.js?v=4');
  window.KPTUTeamMemberManagement?.limitApprovalRoles();
  await import('./home-dashboard-v2.js?v=4');
  await import('./member-default-role.js?v=3');
  await import('./myspace-return.js?v=2');
  await import('./page-design-core.js?v=3');

  await import('./task-workflow.js?v=6');
  await window.__KPTU_TASK_WORKFLOW_READY__;
  await import('./task-layout.js?v=6');
  await window.__KPTU_TASK_LAYOUT_READY__;

  await import('./profile-settings.js?v=4');
  await window.__KPTU_PROFILE_SETTINGS_READY__;

  await Promise.all([
    import('./photo-room.js?v=2'),
    import('./password-reset.js?v=1'),
    import('./calendar-health.js?v=3'),
    import('./home-task-controls.js?v=3'),
    import('./workplace-detail.js?v=3'),
    import('./library-upload.js?v=5'),
    import('./library-public-toggle.js?v=1')
  ]);

  await window.__KPTU_PHOTO_ROOM_READY__;

  await import('./page-list-controller.js?v=2');
  await window.__KPTU_PAGE_LIST_READY__;
  await import('./page-save-controller.js?v=3');
  await window.__KPTU_PAGE_SAVE_READY__;
  const loadPageBuilder=async detail=>{
    window.removeEventListener('kptu:page-editor-opened',lazyPageBuilderOpen);
    await import('./page-builder.js?v=2');
    await window.__KPTU_PAGE_BUILDER_READY__;
    await window.KPTUPageBuilder?.open?.(detail||{});
  };
  const lazyPageBuilderOpen=e=>loadPageBuilder(e.detail).catch(err=>console.error('page builder lazy load failed',err));
  window.addEventListener('kptu:page-editor-opened',lazyPageBuilderOpen);
  await import('./page-shortcut.js?v=2');
  await window.__KPTU_PAGE_SHORTCUT_READY__;
  await import('./page-management.js?v=2');
  await window.__KPTU_PAGE_MANAGEMENT_READY__;
  await import('./media-workflow.js?v=1');
  await window.__KPTU_MEDIA_WORKFLOW_READY__;
  await import('./page-inline-viewer-v2.js?v=1');
  await window.__KPTU_PAGE_INLINE_VIEWER_READY__;

  await import('./meeting-round-detail.js?v=6');
  await window.__KPTU_MEETING_ROUND_DETAIL_READY__;
  const loadAiFeatures=()=>Promise.all([
    import('./workplace-ai-report.js?v=1'),
    import('./workflow-ai-v3.js?v=2'),
    import('./meeting-ai-ingest-client.js?v=1&text=1'),
    import('./meeting-ai-paste-ui.js?v=1')
  ]).catch(err=>console.error('AI feature load failed',err));
  window.addEventListener('kptu:app-ui-ready',loadAiFeatures,{once:true});

  await import('./google-calendar-return-status.js?v=1');
  await import('./task-project-routing.js?v=1');
  await import('./task-completed-label.js?v=2');
  await import('./task-notes.js?v=2');

  await import('./collaboration-center.js?v=6');
  await window.__KPTU_COLLABORATION_READY__;
  await import('./notification-center-ui.js?v=6');
  await window.__KPTU_NOTIFICATION_CENTER_READY__;

  await import('./calendar-plus.js?v=5');
  await window.__KPTU_CALENDAR_PLUS_READY__;
  await import('./calendar-persistence.js?v=10');
  await window.__KPTU_CALENDAR_PERSISTENCE_READY__;
  await import('./calendar-interactions-v2.js?v=3');
  await window.__KPTU_CALENDAR_INTERACTIONS_READY__;
  await import('./calendar-mobile-ui.js?v=3');
  await window.__KPTU_CALENDAR_MOBILE_UI_READY__;
  await import('./calendar-day-overflow.js?v=2');
  await window.__KPTU_CALENDAR_DAY_OVERFLOW_READY__;

  await import('./suborganizations.js?v=2');
  await window.__KPTU_SUBORGANIZATIONS_READY__;
  await import('./suborganization-filters.js?v=3');
  await window.__KPTU_SUBORGANIZATION_FILTERS_READY__;
  await import('./team-profile-view.js?v=2');
  await window.__KPTU_TEAM_PROFILE_READY__;

  await import('./google-tasks.js?v=3');
  await import('./push-notifications-ui.js?v=2');
  await import('./mobile-modal-history.js?v=1');
  await import('./mobile-swipe-navigation.js?v=3');

  window.__KPTU_MARK_APP_UI_READY__?.();
})().catch(err=>{
  console.error(err);
  window.__KPTU_MARK_APP_UI_READY__?.();
  document.body.insertAdjacentHTML('beforeend','<pre style="padding:16px;color:#a33b45">앱 초기화 오류: '+String(err.message||err)+'</pre>');
});