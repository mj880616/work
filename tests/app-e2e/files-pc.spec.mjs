import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { start, openFiles } from './helpers/files-server.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
// S50-27 FILES-내PC드라이브 ②(시안 A, 명진 결정 11/05): 윈도우 PC 브라우저에서 바구니 PC 앱 문(127.0.0.1:47620~47622)이 답하면
// 나무 맨 끝 뿌리 '내 PC'(원드라이브·구글 드라이브 다음 줄) → 드라이브 → 폴더 목록 → 미리보기 [이 PC에서 열기][탐색기에서 위치].
// 두 칸이면 칸마다 '내 PC'를 고른다(왼쪽 내 PC · 오른쪽 원드라이브). 이 단계는 보기·열기만. 문이 답하지 않으면 '내 PC · 꺼짐' 흐린 줄 + 켜는 법.
// PC 목록·이름은 서버·브라우저 저장소에 남지 않는다. 리눅스·폰 브라우저에서는 문을 두드리지 않는다. 문은 흉내(파일 이름은 모두 가짜).
// S52-41 FILES-내PC클라우드옮기기: 문이 0.4.0+(can에 read·write·trash)이면 내 PC ↔ 클라우드 복사·옮기기(끌어 놓기 [복사][옮기기]·F5/F6·Ctrl+C/V·고르기 막대).
//   0.3.x 문(아래 기본 흉내)은 지금처럼 보기·열기만 + '새 판으로 올리면 …' 안내.
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
// CSS 값 안의 역슬래시는 한 번 더 막는다(PC 경로 'C:\\문서').
const at = (attr, v) => `[${attr}="${v.replace(/\\/g, '\\\\')}"]`;
const root = page => page.locator('#filesRoot');
const tree = page => root(page).locator('[data-fx-tree]');
const pane = (page, i) => root(page).locator(`[data-fx-pane-i="${i}"]`);
const list = page => pane(page, 0).locator('[data-fx-list]');
const chip = page => root(page).locator('[data-fx-src="pc"]');
const SHOTS = process.env.FILES_PC_SHOTS || '';
const shot = async (page, name) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/${name}.png` }); } };

const PC = {
  'C:\\': [{ name: '문서', dir: true, size: 0, modified: '2026-11-03T01:00:00Z' }, { name: '가짜설치.exe', dir: false, size: 3500000, modified: '2026-10-20T01:00:00Z' }],
  'C:\\문서': [{ name: '가짜 회의자료_연습.hwpx', dir: false, size: 215040, modified: '2026-11-05T00:14:00Z' }, { name: '하위_예시', dir: true, size: 0, modified: '2026-11-01T00:00:00Z' },
    { name: '가짜 메모_연습.txt', dir: false, size: 12, modified: '2026-11-06T00:00:00Z' }, { name: '가짜 안내문.pdf', dir: false, size: 9, modified: '2026-11-06T00:00:00Z' }],
  'C:\\문서\\하위_예시': [],
  'D:\\': [],
};
// 문 흉내: up = 문이 열려 있나(꺼지면 연결 거절), user = 문이 보는 계정(다른 계정이면 403 other_user).
// write = 0.4.0 문(read·write·trash). 쓴 파일은 PC 목록에 더하고(같은 이름이면 numbered일 때만 '이름 (2)'), 휴지통은 목록에서 뺀다.
// edit = 0.5.0 문(FILES-내PC쓰기: rename·mkdir·move·copy, 폴더 휴지통). 쓰기와 함께 켠다.
async function pcDoor(page, { up = true, user = 'same', write = false, edit = false } = {}) {
  if (edit) write = true;
  const st = { up, user, write, edit, calls: [], writes: {}, seq: 0, trashed: [], pins: [], pc: JSON.parse(JSON.stringify(PC)) };
  await page.route(/^http:\/\/127\.0\.0\.1:4762[0-2]\//, async r => {
    const req = r.request(), u = new URL(req.url()), origin = req.headers().origin || '';
    const cors = { 'access-control-allow-origin': origin, vary: 'Origin', 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-private-network': 'true', 'access-control-expose-headers': 'X-Pc-Size' };
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    const piece = u.pathname === '/v1/write/piece';
    st.calls.push({ port: Number(u.port), path: u.pathname, q: u.searchParams.get('path'), method: req.method(), auth: (req.headers().authorization || '').startsWith('Bearer ') , body: piece ? '' : req.postData() || '', bytes: piece ? (req.postDataBuffer() || Buffer.alloc(0)).length : 0 });
    if (!st.up || u.port !== '47620') return r.abort('connectionrefused');
    const json = (status, body) => r.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
    if (!(req.headers().authorization || '').startsWith('Bearer ')) return json(401, { error: 'no_token' });
    if (st.user !== 'same') return json(403, { error: 'other_user' });
    if (u.pathname === '/v1/hello') return json(200, { app: 'basket-pc', version: st.edit ? '0.5.0' : st.write ? '0.4.0' : '0.3.0', door: 1, can: ['drives', 'list', 'open', 'reveal', ...(st.write ? ['read', 'write', 'trash', 'pins'] : []), ...(st.edit ? ['edit'] : [])] });
    const PCX = st.pc, dirOf = p => p.slice(0, p.lastIndexOf('\\')) || p, baseOf = p => p.slice(p.lastIndexOf('\\') + 1);
    const entry = p => (PCX[dirOf(p)] || []).find(e => e.name === baseOf(p) && !e.dir);
    if (st.write && u.pathname === '/v1/read') {
      const e = entry(u.searchParams.get('path') || ''); if (!e) return json(404, { error: 'not_found' });
      const at = Number(u.searchParams.get('at')), len = Number(u.searchParams.get('len')), all = Buffer.alloc(e.size, 65);
      return r.fulfill({ status: 200, headers: { ...cors, 'x-pc-size': String(e.size) }, contentType: 'application/octet-stream', body: all.subarray(at, at + len) });
    }
    if (st.write && u.pathname === '/v1/write/start') {
      const b = JSON.parse(req.postData() || '{}'); if (!(b.dir in PCX)) return json(404, { error: 'not_found' });
      const id = 'w' + (++st.seq); st.writes[id] = { ...b, got: 0 }; return json(200, { id });
    }
    if (st.write && u.pathname === '/v1/write/piece') {
      const w = st.writes[u.searchParams.get('id')], n = (req.postDataBuffer() || Buffer.alloc(0)).length;
      if (!w || Number(u.searchParams.get('at')) !== w.got) return json(409, { error: 'bad_piece' });
      w.got += n; return json(200, { at: w.got });
    }
    if (st.write && u.pathname === '/v1/write/finish') {
      const b = JSON.parse(req.postData() || '{}'), w = st.writes[b.id];
      if (!w || w.got !== w.size) return json(409, { error: 'bad_piece' });
      const list = PCX[w.dir], has = n => list.some(e => e.name.toLowerCase() === n.toLowerCase());
      let name = w.name;
      if (has(name)) { if (!b.numbered) return json(409, { error: 'exists' }); const dot = name.lastIndexOf('.'); for (let i = 2; has(name); i++) name = dot > 0 ? `${w.name.slice(0, dot)} (${i})${w.name.slice(dot)}` : `${w.name} (${i})`; }
      list.push({ name, dir: false, size: w.size, modified: '2026-11-08T00:00:00Z' }); delete st.writes[b.id];
      return json(200, { name });
    }
    if (st.write && u.pathname === '/v1/pins') {
      if (req.method() === 'POST') st.pins = JSON.parse(req.postData() || '{}').pins || [];
      return json(200, { pins: st.pins });
    }
    if (st.write && u.pathname === '/v1/write/cancel') return json(200, { done: 'cancelled' });
    // 0.5.0 문: 내 PC 안 이름 바꾸기·새 폴더·옮기기·복사(덮어쓰기 없음 — 같은 이름은 numbered일 때만 '이름 (2)').
    const dirP = p => { const d = dirOf(p); return /^[A-Z]:$/.test(d) ? d + '\\' : d; }, join = (d, n) => d.replace(/\\$/, '') + '\\' + n;
    const anyEntry = p => (PCX[dirP(p)] || []).find(e => e.name === baseOf(p));
    const free = (dir, name, numbered) => {
      const has = n => (PCX[dir] || []).some(e => e.name.toLowerCase() === n.toLowerCase());
      if (!has(name)) return name;
      if (!numbered) return null;
      const dot = name.lastIndexOf('.');
      for (let i = 2; ; i++) { const n = dot > 0 ? `${name.slice(0, dot)} (${i})${name.slice(dot)}` : `${name} (${i})`; if (!has(n)) return n; }
    };
    if (st.edit && ['/v1/rename', '/v1/mkdir', '/v1/move', '/v1/copy'].includes(u.pathname)) {
      const b = JSON.parse(req.postData() || '{}');
      if (u.pathname === '/v1/mkdir') {
        if (!(b.dir in PCX)) return json(404, { error: 'not_found' });
        if (free(b.dir, b.name, false) === null) return json(409, { error: 'exists' });
        PCX[b.dir].push({ name: b.name, dir: true, size: 0, modified: '2026-11-08T00:00:00Z' }); PCX[join(b.dir, b.name)] = [];
        return json(200, { path: join(b.dir, b.name) });
      }
      const e = anyEntry(b.path || ''); if (!e) return json(404, { error: 'not_found' });
      if (u.pathname === '/v1/rename') {
        if (/\.exe$/i.test(b.name)) return json(403, { error: 'risky_kind' });
        if (free(dirP(b.path), b.name, false) === null) return json(409, { error: 'exists' });
        const to = join(dirP(b.path), b.name);
        if (e.dir) { PCX[to] = PCX[b.path] || []; delete PCX[b.path]; }
        e.name = b.name; return json(200, { path: to });
      }
      if (!(b.dir in PCX)) return json(404, { error: 'not_found' });
      if (u.pathname === '/v1/copy' && e.dir) return json(400, { error: 'not_file' });
      const name = free(b.dir, e.name, !!b.numbered); if (name === null) return json(409, { error: 'exists' });
      const to = join(b.dir, name);
      if (u.pathname === '/v1/move') {
        PCX[dirP(b.path)] = PCX[dirP(b.path)].filter(x => x !== e);
        if (e.dir) { PCX[to] = PCX[b.path] || []; delete PCX[b.path]; }
        PCX[b.dir].push({ ...e, name });
      } else PCX[b.dir].push({ ...e, name });
      return json(200, { path: to });
    }
    if (st.edit && u.pathname === '/v1/trash') {
      const p = JSON.parse(req.postData() || '{}').path || '', e = anyEntry(p); if (!e) return json(404, { error: 'not_found' });
      PCX[dirP(p)] = PCX[dirP(p)].filter(x => x !== e); if (e.dir) delete PCX[p]; st.trashed.push(p); return json(200, { done: 'trashed' });
    }
    if (st.write && u.pathname === '/v1/trash') {
      const p = JSON.parse(req.postData() || '{}').path || '', e = entry(p); if (!e) return json(404, { error: 'not_found' });
      PCX[dirOf(p)] = PCX[dirOf(p)].filter(x => x !== e); st.trashed.push(p); return json(200, { done: 'trashed' });
    }
    if (u.pathname === '/v1/drives') return json(200, { drives: [{ root: 'C:\\', label: '', kind: 'fixed', total: 1, free: 1 }, { root: 'D:\\', label: '자료', kind: 'fixed', total: 1, free: 1 }] });
    if (u.pathname === '/v1/list') { const p = u.searchParams.get('path'); return p in st.pc ? json(200, { path: p, truncated: false, entries: st.pc[p] }) : json(404, { error: 'not_found' }); }
    if (u.pathname === '/v1/open' || u.pathname === '/v1/reveal') { const p = JSON.parse(req.postData() || '{}').path || ''; return json(200, { done: u.pathname === '/v1/reveal' || p.endsWith('.exe') ? 'revealed' : 'opened' }); }
    return json(404, { error: 'not_found' });
  });
  return st;
}
// 크롬 '로컬 네트워크 접근' 허락 상태를 흉내 낸다(Playwright 판마다 이 권한 이름을 몰라 grantPermissions를 쓰지 않는다).
async function lnaState(page, state) {
  await page.addInitScript(s => {
    const q = navigator.permissions?.query?.bind(navigator.permissions);
    if (!q) return;
    navigator.permissions.query = d => (['loopback-network', 'local-network-access'].includes(d?.name) ? Promise.resolve({ state: s }) : q(d));
  }, state);
}
async function begin(page, door, { perm = 'granted' } = {}) {
  const { errors, server } = await start(page, 1440);
  await lnaState(page, perm);
  const st = await pcDoor(page, door);
  await installViewPrefsServer(page);
  await page.reload();
  await openFiles(page, 1440);
  return { errors, server, st };
}

test.describe('윈도우 PC 1440', () => {
  // 크롬 '로컬 네트워크 접근'을 이미 허락한 PC(begin 기본값, 허락 전 모습은 아래 따로 본다).
  test.use({ userAgent: WINDOWS });

  test("문이 답하면: 나무 맨 끝 '내 PC' → 드라이브 → 폴더 → 미리보기 [이 PC에서 열기]·[탐색기에서 위치], [최근]에는 안 섞임, 서버·저장소에 PC 이름 없음", async ({ page }) => {
    test.setTimeout(90000);
    const { errors, server, st } = await begin(page);
    await expect(chip(page)).toBeVisible();
    await expect(chip(page)).toHaveAttribute('aria-pressed', 'true');
    // 시안 A: 원드라이브·구글 드라이브 다음 줄에 '내 PC'.
    const roots = tree(page).locator('[data-fx-box-tog], [data-fx-pc-knock] .ft-name'); // S51-25: 저장소마다 상자 머리
    await expect(roots).toHaveText(['원드라이브', '구글 드라이브', '내 PC']);
    // 매 요청 로그인 토큰을 머리에 싣는다.
    expect(st.calls.length).toBeGreaterThan(0);
    expect(st.calls.every(c => c.auth)).toBe(true);
    // D3: [최근]에 PC 줄 없음.
    await expect(list(page).locator('[data-fx-row^="od:"]').first()).toBeVisible();
    await expect(list(page).locator('[data-fx-row^="pc:"]')).toHaveCount(0);
    await tree(page).locator('[data-fx-go="pc"][data-fx-id=""]').click();
    await expect(list(page).locator(at('data-fx-row', 'pc:C:\\'))).toContainText('로컬 디스크 (C:)');
    await expect(list(page).locator(at('data-fx-row', 'pc:D:\\'))).toContainText('자료 (D:)');
    await list(page).locator(at('data-fx-row', 'pc:C:\\')).click();
    await list(page).locator(at('data-fx-row', 'pc:C:\\문서')).click();
    await expect(root(page).locator('.fx-top [data-fx-crumb]')).toContainText('내 PC›C:›문서');
    const file = list(page).locator(at('data-fx-row', 'pc:C:\\문서\\가짜 회의자료_연습.hwpx'));
    await expect(file).toBeVisible();
    // PC 줄은 끌 수 없다(이 단계는 보기·열기만).
    await expect(file).not.toHaveAttribute('draggable', 'true');
    // 나무에도 C: › 문서가 펼쳐진다.
    await expect(tree(page).locator('[data-fx-go="pc"]' + at('data-fx-id', 'C:\\문서'))).toBeVisible();
    await file.click();
    const prev = root(page).locator('[data-fx-prev]');
    await expect(prev).toContainText('미리보기 없이 이름·크기만');
    await expect(prev).toContainText('내 PC › C: › 문서');
    await expect(prev.locator('[data-fx-star-one], [data-fx-trash-one], [data-fx-copy-one], [data-fx-down]')).toHaveCount(0);
    await shot(page, 'files-pc-1440');
    await prev.locator('[data-fx-open]').click();
    await expect.poll(() => st.calls.filter(c => c.path === '/v1/open').map(c => JSON.parse(c.body).path)).toEqual(['C:\\문서\\가짜 회의자료_연습.hwpx']);
    await prev.locator('[data-fx-pc-reveal]').click();
    await expect.poll(() => st.calls.filter(c => c.path === '/v1/reveal').length).toBe(1);
    // 고르면 '보기·열기만' 막대, Delete·Ctrl+C는 안내만(서버로 가지 않음).
    await file.click({ modifiers: ['Control'] });
    await expect(root(page).locator('[data-fx-bar]')).toContainText('내 PC · 보기·열기만');
    await page.keyboard.press('Delete');
    await expect(page.getByText('새 판(0.4.0)으로 올리면').first()).toBeVisible();
    // PC 이름·경로는 서버·주소창 어디에도 없다(브라우저 저장소를 쓰지 않는 것은 tests/pc-files-model.test.mjs가 코드로 본다).
    expect(JSON.stringify(server.calls)).not.toContain('가짜 회의자료');
    expect(JSON.stringify(server.calls)).not.toContain('C:\\\\');
    expect(page.url()).not.toContain('C%3A');
    expect(errors).toEqual([]);
  });

  test("두 칸: 칸마다 '내 PC'를 고를 수 있다(왼쪽 내 PC · 오른쪽 원드라이브), 내 PC로 보내기는 막고 안내(단추 흐림·F5 안내)", async ({ page }) => {
    test.setTimeout(90000);
    const { errors } = await begin(page);
    await root(page).locator('[data-fx-two]').click();
    await expect(pane(page, 1)).toBeVisible();
    await root(page).locator('[data-fx-tree-tog]').click(); // S52-41 ③: 두 칸이면 나무는 접혀 있다
    // 왼쪽 칸(지금 칸)에서 나무 '내 PC' → C:.
    await pane(page, 0).locator('.fx-ptop').click({ position: { x: 300, y: 5 } });
    await tree(page).locator('[data-fx-go="pc"][data-fx-id=""]').click();
    await expect(pane(page, 0).locator(at('data-fx-row', 'pc:C:\\'))).toBeVisible();
    await pane(page, 0).locator(at('data-fx-row', 'pc:C:\\')).click();
    await expect(pane(page, 0).locator(at('data-fx-row', 'pc:C:\\문서'))).toBeVisible();
    // 오른쪽 칸으로 바꿔 나무에서 원드라이브.
    await pane(page, 1).locator('.fx-ptop').click({ position: { x: 300, y: 5 } });
    await expect(pane(page, 1)).toHaveClass(/fx-cur/);
    await tree(page).locator('[data-fx-go="od"][data-fx-id=""]').click();
    await expect(pane(page, 1).locator('.fx-ptop .fx-psrc-name')).toHaveText('원드라이브');
    await expect(pane(page, 1).locator('[data-fx-row^="od:"]').first()).toBeVisible();
    await expect(pane(page, 0).locator('.fx-ptop .fx-crumb-now')).toHaveText('C:');
    // 오른쪽(원드라이브) 줄을 골라 '← 왼쪽에 복사' → 받을 곳이 내 PC라 막고 안내.
    await pane(page, 1).locator('[data-fx-row^="od:"]').first().click({ modifiers: ['Control'] });
    const send = root(page).locator('[data-fx-bar] [data-fx-send="copy"]');
    await expect(send).toBeDisabled();
    await expect(send).toHaveAttribute('title', /새 판\(0\.4\.0\)으로 올리면/);
    // F5(반대 칸에 복사)도 안내만.
    await page.keyboard.press('F5');
    await expect(page.getByText('새 판(0.4.0)으로 올리면').first()).toBeVisible();
    await shot(page, 'files-pc-two-1440');
    expect(errors).toEqual([]);
  });

  test("문이 꺼져 있으면: '내 PC · 꺼짐' 흐린 줄, 누르면 켜는 법 한 줄. 켜고 다시 누르면 드라이브가 열린다", async ({ page }) => {
    test.setTimeout(90000);
    const { errors, st } = await begin(page, { up: false });
    const off = tree(page).locator('[data-fx-pc-knock]');
    await expect(off).toHaveText('내 PC · 꺼짐');
    await expect(tree(page).locator('[data-fx-box-tog], [data-fx-pc-knock] .ft-name')).toHaveText(['원드라이브', '구글 드라이브', '내 PC · 꺼짐']);
    await expect(chip(page)).toHaveAttribute('aria-pressed', 'false');
    await shot(page, 'files-pc-off-1440');
    await off.click();
    await expect(root(page).locator('[data-fx-note]')).toContainText('[웹2에서 이 PC 보기]를 켜 주세요');
    st.up = true;
    await off.click();
    await expect(list(page).locator(at('data-fx-row', 'pc:C:\\'))).toBeVisible();
    await expect(tree(page).locator('[data-fx-box-tog], [data-fx-pc-knock] .ft-name')).toHaveText(['원드라이브', '구글 드라이브', '내 PC']);
    expect(errors).toEqual([]);
  });

  test('다른 계정으로 로그인한 바구니 앱이면 목록을 받지 않고 그 까닭을 알린다', async ({ page }) => {
    test.setTimeout(90000);
    const { errors, st } = await begin(page, { user: 'other' });
    await expect(tree(page).locator('[data-fx-pc-knock]')).toHaveText('내 PC · 꺼짐');
    await tree(page).locator('[data-fx-pc-knock]').click();
    await expect(root(page).locator('[data-fx-note]')).toContainText('다른 계정');
    expect(st.calls.some(c => c.path === '/v1/drives' || c.path === '/v1/list')).toBe(false);
    expect(errors).toEqual([]);
  });
});

// S52-41 FILES-내PC클라우드옮기기: 0.4.0 문. 왼쪽 칸 내 PC › C: › 문서, 오른쪽 칸 원드라이브 › 가짜 문서함.
async function twoPanes(page) {
  await root(page).locator('[data-fx-two]').click();
  await expect(pane(page, 1)).toBeVisible();
  await root(page).locator('[data-fx-tree-tog]').click(); // S52-41 ③: 두 칸이면 나무는 접혀 있다
  await pane(page, 0).locator('.fx-ptop').click({ position: { x: 300, y: 5 } });
  await tree(page).locator('[data-fx-go="pc"][data-fx-id=""]').click();
  await pane(page, 0).locator(at('data-fx-row', 'pc:C:\\')).click();
  await pane(page, 0).locator(at('data-fx-row', 'pc:C:\\문서')).click();
  await expect(pane(page, 0).locator(at('data-fx-row', 'pc:C:\\문서\\가짜 메모_연습.txt'))).toBeVisible();
  await pane(page, 1).locator('.fx-ptop').click({ position: { x: 300, y: 5 } });
  await tree(page).locator('[data-fx-go="od"][data-fx-id=""]').click();
  await pane(page, 1).locator('[data-fx-row="od:OD!1"]').click();
  await expect(pane(page, 1).locator('[data-fx-row="od:OD!13"]')).toBeVisible();
}
test.describe('윈도우 PC 1440 · 바구니 0.4.0 문(내 PC ↔ 클라우드)', () => {
  test.use({ userAgent: WINDOWS });
  test('내 PC 줄을 오른쪽 칸(원드라이브)으로 끌어 놓으면 [복사][옮기기] → 복사: 문에서 읽어 올리기 길로, PC 경로는 서버에 가지 않음', async ({ page }) => {
    test.setTimeout(120000);
    const { errors, server, st } = await begin(page, { write: true });
    await twoPanes(page);
    const memo = pane(page, 0).locator(at('data-fx-row', 'pc:C:\\문서\\가짜 메모_연습.txt'));
    await expect(memo).toHaveAttribute('draggable', 'true');
    await memo.dragTo(pane(page, 1).locator('[data-fx-list]'));
    const ask = root(page).locator('[data-fx-dropask]');
    await expect(ask).toBeVisible();
    await shot(page, 'files-pc-xfer-drop-1440');
    await ask.locator('[data-fx-drop-go="copy"]').click();
    await expect.poll(() => server.calls.filter(c => c.body?.action === 'upload_done').length, { timeout: 20000 }).toBe(1);
    expect(st.calls.filter(c => c.path === '/v1/read').map(c => c.q)).toEqual(['C:\\문서\\가짜 메모_연습.txt']);
    const open = server.calls.find(c => c.body?.action === 'upload_open')?.body;
    expect(open).toMatchObject({ to_source: 'od', to: 'OD!1', name: '가짜 메모_연습.txt', size: 12 });
    await expect(pane(page, 1).locator('[data-fx-list]')).toContainText('가짜 메모_연습.txt');
    // 복사라 원본은 그대로, 휴지통 요청 없음. PC 경로·드라이브 글자는 서버 어디에도 없다.
    expect(st.trashed).toEqual([]);
    expect(JSON.stringify(server.calls)).not.toContain('C:\\\\');
    expect(JSON.stringify(server.prefCalls || [])).not.toContain('C:');
    expect(errors).toEqual([]);
  });

  test("옮기기: 오른쪽 클라우드 파일을 F6으로 왼쪽 내 PC에 → 한 번 묻고 문에 새 파일로 쓴 뒤 원본만 클라우드 휴지통. 같은 이름은 '그래도 하기' = 이름 (2)", async ({ page }) => {
    test.setTimeout(120000);
    const { errors, server, st } = await begin(page, { write: true });
    st.pc['C:\\문서'].push({ name: '가짜 메모.txt', dir: false, size: 5, modified: '2026-11-01T00:00:00Z' });
    await twoPanes(page);
    // 오른쪽 칸(지금 칸)에서 '가짜 메모.txt'를 골라 '← 왼쪽으로 옮기기'(F6).
    await pane(page, 1).locator('[data-fx-row="od:OD!13"]').click({ modifiers: ['Control'] });
    const move = root(page).locator('[data-fx-bar] [data-fx-send="move"]');
    await expect(move).toBeEnabled();
    await page.keyboard.press('F6');
    await page.getByRole('alertdialog').getByRole('button', { name: '옮기기', exact: true }).click(); // 다른 저장소로 옮기기 확인 한 번
    const ask = root(page).locator('[data-fx-ask="go"]');
    await expect(ask).toBeVisible(); // 같은 이름 묻기
    await ask.click();
    await expect.poll(() => st.calls.filter(c => c.path === '/v1/write/finish').map(c => JSON.parse(c.body).numbered)).toEqual([true]);
    expect(st.calls.filter(c => c.path === '/v1/write/start').map(c => JSON.parse(c.body))).toEqual([{ dir: 'C:\\문서', name: '가짜 메모.txt', size: st.calls.filter(c => c.path === '/v1/write/piece').reduce((a, c) => a + c.bytes, 0) }]);
    await expect.poll(() => server.items.find(i => i.item_id === 'OD!13').trashed).toBe(true);
    await expect(pane(page, 0).locator(at('data-fx-row', 'pc:C:\\문서\\가짜 메모 (2).txt'))).toBeVisible();
    await expect(pane(page, 1).locator('[data-fx-row="od:OD!13"]')).toHaveCount(0);
    // 받을 곳(내 PC 폴더)은 '최근 보낸 곳'에 남기지 않는다.
    expect(JSON.stringify(server.prefCalls || [])).not.toContain('문서');
    expect(errors).toEqual([]);
  });

  test('내 PC → 클라우드 옮기기(Ctrl+X → 칸 바꿔 Ctrl+V): 서버가 올린 파일을 맞춘 뒤에만 원본을 윈도우 휴지통으로', async ({ page }) => {
    test.setTimeout(60000);
    const { errors, server, st } = await begin(page, { write: true });
    await twoPanes(page);
    await pane(page, 0).locator(at('data-fx-row', 'pc:C:\\문서\\가짜 안내문.pdf')).click({ modifiers: ['Control'] });
    await page.keyboard.press('Control+x');
    await pane(page, 1).locator('.fx-ptop').click({ position: { x: 300, y: 5 } });
    await expect(root(page).locator('[data-fx-bar] [data-fx-paste]')).toBeEnabled();
    await pane(page, 1).locator('[data-fx-row="od:OD!13"]').focus(); // 단축키는 [파일] 화면 안에 포커스가 있을 때
    await page.keyboard.press('Control+v');
    await page.getByRole('alertdialog').getByRole('button', { name: '옮기기', exact: true }).click();
    await expect(root(page).locator('[data-fx-ask="go"]')).toBeVisible(); // 원드라이브에도 '가짜 안내문.pdf'가 있다
    await root(page).locator('[data-fx-ask="go"]').click();
    await expect.poll(() => st.trashed, { timeout: 20000 }).toEqual(['C:\\문서\\가짜 안내문.pdf']);
    const done = server.calls.findIndex(c => c.body?.action === 'upload_done'), trash = st.calls.findIndex(c => c.path === '/v1/trash');
    expect(done).toBeGreaterThanOrEqual(0);
    expect(trash).toBeGreaterThanOrEqual(0);
    await expect(pane(page, 0).locator(at('data-fx-row', 'pc:C:\\문서\\가짜 안내문.pdf'))).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('한 칸: 내 PC 줄 고르기 막대 [복사] → 받을 곳 창에 클라우드만, 클라우드 줄 [복사] → 받을 곳 창에 내 PC(드라이브 맨 위는 받을 곳 아님). 내 PC 이름·휴지통은 다음 판 안내', async ({ page }) => {
    test.setTimeout(120000);
    const { errors } = await begin(page, { write: true });
    await tree(page).locator('[data-fx-go="pc"][data-fx-id=""]').click();
    await list(page).locator(at('data-fx-row', 'pc:C:\\')).click();
    await list(page).locator(at('data-fx-row', 'pc:C:\\문서')).click();
    const memo = list(page).locator(at('data-fx-row', 'pc:C:\\문서\\가짜 메모_연습.txt'));
    await memo.click({ modifiers: ['Control'] });
    const bar = root(page).locator('[data-fx-bar]');
    await expect(bar.locator('[data-fx-copy]')).toBeVisible();
    await expect(bar.locator('[data-fx-trash], [data-fx-rename]')).toHaveCount(0);
    await page.keyboard.press('Delete');
    await expect(page.getByText(/새 판\(0\.5\.0\)으로 올리면 내 PC 안 이름 바꾸기/).first()).toBeVisible();
    await bar.locator('[data-fx-copy]').click();
    const dest = root(page).locator('[data-fx-dest]');
    await expect(dest).toBeVisible();
    await expect(dest.locator('[data-fx-dest-pick="od:"]')).toBeVisible();
    await expect(dest.locator('[data-fx-dest-pick="pc:"]')).toHaveCount(0);
    await dest.locator('[data-fx-dest-close]').click();
    // 클라우드 파일 → 받을 곳 창에 '내 PC'가 있고, 맨 위(드라이브 목록)를 고르면 [여기에 복사]가 흐리다.
    await tree(page).locator('[data-fx-go="od"][data-fx-id=""]').click();
    await list(page).locator('[data-fx-row="od:OD!1"]').click();
    await list(page).locator('[data-fx-row="od:OD!13"]').click({ modifiers: ['Control'] });
    await bar.locator('[data-fx-copy]').click();
    await dest.locator('[data-fx-dest-pick="pc:"]').click();
    await expect(dest.locator('[data-fx-dest-go]')).toBeDisabled();
    expect(errors).toEqual([]);
  });
});

test.describe('윈도우 PC 1440 · 내 PC 폴더 고정(S52-41 ④)', () => {
  test.use({ userAgent: WINDOWS });
  test('내 PC 폴더 ⋯ [위에 고정] → 경로는 그 PC 바구니 앱에만(서버·화면 기억 칸에 없음), 고정한 폴더 상자에 "내 PC"로 보이고 누르면 연다', async ({ page }) => {
    test.setTimeout(90000);
    const { errors, server, st } = await begin(page, { write: true });
    await tree(page).locator('[data-fx-go="pc"][data-fx-id=""]').click();
    await list(page).locator(at('data-fx-row', 'pc:C:\\')).click();
    const row = tree(page).locator(at('data-fx-fold', 'pc:C:\\문서'));
    await row.locator('[data-fx-tmenu]').click();
    await page.locator('[data-row-item="pin"]').first().click();
    await expect.poll(() => st.pins).toEqual(['C:\\문서']);
    const pin = tree(page).locator('[data-fx-box="pins"] .fx-pin');
    await expect(pin.locator('.ft-name')).toHaveText(['문서']);
    await expect(pin.locator('.ft-num')).toHaveText(['내 PC']);
    await tree(page).locator('[data-fx-go="od"][data-fx-id=""]').click();
    await pin.locator('[data-fx-pin-go]').click();
    await expect(list(page).locator(at('data-fx-row', 'pc:C:\\문서\\가짜 회의자료_연습.hwpx'))).toBeVisible();
    // 경로는 서버(화면 기억 칸 포함)로 가지 않는다.
    expect(JSON.stringify(server.calls)).not.toContain('C:\\\\');
    expect(JSON.stringify(server.prefCalls || [])).not.toContain('C:');
    // 고정 풀기도 그 PC에만.
    await tree(page).locator('[data-fx-box="pins"] [data-fx-pin-menu]').click();
    await page.locator('[data-row-item="unpin"]').first().click();
    await expect.poll(() => st.pins).toEqual([]);
    await expect(tree(page).locator('[data-fx-box="pins"]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

test.describe('윈도우 PC 1440 · 크롬 허락 전', () => {
  test.use({ userAgent: WINDOWS });
  test("화면을 열 때는 저절로 두드리지 않고(허락 창 안 띄움) '내 PC · 눌러서 연결', 누르면 두드려 연다", async ({ page }) => {
    test.setTimeout(90000);
    const { errors, st } = await begin(page, {}, { perm: 'prompt' });
    const off = tree(page).locator('[data-fx-pc-knock]');
    await expect(off).toHaveText('내 PC · 눌러서 연결');
    expect(st.calls).toEqual([]);
    await off.click();
    await expect(list(page).locator(at('data-fx-row', 'pc:C:\\'))).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test('윈도우가 아닌 PC 브라우저: 내 PC 아이콘·줄이 없고 문을 두드리지 않는다', async ({ page }) => {
  test.setTimeout(60000);
  const { errors, st } = await begin(page);
  await expect(tree(page).locator('[data-fx-box-tog], [data-fx-pc-knock] .ft-name')).toHaveText(['원드라이브', '구글 드라이브']);
  await expect(chip(page)).toBeHidden();
  await expect(tree(page).locator('[data-fx-pc-knock]')).toHaveCount(0);
  expect(st.calls).toEqual([]);
  expect(errors).toEqual([]);
});

// S52-43 ① FILES-내PC쓰기: 0.5.0 문(can에 edit). 내 PC 안 이름 바꾸기·새 폴더·옮기기·복사·휴지통(파일·폴더), 미리보기(글·사진·PDF),
// 고르기 막대·⋯·우클릭 메뉴가 클라우드와 같은 항목. 덮어쓰기 없음(같은 이름은 한 번 묻고 '이름 (2)'). PC 경로는 서버에 가지 않는다.
const ask = page => page.locator('.kptu-ask');
const menu = page => page.locator('#rowMenu');
async function openDocs(page, i = 0) {
  await tree(page).locator('[data-fx-go="pc"][data-fx-id=""]').click();
  await pane(page, i).locator(at('data-fx-row', 'pc:C:\\')).click();
  await pane(page, i).locator(at('data-fx-row', 'pc:C:\\문서')).click();
  await expect(pane(page, i).locator(at('data-fx-row', 'pc:C:\\문서\\가짜 메모_연습.txt'))).toBeVisible();
}
test.describe('윈도우 PC 1440 · 바구니 0.5.0 문(내 PC 쓰기)', () => {
  test.use({ userAgent: WINDOWS });

  test('한 칸: 고르기 막대 [이름][휴지통]·F2 이름 바꾸기, [새 폴더], [휴지통] → 한 번 묻고 윈도우 휴지통(폴더도), 같은 이름·프로그램 이름은 거절', async ({ page }) => {
    test.setTimeout(120000);
    const { errors, server, st } = await begin(page, { edit: true });
    st.pc['C:\\문서'].push({ name: '가짜 다른.txt', dir: false, size: 3, modified: '2026-11-06T00:00:00Z' });
    await openDocs(page);
    const memo = list(page).locator(at('data-fx-row', 'pc:C:\\문서\\가짜 메모_연습.txt'));
    await memo.click({ modifiers: ['Control'] });
    const bar = root(page).locator('[data-fx-bar]');
    await expect(bar.locator('[data-fx-copy]')).toBeVisible();
    await expect(bar.locator('[data-fx-rename]')).toBeVisible();
    await expect(bar.locator('[data-fx-trash]')).toBeVisible();
    // F2 → 새 이름(확장자는 그대로) → 문 /v1/rename → 목록이 새 이름.
    await page.keyboard.press('F2');
    await expect(ask(page).locator('.kptu-ask-field')).toHaveValue('가짜 메모_연습');
    await ask(page).locator('.kptu-ask-field').fill('가짜 메모_고침');
    await ask(page).getByRole('button', { name: '바꾸기' }).click();
    await expect(list(page).locator(at('data-fx-row', 'pc:C:\\문서\\가짜 메모_고침.txt'))).toBeVisible();
    await expect(list(page).locator(at('data-fx-row', 'pc:C:\\문서\\가짜 메모_연습.txt'))).toHaveCount(0);
    expect(JSON.parse(st.calls.find(c => c.path === '/v1/rename').body)).toEqual({ path: 'C:\\문서\\가짜 메모_연습.txt', name: '가짜 메모_고침.txt' });
    // 같은 이름은 문이 거절 → 한 줄, 아무것도 바뀌지 않음.
    await list(page).locator(at('data-fx-row', 'pc:C:\\문서\\가짜 메모_고침.txt')).click({ modifiers: ['Control'] });
    await page.keyboard.press('F2');
    await ask(page).locator('.kptu-ask-field').fill('가짜 다른');
    await ask(page).getByRole('button', { name: '바꾸기' }).click();
    await expect(page.getByText('같은 이름 파일이 이미 있어요').first()).toBeVisible();
    await expect(list(page).locator(at('data-fx-row', 'pc:C:\\문서\\가짜 메모_고침.txt'))).toBeVisible();
    // [새 폴더]: 내 PC 폴더에서도 보이고 문 /v1/mkdir.
    await root(page).locator('[data-fx-mkdir]').click();
    await ask(page).locator('.kptu-ask-field').fill('가짜 새 폴더');
    await ask(page).getByRole('button', { name: '만들기' }).click();
    await expect(list(page).locator(at('data-fx-row', 'pc:C:\\문서\\가짜 새 폴더'))).toBeVisible();
    // 막대 [휴지통]: 파일 하나 → 한 번 묻기(윈도우 휴지통 안내) → 문 /v1/trash.
    // (앞 이름 바꾸기가 거절돼 그 줄은 아직 골라져 있다.)
    await expect(bar).toContainText('1개');
    await bar.locator('[data-fx-trash]').click();
    await expect(ask(page)).toContainText("'가짜 메모_고침.txt'을(를) 휴지통으로 보낼까요?");
    await expect(ask(page)).toContainText('윈도우 휴지통');
    await ask(page).getByRole('button', { name: '휴지통으로' }).click();
    await expect(list(page).locator(at('data-fx-row', 'pc:C:\\문서\\가짜 메모_고침.txt'))).toHaveCount(0);
    // 폴더도 ⋯ [휴지통](맨 아래)으로.
    const folder = list(page).locator(at('data-fx-row', 'pc:C:\\문서\\하위_예시'));
    await folder.click({ button: 'right' });
    await expect(menu(page)).toBeVisible();
    await expect(menu(page).locator('[data-row-item]')).toHaveText(['열기', '새 폴더', '옮기기', '이름 바꾸기', '위에 고정', '휴지통']);
    await menu(page).getByRole('button', { name: '휴지통' }).click();
    await ask(page).getByRole('button', { name: '휴지통으로' }).click();
    await expect(folder).toHaveCount(0);
    expect(st.trashed).toEqual(['C:\\문서\\가짜 메모_고침.txt', 'C:\\문서\\하위_예시']);
    // PC 경로·이름은 서버 어디에도 없다.
    expect(JSON.stringify(server.calls)).not.toContain('C:\\\\');
    expect(JSON.stringify(server.calls)).not.toContain('가짜 메모_고침');
    expect(errors).toEqual([]);
  });

  test('미리보기: 글은 앞부분만 문에서 읽어 보기 칸에, 아래 줄 [이 PC에서 열기][탐색기에서 위치][복사][옮기기][이름][휴지통]. 0.4.0 문은 이름·휴지통 없음', async ({ page }) => {
    test.setTimeout(90000);
    const { errors, st } = await begin(page, { edit: true });
    await openDocs(page);
    await list(page).locator(at('data-fx-row', 'pc:C:\\문서\\가짜 메모_연습.txt')).click();
    const prev = root(page).locator('[data-fx-prev]');
    await expect(prev.locator('.fx-pv-text')).toHaveText('AAAAAAAAAAAA');
    const read = st.calls.find(c => c.path === '/v1/read');
    expect(read.q).toBe('C:\\문서\\가짜 메모_연습.txt');
    await expect(prev.locator('.fx-pv-acts button')).toHaveText(['이 PC에서 열기', '탐색기에서 위치', '복사', '옮기기', '이름', '휴지통']);
    await shot(page, 'files-pc-preview-text-1440');
    // 한글 문서(미리보기 없는 종류)는 이름·크기만.
    await list(page).locator(at('data-fx-row', 'pc:C:\\문서\\가짜 회의자료_연습.hwpx')).click();
    await expect(prev).toContainText('미리보기 없이 이름·크기만');
    // 미리보기 [이름]도 같은 길.
    await prev.locator('[data-fx-rename-one]').click();
    await ask(page).locator('.kptu-ask-field').fill('가짜 회의자료_고침');
    await ask(page).getByRole('button', { name: '바꾸기' }).click();
    await expect(list(page).locator(at('data-fx-row', 'pc:C:\\문서\\가짜 회의자료_고침.hwpx'))).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('두 칸: 내 PC 줄을 반대 칸 내 PC 폴더로 끌어 놓으면 [복사][옮기기] → 옮기기, 같은 칸 폴더에 놓으면 묻지 않고 옮기기, Ctrl+C → [여기에 복사]는 같은 이름이면 한 번 묻고 이름 (2)', async ({ page }) => {
    test.setTimeout(150000);
    const { errors, server, st } = await begin(page, { edit: true });
    await root(page).locator('[data-fx-two]').click();
    await expect(pane(page, 1)).toBeVisible();
    await root(page).locator('[data-fx-tree-tog]').click();
    await pane(page, 0).locator('.fx-ptop').click({ position: { x: 300, y: 5 } });
    await openDocs(page, 0);
    await pane(page, 1).locator('.fx-ptop').click({ position: { x: 300, y: 5 } });
    await tree(page).locator('[data-fx-go="pc"][data-fx-id=""]').click();
    await pane(page, 1).locator(at('data-fx-row', 'pc:D:\\')).click();
    await expect(pane(page, 1).locator('[data-fx-list]')).toContainText('빈 폴더');
    // 왼쪽 내 PC 파일 → 오른쪽 내 PC D: 끌어 놓기 → [옮기기].
    const memo = pane(page, 0).locator(at('data-fx-row', 'pc:C:\\문서\\가짜 메모_연습.txt'));
    await expect(memo).toHaveAttribute('draggable', 'true');
    await memo.dragTo(pane(page, 1).locator('[data-fx-list]'));
    const drop = root(page).locator('[data-fx-dropask]');
    await expect(drop).toBeVisible();
    await drop.locator('[data-fx-drop-go="move"]').click();
    await expect(pane(page, 1).locator(at('data-fx-row', 'pc:D:\\가짜 메모_연습.txt'))).toBeVisible();
    await expect(memo).toHaveCount(0);
    expect(JSON.parse(st.calls.find(c => c.path === '/v1/move').body)).toEqual({ path: 'C:\\문서\\가짜 메모_연습.txt', dir: 'D:\\' });
    // 같은 칸 안 폴더에 놓기 = 묻지 않고 옮기기(클라우드 안과 같게).
    const pdf = pane(page, 0).locator(at('data-fx-row', 'pc:C:\\문서\\가짜 안내문.pdf'));
    await pdf.dragTo(pane(page, 0).locator(at('data-fx-row', 'pc:C:\\문서\\하위_예시')));
    await expect(pdf).toHaveCount(0);
    expect(st.pc['C:\\문서\\하위_예시'].map(e => e.name)).toEqual(['가짜 안내문.pdf']);
    // Ctrl+C(오른쪽 D: 파일) → 같은 칸 Ctrl+V = 같은 이름 → [그래도 하기] → '이름 (2)'.
    await pane(page, 1).locator(at('data-fx-row', 'pc:D:\\가짜 메모_연습.txt')).click({ modifiers: ['Control'] });
    await page.keyboard.press('Control+c');
    await root(page).locator('[data-fx-bar] [data-fx-paste]').click(); // '1개 복사하는 중 · 이 폴더로 [여기에 복사]'
    const same = root(page).locator('.fx-ask');
    await expect(same).toContainText('같은 이름이 있어요');
    await same.locator('[data-fx-ask="go"]').click();
    await expect(pane(page, 1).locator(at('data-fx-row', 'pc:D:\\가짜 메모_연습 (2).txt'))).toBeVisible();
    expect(JSON.parse(st.calls.find(c => c.path === '/v1/copy').body)).toEqual({ path: 'D:\\가짜 메모_연습.txt', dir: 'D:\\', numbered: true });
    expect(JSON.stringify(server.calls)).not.toContain('D:\\\\');
    expect(errors).toEqual([]);
  });
});
