// Test-only sign-in. The Web2 login screen has only the Google button, so tests start a
// session the way the Google return does: a session object is written through the runtime
// session store (here taken from the fixture's mocked token response), then the login
// page's own "already signed in" path returns to the requested screen.
export async function signInWithSession(page,email='qa@example.org'){
  await page.waitForFunction(()=>location.pathname.endsWith('/app/login/')&&!!window.KPTUAuth&&!!window.KPTURuntime&&!!document.querySelector('#googleLoginBtn'));
  await page.evaluate(async address=>{
    const {url,key}=window.KPTURuntime.config;
    const response=await fetch(url+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify({email:address,password:'fixture'}),cache:'no-store'});
    const data=await response.json();
    data.expires_at=data.expires_at||Math.floor(Date.now()/1000)+(data.expires_in||3600);
    window.KPTURuntime.session.write(data);
    const target=window.KPTUAuth.safeReturn(new URLSearchParams(location.search).get('return'));
    // 이동은 이 호출이 값을 돌려준 다음 틱에 한다 — 같은 호출 안에서 바로 이동하면 이동이 먼저 확정될 때
    // 'Execution context was destroyed'로 호출 자체가 실패한다(STAB-로그인이동경합, 시험이 겹쳐 돌 때 간헐).
    setTimeout(()=>location.replace(target),0);
  },email);
}
