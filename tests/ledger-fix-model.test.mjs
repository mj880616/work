// LEDGER-수정요청: 원장 고치기 칸(app/ledger-fix.js)의 순수 함수. 합성 값만(09xx ID, 가상 이름).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readInput, serverBody, targetsOf, previewLine, previewLines, valueText, appliedText, fixErrorText, FIX_TEXT_MAX,
  plainChange, quickKeys, menuPlan, quickRequest, quickDoneText, anchoredViolation, reopenPlan, QUICK_ACTIONS, QUICK_NOTE_MAX } from '../app/ledger-fix-model.mjs';
import { isSearching, overdueDays, overdueLabel, storySort, chipList, changeInfo, freshFilters, SENSITIVITY_LABEL } from '../app/ledger-browse-model.mjs';

test('input: plain sentence vs Claude block; blank, too long and broken blocks are refused with plain words', () => {
  assert.deepEqual(readInput('  나 지부 2차 교섭은\n11/4가 아니라 11/5였음 '), { mode: 'text', text: '나 지부 2차 교섭은 11/4가 아니라 11/5였음' });
  const block = { format: 'kptu-ledger-fix', version: 1, items: [{ target: 'EVT-0901', do: 'retire', reason: '중복' }] };
  assert.deepEqual(readInput(JSON.stringify(block)), { mode: 'paste', request: { received_from: 'claude_chat', ...block } });
  assert.equal(readInput(JSON.stringify({ ...block, received_from: 'user' })).request.received_from, 'user');
  for (const bad of ['', '   ', '{', '{"format":"x","version":1,"items":[{}]}', '{"format":"kptu-ledger-fix","version":1,"items":[]}', '[1]'.replace('[', '{')]) assert.ok(readInput(bad).error, bad);
  assert.ok(readInput('가'.repeat(FIX_TEXT_MAX + 1)).error);
  assert.equal(readInput('가'.repeat(FIX_TEXT_MAX)).mode, 'text');
});

test('server body: kind + text, target only when it is a ledger id', () => {
  assert.deepEqual(serverBody('고침', 'EVT-0901'), { kind: 'ledger_fix', text: '고침', target: 'EVT-0901' });
  assert.deepEqual(serverBody('고침', null), { kind: 'ledger_fix', text: '고침' });
  assert.deepEqual(serverBody('고침', 'evt-1'), { kind: 'ledger_fix', text: '고침' });
  assert.deepEqual(targetsOf({ items: [{ target: 'EVT-0901' }, { do: 'add', belongs_to: 'EVT-0902' }, { target: 'nope' }] }), ['EVT-0901', 'EVT-0902']);
});

test('preview lines: everyday words, no ledger ids or DB words; replace says the old record stays as 대체됨', () => {
  const names = { records: new Map([['EVT-0901', '가상 나 지부 2차 교섭']]), topics: new Map([['TOP-0901', '가상 임금']]) };
  const replace = previewLine({ do: 'replace', target: 'EVT-0901', changes: [{ field: 'date_start', before: '2026-11-04', after: '2026-11-05' }, { field: 'date_precision', before: 'day', after: 'day' }] }, names);
  assert.equal(replace, '‘가상 나 지부 2차 교섭’: 날짜 11/4 → 11/5로 고침. 옛 기록은 대체됨으로 남김.');
  assert.equal(previewLine({ do: 'retire', target: 'EVT-0901', changes: [] }, names), '‘가상 나 지부 2차 교섭’을(를) 틀린 기록으로 폐기(지우지 않음).');
  assert.equal(previewLine({ do: 'add', kind: 'commitment', changes: [{ field: 'title', after: '가상 사측 회신 약속' }, { field: 'counterparty', after: '가 사측' }, { field: 'follow_up_on', after: '2026-11-01' }] }, names),
    '새 기록(약속) ‘가상 사측 회신 약속’ · 상대 ‘가 사측’ · 확인일 11/1 넣음.');
  assert.match(previewLine({ do: 'add_source', target: 'EVT-0901', changes: [{ field: 'source', after: 'already attached' }] }, names), /이미 붙어/);
  assert.equal(previewLine({ do: 'replace', target: 'EVT-0909', changes: [{ field: 'topic', before: null, after: 'TOP-0901' }] }, names), '그 기록: 주제 없음 → 가상 임금로 고침. 옛 기록은 대체됨으로 남김.');
  assert.equal(valueText('event_status', 'closed'), '종료');
  assert.equal(valueText('sensitivity', 'S2'), '교섭·전략');
  const lines = previewLines({ dry_run: true, items: [{ do: 'retire', target: 'EVT-0901', changes: [] }] }, names);
  assert.equal(lines.length, 1);
  for (const l of [replace, ...lines]) assert.doesNotMatch(l, /EVT-|DB|superseded|retired|current/);
  assert.equal(previewLines({ dry_run: false, items: [] }), null);
  assert.equal(previewLines(null), null);
});

test('applied text and plain error words (no codes)', () => {
  assert.equal(appliedText({ applied: 1 }), '원장에 반영했어요.');
  assert.equal(appliedText({ applied: 3 }), '원장에 3건 반영했어요.');
  const cases = [[{ message: 'LEDGER_FIX_TARGET_INACTIVE: EVT-0901' }, /이미 대체/], [{ message: 'LEDGER_FIX_BROKEN_REF: target EVT-1' }, /찾지 못했어요/],
    [{ message: 'LEDGER_AUTO_PERSONAL: record' }, /개인정보/], [{ message: 'LEDGER_FIX_BAD_REQUEST: item 1' }, /형식/], [{ status: 404 }, /준비 전/],
    [{ message: 'LEDGER_FIX_NOT_OWNER' }, /소유자/], [{ message: 'boom' }, /저장하지 못했어요/]];
  for (const [e, re] of cases) { const t = fixErrorText(e); assert.match(t, re); assert.doesNotMatch(t, /LEDGER_|EVT-/); }
});

test('home helpers: searching or not, overdue days and label, story order, chips', () => {
  assert.equal(isSearching(freshFilters()), false);
  assert.equal(isSearching({ ...freshFilters(), q: ' ' }), false);
  for (const f of [{ q: '교섭' }, { kinds: ['event'] }, { from: '2026-10-01' }, { organization: 'x' }, { scope: 'all' }, { inactive: true }]) assert.equal(isSearching({ ...freshFilters(), ...f }), true, JSON.stringify(f));
  const now = new Date('2026-10-24T03:00:00Z');
  assert.equal(overdueDays('2026-10-19', now), 5);
  assert.equal(overdueDays('2026-10-24', now), 0);
  assert.equal(overdueDays('nope', now), 0);
  assert.equal(overdueLabel({ counterparty: '가 사측', follow_up_on: '2026-10-19' }, now), '가 사측 · 확인일 10/19 · 5일 지남');
  const rows = [{ ledger_id: 'B', date_start: null }, { ledger_id: 'C', date_start: '2026-10-02' }, { ledger_id: 'A', date_start: '2026-10-02' }, { ledger_id: 'D', date_start: '2026-09-30' }];
  assert.deepEqual(storySort(rows).map(r => r.ledger_id), ['D', 'A', 'C', 'B']);
  const id = n => `e0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const names = new Map([[id(1), '나 지부'], [id(2), '가 지부'], [id(3), '']]);
  assert.deepEqual(chipList([id(1), id(2), id(2), id(3), 'x', null], names), [{ id: id(2), name: '가 지부', count: 2 }, { id: id(1), name: '나 지부', count: 1 }]);
  // 직접 넣거나 고친 기록(수정 요청이 만든 기록)은 manual.
  const info = changeInfo([{ record_id: id(9), action: 'created', route: 'correction', note: '명진이 직접 기록 · 2026-10-24' }]);
  assert.deepEqual([info.get(id(9)).auto, info.get(id(9)).manual], [false, true]);
  assert.deepEqual(Object.values(SENSITIVITY_LABEL), ['공개 가능', '내부', '교섭·전략']);
});

test('screen modules: import and candidate panels are gone from the screen; data functions stay untouched', () => {
  const browse = readFileSync(new URL('../app/ledger-browse.js', import.meta.url), 'utf8');
  const loader = readFileSync(new URL('../app/view-loader.js', import.meta.url), 'utf8');
  const fix = readFileSync(new URL('../app/ledger-fix.js', import.meta.url), 'utf8');
  for (const src of [browse, loader, fix]) assert.doesNotMatch(src, /ledger-import\.js|ledger-candidates\.js|app_import_ledger_apply|app_confirm_ledger_candidate|원장 가져오기|원장 후보 만들기/);
  assert.match(loader, /module\('\.\/ledger-fix\.js','__KPTU_LEDGER_FIX_READY__'\)/);
  // The fix panel only writes through the two DB functions, and applies only a request it previewed (dry run first).
  const writes = [...fix.matchAll(/rpc\/(app_[a-z_]+)/g)].map(m => m[1]);
  assert.deepEqual([...new Set(writes)].sort(), ['app_apply_ledger_fix', 'app_undo_ledger_fix']);
  assert.match(fix, /p_dry_run: true/);
  assert.match(fix, /if \(state\.busy \|\| !state\.request\) return;/);
  // 브라우저 저장소 이름은 조각으로 만든다(저장소 사용 검사 workflow가 이 시험 파일을 사용처로 보지 않게).
  assert.doesNotMatch(fix, new RegExp(['local', 'session'].map(k => k + 'Storage').concat(['indexed' + 'DB']).join('|')));
});

// ---------- LEDGER-기록바로업데이트 ----------
const com = { ledger_id: 'COM-0901', kind: 'commitment', validity: 'current', commitment_status: 'waiting', note: '' };
const evt = { ledger_id: 'EVT-0901', kind: 'event', validity: 'current', event_status: 'tracking', note: '기존 비고' };

test('quick actions: only the shortcuts that fit the kind and state; none for change/decision/evidence or finished records', () => {
  assert.deepEqual(quickKeys(com), ['fulfill', 'drop']);
  assert.deepEqual(quickKeys({ ...com, validity: 'needs_check' }), ['fulfill', 'drop']);
  assert.deepEqual(quickKeys({ ...com, commitment_status: 'fulfilled' }), []);
  assert.deepEqual(quickKeys({ ...com, commitment_status: 'cancelled' }), []);
  assert.deepEqual(quickKeys(evt), ['end']);
  assert.deepEqual(quickKeys({ ...evt, event_status: 'watching' }), ['end']);
  assert.deepEqual(quickKeys({ ...evt, event_status: 'closed' }), []);
  for (const kind of ['change', 'decision', 'evidence']) assert.deepEqual(quickKeys({ ledger_id: 'CHG-0901', kind, validity: 'current' }), [], kind);
  assert.deepEqual(quickKeys({ ...com, validity: 'superseded' }), []);
  assert.deepEqual(quickKeys({ ...com, validity: 'retired' }), []);
  assert.deepEqual(quickKeys(null), []);
});

test('menu plan: shortcuts / update / mark-wrong, plus auto-run cancel only for auto records; finished records get no menu', () => {
  assert.deepEqual(menuPlan(com, null), { quick: ['fulfill', 'drop'], update: true, mark: true, undoRun: false });
  assert.deepEqual(menuPlan({ ledger_id: 'DEC-0901', kind: 'decision', validity: 'current' }, { auto: true, runId: 'r' }), { quick: [], update: true, mark: true, undoRun: true });
  assert.equal(menuPlan(com, { auto: true }).undoRun, false);
  assert.deepEqual(menuPlan({ ...com, validity: 'superseded' }, null), { quick: [], update: false, mark: false, undoRun: false });
});

test('quick request: one replace on that record only; blank text is allowed and the old note is kept', () => {
  assert.deepEqual(quickRequest(com, 'drop'), { format: 'kptu-ledger-fix', version: 1, received_from: 'user',
    items: [{ target: 'COM-0901', do: 'replace', set: { commitment_status: 'cancelled' }, reason: '더 이상 추적하지 않음' }] });
  assert.deepEqual(quickRequest(com, 'fulfill').items[0], { target: 'COM-0901', do: 'replace', set: { commitment_status: 'fulfilled' }, reason: '지켜져서 종결' });
  assert.deepEqual(quickRequest(evt, 'end').items[0], { target: 'EVT-0901', do: 'replace', set: { event_status: 'closed' }, reason: '추적을 끝냄' });
  const withText = quickRequest({ ...com, note: '앞 메모' }, 'fulfill', '  자료 받음\n11/3 ');
  assert.equal(withText.items[0].set.note, '앞 메모 · 결과: 자료 받음 11/3');
  assert.equal(withText.items[0].reason, '지켜짐 · 자료 받음 11/3');
  assert.equal(quickRequest(evt, 'end', '정리됨').items[0].set.note, '기존 비고 · 추적을 끝낸 이유: 정리됨');
  assert.equal([...quickRequest(com, 'drop', '가'.repeat(500)).items[0].reason].length <= 300, true);
  assert.equal([...quickRequest(com, 'drop', '가'.repeat(500)).items[0].set.note].length < QUICK_NOTE_MAX + 40, true);
  // 맞지 않는 바로가기·종류는 요청을 만들지 않는다.
  assert.equal(quickRequest(com, 'end'), null);
  assert.equal(quickRequest(evt, 'drop'), null);
  assert.equal(quickRequest({ ...com, commitment_status: 'fulfilled' }, 'drop'), null);
  assert.equal(quickRequest({ ...com, ledger_id: 'x' }, 'drop'), null);
  for (const k of Object.keys(QUICK_ACTIONS)) assert.ok(QUICK_ACTIONS[k].label && QUICK_ACTIONS[k].line.endsWith('.'));
  assert.match(quickDoneText('drop', 'COM-0901'), /추적에서 뺐어요/);
  assert.match(quickDoneText('fulfill', 'COM-0901'), /지켜짐으로 종결/);
  assert.match(quickDoneText('end', 'EVT-0901'), /추적을 끝냈어요/);
});

test('preview in plain words for status and due-date changes (needs the record kind); other changes keep the before → after lines', () => {
  const kinds = new Map([['COM-0901', 'commitment'], ['EVT-0901', 'event']]);
  const names = { records: new Map([['COM-0901', '가상 회신 약속']]), kinds };
  const rep = (target, ...changes) => ({ do: 'replace', target, changes });
  assert.equal(previewLine(rep('COM-0901', { field: 'commitment_status', before: 'waiting', after: 'cancelled' }), names), '이 약속을 추적에서 뺍니다. 옛 기록은 대체됨으로 남깁니다.');
  assert.match(previewLine(rep('COM-0901', { field: 'commitment_status', before: 'waiting', after: 'fulfilled' }), names), /^이 약속을 지켜짐으로 종결합니다/);
  assert.match(previewLine(rep('COM-0901', { field: 'follow_up_on', before: '2026-10-30', after: '2026-11-05' }), names), /^이 약속의 기한을 11\/5로 바꿉니다/);
  assert.match(previewLine(rep('COM-0901', { field: 'follow_up_on', before: '2026-10-30', after: null }), names), /기한을 없앱니다/);
  assert.match(previewLine(rep('EVT-0901', { field: 'event_status', before: 'tracking', after: 'closed' }), names), /^이 일의 추적을 끝냅니다/);
  assert.match(previewLine(rep('COM-0901', { field: 'commitment_status', before: 'waiting', after: 'cancelled' }, { field: 'note', before: '', after: '이유' }), names), /^이 약속을 추적에서 뺍니다 · 이 약속의 비고를 바꿉니다/);
  // 메모만 붙이면 상태가 안 바뀌는 것이 그대로 보인다(추적 안 함 메모만 붙는 경우를 눈으로 알아볼 수 있게).
  assert.equal(previewLine(rep('COM-0901', { field: 'note', before: '', after: '더 이상 추적 안 함' }), names), '이 약속의 비고를 바꿉니다. 옛 기록은 대체됨으로 남깁니다.');
  // 알 수 없는 칸이 섞이거나 종류를 모르면 기존 문구.
  assert.match(previewLine(rep('COM-0901', { field: 'commitment_status', before: 'waiting', after: 'cancelled' }, { field: 'title', before: 'a', after: 'b' }), names), /로 고침\. 옛 기록은 대체됨으로 남김\./);
  assert.match(previewLine(rep('COM-0901', { field: 'commitment_status', before: 'waiting', after: 'cancelled' }), { records: names.records }), /이행 대기 → 취소/);
  assert.equal(plainChange([{ field: 'commitment_status', after: 'cancelled' }], 'event'), null);
  assert.equal(plainChange([], 'commitment'), null);
});

test('[내용 업데이트…] stays on its record: only replace/retire/add_source of that record pass', () => {
  const ok = { items: [{ do: 'replace', target: 'COM-0901', set: { follow_up_on: '2026-11-05' }, reason: '기한' }] };
  assert.equal(anchoredViolation(ok, 'COM-0901'), null);
  assert.equal(anchoredViolation({ items: [{ do: 'retire', target: 'COM-0901', reason: 'x' }] }, 'COM-0901'), null);
  assert.equal(anchoredViolation({ items: [{ do: 'add_source', target: 'COM-0901', source: {} }] }, 'COM-0901'), null);
  assert.match(anchoredViolation({ items: [{ do: 'retire', target: 'DEC-0901', reason: 'x' }] }, 'COM-0901'), /이 기록 하나만/);
  assert.match(anchoredViolation({ items: [...ok.items, { do: 'retire', target: 'DEC-0901', reason: 'x' }] }, 'COM-0901'), /이 기록 하나만/);
  assert.match(anchoredViolation({ items: [{ do: 'add', kind: 'event', set: { title: 't' } }] }, 'COM-0901'), /\[\+ 기록하기\]/);
  assert.ok(anchoredViolation({ items: [] }, 'COM-0901'));
  assert.equal(anchoredViolation({ items: [{ do: 'add', kind: 'event', set: { title: 't' } }] }, null), null);
});

test('after the ledger is re-read: re-read the open record when it is still listed, close it when it is gone, nothing when none is open', () => {
  assert.equal(reopenPlan(null, ['a']), 'none');
  assert.equal(reopenPlan('a', ['a', 'b']), 'reread');
  assert.equal(reopenPlan('a', new Set(['a'])), 'reread');
  assert.equal(reopenPlan('a', ['b']), 'close');
  assert.equal(reopenPlan('a', []), 'close');
  assert.equal(reopenPlan('a', undefined), 'close');
});

test('browse screen wiring (source text): detail is re-read after a reload, every write path goes through the same reload, no browser storage', () => {
  const src = readFileSync(new URL('../app/ledger-browse.js', import.meta.url), 'utf8');
  assert.match(src, /settleOpen\(open\)/);
  assert.match(src, /reopenPlan\(/);
  assert.match(src, /keepOpen: true/);
  assert.match(src, /again = true/);
  for (const fn of ['retireRecord', 'quickApply', 'undoRun']) assert.match(src, new RegExp('function ' + fn), fn);
  assert.equal((src.match(/changedLedger\(\)/g) || []).length >= 5, true);
  // 브라우저 저장소 금지(글자를 쪼개 둔 것은 저장소 사용 점검기가 이 시험 파일을 사용처로 오인하지 않게).
  assert.equal(['local', 'session'].some(p => src.includes(p + 'Storage')) || src.includes('indexed' + 'DB'), false);
  assert.doesNotMatch(src, /lg-danger/);
  assert.doesNotMatch(src, /lb-detail-top/);
});
