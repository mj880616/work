import { test } from 'node:test';
import assert from 'node:assert/strict';
// UI-자주가는링크: 주소·이름 검사, 저장된 값 읽기, 순서 바꾸기, 내 프로필 칸 읽기/쓰기. 공개 업무 주소만.
const mod = import('../app/quick-links.js');

test('주소: http/https만, javascript:·data:·ftp:·공백·빈 호스트는 거절, www.만 쓰면 https:// 붙임', async () => {
  const {cleanUrl} = await mod;
  for (const ok of ['https://www.kptu.net:8000/main', 'http://www.stlu.kr/', 'HTTPS://EXAMPLE.ORG']) assert.equal(cleanUrl(ok), ok);
  assert.equal(cleanUrl('  https://railone.kr/  '), 'https://railone.kr/');
  assert.equal(cleanUrl('www.example.org/a?b=1'), 'https://www.example.org/a?b=1');
  for (const bad of ['javascript:alert(1)', 'JavaScript:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,x', 'vbscript:x', 'ftp://example.org',
    'file:///etc/passwd', 'mailto:a@example.org', 'https://', 'http://', 'https://exa mple.org', 'https://a\nb', '//example.org', '/relative', 'example', '', null,
    'https://' + 'a'.repeat(2000)]) assert.equal(cleanUrl(bad), null, String(bad));
});

test('이름: 앞뒤 공백 제거 1~40자, 제어문자 거절', async () => {
  const {cleanName} = await mod;
  assert.equal(cleanName('  망고보드 '), '망고보드');
  assert.equal(cleanName('가'.repeat(40)), '가'.repeat(40));
  for (const bad of ['', '   ', '가'.repeat(41), '두\n줄', null]) assert.equal(cleanName(bad), null);
});

test('저장된 값: 비어 있으면 초기 11개, 모양이 틀리면 null(믿지 않음)', async () => {
  const {parseLinks, DEFAULT_LINKS} = await mod;
  assert.equal(parseLinks(null).length, 11);
  assert.deepEqual(parseLinks(null), DEFAULT_LINKS.map(l => ({...l})));
  assert.equal(DEFAULT_LINKS.filter(l => l.group === 'work').length, 7);
  assert.ok(DEFAULT_LINKS.every(l => /^https?:\/\/[^@\s]+$/.test(l.url)), 'no account in a default address');
  assert.deepEqual(parseLinks([]), []);
  const good = [{group: 'org', name: '궤도협의회', url: 'https://railone.kr/'}];
  assert.deepEqual(parseLinks(good), good);
  for (const bad of [{}, 'x', [null], [{group: 'etc', name: 'a', url: 'https://a.org'}], [{group: 'work', name: 'a', url: 'javascript:alert(1)'}],
    [{group: 'work', name: ' a', url: 'https://a.org'}], [{group: 'work', name: 'a', url: 'https://a.org', extra: 1}], [{group: 'work', name: 'a', url: 5}],
    Array.from({length: 61}, (_, i) => ({group: 'work', name: 'n' + i, url: 'https://a.org/' + i}))]) assert.equal(parseLinks(bad), null, JSON.stringify(bad).slice(0, 60));
});

test('편집 검사와 같은 묶음 안 순서 바꾸기', async () => {
  const {validateDraft, moveWithinGroup} = await mod;
  const rows = [{group: 'work', name: 'A', url: 'https://a.org'}, {group: 'work', name: 'B', url: 'b.org'}, {group: 'org', name: 'C', url: 'https://c.org'}];
  assert.deepEqual(validateDraft(rows), {links: [rows[0], {group: 'work', name: 'B', url: 'https://b.org'}, rows[2]], groups: [{id: 'work', name: '업무'}, {id: 'org', name: '담당조직 홈페이지'}], errors: []});
  assert.deepEqual(validateDraft([{group: 'work', name: '', url: 'javascript:x'}]).errors, [[0, 'name'], [0, 'url']]);
  assert.deepEqual(moveWithinGroup(rows, 1, 0).map(r => r.name), ['B', 'A', 'C']);
  assert.equal(moveWithinGroup(rows, 1, 2), rows, 'never across groups');
});

test('읽기·쓰기: 내 프로필 행 quick_links 칸만, 칸이 없으면(400) pending', async () => {
  const {readLinks, saveLinks} = await mod;
  const calls = [];
  const rt = (reply) => ({context: {read: () => ({user: {id: 'u-1'}})}, api: async (path, options = {}) => { calls.push([path, options]); return reply(path, options); }});
  assert.deepEqual((await readLinks(rt(() => [{quick_links: null}]))).status, 'ok');
  assert.equal(calls.at(-1)[0], '/rest/v1/app_profiles?user_id=eq.u-1&select=quick_links,quick_link_groups&limit=1');
  const missing = rt(() => { const e = new Error('x'); e.status = 400; throw e; });
  const pending = await readLinks(missing);
  assert.equal(pending.status, 'pending'); assert.equal(pending.links.length, 11);
  assert.equal((await readLinks(rt(() => { const e = new Error('x'); e.status = 500; throw e; }))).status, 'error');
  assert.equal((await readLinks({context: {read: () => null}})).status, 'error');
  const links = [{group: 'work', name: 'A', url: 'https://a.org'}];
  const groups = [{id: 'work', name: '업무'}, {id: 'org', name: '담당조직 홈페이지'}];
  const saved = await saveLinks(links, groups, rt((path, options) => [options.body]));
  assert.deepEqual(saved, {ok: true, links, groups});
  assert.deepEqual(calls.at(-1), ['/rest/v1/app_profiles?user_id=eq.u-1', {method: 'PATCH', prefer: 'return=representation', body: {quick_links: links, quick_link_groups: groups}}]);
  assert.deepEqual(await saveLinks([{group: 'work', name: 'A', url: 'javascript:x'}], groups, rt(() => assert.fail('must not send'))), {ok: false});
  assert.deepEqual(await saveLinks(links, groups, missing), {ok: false, pending: true});
});
