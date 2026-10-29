import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// TG-방날짜묶기 2단계: collector-feed telegram 입구의 하루 요약(day)·방 정보(chat_kind·chat_username·open_ref).
// 지어낸 Supabase(PostgREST + rpc)와 지어낸 OpenAI로 실제 handler를 돌린다. 네트워크 없음. 방·사람 이름·아이디는 모두 지어낸 값이다.
const {createCollectorFeedHandler,DAILY_LIMITS,MONTHLY_LIMIT_KRW,ROOM_TOUCH_FN,ROOM_DAY_ADD_FN}=await import('../../supabase/functions/collector-feed/handler.ts');
const {parseTelegram,telegramMaterial,TELEGRAM_INSTRUCTIONS,TELEGRAM_SCHEMA,TG_LIMITS}=await import('../../supabase/functions/collector-feed/telegram.ts');

const SB='https://synthetic.supabase.test';
const FN=`${SB}/functions/v1/collector-feed`;
const WS='a0000000-0000-4000-8000-000000000001';
const NOW=Date.parse('2026-10-24T03:00:00Z');
const TODAY='2026-10-24';
const SECRET='synthetic-collector-feed-secret-0123456789';
const SERVICE='synthetic-service-role-key';
const ROOM_NAME='가상 비밀방이름',USERNAME='fake_room_id',OPEN='123456';
const SECRET_LINE='가상요약비밀줄';

const respond=(body,status=200)=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const DAY=()=>({headline:'가상 교섭 일정이 미뤄짐',lines:['교섭이 다음 주 화요일로 미뤄졌다.','장소는 그대로다.',SECRET_LINE]});
const aiOk=(...a)=>{const day=a.length?a[0]:DAY(),items=a[1];return respond({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({
  ...(day===undefined?{}:{day}),
  items:items??[{title:'교섭 일정',summary:'가상 교섭이 미뤄졌다.',refs:['m1','m2'],organization:'',project:''}]})}]}],usage:{input_tokens:100,output_tokens:50}});};

function harness({ai=()=>aiOk(),rpc=()=>respond({ok:true}),dup=false,days=[]}={}){
  const calls={openai:[],rpc:[],items:[],logs:[]};
  const dayRows=structuredClone(days);
  const doFetch=async(input,init={})=>{
    const url=new URL(String(input)),method=init.method||'GET';
    if(url.origin==='https://api.openai.com'){calls.openai.push(JSON.parse(init.body));return ai();}
    assert.equal(url.origin,SB);
    const path=url.pathname.replace('/rest/v1/','');
    if(path==='rpc/app_operator_feature_workspace')return respond(JSON.stringify(WS));
    if(path.startsWith('rpc/')){
      const fn=path.slice(4);assert.ok([ROOM_TOUCH_FN,ROOM_DAY_ADD_FN].includes(fn),'이 시험에서 부르는 DB 함수는 둘뿐: '+fn);
      const args=JSON.parse(init.body);calls.rpc.push({fn,args,order:calls.items.length});return rpc(fn,args);
    }
    if(path==='app_workspaces')return respond([{id:WS}]);
    if(path==='app_suborganizations'||path==='app_spaces')return respond([]);
    if(path==='app_feed_items'){
      if(method==='GET')return respond(dup?[{source_ref:'tg:x:1'}]:[]);
      const row=JSON.parse(init.body);calls.items.push(row);return new Response(null,{status:201});
    }
    if(path==='app_feed_days'){
      if(method==='GET')return respond(dayRows.filter(r=>url.searchParams.get('day')===`eq.${r.day}`||url.searchParams.get('day')===null));
      if(method==='POST'){dayRows.push(JSON.parse(init.body));return new Response(null,{status:201});}
      return respond([{day:TODAY}]);
    }
    throw new Error('unexpected '+method+' '+path);
  };
  const handler=createCollectorFeedHandler({
    env:n=>({SUPABASE_URL:SB,SUPABASE_SERVICE_ROLE_KEY:SERVICE,COLLECTOR_FEED_SECRET:SECRET,WEB2_OPENAI_API_KEY:'synthetic-openai-key'})[n],
    fetch:doFetch,now:()=>NOW,sleep:async()=>{},log:(code,detail)=>calls.logs.push(JSON.stringify({code,...(detail||{})})),
  });
  const send=(body)=>handler(new Request(`${FN}?action=telegram`,{method:'POST',headers:{'Content-Type':'application/json','x-collector-feed-secret':SECRET},body:JSON.stringify(body)}));
  return {send,calls};
}
const body=(o={})=>({day:TODAY,room_key:'-1001234',room_label:ROOM_NAME,total:3,messages:[
  {ref:'1001',at:'2026-10-24T00:10:00Z',sender:'A',text:'가상지부 교섭이 다음 주 화요일로 미뤄졌습니다'},
  {ref:'1002',at:'2026-10-24T00:12:00Z',sender:'B',text:'장소는 그대로인가요?',reply_to:'1001'},
  {ref:'1003',at:'2026-10-24T00:20:00Z',sender:'A',text:'네 그대로입니다'}],...o});

test('day가 있으면 AI는 한 번, 소식 저장 뒤 touch → day_add 순서로 부른다(작업공간은 서버가 정함)',async()=>{
  const h=harness();const r=await h.send(body({chat_kind:'channel',chat_username:USERNAME,open_ref:OPEN}));
  assert.equal(r.status,200);assert.equal((await r.json()).kept,1);
  assert.equal(h.calls.openai.length,1,'AI 추가 호출 없음');
  assert.deepEqual(h.calls.rpc.map(c=>c.fn),[ROOM_TOUCH_FN,ROOM_DAY_ADD_FN]);
  assert.ok(h.calls.rpc.every(c=>c.order===1),'소식 저장이 끝난 뒤에 부른다');
  const [touch,add]=h.calls.rpc.map(c=>c.args);
  assert.deepEqual(touch,{p_workspace:WS,p_room_key:'-1001234',p_room_label:ROOM_NAME,p_chat_kind:'channel',p_chat_username:USERNAME});
  assert.deepEqual(Object.keys(add).sort(),['p_day','p_part','p_room_key','p_workspace']);
  assert.equal(add.p_workspace,WS);assert.equal(add.p_day,TODAY);assert.equal(add.p_room_key,'-1001234');
  assert.match(add.p_part.batch,/^[0-9a-f]{32}$/);
  assert.equal(h.calls.items[0].source_ref,`tg:${add.p_part.batch}:1`,'요약 묶음 값 = 소식 줄의 묶음 해시');
  assert.equal(add.p_part.first_at,'2026-10-24T00:10:00.000Z');
  assert.equal(add.p_part.headline,'가상 교섭 일정이 미뤄짐');
  assert.deepEqual(add.p_part.lines,DAY().lines);assert.equal(add.p_part.open_ref,OPEN);
  assert.deepEqual(Object.keys(add.p_part).sort(),['batch','first_at','headline','lines','open_ref']);
  // 지시문·답 형식에 day가 있고, 요약 재료도 같은 호출 하나에 담긴다
  const req=h.calls.openai[0];
  assert.deepEqual(req.text.format.schema.required,['day','items']);
  assert.match(req.input[0].content,/day/);
});

test('방 정보 칸이 없으면 null로 touch를 부르고 open_ref는 part에 없다', async()=>{
  const h=harness();await h.send(body());
  assert.deepEqual(h.calls.rpc[0].args,{p_workspace:WS,p_room_key:'-1001234',p_room_label:ROOM_NAME,p_chat_kind:null,p_chat_username:null});
  assert.ok(!('open_ref' in h.calls.rpc[1].args.p_part));
});

test('방 정보 칸이 틀리면 그 칸만 null로 버리고 요청은 통과한다(값은 로그에 없다)',async()=>{
  const h=harness();
  const r=await h.send(body({chat_kind:'supergroup',chat_username:'ab',open_ref:'bad value!'}));
  assert.equal(r.status,200);
  assert.deepEqual(h.calls.rpc[0].args,{p_workspace:WS,p_room_key:'-1001234',p_room_label:ROOM_NAME,p_chat_kind:null,p_chat_username:null});
  assert.ok(!('open_ref' in h.calls.rpc[1].args.p_part));
  assert.match(h.calls.logs.join('\n'),/telegram_room_info_dropped.*"count":3/);
  assert.ok(!/supergroup|bad value/.test(h.calls.logs.join('\n')));
  const h2=harness();await h2.send(body({chat_kind:5,chat_username:'@'+USERNAME,open_ref:null}));
  assert.equal(h2.calls.rpc[0].args.p_chat_kind,null);assert.equal(h2.calls.rpc[0].args.p_chat_username,USERNAME,'앞의 @는 떼고 받는다');
  const bad=harness();const rb=await bad.send(body({workspace_id:WS}));
  assert.equal(rb.status,400,'모르는 칸(업무공간 등)은 여전히 400');
});

test('day가 없거나 틀리면 요약만 버리고 소식은 저장한다(방 정보는 남긴다)',async()=>{
  const cases={
    '없음':undefined,
    '줄 2개':{headline:'제목',lines:['하나','둘']},
    '줄이 문자열 아님':{headline:'제목',lines:'하나둘셋'},
    '객체 아님':'요약',
    '빈 줄만':{headline:'제목',lines:['','  ','x','y']},
  };
  for(const [name,day] of Object.entries(cases)){
    const h=harness({ai:()=>aiOk(day)});const r=await h.send(body());
    assert.equal(r.status,200,name);assert.equal(h.calls.items.length,1,name);
    assert.deepEqual(h.calls.rpc.map(c=>c.fn),[ROOM_TOUCH_FN],name);
  }
});

test('소식이 없으면(items 빈 목록) 방 정보도 요약도 부르지 않는다',async()=>{
  const h=harness({ai:()=>aiOk({headline:'',lines:[]},[])});const r=await h.send(body());
  assert.equal(r.status,200);assert.equal((await r.json()).kept,0);assert.equal(h.calls.rpc.length,0);
  const h2=harness({ai:()=>aiOk(DAY(),[])});await h2.send(body());
  assert.equal(h2.calls.rpc.length,0,'소식 없는 방·날 줄은 만들지 않는다');
  const h3=harness();await h3.send(body({messages:[],total:4}));
  assert.equal(h3.calls.openai.length,0);assert.equal(h3.calls.rpc.length,0);
});

test('같은 묶음이 다시 오면 AI도 DB 함수도 부르지 않는다(멱등)',async()=>{
  const h=harness({dup:true});const r=await h.send(body());
  assert.equal((await r.json()).duplicate,true);assert.equal(h.calls.openai.length,0);assert.equal(h.calls.rpc.length,0);
});

test('DB 함수가 실패해도 소식 저장과 응답은 그대로이고 로그에는 단계 코드만 남는다',async()=>{
  const fail=(fn,code)=>respond({code:'22023',message:code,details:ROOM_NAME+USERNAME,hint:SECRET_LINE},400);
  const h=harness({rpc:(fn)=>fail(fn,fn===ROOM_TOUCH_FN?'TGDG_NO_ROOM':'TGDG_PART_LINES')});
  const r=await h.send(body({chat_kind:'user',chat_username:USERNAME,open_ref:OPEN}));
  const text=await r.text();
  assert.equal(r.status,200);assert.equal(JSON.parse(text).kept,1);assert.equal(h.calls.items.length,1);
  assert.deepEqual(h.calls.rpc.map(c=>c.fn),[ROOM_TOUCH_FN,ROOM_DAY_ADD_FN],'touch가 실패해도 day_add는 시도한다');
  const logs=h.calls.logs.join('\n');
  assert.match(logs,/telegram_room_touch_failed.*TGDG_NO_ROOM/);assert.match(logs,/telegram_room_day_failed.*TGDG_PART_LINES/);
  for(const secret of [ROOM_NAME,USERNAME,OPEN,SECRET_LINE,'교섭이 다음 주'])assert.ok(!logs.includes(secret)&&!text.includes(secret),'비밀 값이 로그·응답에 없다: '+secret);
  // DB가 아예 죽었거나(500) 함수가 없어도(404) 똑같이 계속한다
  for(const status of [500,404]){
    const d=harness({rpc:()=>respond({message:ROOM_NAME},status)});const rd=await d.send(body());
    assert.equal(rd.status,200);assert.equal(d.calls.items.length,1);
    assert.ok(!d.calls.logs.join('\n').includes(ROOM_NAME));
  }
  const thrown=harness({rpc:()=>{throw new Error(ROOM_NAME);}});const rt=await thrown.send(body());
  assert.equal(rt.status,200);assert.equal(thrown.calls.items.length,1);assert.ok(!thrown.calls.logs.join('\n').includes(ROOM_NAME));
});

test('이름·요약·아이디·열기 값은 AI 재료·소식 줄·로그에 새로 들어가지 않는다(방 이름은 원래 재료)',async()=>{
  const h=harness();await h.send(body({chat_kind:'user',chat_username:USERNAME,open_ref:OPEN}));
  const sent=JSON.stringify(h.calls.openai[0]);
  assert.ok(!sent.includes(USERNAME)&&!sent.includes(OPEN),'AI에 방 아이디·열기 값을 보내지 않는다');
  assert.ok(!JSON.stringify(h.calls.items).includes(USERNAME)&&!JSON.stringify(h.calls.items).includes(OPEN));
  assert.ok(!h.calls.logs.join('\n').match(new RegExp(`${USERNAME}|${OPEN}|${SECRET_LINE}`)));
});

test('여러 묶음이면 재료에 "일부" 표시가 붙는다(둘째 묶음, 또는 보낸 수가 전체보다 적을 때)',async()=>{
  const a=harness();await a.send(body());
  assert.ok(!a.calls.openai[0].input[1].content.includes('그날 대화의 일부'));
  const b=harness();await b.send(body({part:2}));
  assert.match(b.calls.openai[0].input[1].content,/묶음: 그날 대화의 일부/);
  const c=harness();await c.send(body({total:9}));
  assert.match(c.calls.openai[0].input[1].content,/묶음: 그날 대화의 일부/);
  assert.match(TELEGRAM_INSTRUCTIONS,/그날 대화의 일부/);
  assert.ok(telegramMaterial(TODAY,'가상방',[],[],[],true).includes('그날 대화의 일부'));
});

test('하루 묶음 한도는 300(TG-1시간수집), 한 달 AI 상한은 6,000원 그대로',()=>{
  assert.equal(DAILY_LIMITS.telegram,300);assert.equal(MONTHLY_LIMIT_KRW,6000);
  assert.ok(TG_LIMITS.maxOutputTokens>=1700,'요약 몫(약 200토큰)을 출력 상한에 더했다');
});

test('AI 답 검사(day): 줄 다듬기·한도·소식 없을 때',()=>{
  const item={title:'소식',summary:'가상 요약',refs:['m1'],organization:'',project:''};
  const ok=(day,items=[item])=>parseTelegram(JSON.stringify({day,items}),2,[],[]);
  let r=ok({headline:'가'.repeat(80),lines:['나'.repeat(150),'다\u0007라','마','바','사']});
  assert.equal([...r.day.headline].length,60);assert.equal(r.day.lines.length,4,'4줄까지만');
  assert.equal([...r.day.lines[0]].length,100);assert.equal(r.day.lines[1],'다 라');
  r=ok({headline:'  ',lines:['가','나','다']});assert.equal(r.day.headline,null);assert.equal(r.day.lines.length,3);
  assert.equal(ok({headline:'제목',lines:['가','나']}).day,null);
  assert.equal(ok({headline:'제목',lines:['가','나','다']},[]).day,null,'소식이 없으면 요약도 없다');
  assert.equal(parseTelegram(JSON.stringify({items:[item]}),2,[],[]).day,null,'day 칸이 없는 옛 형식도 받는다');
  assert.equal(ok(null).day,null);assert.equal(ok([]).day,null);
  assert.equal(r.items.length,1);
  // 소식이 전부 틀리면 지금처럼 응답 전체를 버린다
  assert.equal(parseTelegram(JSON.stringify({day:DAY(),items:[{title:'',summary:'x',refs:['m9']}]}),2,[],[]),null);
  // 답 형식(strict)에 day가 들어 있고 줄 수 한도가 걸려 있다
  assert.equal(TELEGRAM_SCHEMA.properties.day.properties.lines.maxItems,4);
});

test('소스: 방 정보·요약 DB 함수는 이름 상수로만 부르고 표를 직접 쓰지 않는다',()=>{
  const src=readFileSync('supabase/functions/collector-feed/handler.ts','utf8').replace(/\/\/.*$/gm,'');
  assert.ok(!/app_feed_rooms|app_feed_room_days|app_feed_folders/.test(src),'새 표를 직접 읽거나 쓰지 않는다');
  assert.equal(ROOM_TOUCH_FN,'app_feed_room_touch');assert.equal(ROOM_DAY_ADD_FN,'app_feed_room_day_add');
});
