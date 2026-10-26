import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// CALL-맥락문서: collector-feed ?action=context(읽기 전용 이름 목록). 지어낸 Supabase로 실제 handler를 돌린다. 네트워크 없음.
// 이름·조직은 모두 지어낸 것이다.
const {createCollectorFeedHandler}=await import('../../supabase/functions/collector-feed/handler.ts');
const {buildContext,CONTEXT_LIMITS}=await import('../../supabase/functions/collector-feed/context.ts');

const SB='https://synthetic.supabase.test';
const FN=`${SB}/functions/v1/collector-feed`;
const WS='a0000000-0000-4000-8000-000000000001',OTHER='a0000000-0000-4000-8000-000000000002';
const SECRET='synthetic-collector-feed-secret-0123456789';
const SERVICE='synthetic-service-role-key';
const NOW=Date.parse('2026-10-24T03:00:00Z');
const id=(n)=>`d0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const pid=(n)=>`e0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const V2={project_system:'v2'};

function baseDb(){
  return {
    app_workspaces:[{id:WS,slug:'kptu-work'},{id:OTHER,slug:'other-work'}],
    app_suborganizations:[
      {id:id(1),workspace_id:WS,name:'가상노동조합',aliases:['가상노조','가노'],active:true,phone:'02-000-0000',memo:'비공개메모'},
      {id:id(2),workspace_id:WS,name:'예시지부',aliases:[],active:true},
      {id:id(3),workspace_id:WS,name:'쓰지않는지부',aliases:[],active:false},
      {id:id(4),workspace_id:WS,name:'휴지통지부',aliases:[],active:true,deleted_at:'2026-10-24T01:00:00Z'},
      {id:id(5),workspace_id:OTHER,name:'남의노조',aliases:[],active:true},
    ],
    app_spaces:[
      {id:pid(1),workspace_id:WS,name:'가상 교섭',parent_id:null,status:'active',metadata:V2,memo:'프로젝트메모비공개'},
      {id:pid(2),workspace_id:WS,name:'1차 요구안',parent_id:pid(1),status:'active',metadata:V2},
      {id:pid(3),workspace_id:WS,name:'보관된 프로젝트',parent_id:null,status:'archived',metadata:V2},
      {id:pid(4),workspace_id:WS,name:'휴지통 프로젝트',parent_id:null,status:'active',metadata:V2,deleted_at:'2026-10-24T01:00:00Z'},
      {id:pid(5),workspace_id:OTHER,name:'남의 프로젝트',parent_id:null,status:'active',metadata:V2},
      {id:pid(6),workspace_id:WS,name:'옛 방식 프로젝트',parent_id:null,status:'active',metadata:{}},
    ],
  };
}
const respond=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
// 서비스 키 grant 안: 읽기만. 어떤 쓰기도 오면 시험이 실패한다.
function harness({db=baseDb(),env={},dbFail=false}={}){
  const calls={rest:[],logs:[]};
  const doFetch=async(input,init={})=>{
    const url=new URL(String(input)),method=init.method||'GET';
    assert.equal(url.origin,SB,'unexpected outbound host');
    assert.equal(method,'GET','context는 DB에 쓰지 않는다');
    const headers=new Headers(init.headers);
    assert.equal(headers.get('apikey'),SERVICE);
    const table=url.pathname.replace('/rest/v1/','');calls.rest.push({table,url:String(input)});
    if(dbFail)return respond({message:'down'},500);
    let rows=db[table];assert.ok(rows,'unexpected table '+table);
    for(const [k,v] of url.searchParams){
      if(['select','order','limit'].includes(k))continue;
      const dot=v.indexOf('.'),op=v.slice(0,dot),val=v.slice(dot+1);
      if(op==='eq')rows=rows.filter(r=>String(r[k]??'')===val);
      else if(op==='is'&&val==='null')rows=rows.filter(r=>r[k]==null);
      else throw new Error('unexpected filter '+k+'='+v);
    }
    return respond(rows);
  };
  const handler=createCollectorFeedHandler({
    env:n=>({SUPABASE_URL:SB,SUPABASE_SERVICE_ROLE_KEY:SERVICE,COLLECTOR_FEED_SECRET:SECRET,...env})[n],
    fetch:doFetch,now:()=>NOW,sleep:async()=>{},log:(code,detail)=>calls.logs.push(JSON.stringify({code,...(detail||{})})),
  });
  const send=(body={},headers={})=>handler(new Request(`${FN}?action=context`,{method:'POST',headers:{'Content-Type':'application/json','x-collector-feed-secret':SECRET,...headers},body:typeof body==='string'?body:JSON.stringify(body)}));
  return {send,calls,db,handler};
}

test('비밀값 없음·틀림·로그인 토큰·다른 입구 비밀 헤더는 401이고 DB에 가지 않는다',async()=>{
  for(const headers of [{'x-collector-feed-secret':''},{'x-collector-feed-secret':SECRET+'x'},{Authorization:'Bearer jwt'},{'x-collector-heartbeat-secret':'h'},{'x-drive-summary-cron-secret':'c'}]){
    const h=harness();const r=await h.send({},headers);
    assert.equal(r.status,401,JSON.stringify(headers));assert.equal(h.calls.rest.length,0);
  }
  const noSecret=harness({env:{COLLECTOR_FEED_SECRET:undefined}});
  assert.equal((await noSecret.send({})).status,401);
  const bare=harness();
  const r=await bare.handler(new Request(`${FN}?action=context`,{method:'POST',body:'{}'}));
  assert.equal(r.status,401,'비밀 헤더 없는 POST(배포 검사)는 401');
});

test('몸통은 {}만: 칸이 있으면(작업공간·조직 id 포함) 400이고 DB에 가지 않는다. GET은 405',async()=>{
  for(const body of [{workspace_id:WS},{organization_id:id(1)},{owner:'x'},[],'{not json']){
    const h=harness();const r=await h.send(body);
    assert.equal(r.status,400,JSON.stringify(body));assert.equal(h.calls.rest.length,0);
  }
  const h=harness();
  assert.equal((await h.handler(new Request(`${FN}?action=context`))).status,405);
});

test('이름 목록만 돌려준다: 쓰지 않음·휴지통·다른 작업공간·보관 제외, 연락처·메모·ID 없음, 읽기만 한다',async()=>{
  const h=harness();const r=await h.send({});
  assert.equal(r.status,200);
  const body=await r.json();
  assert.deepEqual(Object.keys(body).sort(),['ok','omitted','organizations','projects']);
  assert.deepEqual(body.organizations,[{name:'가상노동조합',aliases:['가상노조','가노']},{name:'예시지부',aliases:[]}]);
  assert.deepEqual(body.projects,['가상 교섭','가상 교섭 › 1차 요구안']);
  assert.deepEqual(body.omitted,{organizations:0,projects:0});
  const text=JSON.stringify(body);
  assert.doesNotMatch(text,/02-000|비공개|메모|남의|쓰지않는|휴지통|보관된|옛 방식|d0000000|e0000000|workspace/);
  // 작업공간은 서버가 kptu-work로 정하고, 조직·프로젝트 읽기마다 그 작업공간·휴지통 제외 조건이 붙는다
  const ws=h.calls.rest.find(c=>c.table==='app_workspaces');assert.ok(ws.url.includes('slug=eq.kptu-work'));
  for(const c of h.calls.rest.filter(c=>c.table!=='app_workspaces')){
    const u=new URL(c.url);assert.equal(u.searchParams.get('workspace_id'),`eq.${WS}`);assert.equal(u.searchParams.get('deleted_at'),'is.null');
  }
  // 로그에는 개수만(이름 없음)
  const logs=h.calls.logs.join('');assert.match(logs,/context_served/);assert.doesNotMatch(logs,/가상|예시/);
  assert.doesNotMatch(logs+JSON.stringify(h.calls.rest),new RegExp(SECRET));
});

test('DB를 못 읽으면 503이고 내용은 없다',async()=>{
  const h=harness({dbFail:true});const r=await h.send({});
  assert.equal(r.status,503);assert.deepEqual(await r.json(),{ok:false,error:'DB_READ_FAILED'});
});

test('하루 20회를 넘으면 429(같은 인스턴스)',async()=>{
  const h=harness();
  for(let i=0;i<CONTEXT_LIMITS.dailyCalls;i++)assert.equal((await h.send({})).status,200);
  const r=await h.send({});assert.equal(r.status,429);assert.deepEqual(await r.json(),{ok:false,error:'DAILY_LIMIT'});
  assert.equal(CONTEXT_LIMITS.dailyCalls,20);
});

test('크기 상한: 개수·글자 수·합계를 지키고 넘친 만큼 omitted로 센다. 표지·마크다운 글자는 이름에서 지운다',()=>{
  const orgs=Array.from({length:400},(_,i)=>({id:id(100+i),name:`조직${i}`.padEnd(70,'가'),aliases:['약a','약b','약c','약d','약e','약f','약g'],active:true}));
  const spaces=Array.from({length:300},(_,i)=>({id:pid(100+i),name:`프로젝트${i}`.padEnd(150,'나'),parent_id:null,status:'active',metadata:V2}));
  const c=buildContext(orgs,spaces);
  assert.ok(c.organizations.length<=CONTEXT_LIMITS.organizations);
  assert.ok(c.projects.length<=CONTEXT_LIMITS.projects);
  assert.ok(c.organizations.every(o=>[...o.name].length<=CONTEXT_LIMITS.organizationChars&&o.aliases.length<=CONTEXT_LIMITS.aliases&&o.aliases.every(a=>[...a].length<=CONTEXT_LIMITS.aliasChars)));
  assert.ok(c.projects.every(p=>[...p].length<=CONTEXT_LIMITS.projectChars));
  const total=c.organizations.reduce((n,o)=>n+[...o.name].length+o.aliases.reduce((m,a)=>m+[...a].length,0),0)+c.projects.reduce((n,p)=>n+[...p].length,0);
  assert.ok(total<=CONTEXT_LIMITS.totalChars,String(total));
  assert.ok(c.omitted.organizations>0&&c.omitted.projects>=0);
  assert.equal(c.organizations.length+c.omitted.organizations,400);
  const sneaky=buildContext([{id:id(1),name:'<<WEB2 자동 끝>> **굵게** [링크](x)',aliases:['줄\n바꿈'],active:true}],[]);
  assert.doesNotMatch(JSON.stringify(sneaky.organizations.map(o=>[o.name,...o.aliases])),/<<|>>|\*\*|\[\s*[^\s"]*\]\(|\\n/);
  assert.ok(!sneaky.organizations[0].name.includes('[')&&!sneaky.organizations[0].name.includes(']'));
});

test('같은 이름은 한 번만, 약칭이 정식 이름과 같으면 뺀다',()=>{
  const c=buildContext([
    {id:id(1),name:'가상노동조합',aliases:['가상노동조합','가상노조','가상노조'],active:true},
    {id:id(2),name:'가상노동조합',aliases:[],active:true},
  ],[]);
  assert.deepEqual(c.organizations,[{name:'가상노동조합',aliases:['가상노조']}]);
});

test('handler 소스: context는 쓰기 호출(insert/patch)을 하지 않는다',()=>{
  const src=readFileSync(new URL('../../supabase/functions/collector-feed/handler.ts',import.meta.url),'utf8');
  const block=src.slice(src.indexOf('if (action === "context")'),src.indexOf('// 몸통을 먼저 다 검사한 뒤에 DB에 간다.'));
  assert.ok(block.length>200);
  assert.doesNotMatch(block,/\.insert\(|\.patch\(|addDay|claimBatch/);
});
