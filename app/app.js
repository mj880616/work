(async()=>{
  await import('./auth-bootstrap.js?v=1');
  await import('./team.js?v=5');
  await Promise.all([
    import('./photo-room.js?v=1'),
    import('./project-access.js?v=1'),
    import('./password-reset.js?v=1'),
    import('./auth-ui.js?v=1')
  ]);
})().catch(err=>{
  console.error(err);
  document.body.insertAdjacentHTML('beforeend','<pre style="padding:16px;color:#a33b45">앱 초기화 오류: '+String(err.message||err)+'</pre>');
});