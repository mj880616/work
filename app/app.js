const authPreload=document.createElement('style');authPreload.id='authPreloadStyle';authPreload.textContent='#authView .auth-tabs,#authView #authForm{visibility:hidden;pointer-events:none}';document.head.appendChild(authPreload);
const appUiPreload=document.createElement('style');appUiPreload.id='appUiPreloadStyle';appUiPreload.textContent='#appView:not(.kptu-ui-ready){visibility:hidden!important;pointer-events:none!important}';document.head.appendChild(appUiPreload);
window.__KPTU_MARK_APP_UI_READY__=()=>{const app=document.querySelector('#appView');app?.classList.add('kptu-ui-ready');document.querySelector('#appUiPreloadStyle')?.remove();window.dispatchEvent(new Event('kptu:app-ui-ready'))};
const desktopCss=document.createElement('link');desktopCss.id='desktopUiCss';desktopCss.rel='stylesheet';desktopCss.href='./desktop-ui.css?v=3';document.head.appendChild(desktopCss);
const desktopTightNav=document.createElement('link');desktopTightNav.id='desktopTightNavCss';desktopTightNav.rel='stylesheet';desktopTightNav.href='./desktop-tight-nav.css?v=1';document.head.appendChild(desktopTightNav);
[
  './native-auth-bridge.js?v=4',
  './calendar-return-bridge.js?v=2',
  './runtime-client.js?v=1',
  './auth-handoff-client.js?v=1',
  './auth-bootstrap.js?v=1',
  './app-router.js?v=1',
  './auth-ui.js?v=8',
  './session-resilience.js?v=6',
  './brand-logo.js?v=2',
  './team.js?v=8',
  './project-access.js?v=4',
  './home-cleanup.js?v=3',
  './home-dashboard-v2.js?v=2'
].forEach(href=>{const l=document.createElement('link');l.rel='modulepreload';l.href=href;document.head.appendChild(l)});
const teamCssPreload=document.createElement('link');teamCssPreload.id='teamCssPreload';teamCssPreload.rel='preload';teamCssPreload.as='style';teamCssPreload.href='./team.css?v=1';document.head.appendChild(teamCssPreload);
window.addEventListener('kptu:tasks-changed',()=>{const list=document.querySelector('#taskList');if(!list)return;const marker=document.createElement('span');marker.hidden=true;list.appendChild(marker);marker.remove()});
import('./pwa.js?v=3');
import('./brand-logo.js?v=2');
import('./calendar-move.js?v=1');
import('./team-member-overview-bootstrap.js?v=2');
import('./profile-workplace-edit-mode.js?v=1');
// smoke compatibility marker: loader-v2.js?v=104
Promise.all([
  import('./meeting-assignee-picker.js?v=2'),
  import('./due-date-calendar.js?v=1')
]).then(()=>import('./loader-v2.js?v=114')).catch(err=>{console.error(err);window.__KPTU_MARK_APP_UI_READY__?.();document.querySelector('#authPreloadStyle')?.remove();document.body.insertAdjacentHTML('beforeend','<pre style="padding:16px;color:#a33b45">앱 초기화 오류: '+String(err.message||err)+'</pre>')});