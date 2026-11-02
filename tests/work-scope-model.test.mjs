import test from 'node:test';
import assert from 'node:assert/strict';
import {scopeKey, hasLines, dropSet, keepLines} from '../app/work-scope-model.mjs';

// JOURNAL-오늘한일업무개인: [주간 정리]에 넣는 '한 줄'은 서버가 '뺄 줄'(drop)로 돌려준 줄을 뺀 것. 판정 뒤 줄이 바뀌면 열쇠가 바뀐다.
const row=(day,raw_text)=>({id:'n-'+day,journal_day:day,raw_text,updated_at:'2026-10-26T00:00:00Z'});
const week=new Map([['2026-10-26',row('2026-10-26','가상 교섭 준비회의\n미술 학원 다녀 옴')],['2026-10-27',row('2026-10-27','병원 다녀옴')],['2026-10-28',row('2026-10-28','성명 초안 정리')]]);

test('개인 줄(drop)은 빠지고 업무 줄은 그대로, 줄이 다 빠진 날은 없어짐, 원래 행은 그대로',()=>{
  const drop=dropSet([{day:'2026-10-26',text:'미술 학원 다녀 옴'},{day:'2026-10-27',text:'병원 다녀옴'}]);
  const kept=keepLines(week,drop);
  assert.deepEqual([...kept.keys()],['2026-10-26','2026-10-28']);
  assert.equal(kept.get('2026-10-26').raw_text,'가상 교섭 준비회의');
  assert.equal(week.get('2026-10-26').raw_text,'가상 교섭 준비회의\n미술 학원 다녀 옴');
  // 같은 글이라도 다른 날 줄은 빠지지 않음.
  assert.equal(keepLines(new Map([['2026-10-28',row('2026-10-28','미술 학원 다녀 옴')]]),drop).size,1);
});

test('틀린 답은 판정 없음(null) — 그때 화면은 줄을 넣지 않음',()=>{
  assert.equal(dropSet(null),null);assert.equal(dropSet([{day:1,text:'x'}]),null);assert.equal(dropSet('x'),null);
  assert.equal(keepLines(week,null).size,0);
  assert.deepEqual([...dropSet([])],[]);
});

test('열쇠: 주인·주·줄 글이 같으면 같고, 줄을 더하거나 고치면 달라짐',()=>{
  const k=scopeKey('u:w','2026-10-26',week);
  assert.equal(scopeKey('u:w','2026-10-26',new Map([...week].reverse())),k);
  const more=new Map(week);more.set('2026-10-29',row('2026-10-29','새 줄'));
  assert.notEqual(scopeKey('u:w','2026-10-26',more),k);
  assert.notEqual(scopeKey('u2:w','2026-10-26',week),k);
  assert.notEqual(scopeKey('u:w','2026-11-02',week),k);
  assert.equal(hasLines(week),true);assert.equal(hasLines(new Map()),false);assert.equal(hasLines(new Map([['d',row('d','  ')]])),false);
});
