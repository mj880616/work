import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// CALL 3-가: docs/ops/collector-feed.gs(앱 스크립트)의 순수 함수를 node에서 돌리고,
// 만든 몸통이 서버 collector-feed(handler.ts parseCallBody, call-analysis.ts parseCall)에서 그대로 읽히는지 본다.
// 네트워크·Drive 없음. 사람·조직·번호는 모두 지어낸 것이다.
const GS=new URL('../../docs/ops/collector-feed.gs',import.meta.url);
const source=readFileSync(GS,'utf8');
const sandbox={module:{exports:{}}};
vm.createContext(sandbox);
vm.runInContext(source,sandbox,{filename:'collector-feed.gs'});
const G=sandbox.module.exports;
const {parseCallBody,SECRET_HEADER,SECRET_NAME}=await import('../../supabase/functions/collector-feed/handler.ts');
const {parseCall,CALL_LIMITS}=await import('../../supabase/functions/collector-feed/call-analysis.ts');

const NOW=Date.parse('2026-10-24T03:00:00Z');
const ORGS=[{id:'d0000000-0000-4000-8000-000000000001',name:'가상노조',aliases:[],active:true}];
const REF='SRCFAKE0001aa';
const plain=(o)=>JSON.parse(JSON.stringify(o)); // vm 경계 객체를 보통 객체로

// 명진의 통화 분석 v3.2(분석 앱 스크립트)가 만드는 모양을 따른 지어낸 분석 파일. isWork: is_work_related 값(null=칸 없음, 옛 3.1).
function analysis({version='3.2',status='검토대기',isWork='true',title='가상노조 위원장 · 교섭 일정',name='홍길동',role='위원장'}={}){
  return ['---',`analysis_version: "${version}"`,`status: "${status}"`,'source_type: "통화녹음"',`source_txt_id: "${REF}"`,
    'source_txt_name: "통화 홍길동_261024_093000.txt"','recording_datetime: "2026-10-24 09:30:00"','analysis_model: "gemini-fake"',
    'analysis_at: "2026-10-24T00:45:00.000Z"','has_candidates: true',
    ...(isWork===null?[]:[`is_work_related: ${isWork}`,`call_title: "${title}"`,'related_organizations: ["가상노조"]']),'---','',`# ${title}`,'',
    '- 원본 전사: 통화 홍길동_261024_093000.txt','- 자료유형: 통화녹음',`- 상대 이름: ${name||'확인필요'}`,`- 상대 직책: ${role||'확인필요'}`,'- 주체 확인필요: 아니오','',
    '## 핵심요약','- 3차 교섭을 10. 28.(화) 14:00로 미루기로 함.','- 사측 안은 서면으로 받기로 함.','',
    '## 약속 후보','### 1. 서면 회신 · 주체 사측 · 기한 10. 27.','- 주체: 사측 (상대측)','- 원문표현: “세부근거표식”','',
    '## 결정 후보','### 1. 요구안 유지','- 근거위치: 앞부분','','## 후속확인 필요사항','- 없음','',
    '## 중요 원문','- 없음','','## AI 메모','없음'].join('\n');
}
const TRANSCRIPT='화자1: 안녕하세요 위원장님\n화자2: 네 안녕하세요\n화자1: 교섭 일정 말인데요';

test('앱 스크립트 파일: 비밀값·개인 값·폴더 ID가 들어 있지 않고 서버 입구 이름과 같다',()=>{
  assert.match(source,/var CALL_FEED_CALL_ROOT_FOLDER = '여기에_통화녹음_폴더_주소_끝부분';/);
  assert.ok(!/1[A-Za-z0-9_-]{30,}/.test(source.replace(/xmlkxfjeagycwttklxjw/g,'')),'Drive ID처럼 긴 글자가 없어야 한다');
  assert.ok(!/01[016789][\s-]?\d{3,4}[\s-]?\d{4}/.test(source),'전화번호가 없어야 한다');
  assert.ok(source.includes(`'${SECRET_NAME}'`)&&source.includes(`'${SECRET_HEADER}'`),'비밀값 이름·헤더는 서버와 같아야 한다');
  assert.ok(source.includes("functions/v1/collector-feed'"));
  // 비밀값 변수(secret)·속성 값을 로그·오류 글에 넣지 않는다.
  for(const m of source.matchAll(/(?:Logger\.log|new Error)\(([^;]*)\)/g)) assert.ok(!/\bsecret\b|getProperty\(CALL_FEED_SECRET_KEY\)/.test(m[1]),m[0]);
  // 시험 모드 기본값: 속성이 '끔'일 때만 보낸다.
  assert.match(source,/getProperty\(CALL_FEED_TEST_KEY\) !== '끔'/);
  // 분석 파일 status·Drive 설명을 건드리지 않는다(Q13).
  assert.ok(!/setDescription|setContent|setName|setTrashed|moveTo|createFile/.test(source));
});

test('번호 정규화: 하이픈·빈칸·+82를 정리한다. 이름은 번호로 보지 않는다',()=>{
  assert.equal(G.callFeedNormalizeNumber('010-1234-5678'),'01012345678');
  assert.equal(G.callFeedNormalizeNumber(' 010 1234 5678 '),'01012345678');
  assert.equal(G.callFeedNormalizeNumber('+82 10-1234-5678'),'01012345678');
  assert.equal(G.callFeedNormalizeNumber('(02) 123-4567'),'021234567');
  assert.equal(G.callFeedNormalizeNumber('홍길동'),null);
  assert.equal(G.callFeedNormalizeNumber('엄마 010'),null);
  assert.equal(G.callFeedNormalizeName('  가상  친구 '),'가상 친구');
});

test('개인 목록 대조: 번호는 숫자만, 이름은 글자 그대로(NFC) 비교한다',()=>{
  const list=G.callFeedParseList('010-1111-2222, 가상 친구\n엄마;+82 10-3333-4444\n\n');
  assert.deepEqual(plain(list),{numbers:['01011112222','01033334444'],names:['가상 친구','엄마']});
  assert.equal(G.callFeedIsPersonal('01011112222',list),true);
  assert.equal(G.callFeedIsPersonal('010 3333 4444',list),true);
  assert.equal(G.callFeedIsPersonal('엄마',list),true);
  assert.equal(G.callFeedIsPersonal('가상  친구',list),true);
  assert.equal(G.callFeedIsPersonal('엄마 회사',list),false,'부분 일치는 거르지 않는다');
  assert.equal(G.callFeedIsPersonal('홍길동',list),false);
  assert.equal(G.callFeedIsPersonal(null,list),false);
  // 한글 자모가 풀린(NFD) 이름도 같다.
  assert.equal(G.callFeedIsPersonal('엄마'.normalize('NFD'),list),true);
});

test('전사 파일 이름: 연락처·날짜·시각, 분석 파일 이름은 기존 분석 스크립트 규칙',()=>{
  assert.deepEqual(plain(G.callFeedTranscriptName('통화 홍길동_261024_093000.txt')),{contact:'홍길동',day:'2026-10-24',datetime:'2026-10-24 09:30:00'});
  assert.deepEqual(plain(G.callFeedTranscriptName('통화 010-1234-5678_261024_093000.txt')).contact,'010-1234-5678');
  assert.equal(G.callFeedTranscriptName('메모.txt').contact,null);
  assert.equal(G.callFeedAnalysisName('통화 가상/노조_261024_093000.txt',REF),`검토__통화 가상_노조_261024_093000__SRC_${REF}.md`);
  assert.equal(G.callFeedDayInRange('2026-10-24',NOW),true);
  assert.equal(G.callFeedDayInRange('2026-10-25',NOW),false);
  assert.equal(G.callFeedDayInRange('2026-07-01',NOW),false);
});

test('업무 몸통: 서버 parseCallBody를 통과하고 parseCall이 업무로 읽는다. 전사는 고치지 않고 그대로 보낸다',()=>{
  const body=plain(G.callFeedBuildCallBody({ref:REF,analysisMd:analysis(),transcript:TRANSCRIPT,driveUrl:'https://drive.google.com/file/d/FAKEFILE/view',contact:'홍길동',recordedAt:'2026-10-24 09:30:00'}));
  assert.deepEqual(Object.keys(body).sort(),['analysis_md','drive_url','ref','transcript']);
  const input=parseCallBody(body);
  assert.equal(input.drive_url,'https://drive.google.com/file/d/FAKEFILE/view');
  assert.equal(body.transcript,TRANSCRIPT);
  const parsed=parseCall(input,ORGS,NOW);
  assert.equal(parsed.kind,'business');
  assert.equal(parsed.title,'가상노조 위원장 · 교섭 일정');
  assert.equal(parsed.counterpart,'가상노조 홍길동 위원장');
  assert.equal(parsed.organization_id,ORGS[0].id);
  assert.equal(parsed.speaker_split,true,'화자1/화자2 줄도 화자별 줄로 본다');
  assert.equal(parsed.day,'2026-10-24');
  assert.ok(parsed.points.includes('[확정] 요구안 유지'));
  assert.ok(parsed.points.some((p)=>p.startsWith('[예정] 서면 회신')));
  assert.ok(!parsed.points.some((p)=>p.includes('세부근거표식')),'후보 근거 줄은 읽지 않는다');
  // 한 문단 전사는 그대로, speaker_split=false
  const one=plain(G.callFeedBuildCallBody({ref:REF,analysisMd:analysis(),transcript:'줄바꿈 없는 한 문단 전사입니다'}));
  assert.equal(parseCall(parseCallBody(one),ORGS,NOW).speaker_split,false);
});

test('개인·구분 없음·분석 실패: 이름·요약·전사를 보내지 않고 서버가 개수로만 센다',()=>{
  const cases=[
    [analysis({isWork:'false'}),'personal','개인'],
    [analysis({isWork:null,status:'개인'}),'personal','개인'],       // v3.2 개인 기록 파일 모양(status만으로도)
    [analysis({isWork:null}),'unsure','구분없음'],                   // 칸 없음
    [analysis({version:'3.1',isWork:null}),'unsure','구분없음'],     // 옛 3.1 파일
    [analysis({isWork:'""'}),'unsure','구분없음'],                   // 비어 있음(애매)
    [analysis({status:'분석실패',isWork:null}),'failed','실패'],
  ];
  for(const [md,kind,cls] of cases){
    assert.equal(G.callFeedClass(md),cls,md.slice(0,80));
    const body=plain(G.callFeedBuildCallBody({ref:REF,analysisMd:md,transcript:TRANSCRIPT,contact:'홍길동',recordedAt:'2026-10-24 09:30:00'}));
    assert.equal(body.transcript,'');
    assert.ok(!body.analysis_md.includes('홍길동')&&!body.analysis_md.includes('교섭'),'이름·요약을 보내지 않는다');
    const parsed=parseCall(parseCallBody(body),ORGS,NOW);
    assert.equal(parsed.kind,kind,md.slice(0,80));
    if(kind!=='failed') assert.equal(parsed.day,'2026-10-24');
  }
  assert.equal(G.callFeedClass(analysis()),'업무');
});

test('크기: 분석 파일이 64 KB를 넘으면 보내지 않고, 합계 200 KB를 넘으면 전사를 글자 경계에서 자른다',()=>{
  assert.equal(G.callFeedBuildCallBody({ref:REF,analysisMd:analysis()+'가'.repeat(CALL_LIMITS.analysisBytes),transcript:''}),null);
  const long='화자1: '+'가'.repeat(80000);
  const body=plain(G.callFeedBuildCallBody({ref:REF,analysisMd:analysis(),transcript:long}));
  const bytes=(s)=>Buffer.byteLength(s,'utf8');
  assert.ok(bytes(body.analysis_md)+bytes(body.transcript)<=CALL_LIMITS.totalBytes);
  assert.ok(!body.transcript.includes('�'));
  parseCallBody(body);
  assert.equal(G.callFeedBytes('가a😀'),3+1+4);
  assert.equal(G.callFeedCapBytes('😀😀',5),'😀');
  // 이상한 Drive 주소는 빼고 보낸다(서버는 그런 주소를 400으로 거절).
  assert.ok(!('drive_url' in plain(G.callFeedBuildCallBody({ref:REF,analysisMd:analysis(),transcript:'',driveUrl:'https://evil.test/x'}))));
});

test('응답 코드 처리: 200 다음, 401 멈춤, 429 다음 실행, 400·413 넘김, 그 밖은 다시 보냄',()=>{
  assert.equal(G.callFeedVerdict(200),'ok');
  assert.equal(G.callFeedVerdict(401),'auth');
  assert.equal(G.callFeedVerdict(429),'limit');
  assert.equal(G.callFeedVerdict(400),'drop');
  assert.equal(G.callFeedVerdict(413),'drop');
  for(const c of [0,500,502,503,504]) assert.equal(G.callFeedVerdict(c),'retry');
});

test('call_skip 몸통 모양은 서버와 같다({day, personal, short})',()=>{
  assert.match(source,/callFeed_post_\('call_skip', \{ day: d, personal: Math\.min\(skipDays\[d\], 500\), short: 0 \}/);
});

// ---- 실행 흐름: 지어낸 Drive·스크립트 속성·UrlFetchApp로 callFeed_run을 돌린다 ----------------------------------
// 시험용 고정 시계: 실제 날짜가 흘러도(녹음 날짜는 최근 7일 안이어야 함) 같은 결과가 나오게 한다.
const NOW0=Date.parse('2026-10-25T03:00:00Z');
class FixedDate extends Date{constructor(...a){if(a.length)super(...a);else super(NOW0);}static now(){return NOW0;}}
function fakeEnv({props={},responses=[],custom=null}={}){
  const store={...props};
  const sent=[];
  const logs=[];
  const file=(name,id,created,text,extra={})=>({getName:()=>name,getId:()=>id,getMimeType:()=>'text/plain',getDateCreated:()=>new Date(created),
    getUrl:()=>`https://drive.google.com/file/d/${id}/view`,isTrashed:()=>false,getBlob:()=>({getDataAsString:()=>text}),...extra});
  const iter=(list)=>{let i=0;return {hasNext:()=>i<list.length,next:()=>list[i++]};};
  const T0=Date.parse('2026-10-24T00:00:00Z');
  const transcripts=[
    file('통화 홍길동_261024_093000.txt','TXTFAKE0001aa',T0+1000,TRANSCRIPT),
    file('통화 010-1111-2222_261024_100000.txt','TXTFAKE0002bb',T0+2000,'개인 통화 내용'),
    file('통화 가상 국장_261024_110000.txt','TXTFAKE0003cc',T0+3000,'애매 통화'),
  ];
  const analyses={
    [G.callFeedAnalysisName('통화 홍길동_261024_093000.txt','TXTFAKE0001aa')]:file('a1','A1',T0,analysis().replace(REF,'TXTFAKE0001aa')),
    [G.callFeedAnalysisName('통화 가상 국장_261024_110000.txt','TXTFAKE0003cc')]:file('a3','A3',T0,analysis({isWork:null}).replace(REF,'TXTFAKE0003cc')),
  };
  if(custom){const c=custom(file);transcripts.length=0;transcripts.push(...c.transcripts);for(const k of Object.keys(analyses))delete analyses[k];Object.assign(analyses,c.analyses);}
  const folder=(name,children={},files=[])=>({getName:()=>name,
    getFoldersByName:(n)=>iter(children[n]?[children[n]]:[]),
    searchFiles:()=>iter(files),getFilesByName:(n)=>iter(analyses[n]&&name==='검토대기'?[analyses[n]]:[]),getParents:()=>iter([])});
  const transcriptFolder=folder('전사',{},transcripts);
  const parent=folder('AI업무수집',{'검토대기':folder('검토대기'),'검토완료':folder('검토완료')});
  const root=folder('통화녹음',{'전사':transcriptFolder});
  root.getParents=()=>iter([parent]);
  const env={
    module:{exports:{}},
    Logger:{log:(m)=>logs.push(String(m))},
    PropertiesService:{getScriptProperties:()=>({getProperty:(k)=>k in store?store[k]:null,setProperty:(k,v)=>{store[k]=String(v);},deleteProperty:(k)=>{delete store[k];}})},
    DriveApp:{getFolderById:()=>root,getFileById:(id)=>{const f=transcripts.find((t)=>t.getId()===id);if(!f)throw new Error('없음');return f;}},
    Utilities:{formatDate:(d)=>d.toISOString().slice(0,19),getUuid:()=>'00000000-0000-4000-8000-000000000000'},
    UrlFetchApp:{fetch:(url,opt)=>{sent.push({url,opt});const r=responses.shift()??{code:200,body:{ok:true,kept:1,personal:0,unsure:0,failed:0,duplicate:false}};
      return {getResponseCode:()=>r.code,getContentText:()=>JSON.stringify(r.body??{})};}},
    ScriptApp:{getProjectTriggers:()=>[],newTrigger:()=>({timeBased:()=>({everyHours:()=>({create:()=>{}})})})},
    Date:FixedDate,JSON,
  };
  vm.createContext(env);
  vm.runInContext(source.replace("'여기에_통화녹음_폴더_주소_끝부분'","'FAKEROOT'"),env);
  return {env,store,sent,logs};
}
const SECRET='synthetic-collector-feed-secret-0123456789';
const BASE={CALL_FEED_STATE:JSON.stringify({since:'2026-10-23T00:00:00.000Z',backfillChecked:true}),CALL_FEED_PERSONAL_LIST:'010-1111-2222'};

test('실행 흐름 — 시험 모드(기본): 아무것도 보내지 않고, 어디까지 보냈는지도 바꾸지 않고, 개수만 로그에 남긴다',()=>{
  const {env,store,sent,logs}=fakeEnv({props:{...BASE}});
  env.callFeed_run();
  assert.equal(sent.length,0);
  assert.equal(store.CALL_FEED_STATE,BASE.CALL_FEED_STATE);
  const log=logs.join('\n');
  assert.match(log,/시험 모드/);
  assert.match(log,/개인 목록으로 거름: 1/);
  assert.match(log,/업무 1 · 개인 0 · 애매 0 · 구분 없음\(옛 분석·비어 있음\) 1/);
  assert.ok(!/홍길동|010|교섭/.test(log),'로그에 이름·번호·내용이 없다');
});

test('실행 흐름 — 실제 모드: 업무·구분 없음은 한 건씩, 개인 목록은 날짜별 개수만. 비밀값은 헤더로만 가고 진행 위치가 앞으로 간다',()=>{
  const {env,store,sent,logs}=fakeEnv({props:{...BASE,CALL_FEED_TEST_MODE:'끔',COLLECTOR_FEED_SECRET:SECRET},
    responses:[{code:200,body:{ok:true,kept:1}},{code:200,body:{ok:true,unsure:1}},{code:200,body:{ok:true,personal:1}}]});
  env.callFeed_run();
  assert.deepEqual(sent.map((s)=>s.url.split('?')[1]),['action=call','action=call','action=call_skip']);
  for(const s of sent){
    assert.equal(s.opt.headers['x-collector-feed-secret'],SECRET);
    assert.ok(!s.url.includes(SECRET)&&!s.opt.payload.includes(SECRET));
  }
  const [work,unsure,skip]=sent.map((s)=>JSON.parse(s.opt.payload));
  assert.equal(parseCall(parseCallBody(work),ORGS,NOW).kind,'business');
  assert.equal(work.ref,'TXTFAKE0001aa');
  assert.equal(parseCall(parseCallBody(unsure),ORGS,NOW).kind,'unsure');
  assert.equal(unsure.transcript,'');
  assert.deepEqual(skip,{day:'2026-10-24',personal:1,short:0});
  assert.ok(!sent.some((s)=>s.opt.payload.includes('개인 통화 내용')),'개인 목록 통화의 내용은 보내지 않는다');
  const state=JSON.parse(store.CALL_FEED_STATE);
  assert.equal(state.since,new Date(Date.parse('2026-10-24T00:00:00Z')+3000).toISOString());
  assert.deepEqual(state.skips,{});
  assert.match(logs.join('\n'),/끝까지 봄/);
});

test('실행 흐름 — 서버 실패(503)면 그 건에서 멈추고 다음 실행에 다시 보낸다. 401이면 오류로 알린다',()=>{
  const a=fakeEnv({props:{...BASE,CALL_FEED_TEST_MODE:'끔',COLLECTOR_FEED_SECRET:SECRET},responses:[{code:503,body:{ok:false}}]});
  a.env.callFeed_run();
  assert.equal(a.sent.filter((s)=>s.url.endsWith('action=call')).length,1);
  const st=JSON.parse(a.store.CALL_FEED_STATE);
  assert.equal(st.since,'2026-10-23T00:00:00.000Z','진행 위치를 넘기지 않는다');
  assert.equal(st.attempts.TXTFAKE0001aa,1);
  const b=fakeEnv({props:{...BASE,CALL_FEED_TEST_MODE:'끔',COLLECTOR_FEED_SECRET:SECRET},responses:[{code:401,body:{ok:false}}]});
  assert.throws(()=>b.env.callFeed_run(),/비밀값 불일치/);
  const c=fakeEnv({props:{...BASE,CALL_FEED_TEST_MODE:'끔'}});
  assert.throws(()=>c.env.callFeed_run(),/COLLECTOR_FEED_SECRET/);
  assert.equal(c.sent.length,0);
});

// ---- 분석 대기: 막히지 않고 건너뛰어 계속, 대기 목록에서 한 번씩만 처리 ----------------------------------
const HOUR=3600*1000;
// 가장 오래된 통화는 분석이 없고(방금 만든 것), 그 뒤 두 통화는 분석이 있다.
function waitScenario({analysisLater=false,ageH=1}={}){
  const now=NOW0;
  const tA=now-ageH*HOUR, tB=now-ageH*HOUR+1000, tC=now-ageH*HOUR+2000;
  const nameA='통화 가상 갑_261024_090000.txt',nameB='통화 홍길동_261024_093000.txt',nameC='통화 가상 국장_261024_110000.txt';
  return {tA,tB,tC,custom:(file)=>({
    transcripts:[file(nameA,'TXTWAIT0001aa',tA,'대기 통화'),file(nameB,'TXTFAKE0001aa',tB,TRANSCRIPT),file(nameC,'TXTFAKE0003cc',tC,'애매 통화')],
    analyses:{
      [G.callFeedAnalysisName(nameB,'TXTFAKE0001aa')]:file('a2','A2',tB,analysis().replace(REF,'TXTFAKE0001aa')),
      [G.callFeedAnalysisName(nameC,'TXTFAKE0003cc')]:file('a3','A3',tC,analysis({isWork:null}).replace(REF,'TXTFAKE0003cc')),
      ...(analysisLater?{[G.callFeedAnalysisName(nameA,'TXTWAIT0001aa')]:file('a1','A1',tA,analysis({isWork:'false'}).replace(REF,'TXTWAIT0001aa'))}:{}),
    }})};
}
const SINCE_OLD=JSON.stringify({since:new Date(NOW0-48*HOUR).toISOString(),backfillChecked:true});

test('분석 대기 통화: 시험 모드는 건너뛰고 계속 세며, 진행 위치·대기 목록을 저장하지 않는다',()=>{
  const sc=waitScenario();
  const {env,store,sent,logs}=fakeEnv({props:{CALL_FEED_STATE:SINCE_OLD},custom:sc.custom});
  env.callFeed_run();
  assert.equal(store.CALL_FEED_STATE,SINCE_OLD);
  assert.equal(sent.length,0);
  const log=logs.join('\n');
  assert.match(log,/분석 대기: 1건\(건너뛰고 계속\)/);
  assert.match(log,/보낼 것: 2/);
  assert.match(log,/끝까지 봄/);
});

test('분석 대기 통화: 실제 모드는 대기 목록에 넣고 뒤의 통화를 보낸다. 진행 위치는 끝까지 간다',()=>{
  const sc=waitScenario();
  const {env,store,sent,logs}=fakeEnv({props:{CALL_FEED_STATE:SINCE_OLD,CALL_FEED_TEST_MODE:'끔',COLLECTOR_FEED_SECRET:SECRET},custom:sc.custom});
  env.callFeed_run();
  assert.equal(sent.length,2,'뒤의 두 통화는 보낸다');
  const st=JSON.parse(store.CALL_FEED_STATE);
  assert.deepEqual(st.pending,[{id:'TXTWAIT0001aa',created:sc.tA,tries:1}]);
  assert.equal(st.since,new Date(sc.tC).toISOString());
  assert.match(logs.join('\n'),/대기 목록: 1건/);
});

test('분석 대기 통화: 다음 실행에서 분석이 생기면 한 번 보내고 목록에서 뺀다. 그 다음 실행에는 다시 보내지 않는다',()=>{
  const sc=waitScenario();
  const first=fakeEnv({props:{CALL_FEED_STATE:SINCE_OLD,CALL_FEED_TEST_MODE:'끔',COLLECTOR_FEED_SECRET:SECRET},custom:sc.custom});
  first.env.callFeed_run();
  const later=waitScenario({analysisLater:true});
  const second=fakeEnv({props:{CALL_FEED_STATE:first.store.CALL_FEED_STATE,CALL_FEED_TEST_MODE:'끔',COLLECTOR_FEED_SECRET:SECRET},
    responses:[{code:200,body:{ok:true,personal:1}}],custom:later.custom});
  second.env.callFeed_run();
  const calls=second.sent.filter((s)=>s.url.endsWith('action=call'));
  assert.equal(calls.length,1);
  assert.equal(JSON.parse(calls[0].opt.payload).ref,'TXTWAIT0001aa');
  const st=JSON.parse(second.store.CALL_FEED_STATE);
  assert.deepEqual(st.pending,[]);
  const third=fakeEnv({props:{CALL_FEED_STATE:second.store.CALL_FEED_STATE,CALL_FEED_TEST_MODE:'끔',COLLECTOR_FEED_SECRET:SECRET},custom:later.custom});
  third.env.callFeed_run();
  assert.equal(third.sent.length,0,'같은 통화를 다시 보내거나 세지 않는다');
});

test('분석 대기 통화: 3일이 지나도 분석이 없으면 넘김으로 세고 목록에서 뺀다',()=>{
  const sc=waitScenario();
  const pend=JSON.stringify({since:new Date(sc.tC).toISOString(),backfillChecked:true,pending:[{id:'TXTWAIT0001aa',created:NOW0-73*HOUR,tries:5}]});
  const {env,store,sent,logs}=fakeEnv({props:{CALL_FEED_STATE:pend,CALL_FEED_TEST_MODE:'끔',COLLECTOR_FEED_SECRET:SECRET},custom:sc.custom});
  env.callFeed_run();
  assert.equal(sent.length,0);
  assert.deepEqual(JSON.parse(store.CALL_FEED_STATE).pending,[]);
  assert.match(logs.join('\n'),/넘김: 1/);
});

test('대기 목록 정리·상한·판정(순수 함수)',()=>{
  const clean=plain(G.callFeedPendingClean([{id:'b',created:2,tries:1},{id:'a',created:1},{id:'a',created:9},{id:'',created:3},{id:'c',created:'x'},null,{id:'d',created:5,tries:-2}]));
  assert.deepEqual(clean,[{id:'a',created:1,tries:0},{id:'b',created:2,tries:1},{id:'d',created:5,tries:0}]);
  assert.deepEqual(plain(G.callFeedPendingClean(undefined)),[]);
  const many=Array.from({length:53},(_,i)=>({id:'id'+i,created:i+1,tries:1}));
  const t=plain(G.callFeedPendingTrim(many.slice().reverse(),50));
  assert.equal(t.keep.length,50);
  assert.deepEqual(t.dropped.map((e)=>e.id),['id0','id1','id2'],'가장 오래된 것부터 넘김');
  assert.equal(G.callFeedPendingTrim(many.slice(0,5),50).dropped.length,0);
  const now=1e12, W=72*3600*1000;
  assert.equal(G.callFeedPendingDecision({created:now-1000},now,true),'send');
  assert.equal(G.callFeedPendingDecision({created:now-1000},now,false),'wait');
  assert.equal(G.callFeedPendingDecision({created:now-W},now,false),'expire');
  assert.equal(G.callFeedPendingDecision({created:now-W},now,true),'send');
});

test('최근 일주일보다 오래된 녹음은 보내지 않는다(명진 결정 10/25)',()=>{
  const now=Date.parse('2026-10-25T03:00:00Z');
  assert.equal(G.callFeedTooOld('2026-04-14',now),true);
  assert.equal(G.callFeedTooOld('2026-10-17',now),true);
  assert.equal(G.callFeedTooOld('2026-10-18',now),false);
  assert.equal(G.callFeedTooOld('2026-10-25',now),false);
  assert.equal(G.callFeedTooOld('',now),false,'날짜를 못 읽으면 넘기지 않는다');
});

// ---- 최근 7일 보충·중복 방지·상한·화자 번호 (feed-send) ----------------------------------------------------------
test('최근 일주일 시작 시각: 한국 날짜로 7일 전 0시. callFeedTooOld와 같은 날짜선',()=>{
  const now=Date.parse('2026-10-25T03:00:00Z');
  assert.equal(G.callFeedRecentStartMs(now),Date.parse('2026-10-18T00:00:00+09:00'));
  assert.equal(G.callFeedRecentStartMs(Date.parse('2026-10-24T16:00:00Z')),Date.parse('2026-10-18T00:00:00+09:00'),'UTC로는 24일이어도 한국은 25일');
});

// 설치(10/25 09:40 한국) 전에 만들어진 전사: 녹음은 10/22·10/23, 분석은 나중에 끝남. 10/10 녹음은 일주일 밖.
function installScenario(n=0){
  const INSTALL=Date.parse('2026-10-25T00:40:00Z');
  const day=(d)=>Date.parse(d+'T01:00:00Z');
  const list=[['통화 가상 갑_261022_090000.txt','TXTOLD0000122',day('2026-10-22')],['통화 가상 을_261023_090000.txt','TXTOLD0000123',day('2026-10-23')],
    ['통화 가상 병_261010_090000.txt','TXTOLD0000110',day('2026-10-23')]];
  for(let i=0;i<n;i++) list.push([`통화 가상 ${i}_261024_1000${String(i).padStart(2,'0')}.txt`,`TXTMANY${String(i).padStart(6,'0')}`,day('2026-10-24')+i*1000]);
  return {INSTALL,custom:(file)=>({
    transcripts:list.map(([nm,id,c])=>file(nm,id,c,TRANSCRIPT)),
    analyses:Object.fromEntries(list.map(([nm,id,c])=>[G.callFeedAnalysisName(nm,id),file('a'+id,'A'+id,c,analysis().replace(REF,id))])),
  })};
}
const REAL={CALL_FEED_TEST_MODE:'끔',COLLECTOR_FEED_SECRET:SECRET};

test('설치 전에 만든 최근 7일 통화도 한 번 보낸다. 일주일 넘은 녹음은 넘기고, 다음 실행에는 다시 보내지 않는다',()=>{
  const sc=installScenario();
  const first=fakeEnv({props:{...REAL,CALL_FEED_STATE:JSON.stringify({since:new Date(sc.INSTALL).toISOString()})},custom:sc.custom});
  first.env.callFeed_run();
  const calls=first.sent.filter((s)=>s.url.endsWith('action=call'));
  assert.deepEqual(calls.map((s)=>JSON.parse(s.opt.payload).ref).sort(),['TXTOLD0000122','TXTOLD0000123']);
  const st=JSON.parse(first.store.CALL_FEED_STATE);
  assert.equal(st.backfillChecked,true);assert.equal(st.backfill,null,'보충이 끝나면 지운다');
  assert.match(first.logs.join('\n'),/일주일 넘은 옛 녹음 넘김: 1/);
  const second=fakeEnv({props:{...REAL,CALL_FEED_STATE:first.store.CALL_FEED_STATE},custom:sc.custom});
  second.env.callFeed_run();
  assert.equal(second.sent.length,0,'보낸 통화는 다시 보내지 않는다');
});

test('보충 구간: 시험 모드는 보내지 않고 상태도 바꾸지 않지만 개수는 센다',()=>{
  const sc=installScenario();
  const state=JSON.stringify({since:new Date(sc.INSTALL).toISOString()});
  const t=fakeEnv({props:{CALL_FEED_STATE:state},custom:sc.custom});
  t.env.callFeed_run();
  assert.equal(t.sent.length,0);assert.equal(t.store.CALL_FEED_STATE,state);
  assert.match(t.logs.join('\n'),/보낼 것: 2/);
});

test('한 번에 보낼 개수 상한: 20건에서 멈추고 진행 위치를 적어 다음 실행에서 나머지만 보낸다(겹침 없음)',()=>{
  const sc=installScenario(25);   // 최근 일주일 안 27건 + 옛 녹음 1건
  const first=fakeEnv({props:{...REAL,CALL_FEED_STATE:JSON.stringify({since:new Date(sc.INSTALL).toISOString()})},custom:sc.custom});
  first.env.callFeed_run();
  const refs1=first.sent.filter((s)=>s.url.endsWith('action=call')).map((s)=>JSON.parse(s.opt.payload).ref);
  assert.equal(refs1.length,20);
  const st=JSON.parse(first.store.CALL_FEED_STATE);
  assert.ok(st.backfill&&st.backfill.from>0,'멈춘 자리부터 이어 한다');
  assert.match(first.logs.join('\n'),/한 번에 보낼 수 도달/);
  const second=fakeEnv({props:{...REAL,CALL_FEED_STATE:first.store.CALL_FEED_STATE},custom:sc.custom});
  second.env.callFeed_run();
  const refs2=second.sent.filter((s)=>s.url.endsWith('action=call')).map((s)=>JSON.parse(s.opt.payload).ref);
  assert.equal(refs2.length,7);
  assert.equal(new Set([...refs1,...refs2]).size,27,'같은 통화가 두 번 가지 않는다');
  assert.equal(JSON.parse(second.store.CALL_FEED_STATE).backfill,null);
});

test('처음 설치(callFeed_setup)는 시작 시각을 일주일 전 0시(한국)로 적고 따로 보충할 구간을 두지 않는다',()=>{
  const {env,store}=fakeEnv({props:{COLLECTOR_FEED_SECRET:SECRET}});
  env.callFeed_setup();
  const st=JSON.parse(store.CALL_FEED_STATE);
  assert.equal(st.since,new Date(Date.parse('2026-10-18T00:00:00+09:00')).toISOString());
  assert.equal(st.backfillChecked,true);
});

test('화자 번호: 0번부터 오면 분석·전사를 함께 1씩 올려 화자1부터 보낸다. 1번부터 오면 그대로',()=>{
  assert.equal(G.callFeedShiftSpeakers('화자0: 안녕\n화자1: 네\n화자 2: 응'),'화자1: 안녕\n화자2: 네\n화자 3: 응');
  assert.equal(G.callFeedHasSpeakerZero('화자0: 가'),true);assert.equal(G.callFeedHasSpeakerZero('화자10: 가\n화자1: 나'),false);
  const md=analysis().replace('has_candidates: true','has_candidates: true\nspeaker_labels: {"화자0":"나","화자1":"상대"}').replace('3차 교섭','화자0이 3차 교섭');
  const body=plain(G.callFeedBuildCallBody({ref:REF,analysisMd:md,transcript:'화자0: 안녕하세요\n화자1: 네'}));
  assert.equal(body.transcript,'화자1: 안녕하세요\n화자2: 네');
  assert.match(body.analysis_md,/speaker_labels: \{"화자1":"나","화자2":"상대"\}/);
  assert.ok(!/화자0/.test(body.analysis_md)&&/화자1이 3차 교섭/.test(body.analysis_md));
  const ok=parseCall(parseCallBody(body),ORGS,NOW);
  assert.equal(ok.kind,'business');
  const keep=plain(G.callFeedBuildCallBody({ref:REF,analysisMd:analysis(),transcript:TRANSCRIPT}));
  assert.equal(keep.transcript,TRANSCRIPT,'1번부터 오면 건드리지 않는다');
});
