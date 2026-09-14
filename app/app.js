const authPreload=document.createElement('style');authPreload.id='authPreloadStyle';authPreload.textContent='#authView .auth-tabs,#authView #authForm{visibility:hidden;pointer-events:none}';document.head.appendChild(authPreload);
const appUiPreload=document.createElement('style');appUiPreload.id='appUiPreloadStyle';appUiPreload.textContent='#appView:not(.kptu-ui-ready){visibility:hidden!important;pointer-events:none!important}';document.head.appendChild(appUiPreload);
const myspaceGate=document.createElement('style');myspaceGate.id='myspaceGateStyle';myspaceGate.textContent='[data-view="myspace"],#myspaceView{display:none!important}';document.head.appendChild(myspaceGate);
window.__KPTU_MARK_APP_UI_READY__=()=>{const app=document.querySelector('#appView');app?.classList.add('kptu-ui-ready');document.querySelector('#appUiPreloadStyle')?.remove();window.dispatchEvent(new Event('kptu:app-ui-ready'))};
const desktopCss=document.createElement('link');desktopCss.id='desktopUiCss';desktopCss.rel='stylesheet';desktopCss.href='./desktop-ui.css?v=3';document.head.appendChild(desktopCss);
const desktopTightNav=document.createElement('link');desktopTightNav.id='desktopTightNavCss';desktopTightNav.rel='stylesheet';desktopTightNav.href='./desktop-tight-nav.css?v=1';document.head.appendChild(desktopTightNav);
[
  './native-auth-bridge.js?v=4','./calendar-return-bridge.js?v=2','./runtime-client.js?v=1','./auth-handoff-client.js?v=1','./auth-bootstrap.js?v=1','./app-router.js?v=2','./auth-ui.js?v=8','./session-resilience.js?v=6','./brand-logo.js?v=2','./team.js?v=8','./project-access.js?v=4','./home-cleanup.js?v=3','./home-dashboard-v2.js?v=2'
].forEach(href=>{const l=document.createElement('link');l.rel='modulepreload';l.href=href;document.head.appendChild(l)});
const teamCssPreload=document.createElement('link');teamCssPreload.id='teamCssPreload';teamCssPreload.rel='preload';teamCssPreload.as='style';teamCssPreload.href='./team.css?v=1';document.head.appendChild(teamCssPreload);
window.addEventListener('kptu:tasks-changed',()=>{const list=document.querySelector('#taskList');if(!list)return;const marker=document.createElement('span');marker.hidden=true;list.appendChild(marker);marker.remove()});
const fail=err=>{console.error(err);window.__KPTU_MARK_APP_UI_READY__?.();document.querySelector('#authPreloadStyle')?.remove();document.body.insertAdjacentHTML('beforeend','<pre style="padding:16px;color:#a33b45">앱 초기화 오류: '+String(err.message||err)+'</pre>')};
// smoke compatibility marker: loader-v2.js?v=104
import('./pwa.js?v=3');
import('./brand-logo.js?v=2');

async function bootAuthenticated(){
  import('./calendar-move.js?v=1');
  import('./team-member-overview-bootstrap.js?v=2');
  import('./profile-workplace-edit-mode.js?v=1');
  import('./suborganization-filters.js?v=2');
  await Promise.all([import('./meeting-assignee-picker.js?v=2'),import('./due-date-calendar.js?v=1')]);
  await import('./loader-v2.js?v=117');
}

async function bootPublicReadonly(){
  await import('./app-router.js?v=2');
  if(!document.querySelector('#workspaceUiCss')){const l=document.createElement('link');l.id='workspaceUiCss';l.rel='stylesheet';l.href='./workspace-ui.css?v=5';document.head.appendChild(l)}
  await import('./auth-ui.js?v=8');
  await import('./auth-login-fallback.js?v=1');
  await import('./session-resilience.js?v=6');
  await import('./team.js?v=8');
  if(window.KPTURuntime?.session?.read?.()){location.reload();return}
  await import('./public-readonly-bootstrap.js?v=1');
  await import('./mobile-safe-area.js?v=1');
  await import('./mobile-swipe-navigation.js?v=3');
}

async function boot(){
  await import('./native-auth-bridge.js?v=4');if(window.__KPTU_NATIVE_BRIDGE__)return;
  await import('./calendar-return-bridge.js?v=2');if(window.__KPTU_CALENDAR_BRIDGE__)return;
  await import('./runtime-client.js?v=1');
  await import('./auth-handoff-client.js?v=1');
  await import('./auth-bootstrap.js?v=1');
  if(window.KPTURuntime?.session?.read?.())await bootAuthenticated();
  else await bootPublicReadonly();
}
boot().catch(fail);
