// 일회용 조사 3차(S47-34): 고친 parse·카탈로그로 실제 목록·글 쪽 확인. GET만, 비밀값 없음.
import {sourceByKey} from "../supabase/functions/_shared/outside-catalog.ts";
import * as P from "../supabase/functions/outside-feed/parse.ts";
const UA="Web2OutsideFeed/1.0 (+https://github.com/mj880616/work/blob/main/docs/design/outside-statements.md)";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const NOW=Date.now();
async function get(url){try{const r=await fetch(url,{headers:{"User-Agent":UA,Accept:"text/html","Accept-Language":"ko,en;q=0.8"},redirect:"follow",signal:AbortSignal.timeout(20000)});const buf=new Uint8Array(await r.arrayBuffer());await sleep(2000);return {status:r.status,url:r.url,text:P.decodeBody(buf,r.headers.get("content-type"))};}catch(e){await sleep(2000);return {err:String(e)};}}
const J=s=>JSON.stringify(s);
for(const [key,n] of [["socialism",4],["kptu",4],["jinboparty",2],["jacobin",2],["kctu",2],["kgreens",1],["pssp",1],["platformc",1],["leftall",1]]){
  const s=sourceByKey(key);console.log(`\n===== ${key}`);let all=[];
  for(const l of s.lists){const r=await get(l);if(!r.text){console.log("LIST fail",r.err);continue;}const st={candidates:0};const it=s.mode==="rss"?P.parseFeed(s,r.text,NOW,20,st):P.parseListHtml(s,r.text,r.url||l,20,st,NOW);
    console.log(`LIST ${l} ${r.status} parsed=${it.length} cand=${st.candidates}`);for(const x of it.slice(0,20))console.log(`  ${x.kind} ${x.published_at||"-"} ${x.url.replace(/^https?:\/\/[^/]+/,"")} ${x.title.slice(0,50)}`);all=all.concat(it);}
  for(const x of all.filter(x=>!(x.content&&x.content.length>=200)).slice(0,n)){const r=await get(x.url);const b=r.text?P.extractBody(r.text,x.title,s.bodyClass):"";console.log(`PAGE ${x.url.replace(/^https?:\/\/[^/]+/,"")} ${r.status} body=${b.length} date=${r.text?P.pageDate(r.text,x.title,NOW):null}`);console.log(`  head ${J(b.slice(0,140))}`);console.log(`  tail ${J(b.slice(-100))}`);}
}
