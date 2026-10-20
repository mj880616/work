// Test-only sign-in. The Web2 login screen has only the Google button, so tests start a
// session the way the Google return does: a session object is written through the runtime
// session store (here taken from the fixture's mocked token response), then the login
// page's own "already signed in" path returns to the requested screen.
export async function signInWithSession(page,email='qa@example.org'){
  await page.evaluate(async address=>{
    const {url,key}=window.KPTURuntime.config;
    const response=await fetch(url+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify({email:address,password:'fixture'}),cache:'no-store'});
    const data=await response.json();
    data.expires_at=data.expires_at||Math.floor(Date.now()/1000)+(data.expires_in||3600);
    window.KPTURuntime.session.write(data);
    const target=window.KPTUAuth.safeReturn(new URLSearchParams(location.search).get('return'));
    location.replace(target);
  },email);
}
