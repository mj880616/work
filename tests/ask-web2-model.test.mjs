import test from 'node:test';
import assert from 'node:assert/strict';
// FEAT-1029묶음 ① Web2에 물어보기 화면 규칙(app/ask-web2-model.mjs). 합성 값만.
import * as m from '../app/ask-web2-model.mjs';
const ID=n=>`c0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;

test('question detection: question mark, 4+ words or question words; one-word search stays a search',()=>{
  assert.equal(m.looksLikeQuestion('A 사업장 임금교섭 지난번 쟁점 뭐였지?'),true);
  assert.equal(m.looksLikeQuestion('교섭 일정 언제'),true);
  assert.equal(m.looksLikeQuestion('가 나 다 라'),true);
  for(const q of ['교섭','오전 일정','실패 검색','오늘 항목','교'])assert.equal(m.looksLikeQuestion(q),false,q);
  assert.equal(m.canAsk('가'.repeat(201)),false);assert.equal(m.canAsk('짧음'),false);assert.equal(m.canAsk('네 글자임'),true);
});

test('answer check: refs must exist, lines without refs dropped, unknown kinds/ids dropped, S2 tag kept',()=>{
  const a=m.cleanAnswer({status:'ok',id:ID(1),question:'질문임',created_at:'2026-10-29T00:12:00Z',
    lines:[{text:'쟁점임.',refs:['s1','s9','s1']},{text:'근거 없음',refs:['s9']},{text:'',refs:['s1']}],
    sources:[{ref:'s1',kind:'meeting',source:'meeting',id:ID(2),date:'2026-10-27',title:'3차 교섭'},{ref:'s2',kind:'diary',id:ID(3),title:'x'},
      {ref:'s3',kind:'ledger',source:'ledger',id:ID(4),date:'2026-10-26',title:'전략',sent:false,tag:'교섭·전략'},{ref:'bad',kind:'call',id:ID(5),title:'x'}]});
  assert.deepEqual(a.lines,[{text:'쟁점임.',refs:['s1']}]);
  assert.deepEqual(a.sources.map(s=>[s.ref,s.kind,s.sent,s.tag]),[['s1','meeting',true,null],['s3','ledger',false,'교섭·전략']]);
  assert.equal(m.answerNote(a),'');
  assert.equal(m.answerNote({...a,lines:[]}),m.ASK_TEXT.no_lines);
  assert.equal(m.answerNote({status:'empty',lines:[],sources:[]}),m.ASK_TEXT.empty);
  assert.equal(m.answerNote({status:'monthly_limit',lines:[],sources:[]}),m.ASK_TEXT.monthly_limit);
  assert.equal(m.tagLabel(a.sources[0]),'회의 10/27');
  assert.equal(m.sourcesSummary(a.sources),'근거 2건 — 회의 1 · 원장 1');
  assert.equal(m.recentLabel(a),'10/29 질문임');
});

test('open targets: same as search rows, plus calls, telegram room/day and ledger; Edge not deployed → 준비 중',()=>{
  const src=(o)=>m.cleanSource({ref:'s1',title:'t',...o});
  assert.deepEqual(m.sourceTarget(src({kind:'call',id:ID(1)})),{view:'calls',id:ID(1)});
  assert.deepEqual(m.sourceTarget(src({kind:'telegram',id:ID(2),room:'room-1',day:'2026-10-28'})),{view:'telegram',room:'room-1',day:'2026-10-28',item:ID(2)});
  assert.equal(m.sourceTarget(src({kind:'telegram',id:ID(2)})),null);
  assert.deepEqual(m.sourceTarget(src({kind:'ledger',id:ID(3)})),{view:'ledger',id:ID(3)});
  assert.deepEqual(m.sourceTarget(src({kind:'work',source:'note',id:ID(4),day:'2026-10-27'})),{view:'journal',day:'2026-10-27'});
  assert.deepEqual(m.sourceTarget(src({kind:'project',source:'progress',id:ID(5),project_id:ID(6)})),{view:'projects',id:ID(6)});
  assert.deepEqual(m.sourceTarget(src({kind:'document',id:ID(7)})),{view:'library',id:ID(7)});
  for(const c of ['unsupported_kind','ask_not_ready','not_ready'])assert.equal(m.askFailText(c),m.ASK_TEXT.not_ready);
  assert.equal(m.askFailText('ai_busy'),m.ASK_TEXT.failed);
});
