// 일회용 조사 4차(S47-31). GET만, 비밀값 없음.
const UA="Web2OutsideFeed/1.0 (+https://github.com/mj880616/work/blob/main/docs/design/outside-statements.md)";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function get(url){try{const r=await fetch(url,{headers:{"User-Agent":UA,Accept:"text/html","Accept-Language":"ko,en;q=0.8"},redirect:"manual",signal:AbortSignal.timeout(20000)});const buf=new Uint8Array(await r.arrayBuffer());await sleep(1500);return {status:r.status,loc:r.headers.get("location"),bytes:buf.byteLength,text:new TextDecoder("utf-8").decode(buf)};}catch(e){await sleep(1500);return {err:String(e)};}}
{const u="https://platformc.kr/";const r=await get(u);console.log(`GET ${u} ${r.status} ${r.bytes}`);const t=r.text||"";
 const re=/<a\b[^>]*href="(\/\d{4}\/\d{2}\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;let n=0;for(const m of t.matchAll(re)){if(n++>=4)break;console.log(`A ${JSON.stringify(m[0].slice(0,900))}`);}
 const all=[...t.matchAll(re)];const withText=all.filter(m=>m[2].replace(/<[^>]*>/g,"").trim());console.log(`anchors=${all.length} withText=${withText.length}`);
 for(const m of withText.slice(0,3))console.log(`T ${JSON.stringify(m[0].slice(0,1200))}`);}
{const u="https://jinboparty.com/pages/?p=15&b=b_1_2&bn=18655&m=read";const r=await get(u);console.log(`GET ${u} ${r.status} ${r.bytes} loc=${r.loc}`);const t=r.text||"";const i=t.indexOf("배우자의 명품");console.log(`title@${i} ${JSON.stringify(t.slice(Math.max(0,i-300),i+800))}`);}
{const u="https://jinboparty.com/pages/?p=286&b=b_1_111&bn=18659&m=read";const r=await get(u);console.log(`GET ${u} ${r.status} ${r.bytes} loc=${r.loc}`);const t=r.text||"";const i=t.indexOf("민생회복 시민대회");console.log(`title@${i}`);}
