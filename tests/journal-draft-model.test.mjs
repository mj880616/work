import test from 'node:test';
import assert from 'node:assert/strict';
const m = await import('../app/journal-draft-model.mjs');

// JOURNAL-오늘한줄초안: when the screen asks for the evening draft, what it shows, and the material lines it sends.
test('ask only for today, after 18:00 KST, with no line, with the draft table and no draft yet, once', () => {
  const base = {day:'2026-10-29', today:'2026-10-29', hour:18, hasLine:false, drafts:{missing:false, map:new Map()}, asked:false};
  assert.equal(m.shouldAskDraft(base), true);
  for (const change of [{hour:17}, {day:'2026-10-28'}, {hasLine:true}, {asked:true}, {drafts:{missing:true, map:new Map()}}, {drafts:null},
    {drafts:{missing:false, map:new Map([['2026-10-29', '이미 있음.']])}}]) assert.equal(m.shouldAskDraft({...base, ...change}), false, JSON.stringify(Object.keys(change)));
});

test('a draft shows only on a day without a line (a written line is never covered); no table means no draft', () => {
  const drafts = {missing:false, map:new Map([['2026-10-29', '회의 진행함.']])};
  assert.equal(m.draftFor(drafts, '2026-10-29', false), '회의 진행함.');
  assert.equal(m.draftFor(drafts, '2026-10-29', true), '');
  assert.equal(m.draftFor(drafts, '2026-10-28', false), '');
  assert.equal(m.draftFor({missing:true, map:new Map()}, '2026-10-29', false), '');
  assert.equal(m.draftFor(null, '2026-10-29', false), '');
});

test('material lines: schedule, done tasks, reported meetings, business/org news, memos and work calls — tagged, cleaned, capped', () => {
  const card = {
    events:{items:[{text:'10:00 3차 교섭 준비회의'}]},
    tasks:{done:[{text:'요구안 초안 정리'}], todo:[{text:'내일 할 일'}]},
    report:[
      {key:'activities', items:[{text:'14:00 운영위', summary:'예산 승인'}, {text:'16:00 내부 모임', summary:'', hidden:true}]},
      {key:'business', sections:[{name:'임단투', items:['교섭 일정 확정']}]},
      {key:'orgs', sections:[{name:'가상지부', items:['총회\n공지']}]},
    ],
    others:[{key:'docs', items:[{text:'[자료] 파일'}]}, {key:'memos', items:[{text:'기타 메모'}]}, {key:'calls', items:[{text:'14:20 김가상 · 일정 확인', callSummary:'교섭 일정\n둘째 줄'}, {text:'15:00 이가상 · 회신'}]}],
  };
  assert.deepEqual(m.draftMaterial(card), [
    '[일정] 10:00 3차 교섭 준비회의', '[한 일] 요구안 초안 정리', '[회의·활동] 14:00 운영위 — 예산 승인',
    '[사업 소식] 임단투 · 교섭 일정 확정', '[조직 소식] 가상지부 · 총회 공지', '[메모] 기타 메모',
    '[업무 통화] 14:20 김가상 · 일정 확인 — 교섭 일정', '[업무 통화] 15:00 이가상 · 회신']);
  const many = {tasks:{done:Array.from({length:80}, (_, i) => ({text:`일 ${i} ${'가'.repeat(200)}`}))}};
  const lines = m.draftMaterial(many);
  assert.equal(lines.length, m.DRAFT_LINES);
  assert.ok(lines.every(line => [...line].length <= m.DRAFT_LINE_CHARS && !/[\r\n]/.test(line) && line === line.trim()));
  assert.deepEqual(m.draftMaterial({}), []);
});

test('a work call line: time, counterpart and title (or the summary first line)', () => {
  assert.equal(m.callLine({counterpart:'김가상', title:'일정 확인'}, '14:20'), '14:20 김가상 · 일정 확인');
  assert.equal(m.callLine({counterpart:'', title:'', summary:'\n요약 첫 줄\n둘째'}, ''), '요약 첫 줄');
  assert.equal(m.callLine({}, ''), '');
});

test('the screen reads work calls only (never the personal call box) and the drafts table read-only', async () => {
  const {readFileSync} = await import('node:fs');
  const data = readFileSync(new URL('../app/journal-data.js', import.meta.url), 'utf8');
  const view = readFileSync(new URL('../app/journal.js', import.meta.url), 'utf8');
  assert.doesNotMatch(data + view, /app_call_personal/);
  assert.match(data, /app_feed_items\?workspace_id=eq\.[^`]*source=eq\.call/);
  assert.doesNotMatch(data + view, /app_journal_drafts[^`]*method:/, 'the screen never writes drafts');
  assert.doesNotMatch(data + view, /localStorage|sessionStorage|indexedDB/);
});
