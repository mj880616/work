// NEWS-전면개편 P2b ②: news-feed가 수집 때 본문 블록을 app_feed_bodies에 넣는다(설계 news-overhaul 4.3·4.7절).
// 네트워크 없음. 사이트·Supabase는 지어낸 응답이다(example.com·합성 글).
import test from 'node:test';
import assert from 'node:assert/strict';

const H=await import('../../supabase/functions/news-feed/handler.ts');
const NOW=Date.parse('2026-11-06T03:00:00Z');
const SB='https://synthetic.supabase.test',SERVICE='synthetic-service-role-key',SECRET='synthetic-news-feed-cron-secret-0123456789abc';
const WS='a0000000-0000-4000-8000-000000000001',WS2='a0000000-0000-4000-8000-000000000002';
const FN=`${SB}/functions/v1/news-feed`;
const LONG='노동자들은 오늘 합성 견본 기사 문단을 차례로 읽는다. 이 문단은 시험용으로 지어낸 글이다. '.repeat(5);
const PAGE=(n)=>`<html><head><meta property="og:title" content="합성 기사 ${n}"></head><body><nav>합성 메뉴</nav>
<article id="article-view-content-div"><p>${LONG}</p><figure class="photo-layout"><img src="/news/photo/${n}.jpg"><figcaption>합성 캡션 ${n}</figcaption></figure><p>${LONG}</p></article></body></html>`;
const ART=n=>`https://www.beminor.com/news/articleView.html?idxno=${n}`;

function world({items=[],sources=[],clockStep=0,sites={}}={}){
 const calls=[],bodies=[];let t=NOW;
 const res=(v,s=200)=>new Response(v===null?null:JSON.stringify(v),{status:s,headers:{'content-type':'application/json'}});
 const doFetch=async(url,init={})=>{
  const u=new URL(url),method=init.method??'GET',body=init.body?JSON.parse(init.body):undefined;
  calls.push({url:u.href,method,body,prefer:init.headers?.Prefer});
  if(u.origin===SB){
   const p=u.pathname.replace('/rest/v1/','');
   if(p==='app_outside_sources')return res(sources);
   if(p==='app_feed_bodies'&&method==='POST'){for(const b of [].concat(body)){const i=bodies.findIndex(x=>x.news_item_id===b.news_item_id);
     if(i<0)bodies.push(b);else if(/merge-duplicates/.test(init.headers.Prefer))bodies[i]=b;}return res(null,201);}
   if(p==='app_news_items'&&method==='GET'){
    const q=u.searchParams;
    if(q.get('app_feed_bodies')==='is.null'){
     const lane=q.get('lane').slice(3),key=q.get('source_key')?.slice(3);
     return res(items.filter(i=>i.lane===lane&&(!key||i.source_key===key)&&!bodies.some(b=>b.news_item_id===i.id)));
    }
    return res([]);
   }
   return res(null,204);
  }
  t+=clockStep;
  const site=sites[u.href];
  if(site===undefined)return new Response('',{status:404});
  return new Response(site.body,{status:site.status??200,headers:{'content-type':site.type??'text/html; charset=utf-8'}});
 };
 const h=H.createNewsFeedHandler({env:n=>({SUPABASE_URL:SB,SUPABASE_SERVICE_ROLE_KEY:SERVICE,NEWS_FEED_CRON_SECRET:SECRET})[n],fetch:doFetch,now:()=>t,sleep:async()=>{},log:()=>{}});
 const cron=async(body)=>{const r=await h(new Request(`${FN}?action=run`,{method:'POST',headers:{[H.CRON_HEADER]:SECRET,'content-type':'application/json'},body:JSON.stringify(body)}));return r.json();};
 return {calls,bodies,cron};
}
const media=(n,ws=WS)=>({id:`c0000000-0000-4000-8000-${String(n).padStart(12,'0')}`,workspace_id:ws,lane:'media',source_key:'news-beminor',url:ART(n),title:`합성 기사 ${n}`,summary:'합성 소개',publisher:'비마이너',published_at:null});

test('media: 피드 읽은 뒤 새 기사마다 글 쪽 1번 → 기사 body full + 블록 줄(사진·캡션), AI·열기 한도 안 씀',async()=>{
 const rss=`<rss><channel><item><title>합성 기사 1</title><link>${ART(1)}</link><description>합성 소개</description></item></channel></rss>`;
 const a=media(1),b={...media(1,WS2),id:'c0000000-0000-4000-8000-000000000101'};
 const w=world({items:[a,b],sources:[{workspace_id:WS,source_key:'news-beminor'},{workspace_id:WS2,source_key:'news-beminor'}],
  sites:{'https://www.beminor.com/rss/allArticle.xml':{body:rss,type:'application/rss+xml'},[ART(1)]:{body:PAGE(1)}}});
 const out=await w.cron({step:'media',source:'news-beminor'});
 assert.equal(out.ok,true);assert.equal(out.bodies,1);assert.equal(out.bodies_deferred,0);
 assert.equal(w.calls.filter(c=>c.url===ART(1)).length,1,'같은 주소는 한 번만 읽음(작업공간 둘)');
 assert.deepEqual(w.bodies.map(x=>[x.workspace_id,x.news_item_id,x.state,x.rule,x.images]).sort(),[[WS,a.id,'ok','news-beminor@2',1],[WS2,b.id,'ok','news-beminor@2',1]].sort());
 const img=w.bodies[0].blocks.find(x=>x.t==='img');assert.deepEqual(img,{t:'img',src:'https://www.beminor.com/news/photo/1.jpg',cap:'합성 캡션 1',alt:null});
 assert.ok(!JSON.stringify(w.bodies).includes('합성 메뉴'));
 const patches=w.calls.filter(c=>c.method==='PATCH'&&c.url.includes('/app_news_items?id=eq.'));
 assert.equal(patches.length,2);assert.ok(patches.every(p=>p.body.body_kind==='full'&&p.body.body===w.bodies[0].blocks.filter(x=>x.t!=='img').map(x=>x.text).join('\n')));
 assert.ok(!w.calls.some(c=>c.url.includes('api.openai.com')),'요약은 P3 — 수집 때 AI 없음');
 assert.ok(!w.calls.some(c=>c.url.includes('/app_news_days')&&c.method!=='GET'),'열기 하루 한도(fetch_n) 안 셈');
 assert.ok(w.calls.filter(c=>c.url.includes('/app_feed_bodies')).every(c=>/on_conflict=news_item_id/.test(c.url)&&/merge-duplicates/.test(c.prefer)));
});

test('media: 시간 예산을 넘으면 멈추고 남은 것은 다음 대기 기사(pending) 일이 읽음, 30건 상한',async()=>{
 const items=Array.from({length:40},(_,i)=>media(i+1));
 const sites=Object.fromEntries(items.map(i=>[i.url,{body:PAGE(1)}]));
 sites['https://www.beminor.com/rss/allArticle.xml']={body:'<rss><channel></channel></rss>',type:'application/rss+xml'};
 const w=world({items,sources:[{workspace_id:WS,source_key:'news-beminor'}],sites,clockStep:H.RUN_BUDGET_MS/5});
 const out=await w.cron({step:'media',source:'news-beminor'});
 assert.ok(out.bodies>=1&&out.bodies<30,`읽은 수 ${out.bodies}`);assert.ok(out.bodies_deferred>0);
 assert.equal(out.bodies+out.bodies_deferred,H.MEDIA_BODY_PER_RUN,'한 번 30건 상한');
 const w2=world({items,sources:[{workspace_id:WS,source_key:'news-beminor'}],sites});
 const p=await w2.cron({step:'pending'});
 assert.equal(p.bodies,H.MEDIA_BODY_PER_RUN);assert.equal(w2.bodies.length,30);
});

test('읽기 실패·허용 밖 주소·키워드(구글 중계)는 블록 없이 까닭 코드만',async()=>{
 const off={...media(7),url:'https://other.example.com/a/7'};
 const down=media(8);
 const w=world({items:[off,down],sources:[{workspace_id:WS,source_key:'news-beminor'}],
  sites:{'https://www.beminor.com/rss/allArticle.xml':{body:'<rss><channel></channel></rss>',type:'application/rss+xml'},[ART(8)]:{body:'',status:503}}});
 await w.cron({step:'media',source:'news-beminor'});
 assert.deepEqual(w.bodies.map(b=>[b.news_item_id,b.state,b.reason,b.blocks.length]).sort(),[[off.id,'failed','off_host',0],[down.id,'failed','http_5xx',0]].sort());
 assert.ok(!w.calls.some(c=>c.url.startsWith('https://other.example.com')),'허용 밖 주소는 요청하지 않음');
 const kw={id:'c0000000-0000-4000-8000-000000000201',workspace_id:WS,lane:'keyword',url:'https://news.google.com/rss/articles/x'};
 const w2=world({items:[kw]});
 const k=await w2.cron({step:'keywords'});
 assert.equal(k.relay,1);assert.deepEqual(w2.bodies.map(b=>[b.state,b.reason,b.rule]),[['failed','relay',null]]);
 assert.ok(!w2.calls.some(c=>c.url.startsWith('https://news.google.com/rss/articles')),'중계 주소는 읽지 않음');
});
