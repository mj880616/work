import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMeetingMemo, selectedResultText, sendMeetingToBasket, MEMO_LIMIT } from '../app/meeting-basket-send.js';
import { createNote } from '../app/basket-data.js';

const runtime = api => ({ context: { read: () => ({ workspace: { id: 'w' } }) }, api });
const meeting = { id: 'm', series_name: '시험 회의', round_no: 3, meeting_at: '2026-09-17T10:00:00Z' };

test('memo starts with a source line using the Seoul meeting date and keeps the body as is', () => {
  const r = buildMeetingMemo({ name: '시험 회의', roundNo: 3, meetingAt: '2026-09-17T16:00:00Z', body: ' 본문 첫 줄\n둘째 줄 ' });
  assert.equal(r.raw_text, '출처: 시험 회의 3차 회의 (2026-09-18)\n\n본문 첫 줄\n둘째 줄');
  assert.equal(r.truncated, false);
});
test('memo without name, round or date still has a clean source line', () => {
  assert.equal(buildMeetingMemo({ body: '글' }).raw_text, '출처: 회의 회의\n\n글');
});
test('long results are cut to 20,000 characters in total with a visible cut mark (B7)', () => {
  const r = buildMeetingMemo({ name: '회의', meetingAt: '2026-09-17T10:00:00Z', body: '😀'.repeat(30000) });
  assert.equal(r.truncated, true);
  assert.equal([...r.raw_text].length, MEMO_LIMIT);
  assert.ok(r.raw_text.endsWith('…(뒷부분 잘림)'));
  const exact = buildMeetingMemo({ name: '회의', body: '가'.repeat(MEMO_LIMIT - [...'출처: 회의 회의\n\n'].length) });
  assert.equal(exact.truncated, false);
  assert.equal([...exact.raw_text].length, MEMO_LIMIT);
});
test('selected text counts only inside the result box', () => {
  const inside = {}, root = { contains: n => n === inside };
  const sel = (node, text, collapsed = false) => ({ rangeCount: 1, isCollapsed: collapsed, getRangeAt: () => ({ commonAncestorContainer: node }), toString: () => text });
  assert.equal(selectedResultText(root, sel(inside, ' 고른 글 ')), '고른 글');
  assert.equal(selectedResultText(root, sel({}, '밖의 글')), '');
  assert.equal(selectedResultText(root, sel(inside, '글', true)), '');
  assert.equal(selectedResultText(root, { rangeCount: 0 }), '');
  assert.equal(selectedResultText(null, sel(inside, '글')), '');
});
test('createNote sends occurred_at only when given', async () => {
  const calls = [];
  const rt = runtime(async (path, o) => { calls.push(o.body); return [{ id: 'n', ...o.body }]; });
  await createNote({ raw_text: '글' }, rt);
  await createNote({ raw_text: '글', occurred_at: '2026-09-17T10:00:00.000Z' }, rt);
  assert.equal(Object.hasOwn(calls[0], 'occurred_at'), false);
  assert.equal(calls[1].occurred_at, '2026-09-17T10:00:00.000Z');
});
test('send saves one basket note through the existing insert dated at the meeting, and announces it', async () => {
  const calls = [], events = [];
  globalThis.window = { dispatchEvent: e => events.push(e.type) };
  globalThis.CustomEvent = class { constructor(type) { this.type = type; } };
  const rt = runtime(async (path, o) => { calls.push({ path, method: o.method, body: o.body }); return [{ id: 'n', ...o.body }]; });
  const r = await sendMeetingToBasket(meeting, '고른 글', rt);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/rest/v1/app_notes');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].body.workspace_id, 'w');
  assert.equal(calls[0].body.occurred_at, '2026-09-17T10:00:00.000Z');
  assert.ok(calls[0].body.raw_text.startsWith('출처: 시험 회의 3차 회의 (2026-09-17)\n\n고른 글'));
  assert.equal(Object.keys(calls[0].body).sort().join(), 'occurred_at,raw_text,workspace_id');
  assert.equal(r.truncated, false);
  assert.deepEqual(events, ['kptu:basket-note-created']);
  await assert.rejects(sendMeetingToBasket(meeting, '  ', rt), /담을 글/);
  assert.equal(calls.length, 1);
  delete globalThis.window;
});
