// 로그인 세션은 runtime-client.js(KPTURuntime.session) 한 곳에서 읽는다.
function srRead(){return window.KPTURuntime?.session?.read?.()||null}
function srHasSession(){const s=srRead();return !!(s?.refresh_token||s?.access_token)}
window.__KPTU_SESSION_GUARD__={
  hasSession:srHasSession,
  allowExplicitLogout(){}
};
