import test from 'node:test';
import assert from 'node:assert/strict';

// FEAT-1029묶음 ④ 성명·보도자료 초안 화면 쪽 순수 함수(app/press-draft-model.mjs). 가짜 ID·글만.
const m=await import('../app/press-draft-model.mjs');
const id=n=>`e0000000-0000-4000-8000-00000000000${n}`;
const answer=(o={})=>({ok:true,kind:'press_draft',type:'statement',title:'제목',subtitle:'부제',paragraphs:[{text:'문단 하나.',refs:[1]},{text:'근거 밖',refs:[9]},{text:'',refs:[1]}],
  demands:[{text:'철회하라.',refs:[1,1]}],checks:['날짜 확인','',7],sources:[{ref:1,meeting_id:id(1).toUpperCase(),title:'회의',day:'2026-10-02'},{ref:9,meeting_id:'x',title:'나쁨',day:''}],...o});

test('request: only the type, 1~5 unique ids in order and a short direction; never record text',()=>{
  assert.deepEqual(m.pressRequest('release',[id(2),id(1),id(2),'bad'],'  철회  촉구 '),{kind:'press_draft',type:'release',meeting_ids:[id(2),id(1)],direction:'철회 촉구'});
  assert.deepEqual(m.pressRequest('x',[1,2,3,4,5,6].map(id),''),{kind:'press_draft',type:'statement',meeting_ids:[1,2,3,4,5].map(id)});
  assert.equal(m.pressRequest('statement',[id(1)],'가'.repeat(100)).direction.length,80);
});

test('answer: refs outside the returned sources and empty lines are dropped; no title or no paragraph → null',()=>{
  const d=m.parsePressAnswer(answer());
  assert.deepEqual(d.paragraphs,[{text:'문단 하나.',refs:[1]}]);
  assert.deepEqual(d.demands,[{text:'철회하라.',refs:[1]}]);
  assert.deepEqual(d.checks,['날짜 확인']);
  assert.deepEqual(d.sources,[{ref:1,meeting_id:id(1),title:'회의',day:'2026-10-02'}]);
  assert.equal(m.parsePressAnswer(answer({title:''})),null);
  assert.equal(m.parsePressAnswer(answer({paragraphs:[{text:'x',refs:[3]}]})),null);
  assert.equal(m.parsePressAnswer(answer({kind:'other'})),null);
  assert.equal(m.parsePressAnswer(null),null);
});

test('note: title, a head line that says AI draft before fact check, paragraphs with 근거 tags, demands, checks and the 근거 list',()=>{
  const note=m.pressNote(m.parsePressAnswer(answer()));
  assert.equal(note.title,'제목');
  assert.equal(note.raw_text,['[성명 초안 · AI 초안 · 사실 확인 전]','','부제','','문단 하나. [근거 1]','','요구','- 철회하라. [근거 1]','','확인할 것','1. 날짜 확인','','근거','1. 사업 보고 · 회의 · 10.2'].join('\n'));
  assert.match(m.pressNote(m.parsePressAnswer(answer({type:'release'}))).raw_text,/^\[보도자료 초안/);
});

test('pick line: series name + round, kind and date (Seoul)',()=>{
  assert.deepEqual(m.meetingPickLine({id:id(1).toUpperCase(),title:'3차',series_name:'가상 임단협',round_no:3,meeting_at:'2026-10-02T16:00:00Z'},()=>'교섭'),{id:id(1),name:'가상 임단협 3차',meta:'교섭 · 10.3'});
  assert.deepEqual(m.meetingPickLine({id:id(2),title:'',series_name:null,round_no:null,meeting_at:null}),{id:id(2),name:'사업 보고',meta:''});
  assert.equal(m.PRESS_FOLDER_NAME,'성명 초안');
});

// S48-18 바깥 문장(사회운동 Now [초안에 쓰기]): 글 id + 문장 번호만 보내고, 답의 근거에 바깥 인용이 섞여도 받는다.
const pid=n=>`f0000000-0000-4000-8000-00000000000${n}`;
test('quotes: request sends post id + index only (0~5, unique), meetings may be empty; answer keeps quote sources; note lists them',()=>{
  assert.deepEqual(m.pressRequest('statement',[],'',[{post_id:pid(1).toUpperCase(),idx:2,text:'문장 글',source:'단체'},{post_id:pid(1),idx:2},{post_id:'x',idx:0},{post_id:pid(2),idx:-1},{post_id:pid(3),idx:0}]),
    {kind:'press_draft',type:'statement',meeting_ids:[],quotes:[{post_id:pid(1),idx:2},{post_id:pid(3),idx:0}]});
  assert.equal(m.pressRequest('statement',[],'',Array.from({length:7},(_,i)=>({post_id:pid(1),idx:i}))).quotes.length,5);
  assert.ok(!('quotes' in m.pressRequest('statement',[id(1)],'',[])),'no quotes key when none chosen');
  const d=m.parsePressAnswer(answer({paragraphs:[{text:'인용 문단.',refs:[2]}],sources:[{ref:1,meeting_id:id(1),title:'회의',day:'2026-10-02'},{ref:2,post_id:pid(1),idx:0,title:'바깥 인용 · 민주노총 · 가상 성명',day:''},{ref:3,post_id:pid(2),title:'번호 없음',day:''}]}));
  assert.deepEqual(d.sources.map(s=>s.ref),[1,2]);
  assert.deepEqual(d.sources[1],{ref:2,post_id:pid(1),idx:0,title:'바깥 인용 · 민주노총 · 가상 성명',day:''});
  assert.match(m.pressNote(d).raw_text,/근거\n1\. 사업 보고 · 회의 · 10\.2\n2\. 바깥 인용 · 민주노총 · 가상 성명$/);
});

test('quote store: up to 5, no duplicates, memory only, cleared on demand',async()=>{
  const q=await import('../app/press-quotes.mjs');
  q.clearPressQuotes();
  let seen=0;const off=q.onPressQuotes(()=>seen++);
  assert.equal(q.addPressQuote({post_id:pid(1),idx:0,text:' 가 \n 나 ',source:'민주노총',title:'제목',day:'2026-10-28'}),'added');
  assert.equal(q.addPressQuote({post_id:pid(1).toUpperCase(),idx:0}),'have');
  assert.equal(q.addPressQuote({post_id:'x',idx:0}),'bad');
  for(let i=1;i<5;i++)assert.equal(q.addPressQuote({post_id:pid(2),idx:i}),'added');
  assert.equal(q.addPressQuote({post_id:pid(3),idx:0}),'full');
  assert.equal(q.pressQuotes()[0].text,'가 나');assert.equal(q.pressQuotes().length,q.PRESS_QUOTE_MAX);
  q.removePressQuote(pid(2),1);assert.equal(q.hasPressQuote(pid(2),1),false);assert.equal(q.pressQuotes().length,4);
  q.clearPressQuotes();assert.equal(q.pressQuotes().length,0);
  off();assert.equal(seen,7);
});
