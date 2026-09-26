Deno.serve(async () => {
  const targets = [
    "https://kptu.net/board/list.aspx?mid=F686C1F3",
    "https://kptu.net/board/list.aspx?mid=F686C1F3&page=2",
    "https://kptu.net/board/list.aspx?mid=F686C1F3&page=10"
  ];
  const out:any[] = [];
  for (const url of targets) {
    try {
      const r = await fetch(url, {headers:{"user-agent":"Mozilla/5.0 KPTU-archive-test/1.0"}});
      const body = await r.text();
      const detailMatches = [...body.matchAll(/(?:href=["']?)([^"' >]*detail\.aspx[^"' >]*)/gi)].slice(0,10).map(m=>m[1]);
      const fileHints = [...body.matchAll(/(?:href=["']?)([^"' >]*\.(?:hwp|hwpx|pdf)(?:\?[^"' >]*)?)/gi)].slice(0,10).map(m=>m[1]);
      out.push({url,status:r.status,ok:r.ok,bytes:body.length,detailCount:(body.match(/detail\.aspx/gi)||[]).length,detailSamples:detailMatches,fileSamples:fileHints,title:(body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||null});
    } catch(e) { out.push({url,error:String(e)}); }
  }
  return new Response(JSON.stringify({testedAt:new Date().toISOString(),results:out},null,2),{headers:{"content-type":"application/json; charset=utf-8"}});
});