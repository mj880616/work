// 일회용 조사(S47-34). GET만, 비밀값 없음. 실제 parse.ts로 목록·본문 뽑기를 돌려 길이·구조만 찍는다.
import {sourceByKey} from "../supabase/functions/_shared/outside-catalog.ts";
import * as P from "../supabase/functions/outside-feed/parse.ts";
const UA="Web2OutsideFeed/1.0 (+https://github.com/mj880616/work/blob/main/docs/design/outside-statements.md)";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const NOW=Date.now();
async function get(url,accept="text/html"){try{const r=await fetch(url,{headers:{"User-Agent":UA,Accept:accept,"Accept-Language":"ko,en;q=0.8"},redirect:"follow",signal:AbortSignal.timeout(20000)});const buf=new Uint8Array(await r.arrayBuffer());await sleep(2000);return {status:r.status,url:r.url,bytes:buf.byteLength,ct:r.headers.get("content-type"),text:P.decodeBody(buf,r.headers.get("content-type"))};}catch(e){await sleep(2000);return {err:String(e)};}}
const J=s=>JSON.stringify(s);
function classes(html){const m=[...html.matchAll(/\b(?:class|id)\s*=\s*["']([^"']{1,80})["']/g)].map(x=>x[1]);const c={};for(const x of m)c[x]=(c[x]||0)+1;return Object.entries(c).slice(0,400).map(([k,v])=>`${k}:${v}`).join(" | ");}
async function items(key,{pages=2,showStruct=false}={}){
  const s=sourceByKey(key);console.log(`\n===== ${key}`);
  let all=[];
  for(const l of s.lists){const r=await get(l,s.mode==="rss"?"application/rss+xml, application/xml":"text/html");console.log(`LIST ${l} status=${r.status} bytes=${r.bytes} err=${r.err||""}`);if(!r.text)continue;
    const st={candidates:0};const it=s.mode==="rss"?P.parseFeed(s,r.text,NOW,20,st):P.parseListHtml(s,r.text,r.url||l,20,st);console.log(`  parsed=${it.length} candidates=${st.candidates} bot=${P.looksLikeBotCheck(r.text)}`);
    if(!it.length){const hrefs=[...r.text.matchAll(/href\s*=\s*["']([^"']{1,200})["']/g)].map(m=>m[1]).filter(h=>/detail|view|wr_id|idx|uid|bn=|\d{3,}/.test(h)).slice(0,15);console.log(`  hrefs ${J(hrefs)}`);}
    for(const x of it.slice(0,3))console.log(`  item ${J({url:x.url,title:x.title.slice(0,40),kind:x.kind,c:(x.content||"").length,s:(x.summary||"").length,d:x.published_at})}`);
    all=all.concat(it);}
  for(const x of all.slice(0,pages)){const r=await get(x.url);const b=r.text?P.extractBody(r.text,x.title):"";
    console.log(`PAGE ${x.url} status=${r.status} bytes=${r.bytes} final=${r.url} body=${b.length} date=${r.text?P.pageDate(r.text,x.title,NOW):null} article=${/<article\b/i.test(r.text||"")}`);
    console.log(`  head ${J(b.slice(0,160))}`);console.log(`  tail ${J(b.slice(-120))}`);
    if(showStruct&&r.text){console.log(`  CLASSES ${classes(r.text)}`);const t=P.htmlToText(r.text);const i=t.indexOf(x.title.slice(5,20));console.log(`  TEXT@${i} ${J(t.slice(Math.max(0,i-200),i+700))}`);}
  }
}
// 1) robots 확인
for(const o of ["https://socialism.jinbo.net","https://www.kptu.net","https://laborparty.kr","https://jacobin.com","https://labornotes.org","https://www.redpepper.org.uk","https://socialistworker.co.uk"]){const r=await get(o+"/robots.txt","text/plain");console.log(`ROBOTS ${o} ${r.status} ${J((r.text||"").slice(0,600))}`);}
await items("socialism",{pages:3,showStruct:true});
await items("kptu",{pages:2,showStruct:true});
for(const k of ["kctu","kgreens","jinboparty","pssp","platformc","leftall"])await items(k,{pages:2});
for(const k of ["jacobin","labornotes","redpepper","socialistworker"])await items(k,{pages:2,showStruct:false});
// 노동당: 다른 길 찾기(첫 화면의 RSS 안내 링크만 본다)
{const r=await get("https://laborparty.kr/");console.log(`\nLABOR home ${r.status} ${r.bytes}`);const t=r.text||"";console.log(`  alternates ${J([...t.matchAll(/<link\b[^>]*rel=["']alternate["'][^>]*>/gi)].map(m=>m[0]).slice(0,10))}`);console.log(`  feedlinks ${J([...t.matchAll(/href=["']([^"']*(?:feed|rss)[^"']*)["']/gi)].map(m=>m[1]).slice(0,10))}`);}
{const r=await get("https://laborparty.kr/?page_id=13642");const t=r.text||"";console.log(`LABOR list ${r.status} ${r.bytes} rss=${J([...t.matchAll(/href=["']([^"']*(?:rss|feed)[^"']*)["']/gi)].map(m=>m[1]).slice(0,10))}`);}
