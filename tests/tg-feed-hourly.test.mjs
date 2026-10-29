import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// TG-1시간수집: docs/ops/collector-feed.gs 텔레그램 보내기를 1시간마다 새 메시지만 보내는 순수 함수와,
// 만든 몸통(cont 칸)이 서버 collector-feed parseTelegramBody에서 그대로 읽히는지 본다. 네트워크·Drive 없음. 사람·글은 지어낸 것이다.
const source=readFileSync(new URL('../docs/ops/collector-feed.gs',import.meta.url),'utf8');
const sandbox={module:{exports:{}}};
vm.createContext(sandbox);
vm.runInContext(source,sandbox,{filename:'collector-feed.gs'});
const G=sandbox.module.exports;
const {parseTelegramBody}=await import('../supabase/functions/collector-feed/handler.ts');
const plain=o=>JSON.parse(JSON.stringify(o));
const DAY='2026-10-28';
const m=(id,hh,sender,text='가상 안건')=>G.tgFeedParseMessage({message_id:id,date_utc:`2026-10-28T${hh}:00:00Z`,sender_id:sender,text});

test('쉬는 시각: 한국 0~7시는 쉬고 7시부터 다시 돈다. 트리거는 매시',()=>{
  const at=h=>Date.parse(`${DAY}T${String(h).padStart(2,'0')}:20:00+09:00`);
  for(const h of [0,1,3,6])assert.equal(G.tgFeedQuiet(at(h)),true,`${h}시`);
  for(const h of [7,8,12,23])assert.equal(G.tgFeedQuiet(at(h)),false,`${h}시`);
  assert.match(source,/newTrigger\('tgFeed_run'\)\.timeBased\(\)\.everyHours\(1\)/);
  assert.ok(!/atHour\(8\)\.nearMinute\(10\)/.test(source),'매일 08:10 트리거는 없다');
});

test('메시지 번호 비교: 자리수가 다른 큰 번호, 빈 기록, 숫자 아닌 번호',()=>{
  assert.equal(G.tgFeedIdAfter('10','9'),true);
  assert.equal(G.tgFeedIdAfter('9','10'),false);
  assert.equal(G.tgFeedIdAfter('12345678901234567890','12345678901234567889'),true);
  assert.equal(G.tgFeedIdAfter('5','5'),false);
  assert.equal(G.tgFeedIdAfter('5',''),true);
  assert.equal(G.tgFeedIdAfter('abc','5'),true,'숫자가 아니면 새 것으로 본다');
  assert.equal(G.tgFeedMaxId(['3','12','9']),'12');
  assert.equal(G.tgFeedMaxId([]),'');
});

test('새 메시지만: 라벨은 그날 전체 순서라 시간이 달라도 같은 사람은 같은 라벨, 글 없는 메시지는 개수에만',()=>{
  // 오전에 A(9001)·B(9002)가 말했고, 오후에 B와 새 사람 C(9003)가 말했다.
  const morning=[m('101','00','9001'),m('102','01','9002')];
  const afternoon=[m('103','05','9002','가상 답'),m('104','05','9003'),G.tgFeedParseMessage({message_id:105,date_utc:"2026-10-28T05:30:00Z",sender_id:'9003',media_type:'photo'})];
  const g1=G.tgFeedGroupDay(morning,DAY);
  const f1=G.tgFeedFresh(g1,'');
  assert.deepEqual(plain(f1.messages).map(x=>[x.ref,x.sender]),[['101','A'],['102','B']]);
  assert.equal(f1.maxId,'102');
  const g2=G.tgFeedGroupDay([...morning,...afternoon],DAY);
  const f2=G.tgFeedFresh(g2,f1.maxId);
  assert.deepEqual(plain(f2.messages).map(x=>[x.ref,x.sender]),[['103','B'],['104','C']],'오전과 같은 라벨');
  assert.equal(f2.total,3,'첨부만 있는 105도 새 메시지 수에 든다');
  assert.equal(f2.maxId,'105');
  const f3=G.tgFeedFresh(g2,f2.maxId);
  assert.equal(f3.total,0);assert.equal(f3.messages.length,0);assert.equal(f3.maxId,'');
  // 이름표는 이번에 보내는 라벨만
  assert.deepEqual(plain(G.tgFeedSendersFor([{label:'A',key:'k'},{label:'B'},{label:'C'}],f2.messages)).map(s=>s.label),['B','C']);
});

test('보낸 뒤 상태: 오늘은 번호만 옮기고 끝낸 날로 적지 않는다. 끝난 날은 마지막 묶음 뒤 끝낸 날. 보충 구간은 번호를 건드리지 않는다',()=>{
  const rs={doneDay:'2026-10-27',backDay:'',partDay:'',partsDone:0,lastId:'',lastDay:''};
  let s=G.tgFeedAfterSend(rs,DAY,false,true,'102','102');
  assert.deepEqual(plain(s),{doneDay:'2026-10-27',backDay:'',partDay:'',partsDone:0,lastId:'102',lastDay:DAY});
  // 다음 날 첫 실행: 어제(DAY)의 남은 새 메시지를 두 묶음으로 보냄
  s=G.tgFeedAfterSend(s,DAY,false,false,'150','');
  assert.equal(s.doneDay,'2026-10-27','첫 묶음 뒤에는 아직 끝내지 않음');assert.equal(s.lastId,'150');
  s=G.tgFeedAfterSend(s,DAY,false,false,'180','181');
  assert.equal(s.doneDay,DAY);assert.equal(s.lastId,'181');
  // 새 메시지가 없는 끝난 날은 바로 끝낸 날
  assert.equal(G.tgFeedAfterSend(s,'2026-10-29',false,false,'','').doneDay,'2026-10-29');
  // 새 메시지가 없는 오늘은 그대로
  assert.deepEqual(plain(G.tgFeedAfterSend(s,'2026-10-29',false,true,'','')),plain(s));
  // 보충 구간
  const b=G.tgFeedAfterSend({...rs,backDay:'2026-10-20',lastId:'90'},'2026-10-21',true,false,'5','5');
  assert.equal(b.backDay,'2026-10-21');assert.equal(b.lastId,'90');assert.equal(b.doneDay,'2026-10-27');
});

test('보낼 날: 오늘을 넣을 때만 오늘까지(평소 계산·남은 날 표시는 어제까지)',()=>{
  assert.deepEqual(plain(G.tgFeedPendingDays('2026-10-26','2026-10-20',DAY,true)),['2026-10-27',DAY]);
  assert.deepEqual(plain(G.tgFeedPendingDays('2026-10-26','2026-10-20',DAY)),['2026-10-27']);
  const st={startDay:'2026-10-20',backFrom:'',rooms:{r:{d:'2026-10-27',m:'102',l:DAY}}};
  const rs=plain(G.tgFeedRoomState(st,'r'));
  assert.equal(rs.lastId,'102');assert.equal(rs.lastDay,DAY);
  assert.deepEqual(plain(G.tgFeedPlanDays(rs,st,DAY,true)),[{day:DAY,back:false}]);
  assert.deepEqual(plain(G.tgFeedCompactRoom(rs,st)),{d:'2026-10-27',m:'102',l:DAY});
});

test('되돌리기: 그 날 이후 보낸 번호 기록도 지워 그 날부터 다시 보낸다',()=>{
  const st={startDay:'2026-10-20',backFrom:'',rooms:{r:{d:'2026-10-27',m:'200',l:'2026-10-27'},q:{d:'2026-10-24',m:'50',l:'2026-10-24'}},attempts:{}};
  const res=G.tgFeedRewind(st,'2026-10-26','2026-10-28');
  assert.equal(res.changed,1);
  const r=plain(G.tgFeedRoomState(res.state,'r'));
  assert.equal(r.doneDay,'2026-10-25');assert.equal(r.lastId,'');
  assert.equal(plain(G.tgFeedRoomState(res.state,'q')).lastId,'50','더 앞선 방은 그대로');
});

test('몸통: 앞서 보낸 방·날이면 cont를 넣고 서버 parseTelegramBody가 읽는다. 없으면 넣지 않는다',()=>{
  const msgs=G.tgFeedFresh(G.tgFeedGroupDay([m('103','05','9002')],DAY),'').messages;
  const today='2026-10-28';
  const b1=plain(G.tgFeedBuildBody({day:DAY,roomKey:'-1001',roomLabel:'가상 방',total:1,part:1,attempt:1,messages:msgs,cont:true}));
  assert.equal(b1.cont,true);
  assert.equal(parseTelegramBody(b1,today).cont,true);
  const b2=plain(G.tgFeedBuildBody({day:DAY,roomKey:'-1001',roomLabel:'가상 방',total:1,part:1,attempt:1,messages:msgs}));
  assert.ok(!('cont' in b2));
  assert.equal(parseTelegramBody(b2,today).cont,false);
  assert.throws(()=>parseTelegramBody({...b2,cont:'yes'},today),/INVALID_BODY/);
});

test('스크립트 문구: 매일 08:10·하루 상한 80개 같은 옛 안내가 남지 않는다',()=>{
  const tg=source.slice(source.indexOf('텔레그램 보내기 (TG-소식메뉴 3-나)'),source.indexOf('// node 시험에서만'));
  const code=tg.replace(/\/\*\*?[\s\S]*?\*\//g,'');
  assert.ok(!/내일 08:10/.test(code));
  assert.ok(!/묶음 80개/.test(code));
});

// ---- 서버(collector-feed): 앞서 모인 소식으로 그날 요약 다시 쓰기 ----
const H=await import('../supabase/functions/collector-feed/handler.ts');
const T=await import('../supabase/functions/collector-feed/telegram.ts');
const SB='https://synthetic.supabase.test',WS='a0000000-0000-4000-8000-000000000001',SECRET='synthetic-collector-feed-secret-0123456789';
const NOW=Date.parse('2026-10-28T03:00:00Z'),TODAY='2026-10-28';
const respond=(b,status=200)=>new Response(JSON.stringify(b),{status,headers:{'Content-Type':'application/json'}});
const aiOk=()=>respond({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({
  day:{headline:'가상 하루 흐름',lines:['앞서 모인 일과 새 일을 합친 첫 줄.','둘째 줄.','셋째 줄.']},
  items:[{title:'가상 새 소식',summary:'가상 새 일이 생겼다.',refs:['m1'],organization:'',project:''}]})}]}],usage:{input_tokens:100,output_tokens:50}});
function harness({context='ok'}={}){
  const calls={openai:[],rpc:[],days:[]};
  const doFetch=async(input,init={})=>{
    const url=new URL(String(input)),method=init.method||'GET';
    if(url.origin==='https://api.openai.com'){calls.openai.push(JSON.parse(init.body));return aiOk();}
    const path=url.pathname.replace('/rest/v1/','');
    if(path==='rpc/app_operator_feature_workspace')return respond(WS);
    if(path.startsWith('rpc/')){
      const fn=path.slice(4),args=JSON.parse(init.body);calls.rpc.push({fn,args});
      if(fn===H.ROOM_DAY_CONTEXT_FN){
        if(context==='missing')return respond({code:'PGRST202',message:'not found'},404);
        if(context==='fail')return respond({message:'x'},500);
        return respond([{at:'2026-10-28T00:10:00+00:00',title:'가상 앞선 소식',summary:'가상 앞선 일이 정해졌다.'}]);
      }
      if(fn===H.NAMES_FN)return respond([]);
      return respond({ok:true,added:true});
    }
    if(path==='app_workspaces')return respond([{id:WS}]);
    if(path==='app_suborganizations'||path==='app_spaces')return respond([]);
    if(path==='app_feed_items'){if(method==='GET')return respond([]);return new Response(null,{status:201});}
    if(path==='app_feed_days'){if(method==='GET')return respond([]);if(method==='POST'){calls.days.push(JSON.parse(init.body));return new Response(null,{status:201});}return respond([{day:TODAY}]);}
    throw new Error('unexpected '+method+' '+path);
  };
  const handler=H.createCollectorFeedHandler({env:n=>({SUPABASE_URL:SB,SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',COLLECTOR_FEED_SECRET:SECRET,WEB2_OPENAI_API_KEY:'synthetic-openai'})[n],fetch:doFetch,now:()=>NOW,sleep:async()=>{},log:()=>{}});
  const send=b=>handler(new Request(`${SB}/functions/v1/collector-feed?action=telegram`,{method:'POST',headers:{'Content-Type':'application/json','x-collector-feed-secret':SECRET},body:JSON.stringify(b)}));
  return {send,calls};
}
const tgBody=(o={})=>({day:TODAY,room_key:'-1001234',room_label:'가상 방',total:1,messages:[{ref:'2001',at:'2026-10-28T02:10:00Z',sender:'A',text:'가상 새 일이 생겼습니다'}],...o});

test('서버: 앞서 모인 소식을 읽어 재료에 붙이고, 그날 요약은 c- 묶음으로 저장한다. cont면 방 수를 다시 세지 않는다',async()=>{
  const h=harness();
  const r=await h.send(tgBody({cont:true}));
  assert.equal(r.status,200);assert.equal((await r.json()).kept,1);
  const ctx=h.calls.rpc.find(c=>c.fn===H.ROOM_DAY_CONTEXT_FN);
  assert.deepEqual(ctx.args,{p_workspace:WS,p_room_key:'-1001234',p_day:TODAY});
  const material=h.calls.openai[0].input[1].content;
  assert.match(material,/앞서 모인 소식:\n- 09:10 가상 앞선 소식: 가상 앞선 일이 정해졌다\./);
  assert.match(material,/묶음: 그날 대화의 일부/,'이어 보내는 묶음은 그날의 일부');
  assert.match(T.TELEGRAM_INSTRUCTIONS,/앞서 모인 소식과 이번에 남긴 소식을 모두 합쳐/);
  const add=h.calls.rpc.find(c=>c.fn===H.ROOM_DAY_ADD_FN);
  assert.match(add.args.p_part.batch,/^c-[0-9a-f]{32}$/);
  assert.equal(H.CUMULATIVE_PREFIX,'c-');
  const counted=h.calls.days.filter(d=>d.day===TODAY&&'room_count' in d);
  assert.ok(counted.every(d=>!d.room_count),'cont면 방 수 0');
});

test('서버: 앞서 모인 소식 함수가 없거나 실패하면 지금처럼 묶음 몫 요약(c- 없음)으로 저장하고 소식 저장은 계속한다',async()=>{
  for(const context of ['missing','fail']){
    const h=harness({context});
    const r=await h.send(tgBody());
    assert.equal(r.status,200,context);assert.equal((await r.json()).kept,1);
    assert.doesNotMatch(h.calls.openai[0].input[1].content,/앞서 모인 소식/);
    const add=h.calls.rpc.find(c=>c.fn===H.ROOM_DAY_ADD_FN);
    assert.match(add.args.p_part.batch,/^[0-9a-f]{32}$/,context);
  }
  const h=harness();await h.send(tgBody());
  assert.ok(h.calls.days.some(d=>d.day===TODAY&&d.room_count===1),'처음 보내는 방·날은 방 수 1');
});

test('서버 재료: 앞서 모인 소식은 40개·요약 200자까지만',()=>{
  const many=Array.from({length:45},(_,i)=>({at:NOW,title:`제목${i}`,summary:'가'.repeat(300)}));
  const mat=T.telegramMaterial(TODAY,'가상 방',[],[],[],true,new Map(),many);
  const lines=mat.split('\n').filter(l=>l.startsWith('- '));
  assert.equal(lines.length,40);
  assert.ok(lines.every(l=>(l.match(/가/g)||[]).length===200));
  assert.ok(!T.telegramMaterial(TODAY,'가상 방',[],[],[]).includes('앞서 모인 소식'));
});
