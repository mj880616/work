import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as tick} from 'node:timers/promises';

// S54-16: 공용 바깥 읽기(feed-fetch)의 요청 간격은 출처(사이트)마다 따로. 같은 사이트는 gapMs 간격 그대로(동시 요청이어도),
// 다른 사이트끼리는 기다리지 않는다. robots.txt는 출처마다 한 번(동시에 물어도 한 번). 네트워크 없음(가짜 fetch).
// S56-12(STAB-외부소식간격시험): 진짜 타이머·Date.now()로 재면 느린 CI에서 이벤트 루프가 잠깐 멈출 때
// 여러 타이머가 같은 차례에 깨어나 시각이 같은 밀리초로 찍히거나 순서가 뒤집혀 간헐 실패했다.
// 그래서 가짜 시계(now·sleep 주입)로 돈다: 시각은 코드가 잡은 차례 그대로라 실행 속도와 상관없이 같은 결과가 나온다.
const {makeFeedReader}=await import('../../supabase/functions/_shared/feed-fetch.ts');

// 가짜 시계: sleep은 '깰 시각'만 적어 두고, run()이 할 일이 다 멈춘 뒤 가장 이른 것부터 시계를 옮기며 깨운다.
function fakeClock(){
 let clock=0;const timers=[];let seq=0;
 const now=()=>clock;
 const sleep=ms=>new Promise(r=>timers.push({at:clock+ms,seq:seq++,r}));
 async function settle(){for(let i=0;i<10;i++)await tick();}
 async function run(promise){
  let done=false;const out=promise.finally(()=>{done=true;});
  for(let guard=0;guard<1000;guard++){
   await settle();
   if(done)break;
   if(!timers.length)throw new Error('멈춤: 깨울 타이머 없이 끝나지 않음');
   timers.sort((x,y)=>x.at-y.at||x.seq-y.seq);
   const t=timers.shift();clock=t.at;t.r();
  }
  return out;
 }
 return {now,sleep,run};
}

function world(gap){
 const c=fakeClock();
 const sent=[];
 const doFetch=async(url)=>{const u=new URL(url);sent.push({origin:u.origin,path:u.pathname,at:c.now()});
  if(u.pathname==='/robots.txt')return new Response('User-agent: *\nDisallow: /private',{status:200,headers:{'content-type':'text/plain'}});
  return new Response('<html><title>x</title></html>',{status:200,headers:{'content-type':'text/html'}});};
 const reader=makeFeedReader({doFetch,sleep:c.sleep,now:c.now,log:()=>{},userAgent:'T',robotsAgent:'T',gapMs:gap,
  allow:raw=>{try{const u=new URL(raw);return /^(a|b)\.example\.test$/.test(u.hostname)&&u.protocol==='https:'?u:null;}catch{return null;}}});
 return {sent,reader,run:c.run};
}

test('same site keeps the gap even when asked at once; other sites do not wait; robots once per site',async()=>{
 const GAP=60;
 const w=world(GAP);
 const got=await w.run(Promise.all([
  w.reader.get('https://a.example.test/1','text/html'),
  w.reader.get('https://a.example.test/2','text/html'),
  w.reader.get('https://b.example.test/1','text/html'),
 ]));
 assert.ok(got.every(g=>g.ok));
 const of=o=>w.sent.filter(s=>s.origin===o);
 const a=of('https://a.example.test'),b=of('https://b.example.test');
 assert.equal(a.filter(s=>s.path==='/robots.txt').length,1,'robots once for a');
 assert.equal(b.filter(s=>s.path==='/robots.txt').length,1,'robots once for b');
 // 가짜 시계라 시각이 정확하다: a는 robots 0 → /1 60 → /2 120, b는 robots 0 → /1 60.
 assert.deepEqual(a.map(s=>[s.path,s.at]),[['/robots.txt',0],['/1',GAP],['/2',2*GAP]],'a gap kept');
 assert.deepEqual(b.map(s=>[s.path,s.at]),[['/robots.txt',0],['/1',GAP]],'b gap kept');
 // b의 기사는 a의 둘째 기사를 기다리지 않는다(사이트가 다르면 겹침).
 const bArticle=b.find(s=>s.path==='/1'),aSecond=a.filter(s=>s.path!=='/robots.txt')[1];
 assert.ok(bArticle.at<aSecond.at,'other site not queued behind a');
 // robots가 막은 경로는 읽지 않는다(규칙 그대로).
 const n=w.sent.length;
 assert.deepEqual(await w.run(w.reader.get('https://a.example.test/private/x','text/html')),{ok:false,code:'robots'});
 assert.equal(w.sent.length,n);
 assert.deepEqual(await w.run(w.reader.get('https://c.example.test/','text/html')),{ok:false,code:'url_outside'});
});

test('asking the same site one after another still keeps the gap',async()=>{
 const GAP=50;
 const w=world(GAP);
 assert.ok((await w.run(w.reader.get('https://a.example.test/1','text/html'))).ok);
 assert.ok((await w.run(w.reader.get('https://a.example.test/2','text/html'))).ok);
 const a=w.sent.filter(s=>s.origin==='https://a.example.test');
 assert.deepEqual(a.map(s=>[s.path,s.at]),[['/robots.txt',0],['/1',GAP],['/2',2*GAP]]);
});
