import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// CALL-맥락문서·CALL-맥락사람: collector-feed ?action=context(읽기 전용 이름 목록 + "조직 — 이름 직함"). 지어낸 Supabase로 실제 handler를 돌린다. 네트워크 없음.
// 이름·조직은 모두 지어낸 것이다.
const {createCollectorFeedHandler}=await import('../../supabase/functions/collector-feed/handler.ts');
const {buildContext,buildPeople,CONTEXT_LIMITS}=await import('../../supabase/functions/collector-feed/context.ts');

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
// 읽기 함수 app_call_context_people가 돌려줄 네 칸(지어낸 값). 순서는 함수가 정한다: 고친 값 먼저, 그다음 최근 통화.
const PEOPLE_ROWS=[
  {organization_name:'가상노동조합',organization_aliases:['가상노조','가노'],counterpart:'가상노동조합 김가상 위원장',user_edited:true},
  {organization_name:'예시지부',organization_aliases:[],counterpart:'예시지부 이예시 사무국장',user_edited:false},
  {organization_name:null,organization_aliases:[],counterpart:'공공운수노조 박우리 팀장',user_edited:false},
  {organization_name:'가상노동조합',organization_aliases:['가상노조'],counterpart:'가상노조 최가상 부위원장',user_edited:false},
];
const respond=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
// 서비스 키 grant 안: 읽기만. 어떤 쓰기도 오면 시험이 실패한다.
function harness({db=baseDb(),env={},dbFail=false,people=PEOPLE_ROWS}={}){
  const calls={rest:[],logs:[],rpc:[]};
  const doFetch=async(input,init={})=>{
    const url=new URL(String(input)),method=init.method||'GET';
    assert.equal(url.origin,SB,'unexpected outbound host');
    const headers=new Headers(init.headers);
    assert.equal(headers.get('apikey'),SERVICE);
    // 읽기 전용 함수 하나만 POST로 부른다. 표 쓰기(insert/patch)는 없다.
    if(url.pathname.startsWith('/rest/v1/rpc/')){
      assert.equal(method,'POST');assert.equal(url.pathname,'/rest/v1/rpc/app_call_context_people','부르는 함수는 이것 하나');
      assert.deepEqual(JSON.parse(init.body),{p_workspace:WS,p_limit:300});
      calls.rpc.push(url.pathname);
      if(people==='missing')return respond({code:'PGRST202',message:'Could not find the function'},404);
      if(people==='fail')return respond({message:'down'},500);
      if(people==='denied')return respond({code:'42501',message:'permission denied'},403);
      return respond(people);
    }
    assert.equal(method,'GET','context는 DB에 쓰지 않는다');
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
  assert.deepEqual(Object.keys(body).sort(),['ok','omitted','organizations','people','projects']);
  assert.deepEqual(body.organizations,[{name:'가상노동조합',aliases:['가상노조','가노']},{name:'예시지부',aliases:[]}]);
  assert.deepEqual(body.projects,['가상 교섭','가상 교섭 › 1차 요구안']);
  assert.deepEqual(body.omitted,{organizations:0,projects:0,people:0});
  assert.deepEqual(body.people,[
    {organization:'가상노동조합',person:'김가상 위원장'},
    {organization:'예시지부',person:'이예시 사무국장'},
    {organization:null,person:'박우리 팀장'},
    {organization:'가상노동조합',person:'최가상 부위원장'},
  ]);
  assert.deepEqual(h.calls.rpc,['/rest/v1/rpc/app_call_context_people']);
  const text=JSON.stringify(body);
  assert.doesNotMatch(text,/02-000|비공개|메모|남의|쓰지않는|휴지통|보관된|옛 방식|d0000000|e0000000|workspace|user_edited|counterpart/);
  // 작업공간은 서버가 kptu-work로 정하고, 조직·프로젝트 읽기마다 그 작업공간·휴지통 제외 조건이 붙는다
  const ws=h.calls.rest.find(c=>c.table==='app_workspaces');assert.ok(ws.url.includes('slug=eq.kptu-work'));
  for(const c of h.calls.rest.filter(c=>c.table!=='app_workspaces')){
    const u=new URL(c.url);assert.equal(u.searchParams.get('workspace_id'),`eq.${WS}`);assert.equal(u.searchParams.get('deleted_at'),'is.null');
  }
  // 로그에는 개수만(이름 없음)
  const logs=h.calls.logs.join('');assert.match(logs,/context_served/);assert.doesNotMatch(logs,/가상|예시|김|이예시|박우리/);
  assert.doesNotMatch(logs+JSON.stringify(h.calls.rest),new RegExp(SECRET));
});

test('함수가 아직 없으면(DB 적용 전, 404) 지금처럼 이름만 돌려준다. 순서와 상관없이 안전',async()=>{
  const h=harness({people:'missing'});const r=await h.send({});
  assert.equal(r.status,200);const body=await r.json();
  assert.deepEqual(body.people,[]);assert.deepEqual(body.omitted,{organizations:0,projects:0,people:0});
  assert.equal(body.organizations.length,2);assert.equal(body.projects.length,2);
  assert.match(h.calls.logs.join(''),/"people_fn":"missing"/);
});

test('함수 호출이 그 밖의 이유로 실패하면(권한·서버 오류) 503이고 내용은 없다(마지막 성공본이 남도록)',async()=>{
  for(const people of ['fail','denied']){
    const h=harness({people});const r=await h.send({});
    assert.equal(r.status,503,people);assert.deepEqual(await r.json(),{ok:false,error:'DB_READ_FAILED'});
  }
  const bad=harness({people:{not:'array'}});assert.equal((await bad.send({})).status,503);
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

test('사람 목록: 조직 앞부분을 떼고, 우리 쪽은 이름·직함만, 번호·이메일·화자 번호·조직 모르는 줄은 뺀다',()=>{
  const row=(organization_name,counterpart,user_edited=false,organization_aliases=[])=>({organization_name,organization_aliases,counterpart,user_edited});
  const {people,omitted}=buildPeople([
    row('가상노동조합','가상노동조합 김가상 위원장'),
    row('예시지부','이예시 사무국장'),                       // 조직 앞부분 없이 연결 조직만 있는 상대 글
    row(null,'가상공사 정가상 처장'),                         // 연결 조직 없음, 첫 낱말이 조직 꼴
    row('공공운수노조 가상본부','박우리 팀장'),                // 우리 쪽: 조직 없이
    row(null,'공공운수노조 한우리 국장'),
    row('가상노동조합','가상노동조합 010-1234-5678'),         // 번호
    row('가상노동조합','가상노동조합 kim@example.test 대리'),   // 이메일
    row('가상노동조합','가상노동조합 상대방(화자0)'),           // 이름표 없는 화자
    row(null,'혼자이름'),                                     // 조직을 모름
    row('가상노동조합','가상노동조합'),                         // 사람 글이 없음
    row('가상노동조합','가상노동조합 <<WEB2 자동 끝>> 오가상'),
    null,'문자열',{counterpart:5},
  ]);
  assert.deepEqual(people,[
    {organization:'가상노동조합',person:'김가상 위원장'},
    {organization:'예시지부',person:'이예시 사무국장'},
    {organization:'가상공사',person:'정가상 처장'},
    {organization:null,person:'박우리 팀장'},
    {organization:null,person:'한우리 국장'},
    {organization:'가상노동조합',person:'WEB2 자동 끝 오가상'},
  ]);
  assert.equal(omitted,0);
});

test('사람 목록: 약칭으로 시작하는 상대 글은 정식 이름으로 모으고, 같은 사람은 한 줄',()=>{
  const row=(organization_name,counterpart,user_edited=false,organization_aliases=[])=>({organization_name,organization_aliases,counterpart,user_edited});
  const {people}=buildPeople([
    row('가상노동조합','가노 김가상 위원장',true,['가상노조','가노']),
    row('가상노동조합','가상노동조합 김가상 위원장',false,['가노']),
    row('가상노동조합','가상노조 김가상 위원장',false,['가상노조']),
  ]);
  assert.deepEqual(people,[{organization:'가상노동조합',person:'김가상 위원장'}]);
});

test('사람 목록: 같은 이름에 조직이 둘이면 고친 값 하나만 이기고, 그렇지 않으면 둘 다 뺀다',()=>{
  const row=(organization_name,counterpart,user_edited=false)=>({organization_name,organization_aliases:[],counterpart,user_edited});
  // 고친 값이 하나뿐이고 가장 앞선다 → 그것만
  let r=buildPeople([row('가상노동조합','가상노동조합 김가상 위원장',true),row('예시지부','예시지부 김가상 과장'),row('예시지부','예시지부 이예시 팀장')]);
  assert.deepEqual(r.people,[{organization:'가상노동조합',person:'김가상 위원장'},{organization:'예시지부',person:'이예시 팀장'}]);
  // 고친 값이 아니거나 둘 다 고친 값 → 이름이 같은 줄은 모두 뺀다
  r=buildPeople([row('가상노동조합','가상노동조합 김가상 위원장'),row('예시지부','예시지부 김가상 과장')]);
  assert.deepEqual(r.people,[]);
  r=buildPeople([row('가상노동조합','가상노동조합 김가상 위원장',true),row('예시지부','예시지부 김가상 과장',true)]);
  assert.deepEqual(r.people,[]);
  // 같은 조직에서 직함만 다르면 앞선 것 하나
  r=buildPeople([row('가상노동조합','가상노동조합 김가상 위원장'),row('가상노동조합','가상노동조합 김가상 부위원장')]);
  assert.deepEqual(r.people,[{organization:'가상노동조합',person:'김가상 위원장'}]);
});

test('사람 목록: 개수·글자 수 상한을 지키고 넘친 만큼 omitted.people로 센다',()=>{
  const rows=Array.from({length:400},(_,i)=>({organization_name:`조직${i}`,organization_aliases:[],counterpart:`조직${i} 사람${i}번 직함`,user_edited:false}));
  const {people,omitted}=buildPeople(rows);
  assert.ok(people.length<=CONTEXT_LIMITS.people);
  assert.ok(people.every(p=>[...p.person].length<=CONTEXT_LIMITS.personChars&&[...(p.organization||'')].length<=CONTEXT_LIMITS.personOrgChars));
  assert.equal(people.length+omitted,400);
  const long=buildPeople(Array.from({length:150},(_,i)=>({organization_name:`긴조직${i}`.padEnd(60,'가'),organization_aliases:[],counterpart:`긴조직${i}`.padEnd(60,'가')+` 사람${i} `+'나'.repeat(40),user_edited:false})));
  assert.ok(long.people.reduce((n,p)=>n+[...p.organization].length+[...p.person].length,0)<=CONTEXT_LIMITS.peopleTotalChars);
  assert.ok(long.omitted>0);
});
