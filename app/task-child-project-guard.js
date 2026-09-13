(()=>{
'use strict';
const rt=window.KPTURuntime;if(!rt)return;
let spaces=[],observer=null;
const api=(p,o={})=>rt.api(p,o);
function apply(){const sel=document.querySelector('#taskProject');if(!sel||!spaces.length)return;const mains=new Set(spaces.filter(s=>!s.parent_id).map(s=>s.id));[...sel.options].forEach(o=>{if(o.value&&mains.has(o.value))o.remove()})}
function observe(){const sel=document.querySelector('#taskProject');if(!sel)return;if(observer)observer.disconnect();observer=new MutationObserver(()=>apply());observer.observe(sel,{childList:true});apply()}
async function refresh(){try{if(!(await rt.session.ensure()))return;const u=await api('/auth/v1/user');const ms=await api(`/rest/v1/app_workspace_members?user_id=eq.${u.id}&select=workspace_id&limit=1`);if(!ms?.length)return;spaces=await api(`/rest/v1/app_spaces?workspace_id=eq.${ms[0].workspace_id}&select=id,parent_id,status`);spaces=(spaces||[]).filter(s=>s.status!=='archived');observe()}catch(e){console.warn('task child-project guard',e)}}
function boot(){document.addEventListener('click',e=>{if(e.target.closest?.('#newTaskBtn,#quickTaskBtn'))queueMicrotask(apply)},true);window.addEventListener('kptu:session-changed',()=>setTimeout(refresh,0));refresh()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
