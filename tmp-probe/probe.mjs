// 일회용 조사(S47-31): 막힌 단체 목록 주소 구조 확인. GET만, robots.txt 먼저. 운영 DB·비밀값 없음.
const UA="Web2OutsideFeed/1.0 (+https://github.com/mj880616/work/blob/main/docs/design/outside-statements.md)";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function get(url,accept="*/*"){
  try{const r=await fetch(url,{headers:{"User-Agent":UA,Accept:accept,"Accept-Language":"ko,en;q=0.8"},redirect:"manual",signal:AbortSignal.timeout(15000)});
    const buf=new Uint8Array(await r.arrayBuffer());
    return {status:r.status,loc:r.headers.get("location"),ct:r.headers.get("content-type"),cl:r.headers.get("content-length"),bytes:buf.byteLength,text:new TextDecoder("utf-8").decode(buf)};
  }catch(e){return {err:`${e.name}: ${e.message} ${e.cause?.code??""}`};}
}
async function robots(origin){
  const r=await get(origin+"/robots.txt","text/plain");
  console.log(`  robots ${origin}: ${r.err??`${r.status} loc=${r.loc} ct=${r.ct} bytes=${r.bytes}`}`);
  if(r.text&&r.status===200) console.log(r.text.split(/\r?\n/).filter(l=>/agent|allow|disallow|sitemap/i.test(l)).slice(0,40).map(l=>"    | "+l).join("\n"));
  await sleep(1500);
}
async function page(url,{feed=false,hrefRe=null}={}){
  const r=await get(url,feed?"application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9":"text/html, application/xhtml+xml;q=0.9");
  console.log(`  GET ${url}: ${r.err??`${r.status} loc=${r.loc} ct=${r.ct} cl=${r.cl} bytes=${r.bytes}`}`);
  await sleep(1500);
  if(!r.text) return;
  const t=r.text;
  console.log(`    head: ${JSON.stringify(t.slice(0,200))}`);
  const items=[...t.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)];
  if(items.length){console.log(`    items=${items.length}`);
    for(const m of items.slice(0,12)){const ti=/<title[^>]*>([\s\S]*?)<\/title>/i.exec(m[2])?.[1]??"";const li=/<link[^>]*>([\s\S]*?)<\/link>/i.exec(m[2])?.[1]??(/<link\b[^>]*href="([^"]+)"/i.exec(m[2])?.[1]??"");console.log(`    - ${JSON.stringify(ti.slice(0,90))} ${li.slice(0,140)}`);}
  }
  const as=[...t.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)];
  console.log(`    anchors=${as.length} onclick=${(t.match(/onclick=/gi)||[]).length} scripts=${(t.match(/<script/gi)||[]).length}`);
  const hits=as.map(m=>[/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[1]),m]).filter(([h])=>h).map(([h,m])=>[h[1]??h[2]??h[3],m[2].replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().slice(0,60),m[1].slice(0,160)]);
  const sel=hrefRe?hits.filter(([h])=>hrefRe.test(h)):hits.slice(0,0);
  console.log(`    matching hrefs=${sel.length}`);
  for(const [h,txt] of sel.slice(0,15)) console.log(`    > ${h.slice(0,160)} :: ${JSON.stringify(txt)}`);
  if(hrefRe&&!sel.length){ // 링크 대신 무엇이 있는지
    for(const [h,txt,attr] of hits.slice(0,400).filter(([h,txt])=>txt.length>12).slice(0,25)) console.log(`    ? ${h.slice(0,120)} :: ${JSON.stringify(txt)} attrs=${JSON.stringify(attr)}`);
    const snip=/(read|view|bn=|nid=|goView|goRead|fn_|location\.href)/i.exec(t); if(snip) console.log(`    snippet@${snip.index}: ${JSON.stringify(t.slice(Math.max(0,snip.index-200),snip.index+300))}`);
  }
}
console.log("== jinboparty"); await robots("https://jinboparty.com");
await page("https://jinboparty.com/pages/?p=15&b=b_1_2",{hrefRe:/b_1_|bn=|read/i});
await page("https://jinboparty.com/pages/?p=286&b=b_1_111",{hrefRe:/b_1_|bn=|read/i});
console.log("== pssp"); await robots("https://pssp.org"); await robots("https://www.pssp.org");
await page("https://pssp.org/bbs/list.php?board=statement",{hrefRe:/view\.php|nid=/i});
await page("https://www.pssp.org/bbs/list.php?board=statement",{hrefRe:/view\.php|nid=/i});
console.log("== ws"); await robots("https://ws.or.kr");
await page("https://ws.or.kr/feed",{feed:true});
await page("https://ws.or.kr/",{hrefRe:/\/article\/\d+/});
console.log("== socialist"); await robots("http://socialist.kr"); await robots("https://socialist.kr");
await page("http://socialist.kr/feed",{feed:true}); await page("http://socialist.kr/feed/",{feed:true}); await page("https://socialist.kr/feed/",{feed:true});
console.log("== platformc"); await robots("https://platformc.kr");
await page("https://platformc.kr/readings/",{hrefRe:/\/\d{4}\/\d{2}\//});
for(const u of ["https://platformc.kr/feed/","https://platformc.kr/readings/feed/","https://platformc.kr/category/readings/feed/","https://platformc.kr/rss.xml","https://platformc.kr/feed.xml"]) await page(u,{feed:true});
console.log("== laborparty"); await robots("https://laborparty.kr"); await robots("https://www.laborparty.kr");
console.log("== kptu (robots.txt만, 막힌 경로는 열지 않음)"); await robots("https://www.kptu.net"); await robots("https://kptu.net");
