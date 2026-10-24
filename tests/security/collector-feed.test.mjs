import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,copyFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

// CALL·TG 2단계: 실제 collector-feed handler를 지어낸 Supabase(PostgREST + migration 20261024140000 칸별 grant 흉내)와
// 지어낸 OpenAI로 돌린다. 네트워크 없음. 비밀값·열쇠는 고정 가짜 글자. 사람·조직·방·번호는 모두 지어낸 것이다.
const {createCollectorFeedHandler,secretMatches,DAILY_LIMITS,MONTHLY_LIMIT_KRW,SECRET_MIN_CHARS}=
  await import('../../supabase/functions/collector-feed/handler.ts');
const {parseCall,counterpartOf,speakerSplit,transcriptName,parseKstDateTime}=await import('../../supabase/functions/collector-feed/call-analysis.ts');
const {parseTelegram}=await import('../../supabase/functions/collector-feed/telegram.ts');

const SB='https://synthetic.supabase.test';
const FN=`${SB}/functions/v1/collector-feed`;
const WS='a0000000-0000-4000-8000-000000000001',OTHER_WS='a0000000-0000-4000-8000-000000000002';
const ORG='d0000000-0000-4000-8000-000000000001',ORG2='d0000000-0000-4000-8000-000000000002',FOREIGN_ORG='d0000000-0000-4000-8000-000000000003';
const PROJECT='e0000000-0000-4000-8000-000000000001',FOREIGN_PROJECT='e0000000-0000-4000-8000-000000000002';
const NOW=Date.parse('2026-10-24T03:00:00Z'); // 2026-10-24 12:00 KST
const TODAY='2026-10-24';
const SECRET='synthetic-collector-feed-secret-0123456789';
const SERVICE='synthetic-service-role-key';
const FAKE_KEY='synthetic-web2-openai-key';
const RAW_MARK='가상원문표식';

// migration 20261024140000_call_tg_feed.sql 의 service_role 칸 grant(이 표만 흉내낸다).
const GRANTS={
  app_feed_items:{select:['workspace_id','source','source_ref'],insert:['workspace_id','source','day','occurred_at','room_key','room_label','title','summary','points','counterpart','speaker_split','raw_text','raw_count','organization_id','suggested_project_id','source_ref','drive_url','model','judged_at'],update:[]},
  app_feed_days:{select:'*',insert:['workspace_id','day','source','total_count','kept_count','room_count','personal_count','unsure_count','failed_count','batch_count','ai_requests','ai_input_tokens','ai_output_tokens','updated_at'],update:['total_count','kept_count','room_count','personal_count','unsure_count','failed_count','batch_count','ai_requests','ai_input_tokens','ai_output_tokens','updated_at']},
  app_workspaces:{select:'*'},app_suborganizations:{select:'*'},app_spaces:{select:'*'},
};
const COUNTERS=['total_count','kept_count','room_count','personal_count','unsure_count','failed_count','batch_count','ai_requests','ai_input_tokens','ai_output_tokens'];

function analysis({version='3.2',work='업무',title='가상지부 3차 교섭 일정 변경',when='2026-10-24 09:30:00',ref='SRCFAKE0001aa',counterpart='- 이름: 홍길동\n- 직책: 위원장\n- 소속: 가상노조',extraFront='',summary='- 3차 교섭을 10. 28.(화) 14:00로 미루기로 함.\n- 사측 안은 서면으로 받기로 함.'}={}){
  return ['---',`analysis_version: ${version}`,'status: 검토대기','source_type: 통화녹음',`source_txt_id: ${ref}`,'source_txt_name: 통화 홍길동_261024_093000.txt',
    `recording_datetime: ${when}`,'analysis_model: gemini-fake','analysis_at: 2026-10-24 09:45:00','has_candidates: true',
    work===null?'':`work_class: ${work}`,title===null?'':`call_title: ${title}`,extraFront,'---','',
    '## 원본·자료유형·녹음일시','- 통화녹음','',`## 상대 이름·직책`,counterpart,'','## 판단 메모','- 판단메모비밀 내용','',
    '## 핵심요약',summary,'','## 약속 후보','- 사측 안 서면 회신 10. 27.(월)까지','','## 결정 후보','- 인력 충원 12명 요구안 유지','',
    '## 후속확인 필요사항','- 없음','','## 중요 원문','- 중요원문비밀 문장','','## AI 메모','- AI메모비밀'].filter(l=>l!==null).join('\n');
}

const openaiOk=(items)=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({items})}]}],usage:{input_tokens:5000,output_tokens:600}});
const respond=(body,status=200)=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});

function harness({env={},openai=[()=>respond(openaiOk([{title:'교섭 일정 변경',summary:'가상지부 교섭이 다음 주 화요일로 미뤄졌다.',refs:['m1','m2'],organization:'o1',project:'p1'}]))],days=[],items=[],dbFail=null}={}){
  const calls={openai:[],rest:[],logs:[]};
  const db={
    app_workspaces:[{id:WS,slug:'kptu-work'},{id:OTHER_WS,slug:'other-work'}],
    app_suborganizations:[{id:ORG,workspace_id:WS,name:'가상노동조합',aliases:['가상노조'],active:true},{id:ORG2,workspace_id:WS,name:'예시지부',aliases:[],active:true},{id:FOREIGN_ORG,workspace_id:OTHER_WS,name:'남의노조',aliases:[],active:true}],
    app_spaces:[{id:PROJECT,workspace_id:WS,name:'가상 교섭 프로젝트',parent_id:null,status:'active',metadata:{project_system:'v2'}},{id:FOREIGN_PROJECT,workspace_id:OTHER_WS,name:'남의 프로젝트',parent_id:null,status:'active',metadata:{project_system:'v2'}}],
    app_feed_items:structuredClone(items),
    app_feed_days:structuredClone(days),
  };
  const filters=url=>{const f=[];for(const [k,v] of url.searchParams){if(['select','limit','order','offset'].includes(k))continue;f.push([k,v]);}return f;};
  const match=(row,f)=>f.every(([k,v])=>{const i=v.indexOf('.'),op=v.slice(0,i),val=v.slice(i+1);
    if(op==='eq')return String(row[k]??'')===val;if(op==='gte')return String(row[k])>=val;if(op==='lt')return String(row[k])<val;
    if(op==='like'){const re=new RegExp('^'+val.replace(/[.+?^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*')+'$');return re.test(String(row[k]));}
    throw new Error('unexpected filter '+k+'='+v);});
  const doFetch=async(input,init={})=>{
    const url=new URL(String(input)),method=init.method||'GET',headers=new Headers(init.headers);
    if(url.origin==='https://api.openai.com'){calls.openai.push(JSON.parse(init.body));const next=openai[Math.min(calls.openai.length-1,openai.length-1)];return next(init);}
    assert.equal(url.origin,SB,'unexpected outbound host');
    assert.equal(headers.get('apikey'),SERVICE);assert.equal(headers.get('Authorization'),`Bearer ${SERVICE}`);
    const table=url.pathname.replace('/rest/v1/','');const g=GRANTS[table];assert.ok(g,'table without grant: '+table);
    const body=init.body?JSON.parse(init.body):null;calls.rest.push({method,table,url:String(input),body});
    if(dbFail&&dbFail(method,table))return respond({message:'db down'},500);
    const f=filters(url);
    for(const [k] of f)if(g.select!=='*')assert.ok(g.select.includes(k),`filter on ungranted column ${table}.${k}`);
    if(method==='GET'){
      const cols=(url.searchParams.get('select')||'').split(',');
      if(g.select!=='*')for(const c of cols)assert.ok(g.select.includes(c),`select of ungranted column ${table}.${c}`);
      return respond(db[table].filter(r=>match(r,f)).map(r=>Object.fromEntries(cols.map(c=>[c,r[c]]))));
    }
    if(method==='POST'){
      for(const k of Object.keys(body))assert.ok(g.insert.includes(k),`insert of ungranted column ${table}.${k}`);
      if(table==='app_feed_items'){
        // 업무공간은 서버가 정한 것, 칸 상한·모양(migration check 흉내)
        assert.equal(body.workspace_id,WS);
        if(db.app_feed_items.some(r=>r.workspace_id===body.workspace_id&&r.source===body.source&&r.source_ref===body.source_ref))return respond({code:'23505'},409);
        assert.ok(!body.title||[...body.title].length<=80);assert.ok(!body.summary||[...body.summary].length<=400);
        assert.ok(Array.isArray(body.points)&&body.points.length<=8&&body.points.every(p=>typeof p==='string'&&[...p].length<=300));
        assert.ok(!body.counterpart||[...body.counterpart].length<=100);
        assert.ok(body.raw_text===null||body.raw_text===undefined||new TextEncoder().encode(body.raw_text).length<=204800);
        assert.match(body.source_ref,/^[A-Za-z0-9_.:-]{1,200}$/);
        if(body.source==='call'){assert.equal(body.room_key,undefined);assert.ok(body.title);assert.equal(body.raw_count,0);}
        else{assert.ok(body.room_key&&body.room_label);assert.ok(!body.counterpart);assert.equal(body.speaker_split,false);}
        for(const id of [body.organization_id,body.suggested_project_id].filter(Boolean))assert.ok([ORG,ORG2,PROJECT].includes(id),'link outside workspace');
      }
      if(table==='app_feed_days'&&db.app_feed_days.some(r=>r.workspace_id===body.workspace_id&&r.day===body.day&&r.source===body.source))return respond({code:'23505'},409);
      db[table].push({...body});return new Response(null,{status:201});
    }
    if(method==='PATCH'){
      assert.equal(table,'app_feed_days','feed items are never updated by the server');
      for(const k of Object.keys(body))assert.ok(g.update.includes(k),`update of ungranted column ${table}.${k}`);
      const rows=db[table].filter(r=>match(r,f));for(const r of rows)Object.assign(r,body);
      return respond(rows.map(r=>({day:r.day})));
    }
    throw new Error('unexpected method '+method);
  };
  const handler=createCollectorFeedHandler({
    env:name=>({SUPABASE_URL:SB,SUPABASE_SERVICE_ROLE_KEY:SERVICE,COLLECTOR_FEED_SECRET:SECRET,WEB2_OPENAI_API_KEY:FAKE_KEY,...env})[name],
    fetch:doFetch,now:()=>NOW,sleep:async()=>{},log:(code,detail)=>calls.logs.push(JSON.stringify({code,...(detail||{})})),
  });
  const send=(action,body,headers={})=>handler(new Request(`${FN}?action=${action}`,{method:'POST',headers:{'Content-Type':'application/json','x-collector-feed-secret':SECRET,...headers},body:typeof body==='string'?body:JSON.stringify(body)}));
  const day=(d,source)=>db.app_feed_days.find(r=>r.day===d&&r.source===source)||{};
  return {handler,send,calls,db,day};
}
const callBody=(o={})=>({ref:'SRCFAKE0001aa',analysis_md:analysis(o),transcript:'네 위원장님 교섭 일정 건으로 전화드렸습니다 '+RAW_MARK,drive_url:'https://drive.google.com/file/d/SRCFAKE0001aa/view',...(o.body||{})});
const tgBody=(o={})=>({day:TODAY,room_key:'room-fake-1',room_label:'가상 업무방',total:5,messages:[
  {ref:'1001',at:'2026-10-24T00:10:00Z',sender:'A',text:'가상지부 교섭이 다음 주 화요일로 미뤄졌습니다 '+RAW_MARK},
  {ref:'1002',at:'2026-10-24T00:12:00Z',sender:'B',text:'장소는 그대로인가요?',reply_to:'1001'},
  {ref:'1003',at:'2026-10-24T00:20:00Z',sender:'A',text:'넵 ㅎㅎ'},
],...o});

// ---- 입구 ---------------------------------------------------------------------------------------------------------

test('비밀값 없음·틀림·짧은 비밀값 설정·미설정이면 401이고 DB·AI에 가지 않는다',async()=>{
  for(const [headers,env] of [
    [{'x-collector-feed-secret':''},{}],
    [{'x-collector-feed-secret':SECRET+'x'},{}],
    [{'x-collector-feed-secret':'wrong'},{}],
    [{},{COLLECTOR_FEED_SECRET:undefined}],
    [{},{COLLECTOR_FEED_SECRET:''}],
    [{'x-collector-feed-secret':'short-secret'},{COLLECTOR_FEED_SECRET:'short-secret'}],
  ]){
    const h=harness({env});
    const req=new Request(`${FN}?action=call`,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(callBody())});
    if(!('x-collector-feed-secret' in headers)){}
    const r=await h.handler(req);
    assert.equal(r.status,401);assert.deepEqual(await r.json(),{ok:false,error:'UNAUTHORIZED'});
    assert.equal(h.calls.rest.length,0);assert.equal(h.calls.openai.length,0);
  }
  assert.equal(SECRET_MIN_CHARS,32);
  assert.equal(await secretMatches(SECRET,SECRET),true);
  assert.equal(await secretMatches('x'.repeat(5000),'x'.repeat(5000)),false);
});

test('사용자 로그인·예약·heartbeat 비밀 헤더는 열쇠가 아니다(맞는 비밀값과 같이 와도 401)',async()=>{
  for(const extra of [{Authorization:'Bearer some-user-jwt'},{'x-drive-summary-cron-secret':'c'},{'x-collector-heartbeat-secret':'h'}]){
    const h=harness();const r=await h.send('call',callBody(),extra);
    assert.equal(r.status,401);assert.equal(h.calls.rest.length,0);
  }
  const h=harness();
  const r=await h.handler(new Request(`${FN}?action=call`,{method:'POST',headers:{Authorization:'Bearer jwt'},body:'{}'}));
  assert.equal(r.status,401,'배포 검사(비밀 헤더 없는 POST)는 401');
});

test('OPTIONS는 204이고 CORS 허용 헤더를 주지 않는다. GET은 405, 모르는 action은 400',async()=>{
  const h=harness();
  const o=await h.handler(new Request(FN,{method:'OPTIONS'}));assert.equal(o.status,204);assert.equal(o.headers.get('access-control-allow-origin'),null);
  assert.equal((await h.handler(new Request(FN))).status,405);
  assert.equal((await h.send('other',{})).status,400);
});

test('업무공간은 서버가 정한다: workspace·owner 칸을 보내면 400, 저장은 kptu-work로만',async()=>{
  for(const extra of [{workspace_id:OTHER_WS},{owner_id:'x'},{workspace:'other-work'}]){
    const h=harness();const r=await h.send('call',{...callBody(),...extra});
    assert.equal(r.status,400);assert.equal(h.calls.rest.length,0);
  }
  const h=harness();const r=await h.send('call',callBody());assert.equal(r.status,200);
  assert.equal(h.db.app_feed_items.length,1);assert.equal(h.db.app_feed_items[0].workspace_id,WS);
  assert.ok(h.calls.rest.find(c=>c.table==='app_workspaces').url.includes('slug=eq.kptu-work'));
});

test('크기·형식 상한: 너무 큰 몸통·전사본, 깨진 JSON, 잘못된 ref·URL·날짜는 저장 전에 거절',async()=>{
  const cases=[
    ['call',{...callBody(),transcript:'가'.repeat(70000)}],
    ['call',{...callBody(),analysis_md:'x'.repeat(70*1024)}],
    ['call','{not json'],
    ['call',{...callBody(),ref:'../etc'}],
    ['call',{...callBody(),drive_url:'https://evil.example/x'}],
    ['call_skip',{day:'2026-10-25',personal:1,short:0}],
    ['call_skip',{day:'2026-01-01',personal:1,short:0}],
    ['call_skip',{day:TODAY,personal:-1,short:0}],
    ['telegram',tgBody({room_key:'방 이름'})],
    ['telegram',tgBody({room_label:'줄\n바꿈'})],
    ['telegram',tgBody({messages:[{ref:'1',at:'2026-10-24T00:00:00Z',sender:'홍길동',text:'x'}]})],
    ['telegram',tgBody({messages:[{ref:'1',at:'2026-10-22T00:00:00Z',sender:'A',text:'다른 날'}]})],
    ['telegram',tgBody({messages:Array.from({length:301},(_,i)=>({ref:String(i),at:'2026-10-24T00:00:00Z',sender:'A',text:'x'}))})],
    ['telegram',tgBody({total:1})],
  ];
  for(const [action,body] of cases){
    const h=harness();const r=await h.send(action,body);
    assert.ok([400,413].includes(r.status),`${action} ${r.status}`);
    assert.equal(h.db.app_feed_items.length,0);assert.equal(h.calls.openai.length,0);
  }
  const big=harness();
  const r=await big.handler(new Request(`${FN}?action=call`,{method:'POST',headers:{'x-collector-feed-secret':SECRET,'content-length':String(300*1024)},body:'{}'}));
  assert.equal(r.status,413);
});

// ---- 통화 ---------------------------------------------------------------------------------------------------------

test('통화 업무: AI 없이 분석 파일만 읽어 저장(제목·점·상대·조직·전문), 필요한 절만 가져온다',async()=>{
  const h=harness();const r=await h.send('call',callBody());
  assert.deepEqual(await r.json(),{ok:true,kept:1,personal:0,unsure:0,failed:0,duplicate:false});
  assert.equal(h.calls.openai.length,0,'통화는 AI를 부르지 않는다');
  const row=h.db.app_feed_items[0];
  assert.equal(row.source,'call');assert.equal(row.day,TODAY);assert.equal(row.occurred_at,'2026-10-24T00:30:00.000Z');
  assert.equal(row.title,'가상지부 3차 교섭 일정 변경');
  assert.deepEqual(row.points,['3차 교섭을 10. 28.(화) 14:00로 미루기로 함.','사측 안은 서면으로 받기로 함.','[확정] 인력 충원 12명 요구안 유지','[예정] 사측 안 서면 회신 10. 27.(월)까지']);
  assert.equal(row.counterpart,'가상노동조합 홍길동 위원장');assert.equal(row.organization_id,ORG);
  assert.equal(row.speaker_split,false);assert.match(row.raw_text,new RegExp(RAW_MARK));
  assert.equal(row.model,'gemini-fake');assert.equal(row.drive_url,'https://drive.google.com/file/d/SRCFAKE0001aa/view');
  assert.equal(row.source_ref,'SRCFAKE0001aa');
  assert.doesNotMatch(JSON.stringify(row),/판단메모비밀|중요원문비밀|AI메모비밀/,'판단 메모·중요 원문·AI 메모는 가져오지 않는다');
  assert.equal(h.day(TODAY,'call').kept_count,1);assert.equal(h.day(TODAY,'call').total_count,1);assert.equal(h.day(TODAY,'call').batch_count,1);
});

test('통화 개인·애매·구분 없음은 개수만(행 없음), 버전·모양이 다르면 판정 실패',async()=>{
  const cases=[[{work:'개인'},'personal_count'],[{work:'애매'},'unsure_count'],[{work:null},'unsure_count'],[{work:'기타'},'unsure_count'],
    [{version:'4.0'},'failed_count'],[{version:'2.9'},'failed_count'],[{body:{analysis_md:'제목만 있는 글'}},'failed_count'],
    [{summary:'',title:null},'failed_count'],[{ref:'SRCOTHER0001'},'failed_count'],[{when:'2026-06-01 09:00:00'},'failed_count']];
  for(const [o,counter] of cases){
    const h=harness();const r=await h.send('call',callBody(o));
    assert.equal(r.status,200);assert.equal(h.db.app_feed_items.length,0,JSON.stringify(o));
    const d=h.db.app_feed_days.find(x=>x.source==='call'&&x[counter]===1);assert.ok(d,`${counter} for ${JSON.stringify(o)}`);
    assert.equal(d.kept_count,0);
  }
  // 개인 통화는 원문이 어디에도 남지 않는다
  const h=harness();await h.send('call',callBody({work:'개인'}));
  assert.doesNotMatch(JSON.stringify(h.db)+h.calls.logs.join(''),new RegExp(RAW_MARK));
});

test('통화 call_skip: 앱 스크립트가 거른 수만 더한다. 같은 원본은 두 번 저장하지 않는다',async()=>{
  const h=harness();
  assert.equal((await h.send('call_skip',{day:'2026-10-23',personal:3,short:1})).status,200);
  const d=h.day('2026-10-23','call');assert.equal(d.personal_count,3);assert.equal(d.unsure_count,1);assert.equal(d.total_count,4);
  assert.equal(h.db.app_feed_items.length,0);
  await h.send('call',callBody());const again=await (await h.send('call',callBody())).json();
  assert.equal(again.duplicate,true);assert.equal(h.db.app_feed_items.length,1);assert.equal(h.day(TODAY,'call').kept_count,1);
});

test('통화 하루 상한(받은 날 50건)을 넘으면 429',async()=>{
  const h=harness({days:[{workspace_id:WS,day:TODAY,source:'call',...Object.fromEntries(COUNTERS.map(k=>[k,0])),batch_count:DAILY_LIMITS.call}]});
  const r=await h.send('call',callBody());assert.equal(r.status,429);assert.equal((await r.json()).error,'DAILY_LIMIT');
  assert.equal(h.db.app_feed_items.length,0);
});

test('상대 표기(Q11): 담당조직과 확실히 맞을 때만 소속을 붙인다. 모르면 비우고, 번호는 쓰지 않는다',()=>{
  const orgs=[{id:ORG,name:'가상노동조합',aliases:['가상노조']},{id:ORG2,name:'예시지부',aliases:[]}];
  assert.deepEqual(counterpartOf(['- 이름: 홍길동','- 직책: 위원장','- 소속: 가상노조'],null,orgs),{counterpart:'가상노동조합 홍길동 위원장',organization_id:ORG});
  assert.deepEqual(counterpartOf(['- 홍길동 사무국장 (모르는노조)'],null,orgs),{counterpart:'홍길동 사무국장',organization_id:null});
  assert.deepEqual(counterpartOf(['- 예시지부 김가상 지부장'],null,orgs),{counterpart:'예시지부 김가상 지부장',organization_id:ORG2});
  assert.deepEqual(counterpartOf(['- 확인 불가'],null,orgs),{counterpart:null,organization_id:null});
  assert.deepEqual(counterpartOf([],'이가상',orgs),{counterpart:'이가상',organization_id:null},'분석에 없으면 전사 파일 이름의 연락처 이름');
  assert.deepEqual(counterpartOf(['- 010-0000-0000'],null,orgs),{counterpart:null,organization_id:null});
  // 두 조직에 맞으면 애매해서 붙이지 않는다
  const dup=[{id:ORG,name:'가짜갑',aliases:['공동']},{id:ORG2,name:'가짜을',aliases:['공동']}];
  assert.equal(counterpartOf(['- 이름: 박가상','- 소속: 공동'],null,dup).organization_id,null);
  assert.deepEqual(transcriptName('통화 010-0000-0000_261024_093000.txt').contact,null);
  assert.equal(transcriptName('통화 홍길동_261024_093000.txt').contact,'홍길동');
  assert.equal(transcriptName('통화 홍길동_261024_093000.txt').at,Date.parse('2026-10-24T00:30:00Z'));
});

test('화자 표기(4.5절): 나/상대 표기·상대:·화자1/화자2 줄이면 speaker_split, 한 문단이면 false',async()=>{
  assert.equal(speakerSplit('나: 안녕하세요\n가상노조 홍길동 위원장: 네 반갑습니다'),true);
  assert.equal(speakerSplit('나: 네\n상대: 그럼 다음 주에'),true);
  assert.equal(speakerSplit('화자1: 여보세요\n화자2: 네'),true);
  assert.equal(speakerSplit('네 위원장님 교섭 일정 건으로 전화드렸습니다'),false);
  assert.equal(speakerSplit('홍길동: 네\n김가상: 네'),false,'나·화자1 줄이 없으면 화자 구분으로 보지 않는다');
  assert.equal(speakerSplit('나: 네\n줄머리 없는 줄'),false);
  const h=harness();await h.send('call',{...callBody(),transcript:'나: 교섭 건입니다\n가상노동조합 홍길동 위원장: 다음 주 화요일로 하죠'});
  assert.equal(h.db.app_feed_items[0].speaker_split,true);
});

test('제목 없음(분석 안내문 수정 전 3.1 + work_class 있음)이면 핵심요약 첫 문장, 시간대 없는 녹음 일시는 한국 시각',()=>{
  const p=parseCall({ref:'SRCFAKE0001aa',analysis_md:analysis({version:'3.1',title:null}),transcript:''},[],NOW);
  assert.equal(p.kind,'business');assert.equal(p.title,'3차 교섭을 10. 28.(화) 14:00로 미루기로 함.');assert.equal(p.raw_text,null);
  assert.equal(parseKstDateTime('2026-10-24 09:30:00'),Date.parse('2026-10-24T00:30:00Z'));
  assert.equal(parseKstDateTime('2026-10-24T09:30:00Z'),Date.parse('2026-10-24T09:30:00Z'));
  assert.equal(parseKstDateTime('2026-02-30 09:30'),null);
});

// ---- 텔레그램 -----------------------------------------------------------------------------------------------------

test('텔레그램: 묶음마다 AI 한 번, 고른 소식만 저장(요약·근거 원문·조직·추천 프로젝트), 하루 숫자·AI 사용량 기록',async()=>{
  const h=harness();const r=await h.send('telegram',tgBody());
  assert.deepEqual(await r.json(),{ok:true,kept:1,personal:0,unsure:0,failed:0,duplicate:false});
  assert.equal(h.calls.openai.length,1);
  const req=h.calls.openai[0];
  assert.equal(req.store,false);assert.equal(req.model,'gpt-5.6-luna');assert.equal(req.text.format.strict,true);assert.equal(req.tools,undefined);
  const material=req.input[1].content;
  assert.match(material,/m1 09:10 A: /);assert.match(material,/m2 09:12 B \(m1에 답\): /);assert.match(material,/o1=가상노동조합/);assert.match(material,/p1=가상 교섭 프로젝트/);
  assert.doesNotMatch(material,new RegExp(ORG+'|'+PROJECT),'ID는 AI에 보내지 않는다');assert.doesNotMatch(material,/남의/);
  const row=h.db.app_feed_items[0];
  assert.equal(row.source,'telegram');assert.equal(row.room_key,'room-fake-1');assert.equal(row.room_label,'가상 업무방');
  assert.equal(row.summary,'가상지부 교섭이 다음 주 화요일로 미뤄졌다.');assert.equal(row.title,'교섭 일정 변경');
  assert.equal(row.raw_count,2);assert.match(row.raw_text,/^09:10 A: 가상지부/);assert.doesNotMatch(row.raw_text,/넵 ㅎㅎ/,'버린 메시지는 저장하지 않는다');
  assert.equal(row.organization_id,ORG);assert.equal(row.suggested_project_id,PROJECT);assert.match(row.source_ref,/^tg:[0-9a-f]{32}:1$/);
  const d=h.day(TODAY,'telegram');
  assert.equal(d.total_count,5);assert.equal(d.kept_count,1);assert.equal(d.room_count,1);assert.equal(d.batch_count,1);
  assert.equal(d.ai_requests,1);assert.equal(d.ai_input_tokens,5000);assert.equal(d.ai_output_tokens,600);
  // 같은 묶음이 다시 오면 AI를 다시 부르지 않는다
  const again=await (await h.send('telegram',tgBody())).json();
  assert.equal(again.duplicate,true);assert.equal(h.calls.openai.length,1);assert.equal(h.db.app_feed_items.length,1);
});

test('텔레그램 AI 실패·시간 초과·형식 틀림·없는 참조면 아무것도 저장하지 않는다(3번째 시도만 판정 실패로 센다)',async()=>{
  const bad=[
    ()=>respond({error:'x'},500),
    ()=>{const e=new Error('t');e.name='TimeoutError';throw e;},
    ()=>respond({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'not json'}]}],usage:{input_tokens:10,output_tokens:5}}),
    ()=>respond(openaiOk([{title:'t',summary:'요약',refs:['m9'],organization:'',project:''}])),
    ()=>respond(openaiOk([{title:'t',summary:'요약',refs:['m1'],organization:'o9',project:''}])),
    ()=>respond(openaiOk([{title:'t',summary:'요약',refs:['m1'],organization:'',project:'',extra:'x'}])),
    ()=>respond({status:'completed',output:[{type:'message',content:[{type:'refusal',refusal:'no'}]}]}),
  ];
  for(const reply of bad){
    const h=harness({openai:[reply]});const r=await h.send('telegram',tgBody());
    assert.ok(r.status>=500,String(r.status));assert.equal((await r.json()).ok,false);
    assert.equal(h.db.app_feed_items.length,0);
    assert.equal(h.day(TODAY,'telegram').kept_count??0,0);assert.equal(h.day(TODAY,'telegram').failed_count??0,0);
  }
  const h=harness({openai:[()=>respond({error:'x'},500)]});await h.send('telegram',tgBody({attempt:3}));
  assert.equal(h.day(TODAY,'telegram').failed_count,1);assert.equal(h.db.app_feed_items.length,0);
});

test('텔레그램: 중요한 것 없음이면 행 없이 개수만, 글 없는 묶음은 AI를 부르지 않는다, 열쇠 없음은 503',async()=>{
  let h=harness({openai:[()=>respond(openaiOk([]))]});let r=await h.send('telegram',tgBody());
  assert.equal(r.status,200);assert.equal(h.db.app_feed_items.length,0);assert.equal(h.day(TODAY,'telegram').total_count,5);
  h=harness();r=await h.send('telegram',tgBody({messages:[],total:4}));
  assert.equal(r.status,200);assert.equal(h.calls.openai.length,0);assert.equal(h.day(TODAY,'telegram').total_count,4);
  h=harness({openai:[()=>respond(openaiOk([]))]});await h.send('telegram',tgBody({part:2}));
  assert.equal(h.day(TODAY,'telegram').total_count??0,0,'둘째 묶음은 방 메시지 수를 다시 세지 않는다');assert.equal(h.day(TODAY,'telegram').room_count??0,0);
  h=harness({env:{WEB2_OPENAI_API_KEY:undefined}});r=await h.send('telegram',tgBody());
  assert.equal(r.status,503);assert.equal(h.calls.openai.length,0);assert.equal(h.db.app_feed_items.length,0);
});

test('텔레그램 한 달 상한 6,000원(이 기능만 따로)과 하루 묶음 80개 상한',async()=>{
  assert.equal(MONTHLY_LIMIT_KRW,6000);
  const tokens=Math.ceil(MONTHLY_LIMIT_KRW*1_000_000/350);
  let h=harness({days:[{workspace_id:WS,day:'2026-10-03',source:'telegram',...Object.fromEntries(COUNTERS.map(k=>[k,0])),ai_input_tokens:tokens}]});
  let r=await h.send('telegram',tgBody());assert.equal(r.status,429);assert.equal((await r.json()).error,'AI_MONTHLY_LIMIT');assert.equal(h.calls.openai.length,0);
  // 지난달 사용량은 세지 않는다
  h=harness({days:[{workspace_id:WS,day:'2026-09-30',source:'telegram',...Object.fromEntries(COUNTERS.map(k=>[k,0])),ai_input_tokens:tokens}]});
  r=await h.send('telegram',tgBody());assert.equal(r.status,200);
  h=harness({days:[{workspace_id:WS,day:TODAY,source:'telegram',...Object.fromEntries(COUNTERS.map(k=>[k,0])),batch_count:DAILY_LIMITS.telegram}]});
  r=await h.send('telegram',tgBody());assert.equal(r.status,429);assert.equal(h.calls.openai.length,0);
});

test('AI 답 검사: 요약 제어 문자 제거·길이 자르기, 참조 중복 거절',()=>{
  const o=[{ref:'o1',id:ORG,name:'가상'}];
  const items=parseTelegram(JSON.stringify({items:[{title:'제목\u0007',summary:'가'.repeat(500),refs:['m2','m1'],organization:'o1',project:''}]}),2,o,[]);
  assert.equal([...items[0].summary].length,400);assert.equal(items[0].title,'제목');assert.deepEqual(items[0].refs,[0,1]);
  assert.equal(parseTelegram(JSON.stringify({items:[{title:'',summary:'x',refs:['m1','m1'],organization:'',project:''}]}),2,o,[]),null);
  assert.equal(parseTelegram(JSON.stringify({items:[],more:1}),2,o,[]),null);
});

// ---- 로그·원문·소스 -----------------------------------------------------------------------------------------------

test('응답·로그에 원문·요약·이름이 나가지 않는다(DB 오류·AI 오류 때도)',async()=>{
  const runs=[harness({dbFail:(m,t)=>m==='POST'&&t==='app_feed_items'}),harness({openai:[()=>respond({error:{message:RAW_MARK}},500)]}),harness()];
  for(const h of runs){
    const a=await h.send('call',callBody()),b=await h.send('telegram',tgBody());
    const text=await a.text()+await b.text()+h.calls.logs.join('\n');
    assert.doesNotMatch(text,new RegExp(RAW_MARK+'|홍길동|가상노동조합|가상 업무방|교섭'));
  }
});

test('소스: 비밀값·열쇠 값 없음, console에 원문 없음, tools 없음, store:false, 공용 AI 모듈 사용',()=>{
  const files=['handler.ts','call-analysis.ts','telegram.ts','index.ts'].map(f=>readFileSync(`supabase/functions/collector-feed/${f}`,'utf8'));
  const all=files.join('\n');
  assert.doesNotMatch(all,/sk-[A-Za-z0-9]/);assert.doesNotMatch(all,/tools\s*:/);assert.match(all,/store: false/);
  assert.match(all,/from "\.\.\/_shared\/openai-responses\.ts"/);
  assert.doesNotMatch(all,/OPENAI_API_KEY"(?<!WEB2_OPENAI_API_KEY")/);
  assert.equal((all.match(/console\./g)||[]).length,1,'로그는 한 곳(단계 코드만)');
  const logs=[...all.matchAll(/log\("([a-z_]+)"(?:,\s*(\{[^}]*\}))?\)/g)];
  for(const [,code,detail] of logs)if(detail)assert.doesNotMatch(detail,/text|summary|raw|title|name|material|label/,code);
  // 앱 화면·ai-assist 지침은 이 PR에서 고치지 않는다(공용 호출만 옮김)
  assert.match(files[3],/Deno\.serve\(createCollectorFeedHandler\(\{ env: \(name\) => Deno\.env\.get\(name\) \}\)\);/);
});

test('담당조직 이름 비교는 화면(app/org-name-match.mjs)과 같은 파일 사본을 쓴다',()=>{
  assert.deepEqual(readFileSync('app/org-name-match.mjs'),readFileSync('supabase/functions/_shared/org-name-match.mjs'));
});

test('5절 표에 collector-feed가 한 번, verify_jwt=false로 등록되어 첫 배포 검사를 통과한다',()=>{
  const doc=readFileSync('docs/web2-env6b-edge-source.md','utf8');
  const section=doc.slice(doc.indexOf('## 5.'),doc.indexOf('### 5.1'));
  const rows=section.split('\n').filter(l=>/^\| \d+ \| `collector-feed` \|/.test(l));
  assert.equal(rows.length,1);assert.match(rows[0],/\| false \|/);assert.match(rows[0],/\| (배포 대기|운영 배포됨)/);
  const workflow=readFileSync('.github/workflows/edge-function-deploy.yml','utf8');
  const script=name=>workflow.split(`      - name: ${name}\n`)[1].split('\n      - name:')[0]
    .split('        run: |\n')[1].split('\n').map(s=>s.replace(/^          /,'')).join('\n');
  const dir=mkdtempSync(join(tmpdir(),'collector-feed-first-deploy-'));
  try{
    const env={...process.env,FUNCTION_NAME:'collector-feed',FIRST_DEPLOY:'true',VERIFY_JWT:'false',EXPECT_UNAUTH_401:'true',GITHUB_OUTPUT:join(dir,'output')};
    let r=spawnSync('bash',['-c',script('Validate inputs')],{cwd:process.cwd(),encoding:'utf8',env});
    assert.equal(r.status,0,r.stdout+r.stderr);
    r=spawnSync('bash',['-c',script('Validate inputs')],{cwd:process.cwd(),encoding:'utf8',env:{...env,VERIFY_JWT:'true'}});
    assert.notEqual(r.status,0,'verify_jwt=true는 등록된 행과 다르다');
    mkdirSync(join(dir,'docs'));copyFileSync('docs/web2-env6b-edge-source.md',join(dir,'docs/web2-env6b-edge-source.md'));
    writeFileSync(join(dir,'before-list.json'),'[]');
    r=spawnSync('bash',['-c',script('Validate before metadata')],{cwd:dir,encoding:'utf8',env});
    assert.equal(r.status,0,r.stdout+r.stderr);
    writeFileSync(join(dir,'before-list.json'),JSON.stringify([{slug:'collector-feed',version:1,verify_jwt:false}]));
    r=spawnSync('bash',['-c',script('Validate before metadata')],{cwd:dir,encoding:'utf8',env});
    assert.notEqual(r.status,0,'운영에 같은 이름이 있으면 첫 배포 거절');
  }finally{rmSync(dir,{recursive:true,force:true});}
});
