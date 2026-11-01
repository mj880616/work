// 일회용 조사 2차(S47-34). GET만, 비밀값 없음.
import {sourceByKey} from "../supabase/functions/_shared/outside-catalog.ts";
import * as P from "../supabase/functions/outside-feed/parse.ts";
const UA="Web2OutsideFeed/1.0 (+https://github.com/mj880616/work/blob/main/docs/design/outside-statements.md)";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function get(url){try{const r=await fetch(url,{headers:{"User-Agent":UA,Accept:"text/html","Accept-Language":"ko,en;q=0.8"},redirect:"follow",signal:AbortSignal.timeout(20000)});const buf=new Uint8Array(await r.arrayBuffer());await sleep(2000);return {status:r.status,text:P.decodeBody(buf,r.headers.get("content-type"))};}catch(e){await sleep(2000);return {err:String(e)};}}
const J=s=>JSON.stringify(s);
const strip=h=>h.replace(/<script\b[\s\S]*?<\/script>/gi,"<script/>").replace(/<style\b[\s\S]*?<\/style>/gi,"<style/>").replace(/<svg\b[\s\S]*?<\/svg>/gi,"<svg/>").replace(/\s+/g," ");
function around(h,needle,before=1500,after=2500){const t=strip(h);const i=t.indexOf(needle);return i<0?`(no ${needle})`:t.slice(Math.max(0,i-before),i+after);}
function tagsWithClass(h){return [...strip(h).matchAll(/<(article|main|div|section)\b[^>]*>/gi)].map(m=>m[0].slice(0,140)).filter(x=>/content|body|article|post|entry|view|text|read|board/i.test(x)).slice(0,60);}
// socialism list: 모든 후보 제목
{const s=sourceByKey("socialism");const r=await get(s.lists[0]);const it=P.parseListHtml(s,r.text,s.lists[0],40);console.log("SOC LIST "+J(it.map(x=>x.url.replace(/.*wr_id=/,"")+" "+x.title.slice(0,30))));
 console.log("SOC LISTHTML "+around(r.text,"wr_id=1572",3000,1500));}
{const r=await get("https://socialism.jinbo.net/bbs/board.php?bo_table=news&wr_id=1572");console.log("SOC TAGS "+J(tagsWithClass(r.text)));console.log("SOC BODY "+around(r.text,"news_body_area",800,3000));
 const arts=[...strip(r.text).matchAll(/<article\b[^>]*>/gi)].map(m=>m[0]);console.log("SOC ARTICLES "+J(arts));}
{const r=await get("https://www.kptu.net/board/detail.aspx?mid=F686C1F3&idx=56558");console.log("KPTU BODY "+around(r.text,"publishList_write",1200,3000));
 const l=await get("https://www.kptu.net/board/list.aspx?mid=F686C1F3");console.log("KPTU LIST "+around(l.text,"idx=56558",2500,1500));}
{const r=await get("https://jinboparty.com/pages/?p=15&b=b_1_2&bn=18655&m=read");console.log("JINBO TAGS "+J(tagsWithClass(r.text)));console.log("JINBO BODY "+around(r.text,"등록일",1500,3500));}
{const r=await get("https://jacobin.com/2026/10/trump-netanyahu-iran-post-midterms-escalation");console.log("JAC TAGS "+J(tagsWithClass(r.text)));const arts=[...strip(r.text).matchAll(/<article\b[^>]*>/gi)].map(m=>m[0]);console.log("JAC ARTICLES "+J(arts));console.log("JAC BODY "+around(r.text,"<p",1500,2500));
 console.log("JAC LD "+J((/"articleBody"\s*:\s*"([\s\S]{0,300})/.exec(r.text)||[])[1]||"none"));}
{const r=await get("https://labornotes.org/blogs/2026/10/bottom-organizing-how-we-got-clean-porta-johns");console.log("LN TAGS "+J(tagsWithClass(r.text)));}
