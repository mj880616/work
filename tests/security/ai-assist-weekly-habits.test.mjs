import test from 'node:test';
import assert from 'node:assert/strict';

// S56-53 WEEKLY-환류정교화 ②: 같은 주 AI 초안 ↔ 최종(앱 [확정]·자료실 개인 확정본)의 칸별 고친 꼴(더함·뺌·표현 다듬기·다시 쓰기·순서)을
// 서버가 지난 주들에서 모아 다음 AI 초안 재료(cell_habits)로 보낸다. 합성 글만(가상 칸 이름·가상 줄). 네트워크 없음.
const wl = await import('../../supabase/functions/ai-assist/weekly-learn.ts');
const {feedbackRecord, libraryFeedback, cellIdOf, whereOf} = await import('../../app/weekly-feedback.mjs');

const A = cellIdOf('summary', '가 영역›가 일', 0), B = cellIdOf('orgs', '나 조직', 0), C = cellIdOf('sites', '다 사업장', 0), D = cellIdOf('summary', '라 영역›라 일', 0);
const cells = obj => new Map(Object.entries(obj));

// 한 주: AI 초안(proposed) → 사람 최종. A 칸은 표현만 다듬고 한 줄 더함, B 칸은 순서만 바꿈, C 칸은 통째 다시 씀, D 칸은 손대지 않음.
function week(w, from = 'confirm') {
  const proposed = cells({
    [A]: ['합성 회의 개최 예정 안내 줄', '합성 교섭 진행 상황 정리 줄'],
    [B]: ['합성 첫째 줄', '합성 둘째 줄', '합성 셋째 줄'],
    [C]: ['합성 옛 이야기 줄'],
    [D]: ['합성 그대로 둘 줄'],
  });
  const final = cells({
    [A]: ['합성 회의 개최 예정 안내 줄임', '합성 교섭 진행 상황 정리 줄', '합성 새로 더한 결과 줄'],
    [B]: ['합성 셋째 줄', '합성 첫째 줄', '합성 둘째 줄'],
    [C]: ['완전히 다른 내용으로 새로 쓴 문장'],
    [D]: ['합성 그대로 둘 줄'],
  });
  if (from === 'library') {
    const extras = {proposed:{at:`${w}T01:00:00Z`, base:{from:'personal'}, ai:true, cells:[...proposed].map(([id, lines]) => { const [section, key, n] = id.split('\u0000'); return {section, key, n:Number(n), lines}; })}};
    return libraryFeedback({extras, week:w, at:`${w}T09:00:00Z`, final, doc:'doc-synthetic'});
  }
  return feedbackRecord({week:w, at:`${w}T09:00:00Z`, proposed, final});
}

test('readFeedbackCell: 칸별·전체 moved·reworded 와 from 을 지킨다(옛 기록은 0·confirm)', () => {
  const f = wl.readFeedbackCell(week('2026-10-26', 'library'), '2026-10-26');
  assert.equal(f.from, 'library');
  assert.ok(f.counts.moved >= 1 && f.counts.reworded >= 1);
  const a = f.cells.find(c => c.where === whereOf(A)), b = f.cells.find(c => c.where === whereOf(B));
  assert.equal(a.reworded, 1); assert.equal(a.added, 1);
  assert.ok(b.moved >= 1); assert.equal(b.kept, 3);
  const old = wl.readFeedbackCell({at:'2026-10-19T09:00:00Z', week:'2026-10-19', counts:{kept:1, proposed:2, final:2}, cells:[{where:'x', proposed:2, final:2, kept:1, changed:1}]}, '2026-10-19');
  assert.equal(old.from, 'confirm'); assert.equal(old.counts.moved, 0); assert.equal(old.cells[0].reworded, 0);
});

test('cellHabits: 이번 요청 칸만, 여러 주 꼴 숫자, 손대지 않은 칸은 뺀다, 글은 없다', () => {
  const feedback = ['2026-11-02', '2026-10-26'].map((w, i) => wl.readFeedbackCell(week(w, i ? 'confirm' : 'library'), w));
  const h = wl.cellHabits(feedback, [whereOf(A), whereOf(B), whereOf(C), whereOf(D), '요청에만 있는 칸']);
  assert.deepEqual(h.map(x => x.where), [whereOf(A), whereOf(B), whereOf(C)], 'D(손대지 않음)·기록 없는 칸은 없음, 요청 순서');
  const [a, b, c] = h;
  assert.deepEqual({w:a.weeks, add:a.added_weeks, rew:a.reworded_weeks, rw:a.rewritten_weeks, lib:a.library_weeks, kp:a.kept_percent}, {w:2, add:2, rew:2, rw:0, lib:1, kp:50});
  assert.equal(b.moved_weeks, 2); assert.equal(b.kept_percent, 100);
  assert.equal(c.rewritten_weeks, 2); assert.equal(c.kept_percent, 0);
  for (const x of h) for (const v of Object.values(x)) assert.ok(typeof v === 'number' || v === null || v === x.where, '숫자와 칸 이름만');
  assert.deepEqual(wl.cellHabits(feedback, []), []);
});

test('weeklyDraftMaterial: cell_habits 를 보내고, past_edits 는 이번 요청 칸의 예부터(같은 40개 안)', () => {
  const other = {at:'2026-11-02T09:00:00Z', week:'2026-11-02', counts:{}, cells:[],
    added:Array.from({length:45}, (_, i) => ({where:'요청에 없는 칸', text:`합성 다른 칸 줄 ${i}`}))};
  const rows = [
    {week_start:'2026-11-02', feedback:other},
    {week_start:'2026-10-26', feedback:week('2026-10-26', 'library')},
  ];
  const learn = wl.learnFromRows(rows, '2026-11-09');
  const input = {week_start:'2026-11-09', mode:'draft', unmatched:[], cells:[{ref:'c1', where:whereOf(A), lines:['합성 바탕'], material:[]}, {ref:'c2', where:whereOf(C), lines:['합성 바탕'], material:[]}]};
  const m = JSON.parse(wl.weeklyDraftMaterial(input, learn));
  assert.deepEqual(m.cell_habits.map(x => x.where), [whereOf(A), whereOf(C)]);
  assert.equal(m.past_edits.length, wl.WL_EXAMPLES);
  const firstOther = m.past_edits.findIndex(e => e.where === '요청에 없는 칸');
  assert.ok(firstOther > 0 && m.past_edits.slice(0, firstOther).every(e => e.where === whereOf(A) || e.where === whereOf(C)), '요청 칸 예가 먼저');
  assert.ok(m.past_edits.some(e => e.where === whereOf(C)), '오래된 주라도 요청 칸 예가 40개 안에 든다');
});

test('weekly_draft 지시문: cell_habits 꼴(더함·뺌·다듬기·다시 쓰기·순서)을 따르고 사실은 만들지 않는다', () => {
  const t = wl.WEEKLY_DRAFT_INSTRUCTIONS;
  for (const k of ['cell_habits', 'added_weeks', 'dropped_weeks', 'reworded_weeks', 'rewritten_weeks', 'moved_weeks', 'kept_percent']) assert.ok(t.includes(k), k);
  assert.match(t, /재료에 없는 사실을 만들지 않는다/);
});
