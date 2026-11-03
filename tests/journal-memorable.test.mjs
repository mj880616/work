import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {memorableRows, asOfLabel, checkFinalLine, MEMORABLE_REASONS} from '../app/journal-memorable.js';

// S49-13: 하루 카드 '기억할 통화·텔레그램' 묶음의 순수 규칙과 구조(저장은 서버 표뿐, 로컬 저장소 없음, 뺀 줄 숨김).
test('rows: dropped and malformed rows are not shown; a kept line shows the edited text', () => {
  const rows = memorableRows([
    {id:'1', source:'call', feed_item_id:'f1', org_name:'가상지부', line:'일정 확정함.', status:'suggested', final_line:null},
    {id:'2', source:'telegram', feed_item_id:'f2', org_name:null, line:'원래 글', status:'kept', final_line:'고친 글'},
    {id:'3', source:'call', feed_item_id:'f3', org_name:'', line:'뺀 줄', status:'dropped'},
    {id:'4', line:'', status:'suggested'}, null,
  ]);
  assert.deepEqual(rows.map(r => [r.id, r.org, r.line, r.status, r.source]), [['1', '가상지부', '일정 확정함.', 'suggested', 'call'], ['2', '', '고친 글', 'kept', 'telegram']]);
  assert.deepEqual(memorableRows(null), []);
});
test('as-of label is Korea time, "HH:MM 기준"; bad input is empty', () => {
  assert.equal(asOfLabel('2026-11-03T01:00:00Z'), '10:00 기준');
  assert.equal(asOfLabel('x'), '');
});
test('final line: one line, 1~160 characters', () => {
  assert.equal(checkFinalLine('  가  나 '), '가 나');
  assert.equal(checkFinalLine(''), null);
  assert.equal(checkFinalLine('가'.repeat(161)), null);
  assert.equal(checkFinalLine('가'.repeat(160))?.length, 160);
  assert.deepEqual([...MEMORABLE_REASONS], ['중복', '사적', '주간보고감 아님', '기타']);
});
test('structure: server-saved only, one state owner, hooked into the day card report grid', () => {
  const src = readFileSync(new URL('../app/journal-memorable.js', import.meta.url), 'utf8');
  const banned = ['local', 'session'].map(k => k + 'Storage').concat(['indexed', 'DB'].join(''));
  for (const word of banned) assert.ok(!src.includes(word), word);
  assert.match(src, /kind:'journal_memorable'/);
  assert.match(src, /app_journal_memorable\?id=eq/);
  const view = readFileSync(new URL('../app/journal.js', import.meta.url), 'utf8');
  assert.match(view, /memorable\.render\(selected, rt/);
  assert.match(view, /memorable\.ensure\(selected, rt\)/);
});
