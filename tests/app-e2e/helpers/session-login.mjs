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
    // 이동은 이 evaluate가 답을 돌려준 다음 차례에 한다: 같은 차례에 location.replace를 부르면 바쁜 러너에서 답이 오기 전에 페이지가 바뀌어
    // 'Execution context was destroyed'로 깨졌다(LAYOUT-폭별검사 반복 실행에서 300번 중 2번). replace는 그대로라 로그인 화면은 방문 기록에 남지 않는다.
    setTimeout(()=>location.replace(target));
  },email);
}
