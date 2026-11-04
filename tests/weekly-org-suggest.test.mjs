import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// WEEKLY-메뉴짝짓기 P4: 제안 줄을 부르는 자리(기록 번호만 보냄, 기다리지 않음) + 열 때 빠진 것 채우기.
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('부르는 자리: 조직 기록 저장·고침, 조직 확정 연결, 현황 표 줄 넣기·고침이 모두 같은 함수 하나를 부른다', () => {
  assert.match(read('app/quick-save.js'), /suggestOrgWeek\('org_update',rows\[0\]\.id/);
  assert.match(read('app/workplace-detail.js'), /suggestOrgWeek\('org_update',id/);
  assert.match(read('app/basket-classification.js'), /suggestFromLinks\(noteId,targets/);
  const st = read('app/org-status-table.js');
  assert.match(st, /suggestOrgWeek\('status_row', id/);assert.match(st, /suggestOrgWeek\('status_row', made\[0\]\.id/);
  assert.match(read('app/weekly-org-lines.js'), /void fillMissing\(/);
});

test('보내는 것은 종류와 번호뿐(글·조직·날짜를 보내지 않음), 저장 흐름을 기다리게 하지 않는다', () => {
  const s = read('app/weekly-org-suggest.js');
  assert.match(s, /callAiAssist\(\{kind: 'org_week_lines', source_kind: job\.kind, source_id: job\.id\}/);
  assert.doesNotMatch(s, /raw_text|body:/);
  assert.match(s, /FILL_MAX = 10/);
  assert.doesNotMatch(s, /\b(?:local|session)Storage\b|\?v=/);
  for (const [f, re] of [['app/quick-save.js', /await suggestOrgWeek/], ['app/basket-classification.js', /await suggestFromLinks/], ['app/org-status-table.js', /await suggestOrgWeek/]]) assert.doesNotMatch(read(f), re, f);
});

test('번호가 uuid가 아니거나 종류가 다르면 보내지 않고, 같은 기록은 차례 줄에 한 번만', async () => {
  const calls = [];
  globalThis.window = {dispatchEvent() {}, KPTURuntime: null};
  globalThis.CustomEvent = class { constructor(t, o) { this.type = t; this.detail = o?.detail; } };
  const rt = {session: {ensure: async () => true, read: () => ({access_token: 't'})}, config: {url: 'https://x', key: 'k'}};
  globalThis.fetch = async (url, init) => { calls.push(JSON.parse(init.body)); return {ok: true, status: 200, text: async () => JSON.stringify({ok: true, kind: 'org_week_lines', week_start: '2026-11-02', results: [{organization_id: 'o', result: 'added'}]})}; };
  const m = await import('../app/weekly-org-suggest.js');
  const id = '11111111-1111-4111-8111-111111111111';
  assert.equal(m.suggestOrgWeek('org_update', 'not-uuid', {rt}), false);
  assert.equal(m.suggestOrgWeek('meeting', id, {rt}), false);
  assert.equal(m.suggestOrgWeek('org_update', id, {rt}), true);
  assert.equal(m.suggestOrgWeek('org_update', id, {rt}), false);
  m.suggestFromLinks(id, [{kind: 'project'}], {rt});
  m.suggestFromLinks(id, [{kind: 'organization'}], {rt});
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(calls, [{kind: 'org_week_lines', source_kind: 'org_update', source_id: id}, {kind: 'org_week_lines', source_kind: 'note', source_id: id}]);
});
