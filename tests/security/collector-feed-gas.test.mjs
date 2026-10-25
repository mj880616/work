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

test('구분 없음·분석 실패(옛 3.1·비어 있음): 이름·요약·전사를 보내지 않고 서버가 개수로만 센다',()=>{
  const cases=[
    [analysis({isWork:null}),'unsure','구분없음'],                   // 칸 없음
    [analysis({version:'3.1',isWork:null}),'unsure','구분없음'],     // 옛 3.1 파일
    [analysis({isWork:'""'}),'unsure','구분없음'],                   // 비어 있고 status가 애매가 아님
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
    if(kind==='unsure') assert.equal(parsed.box,null,'요약을 보내지 않았으니 개인 통화함 줄이 되지 않는다');
  }
  assert.equal(G.callFeedClass(analysis()),'업무');
});

test('CALL-개인통화함 2단계: 개인·애매 통화도 요약·전문을 그대로 보내고 서버가 개인 통화함 줄로 읽는다',()=>{
  const personal=analysis({version:'3.5',isWork:'false',status:'개인',title:'가상친구 · 주말 약속'});
  const unsure=analysis({version:'3.5',isWork:'""',status:'애매',title:'가상친구 · 확인 필요'});
  assert.equal(G.callFeedClass(personal),'개인');assert.equal(G.callFeedClass(unsure),'애매');
  for(const [md,kind] of [[personal,'personal'],[unsure,'unsure']]){
    const body=plain(G.callFeedBuildCallBody({ref:REF,analysisMd:md,transcript:TRANSCRIPT,contact:'홍길동',recordedAt:'2026-10-24 09:30:00'}));
    assert.equal(body.analysis_md,md,'분석 파일은 고치지 않고 그대로');assert.equal(body.transcript,TRANSCRIPT,'전문도 그대로');
    const parsed=parseCall(parseCallBody(body),ORGS,NOW);
    assert.equal(parsed.kind,kind);assert.ok(parsed.box,'개인 통화함 줄 재료가 있다');
    assert.match(parsed.box.title,/^가상친구 · /);assert.equal(parsed.box.raw_text,TRANSCRIPT);assert.equal(parsed.box.day,'2026-10-24');
  }
  // 요약이 없는 옛 개인 기록(3.2~3.4)은 보내도 서버가 줄을 만들지 않고 개수만 센다
  const old=analysis({version:'3.4',isWork:'false',status:'개인'}).replace(/## 핵심요약\n[\s\S]*?\n\n## 약속 후보/,'## 핵심요약\n- 없음\n\n## 약속 후보');
  const oldBody=plain(G.callFeedBuildCallBody({ref:REF,analysisMd:old,transcript:TRANSCRIPT}));
  const oldParsed=parseCall(parseCallBody(oldBody),ORGS,NOW);
  assert.equal(oldParsed.kind,'personal');assert.equal(oldParsed.box,null);
});

test('개인 번호 목록 통화: 분석이 업무라고 해도 개인으로 고쳐 보내 서버가 업무 통화함에 넣지 못한다. 분석 실패는 그대로',()=>{
  const forced=(md,extra={})=>plain(G.callFeedBuildCallBody({ref:REF,analysisMd:md,transcript:TRANSCRIPT,forcePersonal:true,...extra}));
  // 업무로 분석된 파일 → 개인
  const biz=forced(analysis());
  const parsed=parseCall(parseCallBody(biz),ORGS,NOW);
  assert.equal(parsed.kind,'personal');assert.ok(parsed.box);assert.equal(parsed.box.raw_text,TRANSCRIPT);
  assert.ok(!('organization_id' in parsed.box));
  // 앞머리 두 줄만 바뀌고 나머지(본문 포함)는 그대로, 같은 칸이 두 번 나오지 않는다
  const meta=G.callFeedFrontmatter(biz.analysis_md);
  assert.equal(meta.status,'개인');assert.equal(meta.is_work_related,'false');
  assert.equal(biz.analysis_md.split('\n').filter((l)=>/^(status|is_work_related)\s*:/.test(l)).length,2);
  assert.equal(biz.analysis_md.slice(biz.analysis_md.indexOf('\n---\n',4)),analysis().slice(analysis().indexOf('\n---\n',4)),'본문은 그대로');
  assert.equal(meta.call_title,G.callFeedFrontmatter(analysis()).call_title);
  // 칸이 없던 옛 파일·애매·이미 개인인 파일도 개인으로
  for(const md of [analysis({isWork:null}),analysis({version:'3.5',isWork:'""',status:'애매'}),analysis({isWork:'false',status:'개인'})]){
    const b=forced(md);assert.equal(G.callFeedFrontmatter(b.analysis_md).status,'개인');
    assert.equal(parseCall(parseCallBody(b),ORGS,NOW).kind,'personal');
  }
  // 요약이 없는 옛 파일은 개수만 센다(개인으로)
  const noSummary=forced(analysis({isWork:null}).replace(/## 핵심요약\n[\s\S]*?\n\n## 약속 후보/,'## 핵심요약\n- 없음\n\n## 약속 후보'));
  const ns=parseCall(parseCallBody(noSummary),ORGS,NOW);assert.equal(ns.kind,'personal');assert.equal(ns.box,null);
  // 분석 실패 기록은 목록 통화여도 판정 실패로 센다
  const failed=forced(analysis({status:'분석실패',isWork:null}));
  assert.equal(parseCall(parseCallBody(failed),ORGS,NOW).kind,'failed');assert.equal(failed.transcript,'');
  // 앞머리 없는 글·줄바꿈 CRLF
  assert.equal(G.callFeedForcePersonal('제목만 있는 글'),'제목만 있는 글');
  const crlf=G.callFeedForcePersonal(analysis().replace(/\n/g,'\r\n'));
  assert.equal(G.callFeedFrontmatter(crlf).is_work_related,'false');
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
    [G.callFeedAnalysisName('통화 010-1111-2222_261024_100000.txt','TXTFAKE0002bb')]:file('a2','A2',T0,analysis({version:'3.5',isWork:'false',status:'개인',title:'가상친구 · 주말 약속'}).replace(REF,'TXTFAKE0002bb')),
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
  assert.match(log,/개인 번호 목록 통화: 1/);
  assert.match(log,/업무 1 · 개인 1 · 애매 0 · 구분 없음\(옛 분석·비어 있음\) 1/);
  assert.ok(!/홍길동|010|교섭/.test(log),'로그에 이름·번호·내용이 없다');
});

test('실행 흐름 — 실제 모드: 업무·개인 목록·구분 없음 모두 한 건씩 call로 보낸다(목록 통화도 내용까지, call_skip 없음). 비밀값은 헤더로만 가고 진행 위치가 앞으로 간다',()=>{
  const {env,store,sent,logs}=fakeEnv({props:{...BASE,CALL_FEED_TEST_MODE:'끔',COLLECTOR_FEED_SECRET:SECRET},
    responses:[{code:200,body:{ok:true,kept:1}},{code:200,body:{ok:true,personal:1,boxed:1}},{code:200,body:{ok:true,unsure:1}}]});
  env.callFeed_run();
  assert.deepEqual(sent.map((s)=>s.url.split('?')[1]),['action=call','action=call','action=call']);
  for(const s of sent){
    assert.equal(s.opt.headers['x-collector-feed-secret'],SECRET);
    assert.ok(!s.url.includes(SECRET)&&!s.opt.payload.includes(SECRET));
  }
  const [work,list,unsure]=sent.map((s)=>JSON.parse(s.opt.payload));
  assert.equal(parseCall(parseCallBody(work),ORGS,NOW).kind,'business');
  assert.equal(work.ref,'TXTFAKE0001aa');
  // 개인 번호 목록 통화: 분석·전문(내용)을 보내고 서버가 개인 통화함 줄로 읽는다
  assert.equal(list.ref,'TXTFAKE0002bb');assert.equal(list.transcript,'개인 통화 내용');
  const lp=parseCall(parseCallBody(list),ORGS,NOW);assert.equal(lp.kind,'personal');assert.ok(lp.box);assert.equal(lp.box.raw_text,'개인 통화 내용');
  // 구분 없음(옛 분석)은 개수만
  assert.equal(parseCall(parseCallBody(unsure),ORGS,NOW).kind,'unsure');
  assert.equal(unsure.transcript,'');
  const state=JSON.parse(store.CALL_FEED_STATE);
  assert.equal(state.since,new Date(Date.parse('2026-10-24T00:00:00Z')+3000).toISOString());
  assert.deepEqual(state.skips,{});
  const log=logs.join('\n');
  assert.match(log,/끝까지 봄/);assert.match(log,/개인 통화함에 저장 1/);assert.ok(!/개인 통화 내용|010/.test(log));
});

test('개인 번호 목록 통화인데 분석이 업무로 나와도 개인으로 고쳐 보낸다. 분석이 3일 넘게 없으면 예전처럼 날짜별 개수만 센다(call_skip)',()=>{
  const sc=(custom)=>fakeEnv({props:{...BASE,CALL_FEED_TEST_MODE:'끔',COLLECTOR_FEED_SECRET:SECRET},custom,
    responses:[{code:200,body:{ok:true,personal:1,boxed:1}},{code:200,body:{ok:true,personal:1}}]});
  const T0=Date.parse('2026-10-24T00:00:00Z');
  // 업무로 분석된 목록 통화
  const a=sc((file)=>({transcripts:[file('통화 010-1111-2222_261024_100000.txt','TXTFAKE0002bb',T0+2000,'개인 통화 내용')],
    analyses:{[G.callFeedAnalysisName('통화 010-1111-2222_261024_100000.txt','TXTFAKE0002bb')]:file('a2','A2',T0,analysis().replace(REF,'TXTFAKE0002bb'))}}));
  a.env.callFeed_run();
  assert.equal(a.sent.length,1);
  const body=JSON.parse(a.sent[0].opt.payload);
  assert.equal(parseCall(parseCallBody(body),ORGS,NOW).kind,'personal','업무 통화함으로 가지 않는다');
  // 분석이 끝내 없는 목록 통화(만든 지 3일 넘음)
  const old=NOW0-80*3600*1000;
  const b=fakeEnv({props:{...BASE,CALL_FEED_TEST_MODE:'끔',COLLECTOR_FEED_SECRET:SECRET,CALL_FEED_STATE:JSON.stringify({since:'2026-10-20T00:00:00.000Z',backfillChecked:true})},
    custom:(file)=>({transcripts:[file('통화 010-1111-2222_261024_100000.txt','TXTFAKE0002bb',old,'개인 통화 내용')],analyses:{}}),responses:[{code:200,body:{ok:true,personal:1}}]});
  b.env.callFeed_run();
  assert.deepEqual(b.sent.map((s)=>s.url.split('?')[1]),['action=call_skip']);
  assert.deepEqual(JSON.parse(b.sent[0].opt.payload),{day:'2026-10-24',personal:1,short:0});
  assert.ok(!b.sent[0].opt.payload.includes('개인 통화 내용'));
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

// ── CALL-개인통화함 3단계: 지난 개인·애매 통화 다시 보내기(1회용 callFeed_resendPersonal) ──────────
const REAL_R={CALL_FEED_TEST_MODE:'끔',COLLECTOR_FEED_SECRET:SECRET,CALL_FEED_PERSONAL_LIST:'010-1111-2222'};
const noSummary=(md)=>md.replace(/## 핵심요약[\s\S]*?(?=## 약속 후보)/,'## 핵심요약\n- 없음\n\n');
function resendScenario(extraPersonal=0){
  const t=(h)=>NOW0-h*HOUR;
  const nm={A:'통화 가상 친구_261024_093000.txt',B:'통화 홍길동_261024_100000.txt',C:'통화 가상 국장_261024_110000.txt',D:'통화 가상 이웃_261024_120000.txt',E:'통화 가상 대기_261024_130000.txt',F:'통화 가상 옛날_260101_090000.txt',L:'통화 010-1111-2222_261024_140000.txt'};
  const at={A:t(10),B:t(9),C:t(8),D:t(7),E:t(6),F:t(5),L:t(4)};
  const custom=(file)=>{
    const transcripts=[file(nm.A,'TXTRSND0001aa',at.A,'개인 내용'),file(nm.B,'TXTRSND0002bb',at.B,TRANSCRIPT),file(nm.C,'TXTRSND0003cc',at.C,'애매 내용'),
      file(nm.D,'TXTRSND0004dd',at.D,'요약 없는 개인'),file(nm.E,'TXTRSND0005ee',at.E,'분석 없음'),file(nm.F,'TXTRSND0006ff',at.F,'옛 녹음'),file(nm.L,'TXTRSND0007gg',at.L,'목록 통화')];
    const analyses={
      [G.callFeedAnalysisName(nm.A,'TXTRSND0001aa')]:file('a1','A1',at.A,analysis({version:'3.5',isWork:'false',status:'개인',title:'가상친구 · 주말 약속'}).replace(REF,'TXTRSND0001aa')),
      [G.callFeedAnalysisName(nm.B,'TXTRSND0002bb')]:file('a2','A2',at.B,analysis().replace(REF,'TXTRSND0002bb')),
      [G.callFeedAnalysisName(nm.C,'TXTRSND0003cc')]:file('a3','A3',at.C,analysis({version:'3.5',isWork:null,status:'애매'}).replace(REF,'TXTRSND0003cc')),
      [G.callFeedAnalysisName(nm.D,'TXTRSND0004dd')]:file('a4','A4',at.D,noSummary(analysis({version:'3.4',isWork:'false',status:'개인'})).replace(REF,'TXTRSND0004dd')),
      [G.callFeedAnalysisName(nm.F,'TXTRSND0006ff')]:file('a6','A6',at.F,analysis({version:'3.5',isWork:'false',status:'개인'}).replace(REF,'TXTRSND0006ff')),
      [G.callFeedAnalysisName(nm.L,'TXTRSND0007gg')]:file('a7','A7',at.L,analysis().replace(REF,'TXTRSND0007gg')),
    };
    for(let i=0;i<extraPersonal;i++){
      const n=`통화 가상 추가${i}_261024_15${String(i).padStart(2,'0')}00.txt`,id=`TXTMORE${String(i).padStart(4,'0')}zz`,c=NOW0-3*HOUR+i*1000;
      transcripts.push(file(n,id,c,'추가 개인'));
      analyses[G.callFeedAnalysisName(n,id)]=file('am'+i,'AM'+i,c,analysis({version:'3.5',isWork:'false',status:'개인'}).replace(REF,id));
    }
    return {transcripts,analyses};
  };
  return {custom,at};
}
const callsOf=(sent)=>sent.filter((s)=>s.url.endsWith('action=call'));

test('다시 보내기 대상 판정: 개인·애매이고 핵심요약이 있을 때만. 업무·요약 없음·실패·구분 없음은 아님. 개인 번호 목록은 개인',()=>{
  assert.equal(G.callFeedHasSummary(analysis()),true);
  assert.equal(G.callFeedHasSummary(noSummary(analysis())),false);
  assert.equal(G.callFeedHasSummary('---\nstatus: "개인"\n---\n# 제목\n'),false);
  assert.equal(G.callFeedResendWanted(analysis({version:'3.5',isWork:'false',status:'개인'}),false),'개인');
  assert.equal(G.callFeedResendWanted(analysis({version:'3.5',isWork:null,status:'애매'}),false),'애매');
  assert.equal(G.callFeedResendWanted(analysis(),false),'', '업무 통화는 평소 보내기가 보낸다');
  assert.equal(G.callFeedResendWanted(analysis(),true),'개인','개인 번호 목록 통화는 개인으로');
  assert.equal(G.callFeedResendWanted(noSummary(analysis({isWork:'false',status:'개인'})),false),'');
  assert.equal(G.callFeedResendWanted(analysis({isWork:'false',status:'분석실패'}),false),'');
  assert.equal(G.callFeedResendWanted(analysis({isWork:null}),false),'', '구분 없음(옛 3.1)은 보내지 않는다');
});

test('다시 보내기 — 시험 모드(기본): 보내지 않고 보낼 개수만 적고 진행 위치도 적지 않는다. 로그에 이름·내용이 없다',()=>{
  const sc=resendScenario();
  const {env,store,sent,logs}=fakeEnv({props:{CALL_FEED_PERSONAL_LIST:'010-1111-2222'},custom:sc.custom});
  env.callFeed_resendPersonal();
  assert.equal(sent.length,0);
  assert.equal(store.CALL_FEED_RESEND_STATE,undefined);
  assert.equal(store.CALL_FEED_STATE,undefined);
  const log=logs.join('\n');
  assert.match(log,/시험 모드/);
  assert.match(log,/보낼 것: 3 \(개인 2 · 애매 1\)/);
  assert.match(log,/업무·요약 없음 2 · 분석 아직 없음 1 · 일주일 넘은 옛 녹음 1/);
  assert.match(log,/끝까지 봄/);
  assert.ok(!/홍길동|010|교섭|가상/.test(log));
});

test('다시 보내기 — 실제 모드: 개인·애매·개인 번호 목록 통화만 call로 보낸다. 서버가 막는 중복은 이미 있음으로 센다. 평소 진행 위치(CALL_FEED_STATE)는 건드리지 않는다',()=>{
  const sc=resendScenario();
  const baseState=JSON.stringify({since:'2026-10-23T00:00:00.000Z',backfillChecked:true});
  const {env,store,sent,logs}=fakeEnv({props:{...REAL_R,CALL_FEED_STATE:baseState},custom:sc.custom,
    responses:[{code:200,body:{ok:true,personal:1,boxed:1}},{code:200,body:{ok:true,unsure:1,boxed:1}},{code:200,body:{ok:true,duplicate:true}}]});
  env.callFeed_resendPersonal();
  const calls=callsOf(sent);
  assert.equal(sent.length,3);
  const bodies=calls.map((s)=>JSON.parse(s.opt.payload));
  assert.deepEqual(bodies.map((b)=>b.ref),['TXTRSND0001aa','TXTRSND0003cc','TXTRSND0007gg']);
  for(const s of calls){assert.equal(s.opt.headers['x-collector-feed-secret'],SECRET);assert.ok(!s.url.includes(SECRET)&&!s.opt.payload.includes(SECRET));}
  assert.equal(parseCall(parseCallBody(bodies[0]),ORGS,NOW).kind,'personal');
  assert.ok(parseCall(parseCallBody(bodies[0]),ORGS,NOW).box,'개인 통화함 줄로 읽힌다');
  assert.equal(parseCall(parseCallBody(bodies[1]),ORGS,NOW).kind,'unsure');
  const listCall=parseCall(parseCallBody(bodies[2]),ORGS,NOW);assert.equal(listCall.kind,'personal','분석이 업무라도 목록 통화는 개인으로');
  assert.equal(store.CALL_FEED_STATE,baseState,'평소 보내기의 앞으로만 가는 진행 위치는 그대로');
  assert.equal(JSON.parse(store.CALL_FEED_RESEND_STATE).from,sc.at.L);
  const log=logs.join('\n');
  assert.match(log,/보냄: 3 \(개인 2 · 애매 1\)/);assert.match(log,/개인 통화함에 새로 저장 2 · 이미 있음 1/);
  // 다시 실행하면 이어서 한다: 더 볼 통화가 없다.
  const again=fakeEnv({props:{...REAL_R,CALL_FEED_RESEND_STATE:store.CALL_FEED_RESEND_STATE},custom:sc.custom});
  again.env.callFeed_resendPersonal();
  assert.equal(again.sent.length,0);assert.match(again.logs.join('\n'),/끝까지 봄/);
});

test('다시 보내기: 한 번에 20건에서 멈추고 진행 위치를 적어 다음 실행에서 나머지만 보낸다. 서버 상한(429)에서는 그 통화 앞까지만 적는다',()=>{
  const sc=resendScenario(20);   // 보낼 통화 3 + 20 = 23건
  const first=fakeEnv({props:{...REAL_R},custom:sc.custom});
  first.env.callFeed_resendPersonal();
  const refs1=callsOf(first.sent).map((s)=>JSON.parse(s.opt.payload).ref);
  assert.equal(refs1.length,20);
  assert.match(first.logs.join('\n'),/한 번에 보낼 수 도달/);
  const second=fakeEnv({props:{...REAL_R,CALL_FEED_RESEND_STATE:first.store.CALL_FEED_RESEND_STATE},custom:sc.custom});
  second.env.callFeed_resendPersonal();
  const refs2=callsOf(second.sent).map((s)=>JSON.parse(s.opt.payload).ref);
  assert.equal(refs2.length,3);
  assert.equal(new Set([...refs1,...refs2]).size,23,'겹침 없음');
  // 429: 두 번째 통화에서 막히면 첫 통화까지만 적고, 다시 실행하면 막힌 통화부터 보낸다.
  const lim=fakeEnv({props:{...REAL_R},custom:sc.custom,responses:[{code:200,body:{ok:true,boxed:1}},{code:429,body:{error:'LIMIT'}}]});
  lim.env.callFeed_resendPersonal();
  assert.equal(callsOf(lim.sent).length,2);
  assert.equal(JSON.parse(lim.store.CALL_FEED_RESEND_STATE).from,sc.at.B,"보낸 A와 건너뛴 업무 통화 B까지");
  assert.match(lim.logs.join('\n'),/서버 하루 상한\(429\)/);
  const next=fakeEnv({props:{...REAL_R,CALL_FEED_RESEND_STATE:lim.store.CALL_FEED_RESEND_STATE},custom:sc.custom});
  next.env.callFeed_resendPersonal();
  assert.equal(JSON.parse(callsOf(next.sent)[0].opt.payload).ref,'TXTRSND0003cc');
});

test('다시 보내기: 비밀값이 없으면 시험 모드가 아닐 때 멈추고, 401이면 진행 위치를 적고 멈춘다. 진행 위치는 뒤로 가지 않는다',()=>{
  const sc=resendScenario();
  assert.throws(()=>fakeEnv({props:{CALL_FEED_TEST_MODE:'끔'},custom:sc.custom}).env.callFeed_resendPersonal(),/COLLECTOR_FEED_SECRET/);
  const bad=fakeEnv({props:{...REAL_R},custom:sc.custom,responses:[{code:200,body:{ok:true,boxed:1}},{code:401,body:{}}]});
  assert.throws(()=>bad.env.callFeed_resendPersonal(),/비밀값 불일치/);
  assert.equal(JSON.parse(bad.store.CALL_FEED_RESEND_STATE).from,sc.at.B);
  const ahead=fakeEnv({props:{...REAL_R,CALL_FEED_RESEND_STATE:JSON.stringify({from:sc.at.L})},custom:sc.custom});
  ahead.env.callFeed_resendPersonal();
  assert.equal(ahead.sent.length,0);
  assert.equal(JSON.parse(ahead.store.CALL_FEED_RESEND_STATE).from,sc.at.L,'뒤로 가지 않는다');
  ahead.env.callFeed_resendReset();
  assert.equal(ahead.store.CALL_FEED_RESEND_STATE,undefined);
});
