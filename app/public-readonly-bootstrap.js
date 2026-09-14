(async()=>{
  if(window.__KPTU_PUBLIC_READONLY__)return;
  window.__KPTU_PUBLIC_READONLY__=true;
  if(window.KPTURuntime?.session?.read?.())return;
  await import('./guest-core.js?v=1');
  await import('./guest-main.js?v=1');
  await import('./guest-content.js?v=1');
  await import('./guest-organizations.js?v=1');
  const g=window.KPTUGuest;
  if(!g)return;
  try{
    g.setupShell();
    g.bindLoginGate();
    g.bindContent();
    g.bindOrganizations();
    await g.load();
    g.renderMain();
    g.renderContent();
    g.renderOrganizations();
    window.KPTURouter?.go?.(window.KPTURouter.current||'home',{source:'guest',scroll:false});
    window.__KPTU_MARK_APP_UI_READY__?.();
    document.querySelector('#authPreloadStyle')?.remove();
    window.dispatchEvent(new Event('kptu:guest-ready'));
  }catch(e){
    console.error('public readonly',e);
    g.showOnly('authView');
    document.querySelector('#authPreloadStyle')?.remove();
    const st=document.querySelector('#authStatus');
    if(st){st.textContent='공개 자료를 불러오지 못했습니다. 로그인해서 이용해 주세요.';st.className='status error'}
  }
})();