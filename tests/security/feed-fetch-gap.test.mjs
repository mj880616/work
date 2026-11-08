import test from 'node:test';
import assert from 'node:assert/strict';

// S54-16: 공용 바깥 읽기(feed-fetch)의 요청 간격은 출처(사이트)마다 따로. 같은 사이트는 gapMs 간격 그대로(동시 요청이어도),
// 다른 사이트끼리는 기다리지 않는다. robots.txt는 출처마다 한 번(동시에 물어도 한 번). 네트워크 없음(가짜 fetch, 진짜 타이머).
const {makeFeedReader}=await import('../../supabase/functions/_shared/feed-fetch.ts');

function world(gap){
 const sent=[];
 const doFetch=async(url)=>{const u=new URL(url);sent.push({origin:u.origin,path:u.pathname,at:Date.now()});
  if(u.pathname==='/robots.txt')return new Response('User-agent: *\nDisallow: /private',{status:200,headers:{'content-type':'text/plain'}});
  return new Response('<html><title>x</title></html>',{status:200,headers:{'content-type':'text/html'}});};
 const reader=makeFeedReader({doFetch,sleep:ms=>new Promise(r=>setTimeout(r,ms)),log:()=>{},userAgent:'T',robotsAgent:'T',gapMs:gap,
  allow:raw=>{try{const u=new URL(raw);return /^(a|b)\.example\.test$/.test(u.hostname)&&u.protocol==='https:'?u:null;}catch{return null;}}});
 return {sent,reader};
}

test('same site keeps the gap even when asked at once; other sites do not wait; robots once per site',async()=>{
 const GAP=60;
 const w=world(GAP);
 const got=await Promise.all([
  w.reader.get('https://a.example.test/1','text/html'),
  w.reader.get('https://a.example.test/2','text/html'),
  w.reader.get('https://b.example.test/1','text/html'),
 ]);
 assert.ok(got.every(g=>g.ok));
 const of=o=>w.sent.filter(s=>s.origin===o);
 const a=of('https://a.example.test'),b=of('https://b.example.test');
 assert.equal(a.filter(s=>s.path==='/robots.txt').length,1,'robots once for a');
 assert.equal(b.filter(s=>s.path==='/robots.txt').length,1,'robots once for b');
 for(let i=1;i<a.length;i++)assert.ok(a[i].at-a[i-1].at>=GAP-5,`a gap kept (${a[i].at-a[i-1].at}ms)`);
 for(let i=1;i<b.length;i++)assert.ok(b[i].at-b[i-1].at>=GAP-5,'b gap kept');
 // b의 기사는 a의 둘째 기사를 기다리지 않는다(사이트가 다르면 겹침).
 const bArticle=b.find(s=>s.path==='/1'),aSecond=a.filter(s=>s.path!=='/robots.txt')[1];
 assert.ok(bArticle.at<aSecond.at,'other site not queued behind a');
 // robots가 막은 경로는 읽지 않는다(규칙 그대로).
 const n=w.sent.length;
 assert.deepEqual(await w.reader.get('https://a.example.test/private/x','text/html'),{ok:false,code:'robots'});
 assert.equal(w.sent.length,n);
 assert.deepEqual(await w.reader.get('https://c.example.test/','text/html'),{ok:false,code:'url_outside'});
});
