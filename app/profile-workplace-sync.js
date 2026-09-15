(()=>{
'use strict';
async function refresh(){try{return await window.__KPTU_RELOAD_SUBORGANIZATIONS__?.()}catch(e){console.warn('profile workplace sync skipped',e)}}
window.__KPTU_PROFILE_WORKPLACE_REFRESH__=refresh;
window.addEventListener('kptu:suborganization-updated',()=>refresh());
window.addEventListener('kptu:view-changed',e=>{if(e.detail?.view==='team')refresh()});
})();
