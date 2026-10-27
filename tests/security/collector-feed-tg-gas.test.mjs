import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// TG 3-나: docs/ops/collector-feed.gs의 텔레그램 보내기 순수 함수(묶기·이어 하기 상태)를 node에서 돌리고,
// 만든 몸통이 서버 collector-feed(handler.ts parseTelegramBody)에서 그대로 읽히는지 본다.
// 네트워크·Drive 없음. 방·사람·글은 모두 지어낸 것이다.
const source=readFileSync(new URL('../../docs/ops/collector-feed.gs',import.meta.url),'utf8');
const sandbox={module:{exports:{}}};
vm.createContext(sandbox);
vm.runInContext(source,sandbox,{filename:'collector-feed.gs'});
const G=sandbox.module.exports;
const {parseTelegramBody}=await import('../../supabase/functions/collector-feed/handler.ts');
const plain=(o)=>JSON.parse(JSON.stringify(o));
const TODAY='2026-10-25';

function msg(id,{utc,text='가상 안건 공유합니다',sender='9001',extra={}}={}){
  return {message_id:id,date_utc:utc,date_kst:'x',sender_id:sender,text,...extra};
}

test('앱 스크립트 파일: 텔레그램 구간에 폴더 ID·비밀값·방 이름이 없고, 쓰기 함수를 쓰지 않는다',()=>{
  assert.match(source,/var TG_FEED_ROOT_FOLDER = '여기에_텔레그램_수집_폴더_주소_끝부분';/);
  const tg=source.slice(source.indexOf('텔레그램 보내기 (TG-소식메뉴 3-나)'),source.indexOf('// node 시험에서만'));
  assert.ok(tg.length>2000);
  assert.ok(!/1[A-Za-z0-9_-]{30,}/.test(tg),'Drive ID처럼 긴 글자가 없어야 한다');
  assert.ok(!/setDescription|setContent|setName|setTrashed|moveTo|createFile|createFolder|makeCopy/.test(tg),'Drive를 고치지 않는다');
  for(const m of tg.matchAll(/(?:Logger\.log|new Error)\(([^;]*)\)/g)) assert.ok(!/\bsecret\b|getProperty\(CALL_FEED_SECRET_KEY\)/.test(m[1]),m[0]);
  assert.match(tg,/getProperty\(TG_FEED_TEST_KEY\) !== '끔'/,'시험 모드 기본 켬');
  assert.ok(tg.includes("?action=telegram")&&tg.includes('CALL_FEED_SECRET_KEY'),'통화와 같은 입구·비밀값');
  assert.ok(tg.includes("atHour(8).nearMinute(10)"),'08:10 트리거');
  // 검토후보·AI 검토 상태 파일은 읽지도 않는다(Q9).
  assert.ok(!/검토후보|telegram_ai_review_state/.test(tg.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm,'')),'코드에서 검토후보·상태 파일을 가리키지 않는다');
});

test('허용 방 목록: 폴더 이름 전체 또는 맨 앞 방 번호로 맞고, 목록에 없는 폴더는 맞지 않는다',()=>{
  const wanted=G.tgFeedParseRooms('-100123_가상 업무방, 777 ;\n  가상 일대일 \n-100123_가상 업무방');
  assert.deepEqual(plain(wanted),['-100123_가상 업무방','777','가상 일대일']);
  assert.equal(G.tgFeedRoomMatch('-100123_가상 업무방',wanted),'-100123_가상 업무방');
  assert.equal(G.tgFeedRoomMatch('777_가상 다른 방',wanted),'777');
  assert.equal(G.tgFeedRoomMatch('7777_가상 개인방',wanted),'','번호 앞부분만 같은 방은 맞지 않는다');
  assert.equal(G.tgFeedRoomMatch('999_개인 수집방',wanted),'');
  assert.equal(G.tgFeedRoomPick('-100777_가상 새 업무방',['*'],[]),'*','*면 모든 방');
  assert.equal(G.tgFeedRoomPick('-100778_가상 가족방',['*'],['가상 가족방']),'','*여도 뺄 목록은 뺀다');
  assert.equal(G.tgFeedRoomPick('-100779_가상 업무방',['가상 업무방'],['가상 업무방']),'','뺄 목록이 허용보다 앞선다');
  assert.equal(G.tgFeedRoomMatch('-100555_가상 이름만 적은 방',['가상 이름만 적은 방']),'가상 이름만 적은 방','번호 뒤 방 이름 전체로도 맞는다');
  assert.equal(G.tgFeedRoomMatch('-100555_가상 이름만 적은 방 2',['가상 이름만 적은 방']),'','방 이름 일부만 같으면 맞지 않는다');
  assert.deepEqual(plain(G.tgFeedRoomInfo('-100123_가상 업무방')),{key:'-100123',label:'가상 업무방'});
  assert.equal(G.tgFeedRoomInfo('이름만 있는 폴더'),null);
});

test('메시지 파일 읽기: 한국 날짜, 시스템·첨부만 있는 메시지, 시간대 없는 값',()=>{
  // UTC 15:30은 한국 다음 날 00:30
  const a=G.tgFeedParseMessage(msg(11,{utc:'2026-10-23T15:30:00+00:00'}));
  assert.equal(a.day,'2026-10-24');assert.equal(a.at,'2026-10-23T15:30:00.000Z');assert.equal(a.id,'11');assert.equal(a.hasText,true);
  // date_utc가 없으면 date_kst(시간대 없음 = 한국 시간)
  const b=G.tgFeedParseMessage({message_id:'12',date_kst:'2026-10-24 09:05:00',text:'가상'});
  assert.equal(b.at,'2026-10-24T00:05:00.000Z');assert.equal(b.day,'2026-10-24');
  const sys=G.tgFeedParseMessage(msg(13,{utc:'2026-10-24T01:00:00Z',text:'',extra:{service_action:'join'}}));
  assert.equal(sys.service,true);assert.equal(sys.hasText,false);
  const att=G.tgFeedParseMessage(msg(14,{utc:'2026-10-24T01:00:00Z',text:null,extra:{media_type:'photo'}}));
  assert.equal(att.hasText,false);assert.equal(att.service,false);
  assert.equal(G.tgFeedParseMessage({message_id:'x y',date_utc:'2026-10-24T01:00:00Z'}),null);
  assert.equal(G.tgFeedParseMessage({message_id:'1',date_utc:'엉터리'}),null);
  assert.equal(G.tgFeedParseMessage(null),null);
  // 너무 긴 글은 4000자로 자른다
  assert.equal(Array.from(G.tgFeedParseMessage(msg(15,{utc:'2026-10-24T01:00:00Z',text:'가'.repeat(5000)})).text).length,4000);
});

test('날짜별 묶기: 그 날만, 시스템 메시지 뺌, 같은 id 한 번, 글 없는 것은 개수에만',()=>{
  const list=[
    msg(3,{utc:'2026-10-24T02:00:00Z',sender:'2'}),
    msg(1,{utc:'2026-10-24T01:00:00Z',sender:'1'}),
    msg(1,{utc:'2026-10-24T01:00:00Z',sender:'1',text:'수정본은 쓰지 않음'}),
    msg(2,{utc:'2026-10-24T01:30:00Z',text:null,extra:{media_type:'photo'}}),
    msg(4,{utc:'2026-10-24T02:10:00Z',text:'',extra:{service_action:'pin'}}),
    msg(5,{utc:'2026-10-25T01:00:00Z'}),
  ].map(G.tgFeedParseMessage);
  const g=G.tgFeedGroupDay(list,'2026-10-24');
  assert.equal(g.total,3,'시스템 뺀 3개(글 2 + 첨부 1)');
  assert.deepEqual(plain(g.messages.map((m)=>m.id)),['1','3']);
  assert.equal(g.messages[0].text,'가상 안건 공유합니다');
  assert.equal(G.tgFeedGroupDay(list,'2026-10-26').total,0);
});

test('보낸 이는 처음 나온 순서대로 A, B, C … 로 바꾸고 실제 값은 남지 않는다',()=>{
  const ms=[msg(1,{utc:'2026-10-24T01:00:00Z',sender:'8123456789'}),msg(2,{utc:'2026-10-24T01:01:00Z',sender:'42'}),msg(3,{utc:'2026-10-24T01:02:00Z',sender:'8123456789',extra:{reply_to_message_id:1}})]
    .map(G.tgFeedParseMessage);
  const out=G.tgFeedAssignSenders(ms);
  assert.deepEqual(plain(out.map((m)=>m.sender)),['A','B','A']);
  assert.equal(out[2].reply_to,'1');
  assert.ok(!JSON.stringify(out).includes('8123456789'));
  assert.deepEqual(plain([0,1,25,26,27,701,702].map(G.tgFeedSenderName)),['A','B','Z','AA','AB','ZZ','AAA']);
});

test('쪼개기: 300개·200 KB 안에서 순서를 지키고, 같은 입력이면 같게 쪼갠다',()=>{
  const many=Array.from({length:650},(_,i)=>({ref:String(i+1),at:'2026-10-24T01:00:00.000Z',sender:'A',text:'글',reply_to:null,forwarded:false}));
  const p=G.tgFeedSplit(many);
  assert.deepEqual(plain(p.map((x)=>x.length)),[300,300,50]);
  assert.deepEqual(plain(G.tgFeedSplit(many).map((x)=>x.length)),[300,300,50]);
  const big=Array.from({length:120},(_,i)=>({ref:String(i+1),at:'2026-10-24T01:00:00.000Z',sender:'A',text:'가'.repeat(2000),reply_to:null,forwarded:false}));
  const q=G.tgFeedSplit(big);
  assert.ok(q.length>=3);
  for(const part of q) assert.ok(G.callFeedBytes(JSON.stringify(part))<=200*1024);
  assert.equal(q.flat().length,120);
  assert.deepEqual(plain(G.tgFeedSplit([])),[]);
});

test('만든 몸통이 서버 parseTelegramBody에서 그대로 읽힌다(묶음 둘, 답글·전달 포함)',()=>{
  const ms=[
    msg(1,{utc:'2026-10-24T00:30:00Z',sender:'1'}),
    msg(2,{utc:'2026-10-24T00:31:00Z',sender:'2',extra:{reply_to_message_id:1,forwarded:true}}),
    msg(3,{utc:'2026-10-24T00:32:00Z',sender:'1',extra:{reply_to_message_id:'99999999999999999999999999999999999999999999'}}),
  ].map(G.tgFeedParseMessage);
  const g=G.tgFeedGroupDay(ms,'2026-10-24');
  const parts=G.tgFeedSplit(G.tgFeedAssignSenders(g.messages));
  const body=plain(G.tgFeedBuildBody({day:'2026-10-24',roomKey:'-100123',roomLabel:'가상 업무방',total:7,part:2,attempt:3,messages:parts[0]}));
  assert.equal(body.part,2);assert.equal(body.attempt,3);assert.equal(body.total,7);
  const input=parseTelegramBody(body,TODAY);
  assert.equal(input.room_key,'-100123');assert.equal(input.room_label,'가상 업무방');
  assert.equal(input.messages.length,3);assert.equal(input.messages[1].forwarded,true);assert.equal(input.messages[1].reply_to,'1');
  assert.equal(input.messages[2].reply_to,null,'너무 긴 답글 번호는 보내지 않는다');
  // 첫 묶음·첫 시도에는 part·attempt 칸을 넣지 않는다
  const first=plain(G.tgFeedBuildBody({day:'2026-10-24',roomKey:'1',roomLabel:'방',total:1,part:1,attempt:1,messages:[]}));
  assert.ok(!('part' in first)&&!('attempt' in first));
  parseTelegramBody(first,TODAY);
});

test('이어 하기 상태: 시작 날짜, 보낼 날짜 목록, 묶음 중간에서 이어 하기',()=>{
  const state={startDay:'2026-10-24',rooms:{},attempts:{}};
  const rs=plain(G.tgFeedRoomState(state,'-100123'));
  assert.deepEqual(rs,{doneDay:'2026-10-23',backDay:'',partDay:'',partsDone:0});
  // 오늘(10/25) 08:10: 어제(10/24)까지만. 오늘은 아직 끝나지 않았다.
  assert.deepEqual(plain(G.tgFeedPendingDays(rs.doneDay,state.startDay,'2026-10-25')),['2026-10-24']);
  assert.deepEqual(plain(G.tgFeedPendingDays(rs.doneDay,state.startDay,'2026-10-24')),[],'시작한 날 당일에는 보낼 것이 없다');
  // 사흘 밀렸으면 사흘치 순서대로
  assert.deepEqual(plain(G.tgFeedPendingDays('2026-10-24','2026-10-24','2026-10-28')),['2026-10-25','2026-10-26','2026-10-27']);
  // 시작 날짜 앞은 보내지 않는다
  assert.deepEqual(plain(G.tgFeedPendingDays('2026-10-01','2026-10-26','2026-10-28')),['2026-10-26','2026-10-27']);
  // 서버가 받는 92일보다 오래된 날은 뺀다
  const old=G.tgFeedPendingDays('2026-01-01','2026-01-01','2026-10-25');
  assert.equal(old[0],'2026-07-25');assert.equal(old.at(-1),'2026-10-24');
  // 묶음 3개 중 하나를 보내고 멈춤 → 다음 실행은 둘째부터
  let s=G.tgFeedAfterPart(rs,'2026-10-24',0,3);
  assert.deepEqual(plain(s),{doneDay:'2026-10-23',backDay:'',partDay:'2026-10-24',partsDone:1});
  assert.equal(G.tgFeedPartsToSkip(s,'2026-10-24'),1);
  assert.equal(G.tgFeedPartsToSkip(s,'2026-10-25'),0,'다른 날짜 기록은 쓰지 않는다');
  s=G.tgFeedAfterPart(s,'2026-10-24',1,3);
  assert.equal(G.tgFeedPartsToSkip(s,'2026-10-24'),2);
  s=G.tgFeedAfterPart(s,'2026-10-24',2,3);
  assert.deepEqual(plain(s),{doneDay:'2026-10-24',backDay:'',partDay:'',partsDone:0});
  assert.deepEqual(plain(G.tgFeedPendingDays(s.doneDay,state.startDay,'2026-10-25')),[],'같은 날은 두 번 보내지 않는다');
  // 저장된 상태가 깨져도 시작 날짜로 되돌아간다
  assert.deepEqual(plain(G.tgFeedRoomState({startDay:'2026-10-24',rooms:{a:{doneDay:'엉터리',partsDone:-4}}},'a')),{doneDay:'2026-10-23',backDay:'',partDay:'',partsDone:0});
});

test('파일 찾는 범위: 그 날 0시(한국)부터 3일, 월 폴더는 한국 달과 UTC 달',()=>{
  const w=G.tgFeedWindow('2026-10-24');
  assert.equal(new Date(w.fromMs).toISOString(),'2026-10-23T15:00:00.000Z');
  assert.equal(new Date(w.toMs).toISOString(),'2026-10-26T15:00:00.000Z');
  assert.deepEqual(plain(G.tgFeedMonths('2026-10-24')),['2026-10']);
  assert.deepEqual(plain(G.tgFeedMonths('2026-11-01')),['2026-11','2026-10']);
});

test('서버 응답 → 할 일',()=>{
  const v=G.tgFeedVerdict;
  assert.equal(v(200),'ok');assert.equal(v(401),'auth');assert.equal(v(429),'limit');
  assert.equal(v(400),'drop');assert.equal(v(413),'drop');
  assert.equal(v(503,'AI_NOT_CONFIGURED'),'pause');assert.equal(v(503,'DB_UNAVAILABLE'),'pause');
  assert.equal(v(503,'AI_UNAVAILABLE'),'retry');assert.equal(v(502,'AI_INVALID_RESPONSE'),'retry');
  assert.equal(v(504,'AI_TIMEOUT'),'retry');assert.equal(v(0),'retry');assert.equal(v(500),'retry');
});

test('텔레그램 실패 로그에 서버 오류 코드가 그대로 찍힌다(503 원인 확인용)',()=>{
  const tg=source.slice(source.indexOf('텔레그램 보내기 (TG-소식메뉴 3-나)'),source.indexOf('// node 시험에서만'));
  const withCode="(res.json && res.json.error ? ' ' + res.json.error : '')";
  assert.ok(tg.includes("stop = '서버·연결 실패(HTTP ' + res.code + "+withCode),'다시 보낼 때 멈춤 사유');
  assert.ok(tg.includes("' 묶음 ' + (p + 1) + ' (HTTP ' + res.code + "+withCode+" + ')');"),'3번 실패 로그');
});

// ---- 최근 7일 보충·상한 (feed-send) ----------------------------------------------------------------------------
test('시작 날짜 앞 7일 보충: 방마다 따로 이어 하고, 평소 구간과 같은 날이 겹치지 않는다',()=>{
  // 예전 설치: 시작 날짜 10/24, 오늘 10/25 08:10 → 보충 구간은 10/18~10/23, 평소 구간은 10/24(어제)
  const state={startDay:'2026-10-24',backChecked:true,backFrom:'2026-10-18',rooms:{},attempts:{}};
  const rs=plain(G.tgFeedRoomState(state,'-100123'));
  assert.deepEqual(rs,{doneDay:'2026-10-23',backDay:'2026-10-17',partDay:'',partsDone:0});
  const plan=plain(G.tgFeedPlanDays(rs,state,'2026-10-25'));
  assert.deepEqual(plan.map((p)=>p.day),['2026-10-18','2026-10-19','2026-10-20','2026-10-21','2026-10-22','2026-10-23','2026-10-24']);
  assert.deepEqual(plan.filter((p)=>p.back).map((p)=>p.day),['2026-10-18','2026-10-19','2026-10-20','2026-10-21','2026-10-22','2026-10-23']);
  assert.equal(new Set(plan.map((p)=>p.day)).size,plan.length,'같은 날이 두 번 들어가지 않는다');
  // 보충 구간의 날 하나를 끝내면 backDay만 앞으로 가고 doneDay는 그대로
  let s=G.tgFeedAfterPart(rs,'2026-10-18',0,1,true);
  assert.deepEqual(plain(s),{doneDay:'2026-10-23',backDay:'2026-10-18',partDay:'',partsDone:0});
  // 묶음 중간에서 멈춰도 backDay·doneDay는 그대로, 날짜만 적는다
  s=G.tgFeedAfterPart(s,'2026-10-19',0,2,true);
  assert.deepEqual(plain(s),{doneDay:'2026-10-23',backDay:'2026-10-18',partDay:'2026-10-19',partsDone:1});
  s=G.tgFeedAfterPart(s,'2026-10-19',1,2,true);
  const st2={...state,rooms:{r:plain(s)}};
  const plan2=plain(G.tgFeedPlanDays(plain(G.tgFeedRoomState(st2,'r')),st2,'2026-10-25'));
  assert.deepEqual(plan2.map((p)=>p.day),['2026-10-20','2026-10-21','2026-10-22','2026-10-23','2026-10-24'],'끝낸 날은 다시 보내지 않는다');
  // 평소 구간을 끝내면 doneDay만 앞으로
  assert.deepEqual(plain(G.tgFeedAfterPart(rs,'2026-10-24',0,1,false)),{doneDay:'2026-10-24',backDay:'2026-10-17',partDay:'',partsDone:0});
  // 보충 구간을 모두 끝낸 방, 보충이 필요 없는 설치(처음 설치·backFrom 없음)
  const done={...state,rooms:{r:{doneDay:'2026-10-24',backDay:'2026-10-23'}}};
  assert.deepEqual(plain(G.tgFeedPlanDays(plain(G.tgFeedRoomState(done,'r')),done,'2026-10-26')),[{day:'2026-10-25',back:false}]);
  const fresh={startDay:'2026-10-18',backChecked:true,backFrom:'',rooms:{},attempts:{}};
  assert.deepEqual(plain(G.tgFeedPlanDays(plain(G.tgFeedRoomState(fresh,'r')),fresh,'2026-10-25')).map((p)=>p.day),
    ['2026-10-18','2026-10-19','2026-10-20','2026-10-21','2026-10-22','2026-10-23','2026-10-24']);
  assert.ok(plain(G.tgFeedPlanDays(plain(G.tgFeedRoomState(fresh,'r')),fresh,'2026-10-25')).every((p)=>!p.back));
  // 서버가 받는 92일보다 오래된 날은 뺀다
  assert.deepEqual(plain(G.tgFeedBackfillDays('2026-01-01','2026-01-02','2026-01-04','2026-10-25')),[]);
});

test('한 번 실행에 보낼 묶음 상한이 있고, 넘으면 이어 하기로 나눈다. 처음 설치는 시작 날짜를 7일 전으로 적는다',()=>{
  assert.match(source,/var TG_FEED_MAX_PARTS_PER_RUN = 30;/);
  assert.match(source,/tally\.parts >= TG_FEED_MAX_PARTS_PER_RUN\) \{ run\.stop = [^\n]*run\.resumable = true; break; \}/);
  assert.match(source,/state\.startDay = tgFeedAddDays\(callFeedKstDay\(Date\.now\(\)\), -TG_FEED_RECENT_DAYS\);/);
});

// ---- 멈춤 가시화·빠진 날 다시 보내기 (TG-소식멈춤) ------------------------------------------------------------
test('429는 하루 상한과 이번 달 AI 상한을 구분해 멈춘 이유를 적는다',()=>{
  assert.match(G.tgFeedLimitReason('AI_MONTHLY_LIMIT'),/다음 달 1일/);
  assert.match(G.tgFeedLimitReason('DAILY_LIMIT'),/하루 상한/);
  assert.match(G.tgFeedLimitReason(undefined),/429/);
  assert.ok(source.includes("run.stop = tgFeedLimitReason(res.json && res.json.error); return;"),'429 처리에서 오류 코드를 넘긴다');
});

test('마지막 실행 기록과 방별 진행 요약: 멈춘 방이 몇 개인지 보인다',()=>{
  const lr=G.tgFeedLastRun(Date.parse('2026-10-26T08:12:00+09:00'),'서버 하루 상한',30,12,1);
  assert.deepEqual(plain(G.tgFeedLastRunClean(lr)),plain(lr));
  assert.equal(G.tgFeedLastRunClean({at:'x'}),null);
  assert.match(G.tgFeedLastRunText(lr),/2026-10-26 08:12.*보낸 묶음 30.*서버 하루 상한/);
  assert.match(G.tgFeedLastRunText(null),/기록 없음/);
  const state={startDay:'2026-10-18',backFrom:'',rooms:{'1':{doneDay:'2026-10-25'},'2':{doneDay:'2026-10-24'}}};
  const p=G.tgFeedProgress(state,['1','2','3'],'2026-10-26');
  assert.deepEqual(plain(p),{rooms:3,min:'2026-10-17',max:'2026-10-25',behind:2,yesterday:'2026-10-25'});
  assert.match(G.tgFeedProgressText(p,'2026-10-26'),/3개 방 중 어제\(2026-10-25\)까지 끝낸 방 1개 · 못 끝낸 방 2개/);
});

test('빠진 날 다시 보내기: 방마다 끝낸 날을 하루 전으로, 더 앞선 방·범위 밖 날짜는 그대로·거절',()=>{
  const state={startDay:'2026-10-18',backFrom:'',rooms:{'1':{doneDay:'2026-10-25',partDay:'2026-10-25',partsDone:1},'2':{doneDay:'2026-10-23'}},attempts:{'1|2026-10-25|1':2,'1|2026-10-20|1':1},chain:0};
  const r=G.tgFeedRewind(state,'2026-10-25','2026-10-26');
  assert.equal(r.changed,1);
  assert.deepEqual(plain(r.state.rooms['1']),{doneDay:'2026-10-24',backDay:'',partDay:'',partsDone:0});
  assert.equal(r.state.rooms['2'].doneDay,'2026-10-23','이미 더 앞선 방은 그대로');
  assert.deepEqual(plain(r.state.attempts),{'1|2026-10-20|1':1},'되돌린 날 이후의 재시도 횟수만 지운다');
  assert.equal(state.rooms['1'].doneDay,'2026-10-25','원본 상태는 바꾸지 않는다');
  // 되돌린 뒤 보낼 날짜 목록에 그 날이 다시 들어온다
  const plan=G.tgFeedPlanDays(G.tgFeedRoomState(r.state,'1'),r.state,'2026-10-26');
  assert.deepEqual(plain(plan.map((x)=>x.day)),['2026-10-25']);
  assert.ok(G.tgFeedRewind(state,'','2026-10-26').error);
  assert.ok(G.tgFeedRewind(state,'2026-10-26','2026-10-26').error,'오늘은 안 됨');
  assert.ok(G.tgFeedRewind(state,'2026-10-10','2026-10-26').error,'7일보다 오래된 날은 안 됨');
  const early=G.tgFeedRewind({startDay:'2026-10-26',backFrom:'',rooms:{},attempts:{}},'2026-10-25','2026-10-27');
  assert.equal(early.state.startDay,'2026-10-25','시작 날짜가 더 뒤이면 당겨 상태에 없는 방도 받게 한다');
});

test('실행 확인 함수는 트리거 유무와 진행 위치를 보여 주고, 마지막 실행을 저장한다(비밀·토큰 출력 없음)',()=>{
  assert.ok(source.includes("feedTriggerSummary_(['tgFeed_run', 'tgFeed_continue']"));
  assert.ok(source.includes("feedTriggerSummary_(['callFeed_run']"));
  assert.ok(source.includes("state.lastRun = tgFeedLastRun(Date.now(), stop, tally.parts"));
  assert.ok(source.includes("deleteProperty(TG_FEED_REWIND_KEY)"));
});

// ── TG-발언자이름 3단계: senders(이름표) ──────────────────────────────────────
import {createHmac} from 'node:crypto';
const FAKE_SECRET='가짜열쇠-테스트용-0123456789abcdef';
const hmacKey=(number)=>createHmac('sha256',FAKE_SECRET).update(String(number)).digest('hex').slice(0,32);
const parsed=(items)=>items.map(G.tgFeedParseMessage);

test('HMAC 16진수: 앱 스크립트의 부호 있는 바이트 배열이 node HMAC 앞 32자와 같다',()=>{
  const digest=createHmac('sha256',FAKE_SECRET).update('8123456789').digest();
  const signed=Array.from(digest,(b)=>b>127?b-256:b);   // Utilities.computeHmacSha256Signature는 -128..127
  assert.equal(G.tgFeedHmacHex(signed),hmacKey('8123456789'));
  assert.match(G.tgFeedHmacHex(signed),/^[0-9a-f]{32}$/);
});

test('이름 정리: 제어문자·빈칸 정리, 40글자 제한, 전화번호·@아이디·비문자열은 버린다',()=>{
  assert.equal(G.tgFeedCleanName('  가상  김철수\n과장 '),'가상 김철수 과장');
  assert.equal(G.tgFeedCleanName('가'.repeat(60)).length,40);
  for(const bad of ['@gasang_id','010-1234-5678','+82 10 1234 5678','(02) 123-4567','',' ',null,undefined,123,{a:1}]) assert.equal(G.tgFeedCleanName(bad),'',String(bad));
  assert.equal(G.tgFeedCleanName('가상 3팀'),'가상 3팀','숫자가 조금 든 이름은 그대로');
});

test('이름표 목록: 라벨은 메시지 라벨과 같은 순서, key는 HMAC, 번호 원문은 어디에도 없다',()=>{
  const ms=parsed([
    msg(1,{utc:'2026-10-24T01:00:00Z',sender:'8123456789',extra:{sender_name:'가상 김철수',sender_is_self:false}}),
    msg(2,{utc:'2026-10-24T01:01:00Z',sender:'42',extra:{sender_is_self:true}}),
    msg(3,{utc:'2026-10-24T01:02:00Z',sender:'8123456789'}),
  ]);
  const list=plain(G.tgFeedBuildSenders(ms,hmacKey));
  assert.deepEqual(list,[{label:'A',key:hmacKey('8123456789'),name:'가상 김철수',self:false},{label:'B',key:hmacKey('42'),self:true}]);
  assert.deepEqual(plain(G.tgFeedAssignSenders(ms).map((m)=>m.sender)),['A','B','A'],'라벨 순서가 본문과 같다');
  assert.ok(!JSON.stringify(list).includes('8123456789')&&!JSON.stringify(list).includes('"42"'));
  // 같은 사람은 방·날짜가 달라도 같은 key
  const other=plain(G.tgFeedBuildSenders(parsed([msg(9,{utc:'2026-10-25T01:00:00Z',sender:'42'}),msg(10,{utc:'2026-10-25T01:01:00Z',sender:'8123456789'})]),hmacKey));
  assert.equal(other[0].key,list[1].key);assert.equal(other[1].key,list[0].key);
  assert.equal(other[0].label,'A');
});

test('이름표 목록: 수집기 이름·자기 칸이 없어도 key만 보내고, 번호가 없으면 항목을 만들지 않는다',()=>{
  const noName=plain(G.tgFeedBuildSenders(parsed([msg(1,{utc:'2026-10-24T01:00:00Z',sender:'7'})]),hmacKey));
  assert.deepEqual(noName,[{label:'A',key:hmacKey('7')}]);
  const noNumber=plain(G.tgFeedBuildSenders(parsed([msg(1,{utc:'2026-10-24T01:00:00Z',sender:''}),msg(2,{utc:'2026-10-24T01:01:00Z',sender:'7'})]),hmacKey));
  assert.deepEqual(noNumber,[{label:'B',key:hmacKey('7')}],'번호 없는 사람(?)은 key·이름이 없으면 보낼 것이 없다');
  const noNumberNamed=plain(G.tgFeedBuildSenders(parsed([msg(1,{utc:'2026-10-24T01:00:00Z',sender:'',extra:{sender_name:'가상 채널'}})]),hmacKey));
  assert.deepEqual(noNumberNamed,[{label:'A',name:'가상 채널'}],'번호 없는 사람은 key를 만들지 않는다');
  assert.deepEqual(plain(G.tgFeedBuildSenders([],hmacKey)),[]);
  // 잘못된 칸 값(문자열 self, 전화번호 이름)은 없는 것으로
  const odd=plain(G.tgFeedBuildSenders(parsed([msg(1,{utc:'2026-10-24T01:00:00Z',sender:'7',extra:{sender_name:'010-1234-5678',sender_is_self:'true'}})]),hmacKey));
  assert.deepEqual(odd,[{label:'A',key:hmacKey('7')}]);
  // 이름은 처음 나온 값, self는 한 번이라도 true면 true
  const mix=plain(G.tgFeedBuildSenders(parsed([
    msg(1,{utc:'2026-10-24T01:00:00Z',sender:'7',extra:{sender_name:'가상 첫이름',sender_is_self:false}}),
    msg(2,{utc:'2026-10-24T01:01:00Z',sender:'7',extra:{sender_name:'가상 나중이름',sender_is_self:true}}),
  ]),hmacKey));
  assert.deepEqual(mix,[{label:'A',key:hmacKey('7'),name:'가상 첫이름',self:true}]);
});

test('이름표 목록: 40명까지만 보낸다(번호 41개)',()=>{
  const ms=parsed(Array.from({length:45},(_,i)=>msg(i+1,{utc:'2026-10-24T01:00:00Z',sender:String(1000+i)})));
  const list=plain(G.tgFeedBuildSenders(ms,hmacKey));
  assert.equal(list.length,40);assert.equal(list[39].label,'AN');
});

test('몸통: senders는 값이 있을 때만 넣고, 나뉜 묶음마다 같은 목록이며, 서버 parseTelegramBody가 읽는다',()=>{
  const ms=parsed([
    msg(1,{utc:'2026-10-24T00:30:00Z',sender:'1',extra:{sender_name:'가상 김철수',sender_is_self:true}}),
    msg(2,{utc:'2026-10-24T00:31:00Z',sender:'2'}),
  ]);
  const g=G.tgFeedGroupDay(ms,'2026-10-24');
  const senders=G.tgFeedBuildSenders(g.messages,hmacKey);
  const parts=G.tgFeedSplit(G.tgFeedAssignSenders(g.messages));
  const body=plain(G.tgFeedBuildBody({day:'2026-10-24',roomKey:'-100123',roomLabel:'가상 업무방',total:2,part:1,attempt:1,messages:parts[0],senders}));
  assert.equal(body.senders.length,2);
  const input=parseTelegramBody(body,TODAY);
  assert.equal(input.sendersInvalid,false);
  assert.deepEqual(plain(input.senders),[{label:'A',key:hmacKey('1'),name:'가상 김철수',self:true},{label:'B',key:hmacKey('2')}]);
  const part2=plain(G.tgFeedBuildBody({day:'2026-10-24',roomKey:'-100123',roomLabel:'가상 업무방',total:2,part:2,attempt:1,messages:parts[0],senders}));
  assert.deepEqual(part2.senders,body.senders);
  // 열쇠 없음(빈 목록)·옛 호출 = senders 칸 자체가 없다(지금과 같은 몸통)
  assert.ok(!('senders' in G.tgFeedBuildBody({day:'2026-10-24',roomKey:'1',roomLabel:'방',total:2,part:1,attempt:1,messages:parts[0],senders:[]})));
  assert.ok(!('senders' in G.tgFeedBuildBody({day:'2026-10-24',roomKey:'1',roomLabel:'방',total:2,part:1,attempt:1,messages:parts[0]})));
});

test('앱 스크립트 파일: 열쇠 만들기는 덮어쓰지 않고 값을 로그에 쓰지 않으며, 이름·번호·key를 로그에 쓰지 않는다',()=>{
  const fn=source.slice(source.indexOf('function tgFeed_initSenderKey'),source.indexOf('function tgFeed_setup'));
  assert.match(fn,/if \(props\.getProperty\(TG_FEED_SENDER_KEY\)\) \{[^}]*return;/,'있으면 그대로 둔다');
  for(const m of fn.matchAll(/Logger\.log\(([^;]*)\)/g)) assert.ok(!/getProperty|Utilities|secret|key/i.test(m[1].replace(/'[^']*'/g,'')),m[0]);
  assert.match(source,/var TG_FEED_ROOT_FOLDER = '여기에_텔레그램_수집_폴더_주소_끝부분';/);
  assert.match(source,/var CALL_FEED_CALL_ROOT_FOLDER = '여기에_통화녹음_폴더_주소_끝부분';/);
  const tg=source.slice(source.indexOf('텔레그램 보내기 (TG-소식메뉴 3-나)'),source.indexOf('// node 시험에서만'));
  for(const m of tg.matchAll(/(?:Logger\.log|new Error)\(([^;]*)\)/g)) assert.ok(!/senderName|senderId|senderSelf|senders|SENDER_KEY|\.name\b|\.key\b/.test(m[1]),m[0]);
  assert.ok(tg.includes('computeHmacSha256Signature')&&tg.includes('TG_FEED_SENDER_KEY'));
  // 열쇠가 없으면 보내지 않는다
  assert.match(tg,/if \(!secret\) return \[\];/);
});
