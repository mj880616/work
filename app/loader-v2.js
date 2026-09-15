(async()=>{
  await import('./native-auth-bridge.js?v=4');
  if(window.__KPTU_NATIVE_BRIDGE__)return;
  await import('./calendar-return-bridge.js?v=2');
  if(window.__KPTU_CALENDAR_BRIDGE__)return;
  await import('./runtime-client.js?v=1');
  await import('./auth-handoff-client.js?v=1');
  await import('./auth-bootstrap.js?v=1');
  await import('./app-router.js?v=2');
  await import('./native-back-guard.js?v=1');
  await import('./session-resilience.js?v=6');
  await import('./auth-service.js?v=1');
  await import('./capabilities.js?v=1');
  await import('./pwa.js?v=3');

  const authenticated=await window.KPTURuntime.session.ensure();
  if(!authenticated){
    if(new URLSearchParams(location.search).has('invite')){
      location.replace(window.KPTUAuth.loginUrl(location.href));
      return;
    }
    await import('./public-workspace.js?v=4');
    await import('./public-workspace-extras.js?v=1');
    return;
  }

  await import('./topbar-actions.js?v=1');
  await import('./team.js?v=13');
  await window.__KPTU_TEAM_READY__;

  try{
    const user=await window.KPTURuntime.api('/auth/v1/user');
    const memberships=await window.KPTURuntime.api(`/rest/v1/app_workspace_members?user_id=eq.${user.id}&select=workspace_id,role&limit=1`);
    window.KPTUCapabilities.setContext({user,membership:memberships?.[0]||null});
  }catch(e){console.warn('capability context skipped',e)}

  await import('./project-system-v3.js?v=1');

  await import('./team-member-overview.js?v=2');
  await window.__KPTU_TEAM_MEMBER_OVERVIEW_READY__;
  await import('./team-member-management.js?v=2');
  await window.__KPTU_TEAM_MEMBER_MANAGEMENT_READY__;

  await Promise.all([
    import('./forum-flow-polish.js?v=2'),
    import('./public-page-links.js?v=1'),
    import('./calendar-move.js?v=1'),
    import('./meeting-assignee-picker.js?v=2'),
    import('./due-date-calendar.js?v=1')
  ]);

  await import('./access-approval.js?v=4');
  window.KPTUTeamMemberManagement?.limitApprovalRoles();
  await import('./home-dashboard-v2.js?v=3');
  await import('./member-default-role.js?v=3');
  await import('./myspace-return.js?v=2');
  await import('./meeting-file-route.js?v=1');
  await import('./page-design-core.js?v=3');

  await import('./task-workflow.js?v=5');
  await import('./task-layout.js?v=6');
  await window.__KPTU_TASK_LAYOUT_READY__;

  await import('./profile-settings.js?v=3');
  await window.__KPTU_PROFILE_SETTINGS_READY__;

  await Promise.all([
    import('./photo-room.js?v=2'),
    import('./password-reset.js?v=1'),
    import('./calendar-health.js?v=3'),
    import('./calendar-persistence.js?v=8'),
    import('./home-task-controls.js?v=3'),
    import('./workplace-detail.js?v=2'),
    import('./library-upload.js?v=3'),
    import('./library-public-toggle.js?v=1'),
    import('./page-editor-fix.js?v=2'),
    import('./page-builder.js?v=1&designer=2'),
    import('./page-shortcut.js?v=1'),
    import('./page-management.js?v=1'),
    import('./page-inline-viewer.js?v=2')
  ]);

  await window.__KPTU_PHOTO_ROOM_READY__;

  await import('./meeting-round-detail.js?v=5');
  await import('./workplace-ai-report.js?v=1');
  await import('./workflow-ai-v3.js?v=2');
  await import('./meeting-ai-ingest-client.js?v=1&text=1');
  await import('./meeting-ai-paste-ui.js?v=1');

  await import('./google-calendar-return-status.js?v=1');
  await import('./task-project-routing.js?v=1');
  await import('./task-completed-label.js?v=2');
  await import('./task-notes.js?v=2');
  await import('./collaboration-center.js?v=5');
  await import('./notification-center-ui.js?v=5');
  await import('./task-assignment-visibility.js?v=4');
  await import('./calendar-plus.js?v=4');
  await import('./calendar-defaults.js?v=1');
  await import('./calendar-interactions-v2.js?v=2');
  await import('./calendar-mobile-ui.js?v=2');

  await import('./suborganizations.js?v=2');
  await window.__KPTU_SUBORGANIZATIONS_READY__;
  await import('./suborganization-filters.js?v=3');
  await window.__KPTU_SUBORGANIZATION_FILTERS_READY__;
  await import('./team-profile-view.js?v=2');
  await window.__KPTU_TEAM_PROFILE_READY__;

  await import('./google-tasks.js?v=3');
  await import('./push-notifications-ui.js?v=2');
  await import('./calendar-day-overflow.js?v=1');
  await import('./mobile-modal-history.js?v=1');
  await import('./mobile-swipe-navigation.js?v=3');

  window.__KPTU_MARK_APP_UI_READY__?.();
})().catch(err=>{
  console.error(err);
  window.__KPTU_MARK_APP_UI_READY__?.();
  document.body.insertAdjacentHTML('beforeend','<pre style="padding:16px;color:#a33b45">앱 초기화 오류: '+String(err.message||err)+'</pre>');
});
