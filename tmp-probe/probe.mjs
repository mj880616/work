// 일회용 조사 3차(S47-31). GET만, 비밀값 없음.
const UA="Web2OutsideFeed/1.0 (+https://github.com/mj880616/work/blob/main/docs/design/outside-statements.md)";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function get(url,accept="text/html"){
  try{const r=await fetch(url,{headers:{"User-Agent":UA,Accept:accept,"Accept-Language":"ko,en;q=0.8"},redirect:"manual",signal:AbortSignal.timeout(20000)});
    const buf=new Uint8Array(await r.arrayBuffer());await sleep(1500);
    return {status:r.status,loc:r.headers.get("location"),ct:r.headers.get("content-type"),bytes:buf.byteLength,text:new TextDecoder("utf-8").decode(buf)};
  }catch(e){await sleep(1500);return {err:`${e.name}: ${e.message} ${e.cause?.code??""}`};}
}
const line=(u,r)=>console.log(`  GET ${u}: ${r.err??`${r.status} loc=${r.loc} ct=${r.ct} bytes=${r.bytes}`}`);
for(const u of ["https://jinboparty.com/pages/?p=15&b=b_1_2","https://jinboparty.com/pages/?p=286&b=b_1_111"]){
  const r=await get(u);line(u,r);if(!r.text)continue;const t=r.text;
  let i=t.indexOf("function js_board_view");if(i<0)i=t.indexOf("js_board_view =");console.log(`  fn@${i}: ${JSON.stringify(t.slice(i,i+600))}`);
  const j=t.indexOf("javascript:js_board_view(");console.log(`  anchor: ${JSON.stringify(t.slice(Math.max(0,j-500),j+900))}`);
  const srcs=[...t.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m=>m[1]);console.log(`  script srcs: ${srcs.join(" ")}`);
  const ids=[...t.matchAll(/js_board_view\('(\d+)'\)/g)].map(m=>m[1]);console.log(`  ids=${ids.length} uniq=${new Set(ids).size}`);
}
// js_board_view가 외부 파일에 있으면 그 파일에서 찾는다.
for(const u of ["https://jinboparty.com/js/board.js","https://jinboparty.com/pages/js/board.js","https://jinboparty.com/js/common.js"]){const r=await get(u,"*/*");line(u,r);if(r.text&&r.status===200){const i=r.text.indexOf("js_board_view");console.log(`   @${i} ${JSON.stringify(r.text.slice(Math.max(0,i-100),i+500))}`);}}
console.log("== platformc");
for(const u of ["https://platformc.kr/","https://platformc.kr/readings?page=2"]){const r=await get(u);line(u,r);if(r.text){const d=[...new Set([...r.text.matchAll(/href="(\/\d{4}\/\d{2}\/[^"]+)"/g)].map(m=>m[1]))];console.log(`   dated uniq=${d.length} first=${d.slice(0,5).join(" ")}`);}}
console.log("== laborparty");
{const r=await get("https://www.laborparty.kr/robots.txt","text/plain");line("www robots",r);console.log(`   ${JSON.stringify((r.text||"").slice(0,160))}`);}
{const r=await get("https://www.laborparty.kr/?page_id=13642");line("www list",r);console.log(`   ${JSON.stringify((r.text||"").slice(0,160))}`);}
