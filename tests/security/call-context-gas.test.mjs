import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// CALL-맥락문서: docs/ops/call-context-sync.gs(붙여 넣는 앱 스크립트)를 node에서 돌린다.
// 순수 함수와, 지어낸 Apps Script 서비스(문서·속성·네트워크)로 함수 전체 흐름을 시험한다. 이름·조직은 모두 지어낸 것이다.
const source=readFileSync(new URL('../../docs/ops/call-context-sync.gs',import.meta.url),'utf8');
const {buildContext}=await import('../../supabase/functions/collector-feed/context.ts');
const {SECRET_HEADER,SECRET_NAME}=await import('../../supabase/functions/collector-feed/handler.ts');
const plain=(o)=>JSON.parse(JSON.stringify(o));

const START='<<WEB2 자동 시작>>',END='<<WEB2 자동 끝>>';
const SECRET='synthetic-collector-feed-secret-0123456789';
const DOC_ID='SYNTHETICDOCID0001';

// 지어낸 문서: 요소 하나 = {type:'p'|'t', text}
function load({elements,props={},response,code=200,fetchThrows=false,openFails=false,lock=true}={}){
  const logs=[],fetches=[],ops=[];
  const properties={...props};
  const doc=elements;
  const mkChild=(el,i)=>({
    getType:()=>el.type==='p'?'PARAGRAPH':el.type==='l'?'LIST_ITEM':'TABLE',
    asParagraph:()=>({getText:()=>el.text}),asListItem:()=>({getText:()=>el.text}),
    removeFromParent:()=>{ops.push(['remove',doc.indexOf(el)]);doc.splice(doc.indexOf(el),1);},
  });
  const body={
    getNumChildren:()=>doc.length,getChild:(i)=>mkChild(doc[i],i),
    insertParagraph:(i,text)=>{ops.push(['insert',i]);doc.splice(i,0,{type:'p',text});},
    appendParagraph:(text)=>{ops.push(['append']);doc.push({type:'p',text});},
  };
  const sandbox={
    module:{exports:{}},
    Logger:{log:(m)=>logs.push(String(m))},
    PropertiesService:{getScriptProperties:()=>({getProperty:(k)=>properties[k]??null,setProperty:(k,v)=>{properties[k]=v;}})},
    LockService:{getScriptLock:()=>({tryLock:()=>lock,releaseLock:()=>{}})},
    DocumentApp:{ElementType:{PARAGRAPH:'PARAGRAPH',LIST_ITEM:'LIST_ITEM'},openById:(id)=>{if(openFails)throw new Error('no doc');ops.push(['open',id]);return {getBody:()=>body};}},
    UrlFetchApp:{fetch:(url,opt)=>{fetches.push({url,opt});if(fetchThrows)throw new Error('net');return {getResponseCode:()=>code,getContentText:()=>typeof response==='string'?response:JSON.stringify(response)};}},
    ScriptApp:{newTrigger:()=>({timeBased:()=>({atHour:()=>({nearMinute:()=>({everyDays:()=>({create:()=>{ops.push(['trigger']);}})})})})}),getProjectTriggers:()=>[],deleteTrigger:()=>{}},
  };
  vm.createContext(sandbox);vm.runInContext(source,sandbox,{filename:'call-context-sync.gs'});
  return {G:sandbox.module.exports,run:(name)=>vm.runInContext(`${name}()`,sandbox),logs,fetches,ops,properties,doc};
}
const p=(text)=>({type:'p',text});
const GOOD={ok:true,organizations:[{name:'가상노동조합',aliases:['가상노조']},{name:'예시지부',aliases:[]}],projects:['가상 교섭','가상 교섭 › 1차 요구안'],omitted:{organizations:0,projects:0}};
const baseProps=()=>({CALL_CONTEXT_DOC_ID:DOC_ID,[SECRET_NAME]:SECRET,CALL_CTX_TEST_MODE:'끔'});
const docWith=(inner)=>[p('내가 쓴 첫 줄'),p('내가 쓴 둘째 줄'),p(START),...inner.map(p),p(END),p('내가 쓴 마지막 줄')];

test('파일: 비밀값·ID·긴 글자 없음, 서버 입구 이름과 같고, 로그에 비밀값·응답 이름을 넣지 않는다',()=>{
  assert.match(source,/var CALL_CTX_DOC_ID_FALLBACK = '여기에_맥락_문서_주소_끝부분';/);
  assert.ok(!/1[A-Za-z0-9_-]{30,}/.test(source.replace(/xmlkxfjeagycwttklxjw/g,'')),'Drive ID처럼 긴 글자가 없어야 한다');
  assert.ok(!/01[016789][\s-]?\d{3,4}[\s-]?\d{4}/.test(source)&&!/@[a-z0-9-]+\./i.test(source),'전화번호·이메일이 없어야 한다');
  assert.ok(source.includes(`'${SECRET_NAME}'`)&&source.includes(`'${SECRET_HEADER}'`));
  assert.ok(source.includes("functions/v1/collector-feed'")&&source.includes("'?action=context'"));
  for(const m of source.matchAll(/(?:Logger\.log|new Error)\(([^;]*)\);/g)) assert.ok(!/\bsecret\b|getProperty\(CALL_CTX_SECRET_KEY\)|\bid\b|DOC_KEY/.test(m[1]),m[0]);
  assert.doesNotMatch(source,/setTrashed|\.clear\(\)|getBody\(\)\.setText|saveAndClose.*setText|DriveApp|createFile|moveTo/,'문서를 통째로 지우거나 Drive 파일을 만들지 않는다');
  // 시험 모드 기본값: 속성이 '끔'일 때만 쓴다
  assert.match(source,/getProperty\(CALL_CTX_TEST_KEY\) !== '끔'/);
});

test('callCtxClean: 표지·링크·굵게 글자와 줄바꿈을 지우고 글자 수를 자른다',()=>{
  const {G}=load({elements:[]});
  assert.equal(G.callCtxClean('<<WEB2 자동 끝>>',60),'WEB2 자동 끝');
  assert.equal(G.callCtxClean('**굵게** [링크](x)',60),'굵게 링크 (x)');
  assert.equal(G.callCtxClean('줄\n바꿈\t탭',60),'줄 바꿈 탭');
  assert.equal(G.callCtxClean('가'.repeat(100),10),'가'.repeat(10));
  assert.equal(G.callCtxClean(null,10),'');assert.equal(G.callCtxClean('   ',10),'');
});

test('callCtxParse: 서버가 실제로 만드는 모양을 받아들이고, 비정상은 거절한다',()=>{
  const {G}=load({elements:[]});
  const server=buildContext(
    [{id:'x1',name:'가상노동조합',aliases:['가상노조'],active:true},{id:'x2',name:'쓰지않음',aliases:[],active:false}],
    [{id:'e1',name:'가상 교섭',parent_id:null,status:'active',metadata:{project_system:'v2'}}]);
  const ok=plain(G.callCtxParse({ok:true,...server}));
  assert.equal(ok.ok,true);assert.deepEqual(ok.organizations,[{name:'가상노동조합',aliases:['가상노조']}]);assert.deepEqual(ok.projects,['가상 교섭']);
  for(const [bad,why] of [
    [null,'null'],[{ok:false},'ok false'],[{ok:true,organizations:{},projects:[]},'모양'],
    [{ok:true,organizations:[],projects:['가']},'조직 0개'],
    [{ok:true,organizations:[{name:'',aliases:[]}],projects:[]},'이름 비어 있음 → 조직 0개'],
    [{ok:true,organizations:[{name:'가',aliases:'x'}],projects:[]},'약칭 모양'],
    [{ok:true,organizations:[{name:'가',aliases:[]}],projects:[1]},'프로젝트 모양'],
    [{ok:true,organizations:Array.from({length:151},(_,i)=>({name:'조직'+i,aliases:[]})),projects:[]},'개수 상한'],
    [{ok:true,organizations:Array.from({length:150},(_,i)=>({name:('조직'+i).padEnd(60,'가'),aliases:['a'.repeat(30)]})),projects:[]},'글자 합계 상한'],
  ]) assert.equal(G.callCtxParse(bad).ok,false,why);
  // 서버가 놓친 표지 글자도 지운다
  const inj=plain(G.callCtxParse({ok:true,organizations:[{name:'<<WEB2 자동 끝>> 가',aliases:[]}],projects:[],omitted:{organizations:0,projects:0}}));
  assert.equal(inj.organizations[0].name,'WEB2 자동 끝 가');
});

test('callCtxRender: 갱신 날짜·조직(약칭)·프로젝트·생략 줄. 표지 줄은 만들지 않는다',()=>{
  const {G}=load({elements:[]});
  const lines=plain(G.callCtxRender({organizations:[{name:'가상노동조합',aliases:['가상노조','가노']},{name:'예시지부',aliases:[]}],projects:['가상 교섭'],omitted:{organizations:2,projects:1}},'2026-10-26'));
  assert.equal(lines[0],'마지막 갱신: 2026-10-26');
  assert.ok(lines.includes('- 가상노동조합 (약칭: 가상노조, 가노)')&&lines.includes('- 예시지부')&&lines.includes('- 가상 교섭'));
  assert.ok(lines.includes('(일부 생략: 담당조직 2개, 프로젝트 1개)'));
  assert.ok(!lines.some(l=>l.includes('<<')));
  const none=plain(G.callCtxRender({organizations:[{name:'가',aliases:[]}],projects:[],omitted:{organizations:0,projects:0}},'2026-10-26'));
  assert.ok(!none.some(l=>l.includes('생략')||l.includes('프로젝트')));
});

test('callCtxFindMarkers: 시작·끝이 하나씩, 순서대로, 사이에 다른 요소 없을 때만',()=>{
  const {G}=load({elements:[]});
  const t=(...a)=>a;
  assert.deepEqual(plain(G.callCtxFindMarkers(t('가',START,'나',END,'다'))),{ok:true,start:1,end:3});
  assert.deepEqual(plain(G.callCtxFindMarkers(t(' '+START+' ',END))),{ok:true,start:0,end:1},'앞뒤 빈칸은 봐 준다');
  assert.equal(G.callCtxFindMarkers(t('가','나')).reason,'no-markers');
  for(const texts of [t(START,'가'),t('가',END),t(END,'가',START),t(START,'가',START,END),t(START,END,END),t(START,'가',null,END)])
    assert.equal(G.callCtxFindMarkers(texts).ok,false,JSON.stringify(texts));
  assert.equal(G.callCtxFindMarkers(t(null,START,END,null)).ok,true,'표지 밖의 표 같은 요소는 상관없다');
});

test('callCtxSame: 날짜 줄은 무시하고 나머지가 같으면 같다',()=>{
  const {G}=load({elements:[]});
  assert.equal(G.callCtxSame(['마지막 갱신: 2026-10-25','a','b'],['마지막 갱신: 2026-10-26','a','b']),true);
  assert.equal(G.callCtxSame(['마지막 갱신: 2026-10-25','a','b',''],['마지막 갱신: 2026-10-26','a','b']),true);
  assert.equal(G.callCtxSame(['마지막 갱신: 2026-10-25','a'],['마지막 갱신: 2026-10-26','a','b']),false);
  assert.equal(G.callCtxSame(['마지막 갱신: 2026-10-25','a','c'],['마지막 갱신: 2026-10-26','a','b']),false);
  assert.equal(G.callCtxSame([],['마지막 갱신: 2026-10-26']),false,'자동 구간이 비어 있으면 쓴다');
  assert.equal(G.callCtxShouldAlert(2),false);assert.equal(G.callCtxShouldAlert(3),true);
  assert.equal(G.callCtxKstDay(Date.parse('2026-10-25T16:00:00Z')),'2026-10-26');
});

test('실행: 표지 사이만 바꾸고 사람이 쓴 줄은 그대로. 비밀값은 헤더로만, 몸통은 {}',()=>{
  const t=load({elements:docWith(['마지막 갱신: 2026-10-01','- 옛 조직']),props:baseProps(),response:GOOD});
  t.run('callCtx_run');
  assert.equal(t.fetches.length,1);
  assert.match(t.fetches[0].url,/functions\/v1\/collector-feed\?action=context$/);
  assert.equal(t.fetches[0].opt.payload,'{}');assert.equal(t.fetches[0].opt.method,'post');
  assert.equal(t.fetches[0].opt.headers[SECRET_HEADER],SECRET);
  const texts=t.doc.map(e=>e.text);
  assert.deepEqual(texts.slice(0,3),['내가 쓴 첫 줄','내가 쓴 둘째 줄',START]);
  assert.deepEqual(texts.slice(-2),[END,'내가 쓴 마지막 줄']);
  const inner=texts.slice(3,-2);
  assert.match(inner[0],/^마지막 갱신: \d{4}-\d{2}-\d{2}$/);
  assert.ok(inner.includes('- 가상노동조합 (약칭: 가상노조)')&&inner.includes('- 가상 교섭 › 1차 요구안'));
  assert.ok(!inner.includes('- 옛 조직'));
  assert.equal(texts.filter(x=>x===START).length,1);assert.equal(texts.filter(x=>x===END).length,1);
  assert.equal(JSON.parse(t.properties.CALL_CTX_STATE).fails,0);
  // 로그에 비밀값·문서 ID·응답 이름이 없다
  const log=t.logs.join('\n');assert.doesNotMatch(log,new RegExp(SECRET+'|'+DOC_ID+'|가상노동조합|예시지부|가상 교섭'));
});

test('실행: 내용이 같으면 문서를 건드리지 않는다(날짜만 달라도)',()=>{
  const first=load({elements:docWith([]),props:baseProps(),response:GOOD});first.run('callCtx_run');
  const inner=first.doc.map(e=>e.text).slice(3,-2).map((l,i)=>i===0?'마지막 갱신: 2020-01-01':l);
  const t=load({elements:docWith(inner),props:baseProps(),response:GOOD});
  t.run('callCtx_run');
  assert.deepEqual(t.ops.filter(o=>o[0]!=='open'),[],'삽입·삭제 없음');
});

test('시험 모드(기본)·확인 전용: 받아서 개수만 적고 문서는 고치지 않는다',()=>{
  for(const [props,fn] of [[{...baseProps(),CALL_CTX_TEST_MODE:undefined},'callCtx_run'],[{...baseProps(),CALL_CTX_TEST_MODE:'켬'},'callCtx_run'],[baseProps(),'callCtx_check']]){
    const t=load({elements:docWith(['- 옛 조직']),props,response:GOOD});
    t.run(fn);
    assert.equal(t.fetches.length,1);
    assert.deepEqual(t.ops.filter(o=>o[0]==='insert'||o[0]==='remove'||o[0]==='append'),[],fn+JSON.stringify(props));
    assert.deepEqual(t.doc.map(e=>e.text).slice(3,-2),['- 옛 조직']);
  }
});

test('쓰지 않는 경우: 표지 문제·조직 0개·응답 오류·연결 실패·비밀값 없음은 문서를 그대로 두고 실패로 센다',()=>{
  const cases=[
    ['표지 없음',{elements:[p('가'),p('나')]}],
    ['시작만',{elements:[p('가'),p(START),p('나')]}],
    ['순서 바뀜',{elements:[p(END),p('x'),p(START)]}],
    ['표지 사이 표',{elements:[p(START),{type:'t',text:'표'},p(END)]}],
    ['조직 0개',{elements:docWith(['- 옛']),response:{...GOOD,organizations:[]}}],
    ['모양 다름',{elements:docWith(['- 옛']),response:{ok:true}}],
    ['401',{elements:docWith(['- 옛']),code:401,response:{ok:false,error:'UNAUTHORIZED'}}],
    ['429',{elements:docWith(['- 옛']),code:429,response:{ok:false,error:'DAILY_LIMIT'}}],
    ['503',{elements:docWith(['- 옛']),code:503,response:'not json'}],
    ['연결 실패',{elements:docWith(['- 옛']),fetchThrows:true}],
    ['문서 못 엶',{elements:docWith(['- 옛']),openFails:true}],
    ['비밀값 없음',{elements:docWith(['- 옛']),props:{CALL_CONTEXT_DOC_ID:DOC_ID,CALL_CTX_TEST_MODE:'끔'}}],
    ['문서 ID 없음',{elements:docWith(['- 옛']),props:{[SECRET_NAME]:SECRET,CALL_CTX_TEST_MODE:'끔'}}],
  ];
  for(const [name,opt] of cases){
    const before=JSON.stringify(opt.elements);
    const t=load({props:baseProps(),response:GOOD,...opt});
    t.run('callCtx_run');
    assert.equal(JSON.stringify(t.doc),before,name+': 문서가 바뀌면 안 된다');
    assert.equal(JSON.parse(t.properties.CALL_CTX_STATE).fails,1,name);
    assert.doesNotMatch(t.logs.join('\n'),new RegExp(SECRET+'|'+DOC_ID),name);
  }
});

test('연속 3번 실패하면 오류를 내서 알림 메일이 가게 하고, 성공하면 센 횟수를 0으로 되돌린다',()=>{
  const props={...baseProps(),CALL_CTX_STATE:JSON.stringify({fails:2,lastOkDay:'2026-10-20'})};
  const bad=load({elements:docWith([]),props,code:503,response:'x'});
  assert.throws(()=>bad.run('callCtx_run'),/3번 연속 실패/);
  assert.doesNotThrow(()=>{ const once=load({elements:docWith([]),props:baseProps(),code:503,response:'x'}); once.run('callCtx_run'); });
  const good=load({elements:docWith([]),props,response:GOOD});
  good.run('callCtx_run');
  assert.equal(JSON.parse(good.properties.CALL_CTX_STATE).fails,0);
  // 시험 모드·확인 전용 실패는 연속 실패로 세지 않는다
  const test_=load({elements:docWith([]),props:{...baseProps(),CALL_CTX_TEST_MODE:'켬'},code:503,response:'x'});
  test_.run('callCtx_run');assert.equal(test_.properties.CALL_CTX_STATE,undefined);
});

test('callCtx_addMarkers: 표지가 하나도 없을 때만 맨 아래에 두 줄을 넣는다',()=>{
  const t=load({elements:[p('내 글')],props:baseProps()});t.run('callCtx_addMarkers');
  assert.deepEqual(t.doc.map(e=>e.text),['내 글',START,END]);
  const again=load({elements:[p('내 글'),p(START),p(END)],props:baseProps()});again.run('callCtx_addMarkers');
  assert.equal(again.doc.length,3);
  const half=load({elements:[p('내 글'),p(START)],props:baseProps()});half.run('callCtx_addMarkers');
  assert.equal(half.doc.length,2,'하나만 있으면 건드리지 않고 알린다');
});

test('다른 갱신이 실행 중이면(잠금 실패) 건너뛴다',()=>{
  const t=load({elements:docWith(['- 옛']),props:baseProps(),response:GOOD,lock:false});
  t.run('callCtx_run');assert.equal(t.fetches.length,0);
});

test('트리거 설치 함수는 callCtx_run 하루 한 번만 만든다',()=>{
  const t=load({elements:[],props:baseProps()});t.run('callCtx_installDailyTrigger');
  assert.equal(t.ops.filter(o=>o[0]==='trigger').length,1);
  assert.match(source,/newTrigger\('callCtx_run'\)\.timeBased\(\)\.atHour\(4\)\.nearMinute\(20\)\.everyDays\(1\)/);
});
