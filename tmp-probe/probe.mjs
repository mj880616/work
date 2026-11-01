// 일회용 조사 2차(S47-31). GET만, 비밀값 없음.
const UA="Web2OutsideFeed/1.0 (+https://github.com/mj880616/work/blob/main/docs/design/outside-statements.md)";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function get(url,accept="text/html"){
  try{const r=await fetch(url,{headers:{"User-Agent":UA,Accept:accept,"Accept-Language":"ko,en;q=0.8"},redirect:"manual",signal:AbortSignal.timeout(20000)});
    const buf=new Uint8Array(await r.arrayBuffer());await sleep(1500);
    return {status:r.status,loc:r.headers.get("location"),ct:r.headers.get("content-type"),cl:r.headers.get("content-length"),bytes:buf.byteLength,text:new TextDecoder("utf-8").decode(buf),server:r.headers.get("server")};
  }catch(e){await sleep(1500);return {err:`${e.name}: ${e.message} ${e.cause?.code??""}`};}
}
const line=(u,r)=>console.log(`  GET ${u}: ${r.err??`${r.status} loc=${r.loc} ct=${r.ct} cl=${r.cl} bytes=${r.bytes} server=${r.server}`}`);
function hrefs(t){return [...t.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)].map(m=>{const h=/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[1]);return [h?(h[1]??h[2]??h[3]):"",m[2].replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().slice(0,70),m[1].replace(/\s+/g," ").slice(0,200)];});}
console.log("== jinboparty 논평 목록");
{const u="https://jinboparty.com/pages/?p=15&b=b_1_2";const r=await get(u);line(u,r);
 if(r.text){const hs=hrefs(r.text);console.log(`  bn/read hrefs: ${hs.filter(([h])=>/bn=|m=read/i.test(h)).length}`);
  for(const [h,t,a] of hs.filter(([h])=>/bn=|m=read/i.test(h)).slice(0,8)) console.log(`   > ${h} :: ${JSON.stringify(t)}`);
  for(const [h,t,a] of hs.filter(([h,t])=>t.length>15).slice(0,30)) console.log(`   ? ${h.slice(0,120)} :: ${JSON.stringify(t)} attrs=${JSON.stringify(a)}`);
  const i=r.text.search(/m=read|bn=|goRead|board_list|bbs_list|list_tit|subject/i);console.log(`  snippet@${i}: ${JSON.stringify(r.text.slice(Math.max(0,i-300),i+700))}`);
  const tr=r.text.search(/<tbody|<ul class="[^"]*list/i);console.log(`  listsnip@${tr}: ${JSON.stringify(r.text.slice(tr,tr+1500))}`);}}
console.log("== platformc");
for(const u of ["https://platformc.kr/readings","https://platformc.kr/sitemap.xml","https://platformc.kr/server-sitemap.xml","https://platformc.kr/sitemap-0.xml"]){const r=await get(u,u.endsWith(".xml")?"application/xml":"text/html");line(u,r);
 if(r.text&&r.status===200){const t=r.text;console.log(`   locs=${(t.match(/<loc>/g)||[]).length} dated=${(t.match(/\/\d{4}\/\d{2}\//g)||[]).length} nextdata=${t.indexOf("__NEXT_DATA__")} rsc=${(t.match(/self\.__next_f/g)||[]).length}`);
  const hs=hrefs(t);console.log(`   anchors=${hs.length}`);for(const [h,tt] of hs.filter(([h])=>/\/\d{4}\/\d{2}\//.test(h)).slice(0,8)) console.log(`   > ${h} :: ${JSON.stringify(tt)}`);
  for(const m of [...t.matchAll(/<loc>([^<]+)<\/loc>/g)].slice(0,15)) console.log(`   loc ${m[1]}`);
  if(!hs.length&&!/<loc>/.test(t)) console.log(`   head ${JSON.stringify(t.slice(0,300))}`);
  const big=[...t.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1].length).sort((a,b)=>b-a).slice(0,5);console.log(`   biggest scripts=${big}`);}}
console.log("== laborparty (목록 한 번, 진단만)");
for(const u of ["https://laborparty.kr/?page_id=13642"]){const r=await get(u);line(u,r);if(r.text)console.log(`   head ${JSON.stringify(r.text.slice(0,200))}`);}
console.log("== socialist 첫 화면");
{const u="http://socialist.kr/";const r=await get(u);line(u,r);if(r.text)console.log(`   head ${JSON.stringify(r.text.slice(0,400))}`);}
