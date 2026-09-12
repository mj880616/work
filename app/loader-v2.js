(async()=>{
  await import('./native-auth-bridge.js?v=4');
  if(window.__KPTU_NATIVE_BRIDGE__)return;
  await import('./calendar-return-bridge.js?v=1');
  if(window.__KPTU_CALENDAR_BRIDGE__)return;
  await import('./auth-handoff-client.js?v=1');
  await import('./auth-bootstrap.js?v=1');
  if(!document.querySelector('#workspaceUiCss')){const l=document.createElement('link');l.id='workspaceUiCss';l.rel='stylesheet';l.href='./workspace-ui.css?v=1';document.head.appendChild(l)}
  await import('./auth-ui.js?v=6');
  await import('./auth-cleanup.js?v=2');
  await import('./session-resilience.js?v=5');
  await import('./brand-logo.js?v=1');
  await import('./team.js?v=5');
  await import('./meeting-file-route.js?v=1');
  await Promise.all([
    import('./photo-room.js?v=1'),
    import('./project-access.js?v=1'),
    import('./password-reset.js?v=1'),
    import('./calendar-health.js?v=2'),
    import('./calendar-persistence.js?v=7'),
    import('./task-workflow.js?v=2'),
    import('./task-layout.js?v=1'),
    import('./profile-settings.js?v=1'),
    import('./meeting-round-detail.js?v=1'),
    import('./project-files.js?v=1'),
    import('./library-upload.js?v=1'),
    import('./page-editor-fix.js?v=1')
  ]);
  await import('./task-personal-due.js?v=1');
  await import('./project-update-actions.js?v=1');
  await import('./calendar-plus.js?v=3');
  await import('./calendar-defaults.js?v=1');
  await import('./calendar-interactions-v2.js?v=1');
  await import('./calendar-mobile-ui.js?v=2');
})().catch(err=>{
  console.error(err);
  document.body.insertAdjacentHTML('beforeend','<pre style="padding:16px;color:#a33b45">앱 초기화 오류: '+String(err.message||err)+'</pre>');
});
