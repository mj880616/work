import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { start, openFiles } from './helpers/files-server.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
// S50-27 FILES-내PC드라이브 ②(시안 A, 명진 결정 11/05): 윈도우 PC 브라우저에서 바구니 PC 앱 문(127.0.0.1:47620~47622)이 답하면
// 나무 맨 끝 뿌리 '내 PC'(원드라이브·구글 드라이브 다음 줄) → 드라이브 → 폴더 목록 → 미리보기 [이 PC에서 열기][탐색기에서 위치].
// 두 칸이면 칸마다 '내 PC'를 고른다(왼쪽 내 PC · 오른쪽 원드라이브). 이 단계는 보기·열기만. 문이 답하지 않으면 '내 PC · 꺼짐' 흐린 줄 + 켜는 법.
// PC 목록·이름은 서버·브라우저 저장소에 남지 않는다. 리눅스·폰 브라우저에서는 문을 두드리지 않는다. 문은 흉내(파일 이름은 모두 가짜).
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
  'C:\\문서': [{ name: '가짜 회의자료_연습.hwpx', dir: false, size: 215040, modified: '2026-11-05T00:14:00Z' }, { name: '하위_예시', dir: true, size: 0, modified: '2026-11-01T00:00:00Z' }],
  'C:\\문서\\하위_예시': [],
  'D:\\': [],
};
// 문 흉내: up = 문이 열려 있나(꺼지면 연결 거절), user = 문이 보는 계정(다른 계정이면 403 other_user).
async function pcDoor(page, { up = true, user = 'same' } = {}) {
  const st = { up, user, calls: [] };
  await page.route(/^http:\/\/127\.0\.0\.1:4762[0-2]\//, async r => {
    const req = r.request(), u = new URL(req.url()), origin = req.headers().origin || '';
    const cors = { 'access-control-allow-origin': origin, vary: 'Origin', 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-private-network': 'true' };
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    st.calls.push({ port: Number(u.port), path: u.pathname, q: u.searchParams.get('path'), method: req.method(), auth: (req.headers().authorization || '').startsWith('Bearer ') , body: req.postData() || '' });
    if (!st.up || u.port !== '47620') return r.abort('connectionrefused');
    const json = (status, body) => r.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
    if (!(req.headers().authorization || '').startsWith('Bearer ')) return json(401, { error: 'no_token' });
    if (st.user !== 'same') return json(403, { error: 'other_user' });
    if (u.pathname === '/v1/hello') return json(200, { app: 'basket-pc', version: '0.3.0', door: 1, can: ['drives', 'list', 'open', 'reveal'] });
    if (u.pathname === '/v1/drives') return json(200, { drives: [{ root: 'C:\\', label: '', kind: 'fixed', total: 1, free: 1 }, { root: 'D:\\', label: '자료', kind: 'fixed', total: 1, free: 1 }] });
    if (u.pathname === '/v1/list') { const p = u.searchParams.get('path'); return p in PC ? json(200, { path: p, truncated: false, entries: PC[p] }) : json(404, { error: 'not_found' }); }
    if (u.pathname === '/v1/open' || u.pathname === '/v1/reveal') { const p = JSON.parse(req.postData() || '{}').path || ''; return json(200, { done: u.pathname === '/v1/reveal' || p.endsWith('.exe') ? 'revealed' : 'opened' }); }
    return json(404, { error: 'not_found' });
  });
  return st;
}
async function begin(page, door) {
  const { errors, server } = await start(page, 1440);
  const st = await pcDoor(page, door);
  await installViewPrefsServer(page);
  await page.reload();
  await openFiles(page, 1440);
  return { errors, server, st };
}

test.describe('윈도우 PC 1440', () => {
  // 크롬 '로컬 네트워크 접근'을 이미 허락한 PC(허락 전 모습은 아래 따로 본다).
  test.use({ userAgent: WINDOWS, permissions: ['local-network-access'] });

  test("문이 답하면: 나무 맨 끝 '내 PC' → 드라이브 → 폴더 → 미리보기 [이 PC에서 열기]·[탐색기에서 위치], [최근]에는 안 섞임, 서버·저장소에 PC 이름 없음", async ({ page }) => {
    test.setTimeout(90000);
    const { errors, server, st } = await begin(page);
    await expect(chip(page)).toBeVisible();
    await expect(chip(page)).toHaveAttribute('aria-pressed', 'true');
    // 시안 A: 원드라이브·구글 드라이브 다음 줄에 '내 PC'.
    const roots = tree(page).locator('.fx-root .nx-name');
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
    await expect(page.getByText('내 PC는 지금은 보기·열기만 돼요').first()).toBeVisible();
    // PC 이름·경로는 서버·주소창·브라우저 저장소 어디에도 없다.
    expect(JSON.stringify(server.calls)).not.toContain('가짜 회의자료');
    expect(JSON.stringify(server.calls)).not.toContain('C:\\\\');
    expect(page.url()).not.toContain('C%3A');
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
    expect(stored).not.toContain('가짜 회의자료');
    expect(stored).not.toContain('문서');
    expect(errors).toEqual([]);
  });

  test("두 칸: 칸마다 '내 PC'를 고를 수 있다(왼쪽 내 PC · 오른쪽 원드라이브), 내 PC로 보내기는 막고 안내(단추 흐림·F5 안내)", async ({ page }) => {
    test.setTimeout(90000);
    const { errors } = await begin(page);
    await root(page).locator('[data-fx-two]').click();
    await expect(pane(page, 1)).toBeVisible();
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
    await expect(pane(page, 1).locator('.fx-ptop .fx-crumb-now')).toHaveText('원드라이브');
    await expect(pane(page, 1).locator('[data-fx-row^="od:"]').first()).toBeVisible();
    await expect(pane(page, 0).locator('.fx-ptop .fx-crumb-now')).toHaveText('C:');
    // 오른쪽(원드라이브) 줄을 골라 '← 왼쪽에 복사' → 받을 곳이 내 PC라 막고 안내.
    await pane(page, 1).locator('[data-fx-row^="od:"]').first().click({ modifiers: ['Control'] });
    const send = root(page).locator('[data-fx-bar] [data-fx-send="copy"]');
    await expect(send).toBeDisabled();
    await expect(send).toHaveAttribute('title', '내 PC는 지금은 보기·열기만 돼요(복사·휴지통은 다음 단계)');
    // F5(반대 칸에 복사)도 안내만.
    await page.keyboard.press('F5');
    await expect(page.getByText('내 PC는 지금은 보기·열기만 돼요').first()).toBeVisible();
    await shot(page, 'files-pc-two-1440');
    expect(errors).toEqual([]);
  });

  test("문이 꺼져 있으면: '내 PC · 꺼짐' 흐린 줄, 누르면 켜는 법 한 줄. 켜고 다시 누르면 드라이브가 열린다", async ({ page }) => {
    test.setTimeout(90000);
    const { errors, st } = await begin(page, { up: false });
    const off = tree(page).locator('[data-fx-pc-knock]');
    await expect(off).toHaveText('내 PC · 꺼짐');
    await expect(tree(page).locator('.fx-root .nx-name')).toHaveText(['원드라이브', '구글 드라이브', '내 PC · 꺼짐']);
    await expect(chip(page)).toHaveAttribute('aria-pressed', 'false');
    await shot(page, 'files-pc-off-1440');
    await off.click();
    await expect(root(page).locator('[data-fx-note]')).toContainText('[웹2에서 이 PC 보기]를 켜 주세요');
    st.up = true;
    await off.click();
    await expect(list(page).locator(at('data-fx-row', 'pc:C:\\'))).toBeVisible();
    await expect(tree(page).locator('.fx-root .nx-name')).toHaveText(['원드라이브', '구글 드라이브', '내 PC']);
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

test.describe('윈도우 PC 1440 · 크롬 허락 전', () => {
  test.use({ userAgent: WINDOWS });
  test("화면을 열 때는 저절로 두드리지 않고(허락 창 안 띄움) '내 PC · 눌러서 연결', 누르면 두드려 연다", async ({ page }) => {
    test.setTimeout(90000);
    const { errors, st } = await begin(page);
    const off = tree(page).locator('[data-fx-pc-knock]');
    await expect(off).toHaveText('내 PC · 눌러서 연결');
    expect(st.calls).toEqual([]);
    await page.context().grantPermissions(['local-network-access']);
    await off.click();
    await expect(list(page).locator(at('data-fx-row', 'pc:C:\\'))).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test('윈도우가 아닌 PC 브라우저: 내 PC 아이콘·줄이 없고 문을 두드리지 않는다', async ({ page }) => {
  test.setTimeout(60000);
  const { errors, st } = await begin(page);
  await expect(tree(page).locator('.fx-root .nx-name')).toHaveText(['원드라이브', '구글 드라이브']);
  await expect(chip(page)).toBeHidden();
  await expect(tree(page).locator('[data-fx-pc-knock]')).toHaveCount(0);
  expect(st.calls).toEqual([]);
  expect(errors).toEqual([]);
});
