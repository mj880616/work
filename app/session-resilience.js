const SR_KEY='kptu_collab_session_v1';
function srRead(){try{return JSON.parse(localStorage.getItem(SR_KEY)||'null')}catch{return null}}
function srHasSession(){const s=srRead();return !!(s?.refresh_token||s?.access_token)}
window.__KPTU_SESSION_GUARD__={
  hasSession:srHasSession,
  allowExplicitLogout(){}
};
