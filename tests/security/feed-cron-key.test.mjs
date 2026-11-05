// NEWS-전면개편 P1c: outside-feed·news-feed 예약 입구의 DB 예약 열쇠 지문(app_cron_keys) 확인.
// 지금 비밀값 길은 그대로, 지문 길이 하나 더. 둘 중 하나 맞으면 통과, 지문 행이 없거나 표를 못 읽으면 지문 길만 실패.
// 네트워크 없음: Supabase는 지어낸 응답이다(synthetic 주소). 값·지문은 모두 지어낸 것이다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const K=await import('../../supabase/functions/_shared/cron-key.ts');
const O=await import('../../supabase/functions/outside-feed/handler.ts');
const N=await import('../../supabase/functions/news-feed/handler.ts');

const SB='https://synthetic.supabase.test',SERVICE='synthetic-service-role-key';
const DB_KEY='synthetic-db-made-cron-key-'+'0123456789abcdef'.repeat(3);
const SHA=createHash('sha256').update(DB_KEY).digest('hex');
const OUT_SECRET='synthetic-outside-feed-cron-secret-0123456789',NEWS_SECRET='synthetic-news-feed-cron-secret-0123456789abc';

const res=(v,s=200)=>new Response(v===null?null:JSON.stringify(v),{status:s,headers:{'content-type':'application/json'}});

// keyTable: 'row'(지문 1줄) | 'none'(빈 표) | 'missing'(표 없음 404) | 'error'(500) | 'throw'(연결 실패) | 'badjson' | 'badsha' | 'two' | 'upper'
function world({keyTable='row',env={}}={}){
 const calls=[],logs=[];
 const doFetch=async(url,init={})=>{
  const u=new URL(url);calls.push({url:u.href,method:init.method??'GET',headers:init.headers});
  if(u.origin!==SB)return new Response('',{status:404});
  const p=u.pathname.replace('/rest/v1/','');
  if(p==='app_cron_keys'){
   assert.equal(init.method??'GET','GET');
   assert.equal(u.searchParams.get('name'),'eq.web2_feed_cron');
   assert.equal(u.searchParams.get('select'),'secret_sha256');
   assert.equal(init.headers.Authorization,`Bearer ${SERVICE}`,'service role로만 읽음');
   if(keyTable==='row')return res([{secret_sha256:SHA}]);
   if(keyTable==='none')return res([]);
   if(keyTable==='missing')return res({code:'PGRST205'},404);
   if(keyTable==='error')return res({},500);
   if(keyTable==='throw')throw new TypeError('synthetic network down');
   if(keyTable==='badjson')return new Response('{not json',{status:200});
   if(keyTable==='badsha')return res([{secret_sha256:'xyz'}]);
   if(keyTable==='upper')return res([{secret_sha256:SHA.toUpperCase()}]);
   if(keyTable==='two')return res([{secret_sha256:SHA},{secret_sha256:SHA}]);
  }
  if((init.method??'GET')==='GET')return res([]);
  return res(null,204);
 };
 const base={SUPABASE_URL:SB,SUPABASE_SERVICE_ROLE_KEY:SERVICE,OUTSIDE_FEED_CRON_SECRET:OUT_SECRET,NEWS_FEED_CRON_SECRET:NEWS_SECRET,...env};
 const envFn=n=>base[n]===null?undefined:base[n];
 const deps={env:envFn,fetch:doFetch,now:()=>Date.parse('2026-11-06T00:00:00Z'),sleep:async()=>{},log:(code,detail)=>logs.push(JSON.stringify({code,...(detail??{})}))};
 const keyReads=()=>calls.filter(c=>c.url.includes('/rest/v1/app_cron_keys')).length;
 return {outside:O.createOutsideFeedHandler(deps),news:N.createNewsFeedHandler(deps),calls,logs,keyReads,doFetch};
}
const FNS=[
 {name:'outside-feed',pick:w=>w.outside,header:O.CRON_HEADER,secret:OUT_SECRET,url:'https://synthetic.supabase.test/functions/v1/outside-feed'},
 {name:'news-feed',pick:w=>w.news,header:N.CRON_HEADER,secret:NEWS_SECRET,url:'https://synthetic.supabase.test/functions/v1/news-feed'},
];
const cronReq=(f,value,extra={})=>new Request(`${f.url}?action=run_plan`,{method:'POST',headers:{[f.header]:value,'content-type':'application/json',...extra},body:'{}'});
const status=async(w,f,req)=>(await f.pick(w)(req)).status;

test('shared module: match, wrong, short/long, no row, read failures, bad shape → only exact fingerprint passes',async()=>{
 const deps=w=>({sb:SB,serviceKey:SERVICE,doFetch:w.doFetch});
 let w=world();
 assert.equal(await K.cronKeyMatches(DB_KEY,deps(w)),true);
 assert.equal(await K.cronKeyMatches(DB_KEY+'x',deps(w)),false,'wrong value');
 assert.equal(await K.cronKeyMatches(DB_KEY.slice(0,-1)+'X',deps(w)),false,'same length, one char differs');
 const reads=w.keyReads();
 assert.equal(await K.cronKeyMatches('short-value',deps(w)),false,'shorter than 32 chars');
 assert.equal(await K.cronKeyMatches('a'.repeat(4097),deps(w)),false,'longer than 4096 chars');
 assert.equal(await K.cronKeyMatches(null,deps(w)),false);
 assert.equal(await K.cronKeyMatches('',deps(w)),false);
 assert.equal(w.keyReads(),reads,'length-rejected values never read the table');
 assert.equal(await K.cronKeyMatches(DB_KEY,deps(w),'not-a-web2-name'),false,'bad key name refused');
 assert.equal(await K.cronKeyMatches(DB_KEY,{sb:'http://insecure.test',serviceKey:SERVICE,doFetch:w.doFetch}),false,'non-https store');
 assert.equal(await K.cronKeyMatches(DB_KEY,{sb:SB,serviceKey:'',doFetch:w.doFetch}),false,'no service key');
 for(const keyTable of ['none','missing','error','throw','badjson','badsha','two','upper']){
  w=world({keyTable});
  assert.equal(await K.cronKeyMatches(DB_KEY,deps(w)),false,keyTable);
 }
});

for(const f of FNS){
 test(`${f.name}: DB fingerprint opens the cron entry; current secret still works without reading the table`,async()=>{
  let w=world();
  assert.equal(await status(w,f,cronReq(f,f.secret)),200,'current secret');
  assert.equal(w.keyReads(),0,'current secret path does not read app_cron_keys');
  assert.equal(await status(w,f,cronReq(f,DB_KEY)),200,'DB fingerprint');
  assert.equal(w.keyReads(),1);
  // 지금 비밀값이 없어도(Edge 비밀값 지움) 지문 길은 된다.
  w=world({env:{[f.name==='news-feed'?'NEWS_FEED_CRON_SECRET':'OUTSIDE_FEED_CRON_SECRET']:null}});
  assert.equal(await status(w,f,cronReq(f,DB_KEY)),200,'fingerprint alone');
 });

 test(`${f.name}: wrong values, no row, unreadable table → 401; current secret unaffected`,async()=>{
  let w=world();
  assert.equal(await status(w,f,cronReq(f,DB_KEY+'x')),401,'wrong value');
  assert.equal(await status(w,f,cronReq(f,'short')),401,'short value');
  assert.equal(await status(w,f,cronReq(f,'a'.repeat(5000))),401,'too long value');
  for(const keyTable of ['none','missing','error','throw','badjson','badsha','two']){
   w=world({keyTable});
   assert.equal(await status(w,f,cronReq(f,DB_KEY)),401,`fingerprint path fails: ${keyTable}`);
   assert.equal(await status(w,f,cronReq(f,f.secret)),200,`current secret still works: ${keyTable}`);
  }
  // 둘 다 없음: 비밀값도 없고 지문 행도 없음.
  w=world({keyTable:'none',env:{OUTSIDE_FEED_CRON_SECRET:null,NEWS_FEED_CRON_SECRET:null}});
  assert.equal(await status(w,f,cronReq(f,DB_KEY)),401,'neither key configured');
  assert.equal(await status(w,f,cronReq(f,f.secret)),401,'removed secret no longer works');
 });

 test(`${f.name}: mixing keys stays 401 and the user entry never reads app_cron_keys`,async()=>{
  const w=world();
  assert.equal(await status(w,f,cronReq(f,DB_KEY,{authorization:'Bearer synthetic.user.jwt-owner-0001'})),401,'cron + login together');
  assert.equal(await status(w,f,cronReq(f,DB_KEY,{'x-drive-summary-cron-secret':DB_KEY})),401,'foreign secret header');
  if(f.name==='news-feed')assert.equal(await status(w,f,cronReq(f,DB_KEY,{'x-outside-feed-cron-secret':DB_KEY})),401,'outside header on news-feed');
  // 다른 함수의 비밀값은 이 함수 입구를 못 연다.
  const other=FNS.find(x=>x!==f);
  assert.equal(await status(w,f,cronReq(f,other.secret)),401,'other function secret');
  // 예약 열쇠로 화면 입구 action은 안 된다(400 그대로).
  const r=await f.pick(w)(new Request(`${f.url}?action=catalog`,{method:'POST',headers:{[f.header]:DB_KEY,'content-type':'application/json'},body:'{}'}));
  assert.equal(r.status,400);
  const before=w.keyReads();
  await f.pick(w)(new Request(`${f.url}?action=catalog`,{method:'POST',headers:{authorization:'Bearer synthetic.user.jwt-owner-0001','content-type':'application/json'},body:'{}'}));
  assert.equal(w.keyReads(),before,'login entry does not touch the fingerprint table');
 });

 test(`${f.name}: logs never carry the header value or the fingerprint`,async()=>{
  for(const keyTable of ['row','none','error','badsha']){
   const w=world({keyTable});
   await f.pick(w)(cronReq(f,DB_KEY));
   await f.pick(w)(cronReq(f,DB_KEY+'x'));
   const all=w.logs.join('\n');
   assert.ok(!all.includes(DB_KEY)&&!all.includes(SHA)&&!all.includes(SHA.slice(0,16)),keyTable);
  }
 });
}
