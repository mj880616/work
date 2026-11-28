// Test-only sign-in. The Web2 login screen has only the Google button, so tests start a
// session the way the Google return does: a session object is written through the runtime
// session store (here taken from the fixture's mocked token response), then the login
// page's own "already signed in" path returns to the requested screen.
export async function signInWithSession(page,email='qa@example.org'){
  await page.waitForFunction(()=>location.pathname.endsWith('/app/login/')&&!!window.KPTUAuth&&!!window.KPTURuntime&&!!document.querySelector('#googleLoginBtn'));
  const target=await page.evaluate(async address=>{
    const {url,key}=window.KPTURuntime.config;
    const response=await fetch(url+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify({email:address,password:'fixture'}),cache:'no-store'});
    const data=await response.json();
    data.expires_at=data.expires_at||Math.floor(Date.now()/1000)+(data.expires_in||3600);
    window.KPTURuntime.session.write(data);
    return window.KPTUAuth.safeReturn(new URLSearchParams(location.search).get('return'));
  },email);
  // 이동(location.replace — 로그인 화면은 방문 기록에 남지 않음)은 따로 부른다. 이 호출은 페이지를 바꾸므로 바쁜 러너에서는 답이 오기 전에
  // 실행 환경이 사라져 'Execution context was destroyed'가 날 수 있다(LAYOUT-폭별검사 반복 실행에서 300번 중 2번). 그 오류만 '이동함'으로 받는다.
  // 시험 시계(page.clock)를 멈춰 둔 시험도 있어 타이머로 미루지 않는다.
  await page.evaluate(t=>location.replace(t),target).catch(e=>{if(!/Execution context was destroyed|navigat/i.test(e.message))throw e});
}
