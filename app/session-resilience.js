const SR_KEY='kptu_collab_session_v1';
let srExplicitLogout=false;
const srOriginalRemove=Storage.prototype.removeItem;
function srRead(){try{return JSON.parse(localStorage.getItem(SR_KEY)||'null')}catch{return null}}
function srHasSession(){const s=srRead();return !!(s?.refresh_token||s?.access_token)}
function srAllowRemoval(){return srExplicitLogout||/type=recovery/.test(location.hash)||new URLSearchParams(location.search).get('password')==='changed'}
Storage.prototype.removeItem=function(key){
  if(this===localStorage&&key===SR_KEY&&srHasSession()&&!srAllowRemoval())return;
  return srOriginalRemove.call(this,key);
};
document.addEventListener('click',e=>{if(e.target.closest('#logoutBtn'))srExplicitLogout=true},true);
window.__KPTU_SESSION_GUARD__={
  hasSession:srHasSession,
  allowExplicitLogout(){srExplicitLogout=true}
};
