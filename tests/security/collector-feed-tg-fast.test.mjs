import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// TG-소식멈춤 2단계: docs/ops/collector-feed.gs 텔레그램 보내기의 읽기 속도·이어 읽기.
// 가짜 Drive(목록·내용)·UrlFetch·스크립트 속성·시계를 node 안에 만들어 tgFeed_run/tgFeed_continue를 통째로 돌린다.
// 방·사람·글은 모두 지어낸 것이고, 실제 Drive·서버에는 아무것도 보내지 않는다.
const source=readFileSync(new URL('../../docs/ops/collector-feed.gs',import.meta.url),'utf8');
const DAY=86400000;
const TOKEN='fake-oauth-token-for-test';
const SECRET='s'.repeat(40);
const plain=(o)=>JSON.parse(JSON.stringify(o));
const kst=(day,h=0)=>Date.parse(`${day}T00:00:00+09:00`)+h*3600000;

function iter(list){let i=0;return {hasNext:()=>i<list.length,next:()=>list[i++]};}

/** 가짜 세계. rooms: [{key,name,days:{ 'YYYY-MM-DD': 메시지 수 }, ...}] */
function makeEnv(opts={}){
  const o={rate:100,postMs:200,listMs:50,cap:80,startDay:'2026-10-19',now:'2026-10-26T08:10:00+09:00',pageSize:1000,...opts};
  const clock={now:Date.parse(o.now)};
  const props=new Map(),cache=new Map(),logs=[],posts=[],triggers=[],mediaReads=new Map();
  const env={clock,props,logs,posts,triggers,mediaReads,counts:{list:0,fetchAll:0,single:0,batches:[]},world:{rooms:[]},serverSeen:new Set(),serverDaily:new Map(),blobCalls:0,
    failMedia:()=>0,throwQuota:false,rate:o.rate,lateUploads:[]};
  const folders=new Map(); // id -> {files:[...]}
  const filesById=new Map();
  let fileSeq=0;
  const folderObj=(id,name,kids)=>({getId:()=>id,getName:()=>name,
    getFoldersByName:(n)=>iter(kids().filter((k)=>k.name===n).map((k)=>k.obj())),
    getFolders:()=>iter(kids().map((k)=>k.obj()))});
  const byId=new Map();
  function addRoom(r){
    const i=env.world.rooms.length+1;
    const room={...r,i,files:{} };
    env.world.rooms.push(room);
    const pad=String(i).padStart(4,'0');
    const monthIds={};
    const monthFolder=(m)=>{
      if(!monthIds[m]){monthIds[m]=`MONTH${pad}_${m}`;folders.set(monthIds[m],{files:[]});
        byId.set(monthIds[m],folderObj(monthIds[m],m,()=>[]));}
      return monthIds[m];
    };
    const monthKids=[];
    let msgId=1000*i;
    room.add=(day,count,{lateMs=30000,text,modifiedMs}={})=>{
      for(let n=0;n<count;n++){
        const at=kst(day)+Math.floor((n+0.5)*DAY/count)-0;
        const iso=new Date(at).toISOString();
        const m=iso.slice(0,7);
        const fid=`FILEID${String(++fileSeq).padStart(8,'0')}`;
        const f={id:fid,name:`${++msgId}.json`,modifiedMs:modifiedMs??at+lateMs,
          text:JSON.stringify({message_id:msgId,date_utc:iso,date_kst:'x',sender_id:String(9000+(n%3)),text:text??`가상 안건 ${day} ${n}`})};
        folders.get(monthFolder(m)).files.push(f);filesById.set(fid,f);
      }
      room.files[day]=(room.files[day]||0)+count;
    };
    Object.entries(r.days||{}).forEach(([d,c])=>room.add(d,c));
    const msgFolderId=`MSGFOLD${pad}00`;
    byId.set(msgFolderId,folderObj(msgFolderId,'messages',()=>Object.keys(monthIds).map((m)=>({name:m,obj:()=>byId.get(monthIds[m])}))));
    const roomId=`ROOM${pad}00000`;
    const obj=folderObj(roomId,`${r.key}_${r.name}`,()=>[{name:'messages',obj:()=>byId.get(msgFolderId)}]);
    byId.set(roomId,obj);
    return room;
  }
  env.addRoom=addRoom;
  const rawKids=()=>env.world.rooms.map((r)=>({name:`${r.key}_${r.name}`,obj:()=>byId.get(`ROOM${String(r.i).padStart(4,'0')}00000`)}));
  const raw=folderObj('RAWFOLDER000','원문',rawKids);
  const root=folderObj('ROOTFOLDER000','수집',()=>[{name:'원문',obj:()=>raw}]);
  byId.set('ROOTFOLDER000',root);
  const resp=(code,text)=>({getResponseCode:()=>code,getContentText:()=>text});
  const serverDay=()=>new Date(clock.now+9*3600000).toISOString().slice(0,10);
  function server(body){
    const sd=serverDay();
    const used=(env.serverDaily.get(sd)||0);
    if(used>=o.cap) return resp(429,JSON.stringify({error:'DAILY_LIMIT'}));
    env.serverDaily.set(sd,used+1);
    const key=`${body.room_key}|${body.day}|${(body.messages||[]).map((m)=>m.ref).sort().join(',')}`;
    const dup=env.serverSeen.has(key);env.serverSeen.add(key);
    env.posts.push({room:body.room_key,day:body.day,part:body.part||1,n:(body.messages||[]).length,total:body.total,dup,key});
    return resp(200,JSON.stringify({ok:true,kept:dup?0:(body.messages||[]).length,duplicate:dup}));
  }
  const UrlFetchApp={
    fetch(url,opt={}){
      if(env.throwQuota) throw new Error('Service invoked too many times for one day: urlfetch.');
      if(url.includes('/functions/v1/collector-feed')){clock.now+=o.postMs;return server(JSON.parse(opt.payload));}
      assert.equal(opt.headers.Authorization,`Bearer ${TOKEN}`,'목록 호출에 토큰');
      const u=new URL(url);const q=u.searchParams.get('q');
      assert.ok(u.pathname==='/drive/v3/files');
      const fid=/'([^']+)' in parents/.exec(q)[1];
      const from=Date.parse(/modifiedTime > '([^']+)'/.exec(q)[1]),to=Date.parse(/modifiedTime < '([^']+)'/.exec(q)[1]);
      env.counts.list++;clock.now+=o.listMs;
      if(env.failList&&env.failList(fid)) return resp(env.failList(fid),'{}');
      const all=(folders.get(fid)?.files||[]).filter((f)=>f.modifiedMs>from&&f.modifiedMs<to);
      const start=Number(u.searchParams.get('pageToken')||0),size=Math.min(1000,o.pageSize);
      const page=all.slice(start,start+size);
      const out={files:page.map((f)=>({id:f.id,name:f.name}))};
      if(start+size<all.length) out.nextPageToken=String(start+size);
      return resp(200,JSON.stringify(out));
    },
    fetchAll(reqs){
      if(env.throwQuota) throw new Error('Service invoked too many times for one day: urlfetch.');
      env.counts.fetchAll++;env.counts.batches.push(reqs.length);
      clock.now+=Math.ceil(reqs.length/env.rate*1000);
      return reqs.map((r)=>{
        assert.equal(r.headers.Authorization,`Bearer ${TOKEN}`,'내용 호출에 토큰');
        const m=/\/files\/([^?]+)\?alt=media/.exec(r.url);assert.ok(m,r.url);
        const id=decodeURIComponent(m[1]);
        const n=(env.mediaReads.get(id)||0)+1;env.mediaReads.set(id,n);
        const fail=env.failMedia(id,n);
        if(fail) return resp(fail,'');
        const f=filesById.get(id);
        return f?resp(200,f.text):resp(404,'');
      });
    },
  };
  const DriveApp={getFolderById:(id)=>{const f=byId.get(id);if(!f) throw new Error('Not found');return f;}};
  const store=(m)=>({getProperty:(k)=>m.has(k)?m.get(k):null,setProperty:(k,v)=>{if(String(v).length>9216) throw new Error('Argument too large: value');m.set(k,String(v));},deleteProperty:(k)=>m.delete(k)});
  const sandbox={module:{exports:{}},Logger:{log:(s)=>logs.push(String(s))},UrlFetchApp,DriveApp,
    PropertiesService:{getScriptProperties:()=>store(props)},
    CacheService:{getScriptCache:()=>({get:(k)=>cache.has(k)?cache.get(k):null,put:(k,v)=>{if(v.length>100000) throw new Error('too big');cache.set(k,v);}})},
    LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},
    Utilities:{sleep:(ms)=>{clock.now+=ms;}},
    ScriptApp:{getOAuthToken:()=>TOKEN,getProjectTriggers:()=>triggers.slice(),
      deleteTrigger:(t)=>{const i=triggers.indexOf(t);if(i>=0) triggers.splice(i,1);},
      newTrigger:(name)=>{const t={name,getHandlerFunction:()=>name};const b={timeBased:()=>b,after:()=>b,atHour:()=>b,nearMinute:()=>b,everyDays:()=>b,create:()=>{triggers.push(t);return t;}};return b;}},
    __clock:clock};
  vm.createContext(sandbox);
  vm.runInContext(source,sandbox,{filename:'collector-feed.gs'});
  vm.runInContext('Date.now = function () { return __clock.now; }; TG_FEED_ROOT_FOLDER = "ROOTFOLDER000";',sandbox);
  props.set('TG_FEED_ROOMS','*');props.set('COLLECTOR_FEED_SECRET',SECRET);props.set('TG_FEED_TEST_MODE','끔');
  props.set('TG_FEED_STATE',JSON.stringify({startDay:o.startDay,backChecked:true,backFrom:'',rooms:{},attempts:{}}));
  env.G=sandbox.module.exports;
  env.set=(code)=>vm.runInContext(code,sandbox);
  env.run=(name='tgFeed_run')=>{logs.length=0;sandbox[name]();return logs.join('\n');};
  env.state=()=>JSON.parse(props.get('TG_FEED_STATE'));
  env.hasContinue=()=>triggers.some((t)=>t.name==='tgFeed_continue');
  /** tgFeed_run 뒤 이어 하기가 예약돼 있으면 10분 뒤 tgFeed_continue를 부른다. 끝나면 (실행 로그 목록) 반환 */
  env.drain=(max=20)=>{const outs=[env.run('tgFeed_run')];let k=0;while(env.hasContinue()&&k++<max){clock.now+=600000;outs.push(env.run('tgFeed_continue'));}return outs;};
  return env;
}

const DAYS=['2026-10-19','2026-10-20','2026-10-21','2026-10-22','2026-10-23','2026-10-24','2026-10-25'];
const totalMedia=(env)=>[...env.mediaReads.values()].reduce((a,b)=>a+b,0);
const sentMsgs=(env)=>env.posts.filter((p)=>!p.dup).reduce((a,p)=>a+p.n,0);

test('빠르게 읽기: 파일 내용은 50개씩 묶어 병렬(fetchAll)로 받고, 한 파일씩 getBlob을 부르지 않는다',()=>{
  const env=makeEnv({startDay:'2026-10-25'});
  env.addRoom({key:'-1001',name:'가상 업무방',days:{'2026-10-25':130}});
  const out=env.run();
  assert.equal(env.counts.fetchAll,3,'130개 → 50+50+30');
  assert.deepEqual(env.counts.batches,[50,50,30]);
  assert.equal(totalMedia(env),130,'파일마다 정확히 한 번');
  assert.equal(sentMsgs(env),130);
  assert.deepEqual(plain(env.state().rooms['-1001']),{d:'2026-10-25',m:'1130',l:'2026-10-25'},'끝낸 날과 보낸 가장 큰 메시지 번호(TG-1시간수집)');
  assert.match(out,/읽은 파일 130개/);
  assert.match(out,/끝까지 봄/);
  assert.ok(!/getBlob/.test(source.slice(source.indexOf('텔레그램 보내기 (TG-소식메뉴 3-나)'),source.indexOf('// node 시험에서만'))),'getBlob 호출 없음');
});

test('여러 날을 방 단위로 한 번에 읽는다: 같은 파일을 날마다 세 번 읽지 않는다(백로그 7일)',()=>{
  const env=makeEnv();
  const days=Object.fromEntries(DAYS.map((d)=>[d,60]));
  env.addRoom({key:'-1001',name:'가상 업무방',days});
  env.drain();
  assert.equal(sentMsgs(env),60*7,'7일치 모두 한 번씩');
  assert.equal(env.state().rooms['-1001'].d,'2026-10-25');
  const reads=[...env.mediaReads.values()];
  assert.ok(Math.max(...reads)<=2,'한 파일은 많아야 두 번(3일씩 묶어 읽을 때 걸치는 범위)');
  assert.ok(totalMedia(env)<=60*7*2,`총 읽기 ${totalMedia(env)}`);
  // 옛 방식(날마다 3일 창)이면 하루 60개 × (그 날부터 3일 창에 든 날 수) — 비교용 계산
  const old=DAYS.reduce((a,d,i)=>a+60*Math.min(3,7-i),0);
  assert.ok(totalMedia(env)<old,`옛 방식 ${old}번보다 적다`);
});

test('날짜 판정은 메시지 안 날짜: 뒷날 파일은 읽어도 보내지 않고, 늦게 올라온(3일 안) 앞날 파일은 받는다',()=>{
  const env=makeEnv({startDay:'2026-10-24'});
  const r=env.addRoom({key:'-1001',name:'가상 업무방',days:{'2026-10-24':5}});
  r.add('2026-10-24',2,{modifiedMs:kst('2026-10-26',3)});   // 수집기가 이틀 늦게 올림(3일 창 안)
  r.add('2026-10-25',4);
  env.set('__x=0');
  env.run();
  const day24=env.posts.filter((p)=>p.day==='2026-10-24').reduce((a,p)=>a+p.n,0);
  const day25=env.posts.filter((p)=>p.day==='2026-10-25').reduce((a,p)=>a+p.n,0);
  assert.equal(day24,7,'늦게 올라온 2개도 포함');
  assert.equal(day25,4);
});

test('이어 읽기: 시간 한도에 걸려도 끝낸 방은 다시 읽지 않고, 다음 실행이 이어서 끝낸다(중복 없음)',()=>{
  const env=makeEnv({rate:8});
  for(let i=1;i<=12;i++) env.addRoom({key:`-100${String(i).padStart(2,'0')}`,name:`가상 방 ${i}`,days:{'2026-10-24':100,'2026-10-25':100}});
  env.set('TG_FEED_MAX_PARTS_PER_RUN=1000');
  const outs=env.drain();
  assert.ok(outs.length>=2&&outs.length<=4,`실행 ${outs.length}번`);
  assert.match(outs[0],/미룬 방|시간 제한/);
  for(const k of Object.keys(env.state().rooms)) assert.equal(env.state().rooms[k].d,'2026-10-25');
  assert.equal(Object.keys(env.state().rooms).length,12);
  assert.equal(env.posts.filter((p)=>p.dup).length,0,'같은 묶음을 두 번 보내지 않음');
  assert.equal(sentMsgs(env),12*200);
  // 방마다 시작 날(10/19 기준 6일 중 10/24·25만 파일) 읽은 파일 수는 목록 겹침을 빼면 방당 약 한 번
  assert.ok(totalMedia(env)<=12*200*1.6,`총 읽기 ${totalMedia(env)}`);   // 3일씩 묶어 읽을 때 걸치는 범위만큼만 겹친다(옛 방식은 날마다 3일 창)
  assert.equal(env.hasContinue(),false);
  assert.ok(outs.every((t)=>/읽은 파일 [1-9]/.test(t)),'매 실행이 앞으로 나아감');
});

test('큰 방은 시간이 모자라면 미루고(읽다 버리지 않음), 다음 실행에서 맨 먼저 읽는다',()=>{
  const env=makeEnv({rate:8,startDay:'2026-10-25'});
  env.addRoom({key:'-1001',name:'가상 작은 방',days:{'2026-10-25':80}});
  env.addRoom({key:'-1002',name:'가상 큰 방',days:{'2026-10-25':2300}});
  env.addRoom({key:'-1003',name:'가상 작은 방 2',days:{'2026-10-25':80}});
  env.set('TG_FEED_MAX_PARTS_PER_RUN=1000');
  const out1=env.run('tgFeed_run');
  assert.match(out1,/미룬 방 1개/);
  let st=env.state();
  assert.equal(st.pri,'-1002','미룬 방은 다음 실행의 첫 방');
  assert.equal(st.rooms['-1001'].d,'2026-10-25');assert.equal(st.rooms['-1003'].d,'2026-10-25');
  assert.ok(!st.rooms['-1002'],'큰 방은 아직 시작 전');
  const readsBefore=totalMedia(env);
  assert.equal(readsBefore,160,'큰 방은 한 파일도 읽지 않고 미룸');
  assert.ok(env.hasContinue());
  env.clock.now+=600000;
  const out2=env.run('tgFeed_continue');
  st=env.state();
  assert.equal(st.rooms['-1002'].d,'2026-10-25');
  assert.equal(st.pri||'','');
  // 오늘(TG-1시간수집)도 방마다 보므로 큰 방 뒤 남은 오늘 확인은 다음 이어 하기에서 끝난다.
  let last=out2,k=0;
  while(env.hasContinue()&&k++<5){env.clock.now+=600000;last=env.run('tgFeed_continue');}
  assert.match(last,/끝까지 봄/);
  assert.equal(sentMsgs(env),2460);
});

test('방 순서 공정성: 가장 오래된 못 보낸 날부터(날짜 우선). 큰 방이 몇 날을 해도 작은 방이 굶지 않는다',()=>{
  const env=makeEnv();
  const days=Object.fromEntries(DAYS.map((d)=>[d,700]));    // 하루 묶음 3개
  env.addRoom({key:'-1001',name:'가상 큰 방',days});
  for(let i=2;i<=5;i++) env.addRoom({key:`-100${i}`,name:`가상 작은 방 ${i}`,days:{'2026-10-19':10}});
  env.set('TG_FEED_MAX_PARTS_PER_RUN=8');
  env.drain();
  assert.equal(env.state().rooms['-1001'].d,'2026-10-25');
  for(let i=2;i<=5;i++) assert.equal(env.state().rooms[`-100${i}`].d,'2026-10-25');
  const order=env.posts.map((p)=>`${p.room}|${p.day}`);
  const firstBigLate=order.findIndex((k)=>k.startsWith('-1001|')&&k>'-1001|2026-10-21');   // 큰 방의 둘째 방문(22일~)
  for(let i=2;i<=5;i++) assert.ok(order.indexOf(`-100${i}|2026-10-19`)<firstBigLate,`작은 방 ${i}은 큰 방이 둘째 방문을 하기 전에 서비스됨`);
  assert.equal(env.posts.filter((p)=>p.dup).length,0);
  // 순수 순서: 오래된 날 우선, 같은 날이면 방 번호, 미룬 방이 맨 앞
  const G=env.G;
  const e=(key,day,extra={})=>({room:{key},plan:day?[{day}]:[],blocked:false,first:false,...extra});
  assert.equal(G.tgFeedNextRoom([e('3','2026-10-20'),e('1','2026-10-22'),e('2','2026-10-20')]).room.key,'2');
  assert.equal(G.tgFeedNextRoom([e('3','2026-10-20'),e('1','2026-10-22',{first:true})]).room.key,'1');
  assert.equal(G.tgFeedNextRoom([e('3','2026-10-20',{blocked:true}),e('1',null)]),null);
});

test('진행 기록 크기: 방 86개 기준 짧은 모양이 9 KB 안에 들고, 옛 긴 모양도 그대로 읽는다',()=>{
  const env=makeEnv();const G=env.G;
  const rooms={};const longRooms={};
  for(let i=0;i<86;i++){
    const key=`-100${String(1234567000+i)}`;
    rooms[key]={d:'2026-10-24',b:'2026-10-22',p:'2026-10-25',n:12};
    longRooms[key]={doneDay:'2026-10-24',backDay:'2026-10-22',partDay:'2026-10-25',partsDone:12};
  }
  const base={startDay:'2026-10-19',backChecked:true,backFrom:'2026-10-12',attempts:{'-1001234567000|2026-10-25|3':2,'rd':1},chain:12,
    lastRun:G.tgFeedLastRun(Date.parse('2026-10-26T08:12:00+09:00'),'x'.repeat(300),30,12,1,{files:99999,secs:330,visits:86}),fetch:{d:'2026-10-26',n:19999},pri:'-1001234567085'};
  const worst=JSON.stringify(G.tgFeedCompactState({...base,rooms:longRooms})).length;
  const compactWorstViaRooms=JSON.stringify({...base,rooms}).length;
  assert.ok(worst<=9000,`최악(모든 칸 채움) ${worst}바이트`);
  assert.equal(compactWorstViaRooms>0,true);
  // 보통(끝낸 날만) 크기
  const typical=JSON.stringify(G.tgFeedCompactState({...base,rooms:Object.fromEntries(Object.keys(rooms).map((k)=>[k,{doneDay:'2026-10-24'}]))})).length;
  assert.ok(typical<4500,`보통 ${typical}바이트`);
  console.log(`# 진행 기록 크기(방 86개): 보통 ${typical}바이트, 최악 ${worst}바이트, 예전 긴 모양 최악 ${JSON.stringify({...base,rooms:longRooms}).length}바이트`);
  // 긴 모양과 짧은 모양이 같은 뜻
  const a=G.tgFeedRoomState({startDay:'2026-10-19',backFrom:'2026-10-12',rooms:longRooms},Object.keys(longRooms)[0]);
  const b=G.tgFeedRoomState({startDay:'2026-10-19',backFrom:'2026-10-12',rooms},Object.keys(rooms)[0]);
  assert.deepEqual(plain(a),plain(b));
  assert.deepEqual(plain(G.tgFeedCompactRoom(a,{backFrom:'2026-10-12'})),{d:'2026-10-24',b:'2026-10-22',p:'2026-10-25',n:12});
  assert.deepEqual(plain(G.tgFeedCompactRoom(G.tgFeedRoomState({startDay:'2026-10-19',backFrom:'2026-10-12',rooms:{}},'k'),{backFrom:'2026-10-12'})),{d:'2026-10-18'},'보충을 막 시작한 방의 기본 b는 쓰지 않는다');
  assert.deepEqual(plain(G.tgFeedCompactRoom(G.tgFeedRoomState({startDay:'2026-10-19',rooms:{}},'k'),{})),{d:'2026-10-18'});
});

test('86개 방을 끝까지 돌린 뒤의 진행 기록이 저장되고(9 KB 한도 흉내), 옛 긴 모양 기록에서 이어진다',()=>{
  const env=makeEnv({startDay:'2026-10-25',cap:1000});
  for(let i=1;i<=86;i++) env.addRoom({key:`-100${String(1000000000+i)}`,name:`가상 방 ${i}`,days:{'2026-10-25':2}});
  // 옛 긴 모양으로 일부 방이 이미 끝나 있는 기록
  const old={startDay:'2026-10-25',backChecked:true,backFrom:'',rooms:{[`-100${1000000001}`]:{doneDay:'2026-10-25',backDay:'',partDay:'',partsDone:0}},attempts:{}};
  env.props.set('TG_FEED_STATE',JSON.stringify(old));
  env.drain();
  const st=env.state();
  assert.equal(Object.keys(st.rooms).length,86);
  assert.ok(env.props.get('TG_FEED_STATE').length<9000);
  assert.equal(sentMsgs(env),85*2,'이미 끝난 방은 다시 보내지 않음');
  const chk=env.run('tgFeed_check');
  assert.match(chk,/진행 기록 크기: \d+ \/ 9000바이트/);
});

test('빠진 날 다시 보내기(tgFeed_rewind)가 새 구조에서도 동작하고, 서버는 같은 묶음을 중복으로 거른다',()=>{
  const env=makeEnv({startDay:'2026-10-24'});
  env.addRoom({key:'-1001',name:'가상 방',days:{'2026-10-24':20,'2026-10-25':30}});
  env.addRoom({key:'-1002',name:'가상 방 2',days:{'2026-10-25':10}});
  env.drain();
  assert.equal(sentMsgs(env),60);
  const before=env.posts.length;
  env.props.set('TG_FEED_REWIND_DAY','2026-10-25');
  env.run('tgFeed_rewind');
  assert.equal(env.state().rooms['-1001'].d,'2026-10-24');
  env.drain();
  const again=env.posts.slice(before);
  assert.ok(again.length>=2&&again.every((p)=>p.dup),'다시 보낸 묶음은 모두 서버가 중복으로 걸러냄');
  assert.equal(sentMsgs(env),60,'새로 저장된 것은 없음');
  assert.equal(env.state().rooms['-1001'].d,'2026-10-25');
  // 다 끝난 뒤 다시 돌리면 아무것도 보내지 않는다
  const n=env.posts.length;env.run('tgFeed_run');assert.equal(env.posts.length,n);
});

test('지난주(10/18~) 못 끝낸 방도 보충 구간(backDay)으로 이어서 채운다',()=>{
  const env=makeEnv({startDay:'2026-10-24'});
  env.props.set('TG_FEED_STATE',JSON.stringify({startDay:'2026-10-24',backChecked:true,backFrom:'2026-10-19',
    rooms:{'-1001':{doneDay:'2026-10-23',backDay:'2026-10-20'},'-1002':{d:'2026-10-23',b:'2026-10-22'}},attempts:{}}));
  env.addRoom({key:'-1001',name:'가상 방',days:{'2026-10-19':3,'2026-10-21':4,'2026-10-22':5,'2026-10-24':6,'2026-10-25':7}});
  env.addRoom({key:'-1002',name:'가상 방 2',days:{'2026-10-22':2,'2026-10-23':2,'2026-10-24':2}});
  env.drain();
  const sent=(room,day)=>env.posts.filter((p)=>p.room===room&&p.day===day).reduce((a,p)=>a+p.n,0);
  assert.equal(sent('-1001','2026-10-19'),0,'이미 보충을 끝낸 날(backDay 이전)은 다시 보내지 않음');
  assert.equal(sent('-1001','2026-10-21'),4);assert.equal(sent('-1001','2026-10-22'),5);
  assert.equal(sent('-1001','2026-10-24'),6);assert.equal(sent('-1001','2026-10-25'),7);
  assert.equal(sent('-1002','2026-10-22'),0,'보충을 끝낸 날');assert.equal(sent('-1002','2026-10-23'),2,'다음 날부터 이어서');
  assert.equal(sent('-1002','2026-10-24'),2);
  assert.equal(env.state().rooms['-1001'].b,'2026-10-23');
  assert.equal(env.state().rooms['-1001'].d,'2026-10-25');
});

test('일시 오류 파일은 다시 받고, 끝내 못 읽은 소수는 세어서 넘기며, 많이 못 읽으면 그 방을 끝낸 날로 적지 않는다',()=>{
  const env=makeEnv({startDay:'2026-10-25'});
  env.addRoom({key:'-1001',name:'가상 방',days:{'2026-10-25':200}});
  env.failMedia=(id,n)=>(/^FILEID0000000[1-9]$/.test(id)&&n===1)?503:0;   // 앞 9개는 처음에만 실패
  const out=env.run();
  assert.equal(sentMsgs(env),200,'다시 받아 모두 읽음');
  assert.match(out,/못 읽고 넘김 0/);
  // 영구 실패 2개(허용 범위): 세어서 넘김
  const env2=makeEnv({startDay:'2026-10-25'});
  env2.addRoom({key:'-1001',name:'가상 방',days:{'2026-10-25':200}});
  env2.failMedia=(id)=>/^FILEID0000000[12]$/.test(id)?500:0;
  const out2=env2.run();
  assert.equal(sentMsgs(env2),198);
  assert.match(out2,/못 읽고 넘김 2/);
  // 영구 실패 많음(절반): 읽기 실패 → 끝낸 날로 적지 않고 다음 실행으로
  const env3=makeEnv({startDay:'2026-10-25'});
  env3.addRoom({key:'-1001',name:'가상 방',days:{'2026-10-25':100}});
  env3.addRoom({key:'-1002',name:'가상 방 2',days:{'2026-10-25':10}});
  env3.failMedia=(id)=>{const n=Number(id.slice(6));return n<=50?500:0;};
  const out3=env3.run();
  assert.equal(env3.posts.length>0,true);
  assert.ok(!env3.state().rooms['-1001'],'읽기 실패한 방은 끝낸 날로 적히지 않음');
  assert.equal(env3.state().rooms['-1002'].d,'2026-10-25','다른 방은 계속 진행');
  assert.match(out3,/읽지 못해 이번에는 건너뜀/);
  assert.ok(env3.hasContinue(),'다시 예약');
});

test('목록 호출이 실패해도 "파일 없음"으로 보고 끝낸 날로 적지 않는다',()=>{
  const env=makeEnv({startDay:'2026-10-25'});
  env.addRoom({key:'-1001',name:'가상 방',days:{'2026-10-25':20}});
  env.failList=()=>503;
  const out=env.run();
  assert.equal(env.posts.length,0);
  assert.ok(!env.state().rooms['-1001']);
  assert.match(out,/읽지 못해 이번에는 건너뜀/);
  env.failList=null;
  env.drain();
  assert.equal(sentMsgs(env),20);
});

test('목록이 여러 쪽(1000개 넘음)이어도 모두 받는다',()=>{
  const env=makeEnv({startDay:'2026-10-25',pageSize:30});
  env.addRoom({key:'-1001',name:'가상 방',days:{'2026-10-25':95}});
  env.run();
  assert.ok(env.counts.list>=4);
  assert.equal(sentMsgs(env),95);
});

test('하루 URL 호출 한도: 넘기 전에 멈추고(이어 하기 예약 없음), 다음 날 이어간다. 앱 스크립트의 한도 오류도 안전하게 멈춘다',()=>{
  const env=makeEnv({startDay:'2026-10-25'});
  for(let i=1;i<=4;i++) env.addRoom({key:`-100${i}`,name:`가상 방 ${i}`,days:{'2026-10-25':60}});
  env.set('TG_FEED_FETCH_BUDGET_DEFAULT=150');
  const out=env.run();
  assert.match(out,/URL 호출 하루 한도/);
  assert.equal(env.hasContinue(),false,'오늘은 더 하지 않음');
  assert.ok(env.state().fetch.n<=150+1);
  const doneRooms=Object.keys(env.state().rooms).length;
  assert.ok(doneRooms>=1&&doneRooms<4);
  // 다음 날 08:10: 호출 수가 새로 시작해 남은 방을 끝낸다(4일째 10/26도 파일 없음)
  env.clock.now+=DAY;
  env.drain();
  assert.equal(Object.keys(env.state().rooms).length,4);
  assert.equal(sentMsgs(env),240);
  // 앱 스크립트가 던지는 하루 한도 오류
  const env2=makeEnv({startDay:'2026-10-25'});
  env2.addRoom({key:'-1001',name:'가상 방',days:{'2026-10-25':5}});
  env2.throwQuota=true;
  const out2=env2.run();
  assert.match(out2,/URL 호출 하루 한도/);
  assert.equal(env2.hasContinue(),false);
  assert.ok(!env2.state().rooms['-1001']);
});

test('첫 방이 한 번 실행 시간에 안 들어가면 하루씩 좁혀 읽는다(진행이 멈추지 않음)',()=>{
  const env=makeEnv({rate:10,startDay:'2026-10-22'});
  env.addRoom({key:'-1001',name:'가상 큰 방',days:{'2026-10-22':1000,'2026-10-23':1000,'2026-10-24':1000}});
  env.set('TG_FEED_MAX_PARTS_PER_RUN=1000');
  const outs=env.drain();
  assert.equal(sentMsgs(env),3000);
  assert.equal(env.state().rooms['-1001'].d,'2026-10-25');
  assert.ok(outs.length<=4);
});

test('시험 모드: 서버로 보내지 않고 진행 기록도 바꾸지 않으며, 끝까지 돈다',()=>{
  const env=makeEnv();
  env.props.set('TG_FEED_TEST_MODE','켬');
  const before=env.props.get('TG_FEED_STATE');
  for(let i=1;i<=3;i++) env.addRoom({key:`-100${i}`,name:`가상 방 ${i}`,days:{'2026-10-24':5,'2026-10-25':5}});
  const out=env.run();
  assert.equal(env.posts.length,0);
  assert.equal(env.props.get('TG_FEED_STATE'),before);
  assert.match(out,/\[시험 모드/);
  assert.match(out,/읽은 파일 \d+개/);
  assert.match(out,/끝까지 봄/);
});

test('tgFeed_check: 방별 남은 날 수·마지막 실행 소요·읽은 파일 수·오늘 URL 호출이 보인다. 로그에 이름·번호·내용·토큰이 없다',()=>{
  const env=makeEnv({startDay:'2026-10-22'});
  env.addRoom({key:'-1009876',name:'가상비밀방이름',days:{'2026-10-22':3,'2026-10-23':3,'2026-10-24':3,'2026-10-25':3}});
  env.addRoom({key:'-1005432',name:'가상 둘째',days:{'2026-10-25':3}});
  env.set('TG_FEED_MAX_PARTS_PER_RUN=1');
  const chk0=env.run('tgFeed_check');
  assert.match(chk0,/방별 남은 날: 합계 8일 · 남은 방 2개\(가장 많이 남은 방 4일\)/);
  assert.match(chk0,/오늘 URL 호출: 0 \/ 15000/);
  const run1=env.run('tgFeed_run');
  const chk=env.run('tgFeed_check');
  assert.match(chk,/마지막 실행: .*소요 \d+초 · 읽은 파일 \d+개\(초당 약 \d+\) · 읽은 방 \d+곳/);
  assert.match(chk,/방별 남은 날: 합계 \d+일/);
  assert.match(chk,/오늘 URL 호출: [1-9]\d* \/ 15000/);
  env.drain();
  const all=[chk0,run1,chk,...env.logs].join('\n');
  for(const bad of ['가상비밀방이름','가상 둘째','-1009876','-1005432','가상 안건',TOKEN,SECRET]) assert.ok(!all.includes(bad),`로그에 ${bad} 없음`);
});

test('원본 요건: 비밀값·토큰은 로그에 안 찍고, Drive는 읽기만 한다(REST 호출은 GET만, 읽기 범위 토큰)',()=>{
  const tg=source.slice(source.indexOf('텔레그램 보내기 (TG-소식메뉴 3-나)'),source.indexOf('// node 시험에서만'));
  for(const m of tg.matchAll(/(?:Logger\.log|new Error)\(([^;]*)\)/g)) assert.ok(!/token|Authorization|getOAuthToken/i.test(m[1]),m[0]);
  assert.ok(!/method: 'post'[^}]*googleapis\.com\/drive/.test(tg));
  assert.ok(!/method: '(?:put|patch|delete)'/i.test(tg));
});

test('TG-1시간수집: 같은 날 매시 실행은 새 메시지만 보내고, 밤 0~7시는 쉬며, 다음 날 7시 실행이 어제를 끝낸 날로 적는다',()=>{
  const env=makeEnv({startDay:'2026-10-26',now:'2026-10-26T10:10:00+09:00'});
  const room=env.addRoom({key:'-1001',name:'가상 업무방'});
  room.add('2026-10-26',2);
  let out=env.run();
  assert.deepEqual(env.posts.map(p=>[p.day,p.n,p.dup]),[['2026-10-26',2,false]]);
  let st=env.state().rooms['-1001'];
  assert.equal(st.d,'2026-10-25','오늘은 아직 끝낸 날이 아니다');assert.equal(st.m,'1002');assert.equal(st.l,'2026-10-26');
  assert.match(out,/끝까지 봄/);
  // 한 시간 뒤: 새로 온 3개만
  room.add('2026-10-26',3);
  env.clock.now+=3600000;out=env.run();
  assert.deepEqual(env.posts.slice(1).map(p=>[p.day,p.n,p.total,p.dup]),[['2026-10-26',3,3,false]]);
  // 새 것이 없으면 보내지 않는다
  env.clock.now+=3600000;env.run();
  assert.equal(env.posts.length,2);
  // 밤 3시: 아무것도 하지 않는다(새 메시지가 있어도)
  room.add('2026-10-26',1);
  env.clock.now=Date.parse('2026-10-27T03:10:00+09:00');
  const reads=totalMedia(env);
  out=env.run();
  assert.match(out,/쉽니다/);assert.equal(env.posts.length,2);assert.equal(totalMedia(env),reads,'쉬는 동안 파일을 읽지 않는다');
  // 7시: 어제 남은 1개를 보내고 어제를 끝낸 날로 적는다
  env.clock.now=Date.parse('2026-10-27T07:10:00+09:00');
  out=env.run();
  assert.deepEqual(env.posts.slice(2).map(p=>[p.day,p.n]),[['2026-10-26',1]]);
  st=env.state().rooms['-1001'];
  assert.equal(st.d,'2026-10-26');assert.equal(st.m,'1006');
  assert.equal(sentMsgs(env),6,'같은 메시지를 두 번 보내지 않는다');
  assert.ok(env.posts.every(p=>!p.dup));
});
