import test from 'node:test';
import assert from 'node:assert/strict';

// S48-18 사회운동 Now [문장 찾기] 화면 쪽 순수 함수(app/outside-search-model.mjs). 가짜 글·ID만.
const m=await import('../app/outside-search-model.mjs');
const P='f0000000-0000-4000-8000-000000000001',D='d0000000-0000-4000-8000-00000000000';

test('term: one line, trimmed, 100 chars at most',()=>{
  assert.equal(m.cleanTerm('  구조\n조정  '),'구조 조정');
  assert.equal(m.cleanTerm(null),'');
  assert.equal([...m.cleanTerm('가'.repeat(120))].length,100);
});

test('period: published-date range in Seoul days; pick swaps reversed dates; all and unknown mean no range',()=>{
  const now=Date.parse('2026-11-02T20:00:00Z'); // 서울 11/03 05:00
  assert.deepEqual(m.rangeOf('1m',now),{from:'2026-10-03',to:null});
  assert.deepEqual(m.rangeOf('6m',now),{from:'2026-05-03',to:null});
  assert.deepEqual(m.rangeOf('1y',now),{from:'2025-11-03',to:null});
  assert.deepEqual(m.rangeOf('1m',Date.parse('2026-03-31T03:00:00Z')),{from:'2026-02-28',to:null},'short month clamps the day');
  assert.deepEqual(m.rangeOf('all',now),{from:null,to:null});
  assert.deepEqual(m.rangeOf('nope',now),{from:null,to:null});
  assert.deepEqual(m.rangeOf('pick',now,'2026-10-09','2026-10-01'),{from:'2026-10-01',to:'2026-10-09'});
  assert.deepEqual(m.rangeOf('pick',now,'','2026-10-01'),{from:null,to:'2026-10-01'});
  assert.deepEqual(m.rangeOf('pick',now,'x','y'),{from:null,to:null});
});

test('similar words: up to 6, no blanks, no repeat of the query or each other, 30 chars at most',()=>{
  assert.deepEqual(m.cleanSimilar(['인력 감축','구조조정',' 인력  감축 ','','가'.repeat(31),'정원 축소','a','b','c','d','e'],'구조조정'),['인력 감축','정원 축소','a','b','c','d']);
  assert.deepEqual(m.cleanSimilar(null,'x'),[]);
});

test('hits: keep well-formed rows only; kind label, safe link, neighbours, similar flag',()=>{
  const rows=[{post_id:P.toUpperCase(),idx:2,source_key:'kctu',kind:'comment',title:' 제목 ',url:'javascript:alert(1)',published_at:null,sentence:' 문장 ',prev_sentence:'앞',next_sentence:null,matched:'감축',is_similar:true},
    {post_id:'x',idx:0,sentence:'버림'},{post_id:P,idx:1.5,sentence:'버림'},{post_id:P,idx:3,sentence:'  '},null];
  assert.deepEqual(m.cleanHits(rows),[{post_id:P,idx:2,source_key:'kctu',kind:'논평',title:'제목',url:'',published_at:null,sentence:'문장',prev:'앞',next:'',matched:'감축',similar:true}]);
  assert.deepEqual(m.cleanHits('no'),[]);
});

test('day: Seoul short date for the result foot, 날짜 모름 when unknown; iso day for the draft',()=>{
  assert.equal(m.hitDay('2026-10-27T16:00:00Z'),'26.10.28');
  assert.equal(m.hitDay(null),'날짜 모름');
  assert.equal(m.hitIsoDay('2026-10-27T16:00:00Z'),'2026-10-28');
  assert.equal(m.hitIsoDay(''),'');
});

test('marks: main word first, similar words second, case-insensitive, no overlaps',()=>{
  assert.deepEqual(m.markParts('구조조정과 인력 감축, 구조조정','구조조정',['인력 감축','조정']),
    [{text:'구조조정',mark:'main'},{text:'과 ',mark:''},{text:'인력 감축',mark:'sim'},{text:', ',mark:''},{text:'구조조정',mark:'main'}]);
  assert.deepEqual(m.markParts('Workers UNITE','unite'),[{text:'Workers ',mark:''},{text:'UNITE',mark:'main'}]);
  assert.deepEqual(m.markParts('<b>x</b>','x'),[{text:'<b>',mark:''},{text:'x',mark:'main'},{text:'</b>',mark:''}],'text pieces only; the screen escapes each piece');
  assert.deepEqual(m.markParts('abc',''),[{text:'abc',mark:''}]);
  assert.deepEqual(m.markParts('','a'),[]);
});

test('my statements: library search documents in the 성명·보도자료 category (or its sub-category) only, 10 at most',()=>{
  const data={groups:[{kind:'note',items:[{id:D+'1',title:'노트'}]},{kind:'document',items:[
    {id:D+'2',title:'성명 하나',snippet:' 구조조정  반대 ',occurred_at:'2026-10-01T00:00:00Z'},
    {id:D+'3',title:'회의자료',snippet:'x'},
    {id:D+'4',title:'',snippet:'',occurred_at:null},
    {id:'bad',title:'버림'}]}]};
  assert.deepEqual(m.mineIds(data),[D+'2',D+'3',D+'4']);
  const cats=new Map([[D+'2','성명·보도자료'],[D+'3','회의'],[D+'4','성명·보도자료›논평']]);
  assert.deepEqual(m.mineHits(data,cats),[{id:D+'2',title:'성명 하나',snippet:'구조조정 반대',day:'26.10.01'},{id:D+'4',title:'(제목 없음)',snippet:'',day:'날짜 모름'}]);
  const many={groups:[{kind:'document',items:Array.from({length:12},(_,i)=>({id:`d0000000-0000-4000-8000-0000000000${String(i).padStart(2,'0')}`,title:'t'}))}]};
  assert.equal(m.mineHits(many,new Map(m.mineIds(many).map(id=>[id,'성명·보도자료']))).length,m.MINE_MAX);
});
