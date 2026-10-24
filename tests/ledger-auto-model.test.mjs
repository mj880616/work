// LEDGER-자동기록 3단계(앱): 저장 뒤 묶음 호출·재시도·서버 없음 처리, 원장 화면 도우미, Drive 사본 상태 한 줄(순수 함수).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { affectsLedger, autoOutcome, createAutoBatcher, WAIT_MS, MAX_WAIT_MS, RETRY_MS } from '../app/ledger-auto-model.mjs';
import { web2Source, web2OpenTarget, web2SourceLabel, changeInfo, retireRequest, undoErrorText } from '../app/ledger-browse-model.mjs';
import { exportDue, copyState, nextExportDelay, ledgerFromStatus, DAY_MS, MIN_GAP_MS, CHANGE_WAIT_MS } from '../app/ledger-export-model.mjs';
import { countByDay, kstDayStart } from '../app/journal-ledger.js';

const BASE = 'https://example.supabase.co';
const U = n => `e0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('재료 저장만 센다: 여섯 재료 표의 POST·PATCH, 지우기·다른 표·다른 주소는 아님', () => {
  for (const t of ['app_notes', 'app_meetings', 'app_suborganization_updates', 'app_project_progress_updates']) {
    assert.equal(affectsLedger({ path: `/rest/v1/${t}`, method: 'POST' }, BASE), true, t);
    assert.equal(affectsLedger({ path: `/rest/v1/${t}?id=eq.${U(1)}`, method: 'PATCH' }, BASE), true, t);
    assert.equal(affectsLedger({ path: `/rest/v1/${t}?id=eq.${U(1)}`, method: 'DELETE' }, BASE), false, t);
  }
  assert.equal(affectsLedger({ path: '/rest/v1/app_documents', method: 'POST' }, BASE), false);
  assert.equal(affectsLedger({ path: '/rest/v1/rpc/app_ledger_search', method: 'POST' }, BASE), false);
  assert.equal(affectsLedger({ path: 'https://evil.example/rest/v1/app_notes', method: 'POST' }, BASE), false);
  assert.equal(affectsLedger(null, BASE), false);
});

test('서버 답 해석: 끝남(바뀜 여부)·없음(끔)·잠깐 실패(재시도)·그 밖(이번만 버림)', () => {
  assert.deepEqual(autoOutcome({ ok: true, data: { skipped: true } }), { action: 'done', changed: false, runId: null });
  assert.deepEqual(autoOutcome({ ok: true, data: { run_id: U(9), records_new: 2, changes_linked: 0 } }), { action: 'done', changed: true, runId: U(9) });
  assert.equal(autoOutcome({ ok: true, data: { run_id: U(9), records_new: 0, sources_added: 0, changes_linked: 0, needs_check: 0 } }).changed, false);
  for (const c of ['not_ready', 'unsupported_kind', 'ledger_not_ready', 'daily_limit', 'monthly_limit', 'ai_not_configured', 'session_required']) assert.equal(autoOutcome({ ok: false, code: c }).action, 'off', c);
  for (const c of ['ai_busy', 'ai_timeout', 'ledger_busy', 'ledger_unavailable', 'offline']) assert.equal(autoOutcome({ ok: false, code: c }).action, 'retry', c);
  assert.equal(autoOutcome({ ok: false, code: 'ledger_record_failed' }).action, 'drop');
  assert.equal(autoOutcome(null).action, 'drop');
});

function clock() {
  let t = 0, seq = 0; const timers = new Map();
  return {
    now: () => t,
    setTimer: (fn, ms) => { const id = ++seq; timers.set(id, { at: t + ms, fn }); return id; },
    clearTimer: id => timers.delete(id),
    async advance(ms) {
      const end = t + ms;
      for (;;) {
        const due = [...timers].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]); t = due[1].at; due[1].fn();
        for (let i = 0; i < 5; i++) await Promise.resolve();
      }
      t = end;
      for (let i = 0; i < 5; i++) await Promise.resolve();
    },
    pending: () => timers.size,
  };
}
const make = (answers, extra = {}) => {
  const c = clock(), calls = [], logs = [], done = [];
  const b = createAutoBatcher({ call: async a => { calls.push(a); return answers.length ? answers.shift() : { ok: true, data: { skipped: true } }; },
    isOwner: () => true, onDone: o => done.push(o), log: l => logs.push(l), now: c.now, setTimer: c.setTimer, clearTimer: c.clearTimer, ...extra });
  return { b, c, calls, logs, done };
};

test('묶기: 마지막 저장 10분 뒤 한 번, 저장이 이어져도 처음부터 30분 안에 한 번', async () => {
  const { b, c, calls } = make([]);
  b.saved(); await c.advance(WAIT_MS - 1000); assert.equal(calls.length, 0);
  b.saved(); await c.advance(WAIT_MS - 1000); assert.equal(calls.length, 0);
  await c.advance(1000); assert.equal(calls.length, 1);
  const s = make([]);
  for (let i = 0; i < 40; i++) { s.b.saved(); await s.c.advance(60 * 1000); }
  assert.equal(s.calls.length >= 1 && s.c.now() >= MAX_WAIT_MS, true);
  assert.equal(s.calls.length, 1); // 30분에 한 번(그 뒤 저장은 다음 묶음)
});

test('부르는 중 저장은 끝난 뒤 한 번 더 묶는다, 원장이 바뀌면 onDone', async () => {
  let release; const gate = new Promise(r => { release = r; });
  const c = clock(), calls = [], done = [];
  const b = createAutoBatcher({ call: async () => { calls.push(1); if (calls.length === 1) { await gate; return { ok: true, data: { run_id: U(1), records_new: 1 } }; } return { ok: true, data: { skipped: true } }; },
    isOwner: () => true, onDone: o => done.push(o), now: c.now, setTimer: c.setTimer, clearTimer: c.clearTimer });
  b.saved(); await c.advance(WAIT_MS); assert.equal(calls.length, 1); assert.equal(b.busy(), true);
  b.saved(); release(); await c.advance(0);
  assert.deepEqual(done, [{ action: 'done', changed: true, runId: U(1) }]);
  await c.advance(WAIT_MS); assert.equal(calls.length, 2);
});

test('재시도: 잠깐 실패는 10분 뒤 한 번만, 그다음 실패는 버리고 다음 저장을 기다림', async () => {
  const { b, c, calls, logs } = make([{ ok: false, code: 'ai_busy' }, { ok: false, code: 'ai_busy' }]);
  b.saved(); await c.advance(WAIT_MS); assert.equal(calls.length, 1);
  await c.advance(RETRY_MS - 1); assert.equal(calls.length, 1);
  await c.advance(1); assert.equal(calls.length, 2);
  await c.advance(RETRY_MS * 5); assert.equal(calls.length, 2);
  assert.deepEqual(logs, ['ledger_auto_retry:ai_busy', 'ledger_auto_skip:ai_busy']);
  assert.equal(b.pending(), false);
});

test('서버 없음(배포 전·DB 함수 없음·한도): 이 탭에서 끄고 더 부르지 않음, 던지지 않음', async () => {
  for (const code of ['unsupported_kind', 'not_ready', 'ledger_not_ready', 'daily_limit']) {
    const { b, c, calls, logs } = make([{ ok: false, code }]);
    b.saved(); await c.advance(WAIT_MS);
    assert.equal(calls.length, 1); assert.equal(b.isOff(), true); assert.deepEqual(logs, [`ledger_auto_off:${code}`]);
    b.saved(); b.opened(); await c.advance(MAX_WAIT_MS * 2); assert.equal(calls.length, 1);
    b.reset(); assert.equal(b.isOff(), false); // 다른 계정·다시 로그인이면 다시 켬
  }
  const thrown = make([], { call: async () => { throw new Error('network'); } });
  thrown.b.saved(); await thrown.c.advance(WAIT_MS); assert.deepEqual(thrown.logs, ['ledger_auto_skip:internal_error']);
});

test('앱을 열면 한 번(서버 처리 표 기준 밀린 것), 화면을 떠나면 기다리던 것을 바로(keepalive)', async () => {
  const { b, c, calls } = make([]);
  b.opened(); await c.advance(0); assert.equal(calls.length, 1); assert.deepEqual(calls[0], { leaving: false });
  b.saved(); b.flush(); await c.advance(0); assert.deepEqual(calls[1], { leaving: true });
  const none = make([]); none.b.flush(); await none.c.advance(0); assert.equal(none.calls.length, 0);
  const other = make([], { isOwner: () => false }); other.b.saved(); other.b.opened(); await other.c.advance(MAX_WAIT_MS); assert.equal(other.calls.length, 0);
});

test('근거 web2:<종류>:<id> → 원문 열기, 지워진 원문, 줄 글', () => {
  assert.deepEqual(web2Source(`web2:basket:${U(1).toUpperCase()}`), { kind: 'basket', id: U(1) });
  assert.equal(web2Source('web2:diary:' + U(1)), null);
  assert.equal(web2Source('https://x'), null);
  assert.deepEqual(web2OpenTarget({ kind: 'basket', id: U(1) }, { id: U(1) }), { view: 'basket', note: 'memo', id: U(1) });
  assert.equal(web2OpenTarget({ kind: 'basket', id: U(1) }, { id: U(1), archived_at: '2026-10-01T00:00:00Z' }), null);
  assert.deepEqual(web2OpenTarget({ kind: 'note', id: U(1) }, { id: U(1) }), { view: 'basket', note: 'doc', id: U(1) });
  assert.deepEqual(web2OpenTarget({ kind: 'work', id: U(1) }, { id: U(1), journal_day: '2026-10-22' }), { view: 'journal', day: '2026-10-22' });
  assert.deepEqual(web2OpenTarget({ kind: 'meeting', id: U(2) }, { id: U(2) }), { view: 'meetings', id: U(2) });
  assert.deepEqual(web2OpenTarget({ kind: 'org_update', id: U(3) }, { id: U(3), organization_id: U(4) }), { view: 'team', id: U(4) });
  assert.deepEqual(web2OpenTarget({ kind: 'project_update', id: U(3) }, { id: U(3), project_id: U(5) }), { view: 'projects', id: U(5) });
  assert.equal(web2OpenTarget({ kind: 'meeting', id: U(2) }, undefined), null);
  assert.equal(web2SourceLabel({ kind: 'meeting' }, { title: 'Web2 사업 보고 2026-10-21 (가 지부 3차)', source_date: '2026-10-21' }), '사업 보고 · 가 지부 3차 · 10/21');
  assert.equal(web2SourceLabel({ kind: 'basket' }, { title: 'Web2 업데이트 2026-10-22', source_date: '2026-10-22' }), '업데이트 · 10/22');
});

test('변경 기록 → 자동 꼬리표·실행 번호·한 줄 글, 틀린 기록 요청 모양, 거절 일상어', () => {
  const m = changeInfo([
    { record_id: U(1), action: 'created', route: 'auto', run_id: U(9), note: '자동 기록 · 2026-10-24' },
    { record_id: U(2), action: 'source_added', route: 'auto', run_id: U(9), note: '' },
    { record_id: 'x', action: 'created', route: 'auto' }, { record_id: U(3), action: 'bad', route: 'auto' },
  ]);
  assert.deepEqual(m.get(U(1)), { auto: true, manual: false, runId: U(9), notes: ['자동 기록 · 2026-10-24'] });
  assert.equal(m.get(U(2)).auto, false);
  assert.equal(m.size, 2);
  assert.deepEqual(retireRequest('EVT-0901', 'duplicate'), { format: 'kptu-ledger-fix', version: 1, received_from: 'user', items: [{ target: 'EVT-0901', do: 'retire', reason: '같은 기록이 이미 있어요' }] });
  assert.equal(retireRequest('EVT-0901', 'other'), null);
  assert.equal(retireRequest('<x>', 'wrong'), null);
  assert.match(undoErrorText({ message: 'LEDGER_AUTO_UNDO_CHANGED: x' }), /그 뒤에 고친/);
  assert.match(undoErrorText({ status: 404, message: 'PGRST202' }), /준비 전/);
  assert.doesNotMatch(undoErrorText({ message: 'LEDGER_X' }), /LEDGER/);
});

test('Drive 사본: 열 때 하루 넘고 바뀌었으면, 바뀐 뒤 10분·한 시간 간격, 상태 한 줄(멈췄을 때만 경고)', () => {
  const NOW = Date.parse('2026-10-26T00:00:00Z');
  const s = over => ledgerFromStatus({ ok: true, ledger: { state: 'found', last_success_at: null, last_failure_at: null, last_failure_code: null, ...over } });
  const ok = s({ last_success_at: new Date(NOW - 2 * DAY_MS).toISOString() });
  assert.equal(exportDue(ok, NOW, null), false);
  assert.equal(exportDue(ok, NOW, NOW - DAY_MS), true);
  assert.equal(exportDue(ok, NOW, NOW - 3 * DAY_MS), false);
  assert.equal(exportDue(s({ last_success_at: new Date(NOW - 3600000).toISOString() }), NOW, NOW - 60000), false);
  assert.equal(nextExportDelay(null, NOW), CHANGE_WAIT_MS);
  assert.equal(nextExportDelay(NOW - 5 * 60000, NOW), MIN_GAP_MS - 5 * 60000);
  assert.deepEqual(copyState(ok, NOW, null), { stalled: false, at: NOW - 2 * DAY_MS });
  assert.equal(copyState(ok, NOW, NOW - 2 * 3600000).stalled, false); // 바뀐 지 하루 안
  assert.equal(copyState(ok, NOW, NOW - DAY_MS - 1).stalled, true);
  const failed = s({ last_success_at: new Date(NOW - 3 * DAY_MS).toISOString(), last_failure_at: new Date(NOW - 3600000).toISOString(), last_failure_code: 'DRIVE_TOKEN_FAILED' });
  assert.deepEqual(copyState(failed, NOW, null), { stalled: true, since: NOW - 3 * DAY_MS, code: 'DRIVE_TOKEN_FAILED' });
  assert.equal(copyState(null, NOW), null);
});

test('업무일지 약속 수: 기록된 날(KST)별, 같은 기록 한 번, 약속만', () => {
  assert.equal(kstDayStart('2026-10-24'), '2026-10-23T15:00:00.000Z');
  const rows = [{ record_id: U(1), created_at: '2026-10-23T15:30:00Z' }, { record_id: U(1), created_at: '2026-10-23T16:00:00Z' },
    { record_id: U(2), created_at: '2026-10-23T14:59:00Z' }, { record_id: U(3), created_at: '2026-10-24T01:00:00Z' }];
  assert.deepEqual([...countByDay(rows, new Set([U(1), U(2)]))], [['2026-10-24', 1], ['2026-10-23', 1]]);
});

test('모듈: 본문은 kind 하나, 브라우저 저장소·서버 키 없음, 내보내기 버튼 없음', () => {
  const strip = f => readFileSync(new URL(`../app/${f}`, import.meta.url), 'utf8').split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  const auto = strip('ledger-auto.js'), model = strip('ledger-auto-model.mjs'), exp = strip('ledger-export.js');
  assert.match(auto, /\{ kind: 'ledger_auto' \}/);
  for (const src of [auto, model, exp, strip('journal-ledger.js')]) {
    // 브라우저 저장소 금지(이름은 browser-storage-audit가 따로 막으므로 여기서는 조각으로 만든다).
    assert.doesNotMatch(src, new RegExp(['local', 'session'].map(x => x + 'Storage').concat(['indexed' + 'DB']).join('|')));
    assert.doesNotMatch(src, /service_role|cron-secret/i);
  }
  assert.doesNotMatch(exp, /지금 Drive로 내보내기|data-le-action="export"/);
  assert.match(exp, /'\/functions\/v1\/drive-summary\?action=ledger_export'/);
  assert.doesNotMatch(exp, /body:/);
  assert.match(strip('loader-v2.js'), /import\('\.\/ledger-auto\.js'\)/);
});
