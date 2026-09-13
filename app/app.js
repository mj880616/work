const authPreload=document.createElement('style');authPreload.id='authPreloadStyle';authPreload.textContent='#authView .auth-tabs,#authView #authForm{visibility:hidden;pointer-events:none}';document.head.appendChild(authPreload);
[
  './native-auth-bridge.js?v=4',
  './calendar-return-bridge.js?v=2',
  './runtime-client.js?v=1',
  './auth-handoff-client.js?v=1',
  './auth-bootstrap.js?v=1',
  './app-router.js?v=1',
  './auth-ui.js?v=8',
  './session-resilience.js?v=6',
  './brand-logo.js?v=1',
  './team.js?v=8',
  './project-access.js?v=4'
].forEach(href=>{const l=document.createElement('link');l.rel='modulepreload';l.href=href;document.head.appendChild(l)});
const teamCssPreload=document.createElement('link');teamCssPreload.rel='preload';teamCssPreload.as='style';teamCssPreload.href='./team.css?v=1';document.head.appendChild(teamCssPreload);
window.addEventListener('kptu:tasks-changed',()=>{const list=document.querySelector('#taskList');if(!list)return;const marker=document.createElement('span');marker.hidden=true;list.appendChild(marker);marker.remove()});
import('./pwa.js?v=1');
Promise.all([
  import('./meeting-assignee-picker.js?v=2'),
  import('./due-date-calendar.js?v=1')
]).then(()=>import('./loader-v2.js?v=101')).catch(err=>{console.error(err);document.querySelector('#authPreloadStyle')?.remove();document.body.insertAdjacentHTML('beforeend','<pre style="padding:16px;color:#a33b45">앱 초기화 오류: '+String(err.message||err)+'</pre>')});