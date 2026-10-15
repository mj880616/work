// HWP-편집기 2단계: the editor runs in a sandboxed frame with an opaque origin, so the browser loads its files
// (module script, stylesheet, WASM, fonts) in CORS mode. GitHub Pages answers every file with
// `Access-Control-Allow-Origin: *` and the Cloudflare Worker passes upstream headers through; the local
// `python3 -m http.server` sends no such header, so the tests add the same header to the editor files only.
export async function servePagesCors(page){
  await page.route(url=>url.pathname.includes('/app/hwp-lab/'),async route=>{
    // A test may end while the editor is still loading files. A file that cannot be served is aborted: a real
    // load failure still fails the test through its "editor ready" check.
    try{
      const response=await route.fetch();
      await route.fulfill({response,headers:{...response.headers(),'access-control-allow-origin':'*'}});
    }catch{await route.abort().catch(()=>{})}
  });
}
