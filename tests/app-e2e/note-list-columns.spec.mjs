import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
// S70-35 NOTE-목록표머리 ①(설계 docs/design/note-list-columns.md, 명진 11/25 10:54 "노트 목록화면 제목줄을 만들어주고 … 드래그해서 열 간격 조절" ·
// "스크롤할 때 제목줄은 틀고정"): 노트 [목록] 보기 머리 줄(제목 | 폴더 | 태그 | 수정일 | 첨부), 칸 자리 맞춤, 틀 고정, 칸 너비 끌기(서버 저장), 폰은 아래 작은 줄.
// 이름·내용은 모두 가짜. 서버는 흉내 낸다(기기 저장 없음).
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const settle = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
const rowsBox = page => page.locator('#basketView [data-note-rows]');
const head = page => rowsBox(page).locator('[data-nl-head]');
const headCell = (page, key) => head(page).locator(`[data-nl-col="${key}"]`);

async function fixture(page, width, { prefs = null, locked = false } = {}) {
  await page.setViewportSize({ width, height: 700 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const server = await installViewPrefsServer(page, { note_view: 'list', ...(prefs || {}) });
  // ② 잠긴 노트 시험: '아주 긴 하위 폴더'(U(2))만 잠김(PIN 있음, 풀지 않음) — 그 폴더 노트(n1·n4·…)는 제목 '잠김'.
  const lockRoute = () => page.route(u => u.origin === SB && u.pathname.startsWith('/rest/v1/rpc/app_lock_'), route => {
    const name = new URL(route.request().url()).pathname.split('/').pop(), json = v => route.fulfill({ contentType: 'application/json', body: JSON.stringify(v) });
    if (name === 'app_lock_read') return json({ has_pin: true, features: [], relock: '5m', left: 5, blocked_until: null });
    if (name === 'app_lock_note_folders') return json({ folders: [U(2)], covered: [U(2)], top_names: [] });
    return route.fulfill({ status: 404, body: '' });
  });
  await openHome(page, locked ? { beforeLoad: lockRoute } : undefined);
  const row = (i, extra = {}) => {
    const at = new Date(Date.parse('2026-11-20T01:00:00Z') - i * 3600e3).toISOString();
    return { id: 'n' + i, workspace_id: 'w', kind: 'note', title: `가짜 노트 ${i}`, raw_text: `가짜 노트 ${i} 본문`, occurred_at: at, created_at: at, updated_at: at, archived_at: null, ai_export_allowed: true, attachments: [], metadata: {}, ...extra };
  };
  const rows = Array.from({ length: 30 }, (_, i) => row(i + 1, i % 3 === 0 ? { metadata: { folder_id: U(2), folder: '아주 긴 하위 폴더 이름입니다' } } : i % 3 === 1 ? { metadata: { folder_id: U(1), folder: '갑' } } : {}));
  rows[0].raw_text = '가짜 노트 1 본문 #준비 #회의 #가짜 #넷째';
  rows[1].attachments = [{ id: 'a1', name: '가짜.pdf' }, { id: 'a2', name: '가짜2.pdf' }];
  const folders = [
    { id: U(1), workspace_id: 'w', parent_id: null, name: '갑', sort_order: 1024, created_at: '2026-10-01T00:00:00Z', color: null },
    { id: U(2), workspace_id: 'w', parent_id: U(1), name: '아주 긴 하위 폴더 이름입니다', sort_order: 2048, created_at: '2026-10-02T00:00:00Z', color: null },
  ];
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', r => r.request().method() === 'GET' ? r.fulfill({ json: structuredClone(rows) }) : r.fulfill({ status: 500, json: {} }));
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_folders', r => r.request().method() === 'GET' ? r.fulfill({ json: structuredClone(folders) }) : r.fulfill({ status: 500, json: {} }));
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  const show = async () => {
    await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, { timeout: 20000 });
    await page.waitForFunction(() => window.KPTURouter?.go);
    await page.evaluate(() => window.KPTURouter.go('basket'));
    await chooseBasketKind(page, 'note');
    await expect(page.locator('[data-nx-count]')).toHaveText('노트 · 30');
    await expect(page.locator('#basketView [data-note-view="list"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(rowsBox(page).locator('.nl-cols')).toHaveCount(30);
    await settle(page);
  };
  await show();
  return { errors, server, show };
}

test('PC 1280: 머리 줄이 보이고 날짜 칸이 줄마다 같은 x', async ({ page }) => {
  const s = await fixture(page, 1280);
  await expect(head(page)).toBeVisible();
  await expect(head(page).locator('[role="columnheader"]')).toHaveText([/^제목/, /^폴더/, /^태그/, /^수정일/, /^첨부/]);
  const xs = await rowsBox(page).locator('.nl-cols [data-nl-cell="day"]').evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().right)));
  expect(new Set(xs).size).toBe(1);
  // 머리 '수정일' 칸과 줄 날짜 칸의 오른쪽 끝이 맞는다.
  const h = await headCell(page, 'day').boundingBox();
  expect(Math.abs(h.x + h.width - xs[0])).toBeLessThan(3);
  // 폴더 칸은 끝 폴더 이름, 마우스를 올리면 전체 경로.
  const sub = rowsBox(page).locator('[data-nx-note="n1"] .nl-folder .nx-path');
  await expect(sub).toContainText('아주 긴 하위 폴더 이름입니다');
  await expect(sub).toHaveAttribute('title', '갑 › 아주 긴 하위 폴더 이름입니다');
  // 첨부 칸은 클립 + 수.
  await expect(rowsBox(page).locator('[data-nx-note="n2"] .nl-clip')).toContainText('2');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(s.errors).toEqual([]);
});

for (const width of [880, 1280]) test(`${width}: 머리 줄 고정 — 목록을 내려도 머리 줄 top이 위 줄 바로 아래`, async ({ page }) => {
  const s = await fixture(page, width);
  // 위 줄(--kptu-stick-top, 폰·폴드·PC마다 다름) 값은 머리 줄 자신의 계산된 top으로 읽는다(고르기 막대가 없으면 막대 높이 0).
  const stick = () => head(page).evaluate(el => parseFloat(getComputedStyle(el).top));
  const before = (await head(page).boundingBox()).y;
  const r = await rowsBox(page).locator('.nl-cols').nth(3).boundingBox();
  await page.mouse.move(r.x + 40, r.y + r.height / 2);
  await page.mouse.wheel(0, 600); await page.waitForTimeout(200); await settle(page);
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(100);
  expect(await stick()).toBeGreaterThan(0);
  const top = (await head(page).boundingBox()).y, want = await stick();
  expect(Math.abs(top - want)).toBeLessThan(2);
  expect(top).toBeLessThan(before);
  // 바탕이 비치지 않는다(화면 바탕색).
  const bg = await head(page).evaluate(el => getComputedStyle(el).backgroundColor);
  expect(bg).not.toBe('rgba(0, 0, 0, 0)');
  expect(s.errors).toEqual([]);
});

test('PC 1280: 고르기 막대와 머리 줄이 겹치지 않음', async ({ page }) => {
  const s = await fixture(page, 1280);
  await rowsBox(page).locator('[data-note-row-more="n3"]').click();
  await page.locator('#noteDocMenu [data-nx-select]').click();
  const bar = page.locator('#basketView [data-nx-select-bar]');
  await expect(bar).toBeVisible();
  await page.mouse.wheel(0, 600); await page.waitForTimeout(200); await settle(page);
  const b = await bar.boundingBox(), h = await head(page).boundingBox();
  expect(h.y).toBeGreaterThanOrEqual(b.y + b.height - 1);
  expect(h.y - (b.y + b.height)).toBeLessThan(3);
  expect(s.errors).toEqual([]);
});

test('PC 1280: 칸 경계를 끌면 폴더 칸 너비가 바뀌고 새로 열어도 같음(서버 저장)', async ({ page }) => {
  const s = await fixture(page, 1280);
  const stored = () => s.server.value?.col_widths?.notes ?? null;
  expect(stored()).toBeNull();
  const w0 = (await headCell(page, 'folder').boundingBox()).width;
  expect(Math.abs(w0 - 120)).toBeLessThan(3);
  const grip = head(page).locator('[data-col-grip="folder"]');
  const g = await grip.boundingBox(), y = g.y + g.height / 2, x = g.x + g.width / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + 20, y, { steps: 4 }); await page.mouse.move(x + 60, y, { steps: 4 }); await page.mouse.up(); await settle(page);
  expect(Math.abs((await headCell(page, 'folder').boundingBox()).width - (w0 + 60))).toBeLessThan(3);
  // 줄의 폴더 칸도 같은 너비(머리와 줄이 같은 칸).
  expect(Math.abs((await rowsBox(page).locator('[data-nx-note="n1"] .nl-folder').boundingBox()).width - (w0 + 60))).toBeLessThan(3);
  await expect.poll(() => Math.abs((stored()?.folder ?? 0) - (w0 + 60))).toBeLessThan(3);
  const saved = stored().folder;
  await page.reload(); await s.show();
  await expect.poll(async () => Math.abs((await headCell(page, 'folder').boundingBox()).width - saved)).toBeLessThan(3);
  // 칸 금을 끌어도 노트가 열리지 않는다(목록 그대로).
  await expect(page.locator('#basketView [data-note-detail]')).toBeHidden();
  expect(s.errors).toEqual([]);
});

test('PC 1280: 금 두 번 누르기 = 글자 길이 맞춤', async ({ page }) => {
  const s = await fixture(page, 1280, { prefs: { col_widths: { notes: { folder: 300 } } } });
  await expect.poll(async () => Math.round((await headCell(page, 'folder').boundingBox()).width)).toBe(300);
  const g = await head(page).locator('[data-col-grip="folder"]').boundingBox();
  await page.mouse.dblclick(g.x + g.width / 2, g.y + g.height / 2); await settle(page);
  await expect.poll(() => s.server.value?.col_widths?.notes?.folder).not.toBe(300);
  const fit = s.server.value.col_widths.notes.folder;
  expect(fit).toBeGreaterThanOrEqual(40); expect(fit).toBeLessThan(300);
  // 맞춘 너비에서 가장 긴 폴더 이름이 잘리지 않는다.
  const cut = await rowsBox(page).locator('[data-nx-note="n1"] .nl-folder .nx-path').evaluate(el => el.scrollWidth - el.clientWidth);
  expect(cut).toBeLessThanOrEqual(1);
  expect(s.errors).toEqual([]);
});

test('폰 390은 머리 줄 없이 아래 작은 줄', async ({ page }) => {
  const s = await fixture(page, 390);
  await expect(head(page)).toBeHidden();
  await expect(rowsBox(page).locator('.col-grip:visible')).toHaveCount(0);
  const one = rowsBox(page).locator('[data-nx-note="n1"]');
  const t = await one.locator('.basket-title').boundingBox(), d = await one.locator('[data-nl-cell="day"]').boundingBox(), f = await one.locator('[data-nl-cell="folder"]').boundingBox();
  // 제목 한 줄 아래에 폴더·날짜가 작은 줄로(같은 줄 높이).
  expect(d.y).toBeGreaterThanOrEqual(t.y + t.height - 1);
  expect(Math.abs(d.y - f.y)).toBeLessThan(4);
  expect(await one.locator('[data-nl-cell="day"]').evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeLessThanOrEqual(11);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(s.errors).toEqual([]);
});

// [태그] 보기는 지금 모양 그대로(칸 줄 아님). [폴더] 보기 넓은 화면 오른쪽 목록은 S70-82(NOTE-폴더디자인통일, 명진 11/26 "파일쪽에 맞춰서")부터
// [목록]과 같은 머리 줄·칸 줄(같은 보일 칸) — 자세한 것은 note-folder-unify.spec.mjs.
test('[태그] 보기 줄은 지금 모양 그대로(칸 줄 아님), [폴더] 보기 오른쪽은 [목록]과 같은 머리·칸 줄', async ({ page }) => {
  const s = await fixture(page, 1280);
  await page.locator('#basketView [data-note-view="tag"]').click();
  await expect(rowsBox(page).locator('.nx-note').first()).toBeVisible();
  await expect(rowsBox(page).locator('.nl-cols')).toHaveCount(0);
  await expect(head(page)).toHaveCount(0);
  await page.locator('#basketView [data-note-view="folder"]').click();
  await expect(rowsBox(page).locator('.nx-note').first()).toBeVisible();
  await expect(head(page)).toHaveCount(1);
  expect(await rowsBox(page).locator('.nx-note:not(.nl-cols)').count()).toBe(0);
  expect(s.errors).toEqual([]);
});

// ---------- ①-2 머리 눌러 정렬(결정 ③가, 기준표 H1). 서버 view_prefs.note_list_sort({key, dir}, 기본 수정일 내림) ----------
const ids = page => rowsBox(page).locator('.nl-cols').evaluateAll(els => els.map(e => e.dataset.nxNote));
const sortBtn = (page, key) => head(page).locator(`[data-head-sort="${key}"]`);
const sortCell = (page, key) => sortBtn(page, key).locator('xpath=..');

test('PC 1280: 머리 칸 두 번 누르기 = 오름·내림, aria-sort, 새로 열어도 같음', async ({ page }) => {
  test.setTimeout(90000);
  const s = await fixture(page, 1280);
  const saved = () => s.server.value?.note_list_sort ?? null;
  // 처음 = 수정일 내림(지금 순서), 서버 값 없음.
  await expect(sortCell(page, 'changed')).toHaveAttribute('aria-sort', 'descending');
  await expect(sortBtn(page, 'changed')).toContainText('▼');
  expect((await ids(page)).slice(0, 3)).toEqual(['n1', 'n2', 'n3']);
  expect(saved()).toBeNull();
  // 제목: 처음 누르면 오름(가짜 노트 1, 2, … 30 — 숫자 자연 정렬), 다시 누르면 내림.
  await sortBtn(page, 'title').click();
  await expect(sortCell(page, 'title')).toHaveAttribute('aria-sort', 'ascending');
  await expect(sortCell(page, 'changed')).toHaveAttribute('aria-sort', 'none');
  await expect.poll(async () => (await ids(page)).slice(0, 3)).toEqual(['n1', 'n2', 'n3']);
  expect((await ids(page)).at(-1)).toBe('n30');
  await sortBtn(page, 'title').click();
  await expect(sortCell(page, 'title')).toHaveAttribute('aria-sort', 'descending');
  await expect(sortBtn(page, 'title')).toContainText('▼');
  await expect.poll(async () => (await ids(page))[0]).toBe('n30');
  await expect.poll(saved).toEqual({ key: 'title', dir: 'desc' });
  // 태그 칸은 정렬 칸이 아니다(누를 단추 없음).
  await expect(head(page).locator('[data-nl-col="tags"] [data-head-sort]')).toHaveCount(0);
  // 키보드: 머리 칸에 초점 → Enter = 반대로, 다시 그린 뒤에도 초점은 그 칸.
  await sortBtn(page, 'title').focus();
  await page.keyboard.press('Enter');
  await expect(sortCell(page, 'title')).toHaveAttribute('aria-sort', 'ascending');
  expect(await sortBtn(page, 'title').evaluate(el => el === document.activeElement)).toBe(true);
  // 폴더: 오름 = 가나다(갑 → 아주 긴 …), 폴더 없는 노트는 맨 아래. 같은 폴더 안은 수정일 최신순.
  await sortBtn(page, 'folder').click();
  await expect(sortCell(page, 'folder')).toHaveAttribute('aria-sort', 'ascending');
  const byFolder = await ids(page);
  expect(byFolder.slice(0, 2)).toEqual(['n2', 'n5']);
  expect(byFolder.at(-1)).toBe('n30');
  // 새로 열어도 같은 정렬(서버 값).
  await expect.poll(saved).toEqual({ key: 'folder', dir: 'asc' });
  await page.reload(); await s.show();
  await expect(sortCell(page, 'folder')).toHaveAttribute('aria-sort', 'ascending');
  expect((await ids(page)).slice(0, 2)).toEqual(['n2', 'n5']);
  // 수정일로 돌아가면 기본(내림)이라 서버 값을 지운다.
  await sortBtn(page, 'changed').click();
  await expect(sortCell(page, 'changed')).toHaveAttribute('aria-sort', 'descending');
  await expect.poll(saved).toBeNull();
  expect(s.errors).toEqual([]);
});

test('PC 1280: 너비 손잡이 끌기는 정렬 안 됨', async ({ page }) => {
  const s = await fixture(page, 1280);
  const before = await ids(page);
  for (const key of ['title', 'day']) {
    const g = await head(page).locator(`[data-col-grip="${key}"]`).boundingBox(), y = g.y + g.height / 2, x = g.x + g.width / 2;
    await page.mouse.click(x, y); await page.waitForTimeout(150);
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x - 30, y, { steps: 4 }); await page.mouse.up(); await settle(page);
  }
  expect(await ids(page)).toEqual(before);
  await expect(sortCell(page, 'changed')).toHaveAttribute('aria-sort', 'descending');
  expect(s.server.value?.note_list_sort ?? null).toBeNull();
  await expect(page.locator('#basketView [data-note-detail]')).toBeHidden();
  expect(s.errors).toEqual([]);
});

test('폰 390: 머리 줄 없는 [목록]은 ⋯ 메뉴 정렬로 같은 값, 새로 열어도 같음', async ({ page }) => {
  test.setTimeout(90000);
  const s = await fixture(page, 390);
  const menu = page.locator('#noteDocMenu');
  const openMenu = async () => { await page.locator('.sf-tools [data-note-folder-more]').click(); await expect(menu).toBeVisible(); };
  await openMenu();
  await expect(menu.locator('[data-nl-sort]')).toHaveText(['정렬: 제목', '정렬: 폴더', '정렬: 수정일 ▼', '정렬: 첨부']);
  await menu.locator('[data-nl-sort="title"]').click();
  await expect.poll(async () => (await ids(page)).slice(0, 3)).toEqual(['n1', 'n2', 'n3']);
  expect((await ids(page)).at(-1)).toBe('n30');
  await openMenu();
  await expect(menu.locator('[data-nl-sort="title"]')).toHaveText('정렬: 제목 ▲');
  await menu.locator('[data-nl-sort="title"]').click();
  await expect.poll(async () => (await ids(page))[0]).toBe('n30');
  await expect.poll(() => s.server.value?.note_list_sort ?? null).toEqual({ key: 'title', dir: 'desc' });
  await page.reload(); await s.show();
  expect((await ids(page))[0]).toBe('n30');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(s.errors).toEqual([]);
});

test('[폴더] 보기 ⋯ 메뉴에는 [목록] 정렬 줄이 없다(폴더 보기 정렬은 지금 그대로)', async ({ page }) => {
  const s = await fixture(page, 1280);
  await page.locator('#basketView [data-note-view="folder"]').click();
  await page.locator('.sf-tools [data-note-folder-more]').click();
  await expect(page.locator('#noteDocMenu')).toBeVisible();
  await expect(page.locator('#noteDocMenu [data-nl-sort]')).toHaveCount(0);
  expect(s.errors).toEqual([]);
});

// ---------- ② 보일 칸(결정 ⑦가 메뉴 이름 '보일 칸', ⑤가 칸 차례 고정). 서버 view_prefs.note_cols ----------
const colsMenu = page => page.locator('#noteDocMenu');
const openCols = async page => { await head(page).locator('[data-nl-cols-menu]').click(); await expect(colsMenu(page)).toBeVisible(); await expect(colsMenu(page)).toHaveAttribute('aria-label', '보일 칸'); };
const headNames = page => head(page).locator('[role="columnheader"]').evaluateAll(els => els.map(e => e.dataset.nlCol));

test('PC 1280: 칸을 켜면 머리·줄에 칸이 생기고 끄면 사라짐, 새로 열어도 같음(서버)', async ({ page }) => {
  test.setTimeout(90000);
  const s = await fixture(page, 1280);
  const saved = () => s.server.value?.note_cols ?? null;
  expect(await headNames(page)).toEqual(['title', 'folder', 'tags', 'day', 'clip']);
  await openCols(page);
  await expect(colsMenu(page).locator('[data-nl-col-toggle]')).toHaveText(['✓폴더', '✓태그', '✓수정일', '작성일', '✓첨부', '메모', '글자 수', '공유']);
  // 제목은 끌 수 없다(목록에 없음).
  await expect(colsMenu(page).locator('[data-nl-col-toggle="title"]')).toHaveCount(0);
  // 작성일·글자 수 켜기(메뉴는 열린 채) → 칸 차례는 고정(제목 | 폴더 | 태그 | 수정일 | 작성일 | 첨부 | 글자 수).
  await colsMenu(page).locator('[data-nl-col-toggle="made"]').click();
  await expect(colsMenu(page)).toBeVisible();
  await expect(colsMenu(page).locator('[data-nl-col-toggle="made"]')).toHaveAttribute('aria-checked', 'true');
  await colsMenu(page).locator('[data-nl-col-toggle="chars"]').click();
  // 폴더 끄기.
  await colsMenu(page).locator('[data-nl-col-toggle="folder"]').click();
  expect(await headNames(page)).toEqual(['title', 'tags', 'day', 'made', 'clip', 'chars']);
  await expect(rowsBox(page).locator('[data-nx-note="n1"] [data-nl-cell]')).toHaveCount(5);
  await expect(rowsBox(page).locator('[data-nl-cell="folder"]')).toHaveCount(0);
  await expect(rowsBox(page).locator('[data-nx-note="n1"] [data-nl-cell="chars"]')).toHaveText(String([...'가짜 노트 1 본문 #준비 #회의 #가짜 #넷째'].length));
  await expect(rowsBox(page).locator('[data-nx-note="n1"] [data-nl-cell="made"]')).toHaveText('11.20');
  // 머리 칸과 줄 칸 자리가 맞는다(그리드 하나).
  const hx = (await headCell(page, 'chars').boundingBox()), cx = await rowsBox(page).locator('[data-nx-note="n1"] [data-nl-cell="chars"]').boundingBox();
  expect(Math.abs(hx.x + hx.width - (cx.x + cx.width))).toBeLessThan(3);
  await expect.poll(saved).toEqual(['tags', 'day', 'made', 'clip', 'chars']);
  await page.keyboard.press('Escape');
  // 새로 열어도 같은 칸.
  await page.reload(); await s.show();
  expect(await headNames(page)).toEqual(['title', 'tags', 'day', 'made', 'clip', 'chars']);
  // [기본으로] = 서버 값 지움, 기본 넷.
  await openCols(page);
  await colsMenu(page).locator('[data-nl-cols-reset]').click();
  await expect.poll(saved).toBeNull();
  expect(await headNames(page)).toEqual(['title', 'folder', 'tags', 'day', 'clip']);
  // 작성일 칸 머리를 누르면 작성일 정렬(①-2와 같은 정렬 값).
  await openCols(page); await colsMenu(page).locator('[data-nl-col-toggle="made"]').click(); await page.keyboard.press('Escape');
  await sortBtn(page, 'created').click();
  await expect(sortCell(page, 'created')).toHaveAttribute('aria-sort', 'descending');
  await expect.poll(() => s.server.value?.note_list_sort ?? null).toEqual({ key: 'created', dir: 'desc' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(s.errors).toEqual([]);
});

test('제목만 남겨도(모두 끄기) 줄이 그려지고, 폰 390도 ⋯ [보일 칸…]으로 같은 값', async ({ page }) => {
  test.setTimeout(90000);
  const s = await fixture(page, 390, { prefs: { note_cols: ['day'] } });
  // 폰: 아래 작은 줄에 켠 칸(수정일)만.
  const one = rowsBox(page).locator('[data-nx-note="n1"]');
  await expect(one.locator('[data-nl-cell]')).toHaveCount(1);
  await expect(one.locator('[data-nl-cell="day"]')).toBeVisible();
  await page.locator('.sf-tools [data-note-folder-more]').click();
  await colsMenu(page).locator('[data-nl-cols-open]').click();
  await expect(colsMenu(page)).toHaveAttribute('aria-label', '보일 칸');
  await colsMenu(page).locator('[data-nl-col-toggle="day"]').click();
  await expect.poll(() => s.server.value?.note_cols ?? null).toEqual([]);
  await expect(one.locator('[data-nl-cell]')).toHaveCount(0);
  await expect(one.locator('.basket-title-text')).toHaveText('가짜 노트 1');
  expect(s.errors).toEqual([]);
});

test('PC 1280: 잠긴 노트는 메모·글자 수·공유 칸이 빈칸', async ({ page }) => {
  const s = await fixture(page, 1280, { locked: true, prefs: { note_cols: ['folder', 'tags', 'day', 'clip', 'memo', 'chars', 'pub'] } });
  const lockedRow = rowsBox(page).locator('[data-nx-note="n1"]'), open = rowsBox(page).locator('[data-nx-note="n2"]');
  await expect(lockedRow.locator('.basket-title-text')).toHaveText('잠김');
  for (const key of ['memo', 'chars', 'pub', 'tags']) await expect(lockedRow.locator(`[data-nl-cell="${key}"]`)).toBeEmpty();
  // 잠기지 않은 노트는 글자 수가 보인다.
  await expect(open.locator('[data-nl-cell="chars"]')).not.toBeEmpty();
  expect(s.errors).toEqual([]);
});

// ---------- ③ 태그 칸(칸 너비 기준 +N, 결정 ⑥가 태그 누르기 = 노트 열기) ----------
const tagsOf = row => row.locator('[data-nl-cell="tags"]').evaluate(el => ({ shown: [...el.querySelectorAll('.nl-tag')].filter(t => !t.hidden).length, more: el.querySelector('.nl-more')?.hidden ? '' : el.querySelector('.nl-more')?.textContent || '' }));

test('PC 1280: 태그 4개 노트 — 칸 너비를 줄이면 보이는 태그가 줄고 +N이 늘어남', async ({ page }) => {
  const s = await fixture(page, 1280, { prefs: { col_widths: { notes: { tags: 400 } } } });
  const row = rowsBox(page).locator('[data-nx-note="n1"]');
  await expect.poll(() => tagsOf(row)).toEqual({ shown: 4, more: '' });
  // 글자로는 모든 태그('태그: #준비 #회의 …', 지금 [태그] 칸 글자와 같은 꼴).
  await expect(row.locator('[data-nx-tags]')).toHaveText('태그: #준비 #회의 #가짜 #넷째');
  // 금을 끌어 칸을 줄이면(서버 저장) 보이는 태그가 줄고 +N.
  const grip = head(page).locator('[data-col-grip="tags"]');
  const g = await grip.boundingBox(), y = g.y + g.height / 2, x = g.x + g.width / 2;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x - 150, y, { steps: 5 }); await page.mouse.move(x - 300, y, { steps: 5 }); await page.mouse.up(); await settle(page);
  await expect.poll(async () => (await tagsOf(row)).shown).toBeLessThan(4);
  const narrow = await tagsOf(row);
  expect(narrow.shown).toBeGreaterThanOrEqual(1);
  expect(narrow.more).toBe(`+${4 - narrow.shown}`);
  await expect(row.locator('.nl-more')).toHaveAttribute('aria-label', `외 ${4 - narrow.shown}개`);
  // 칸 안에 넘치지 않는다.
  expect(await row.locator('[data-nl-cell="tags"]').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  // 태그를 누르면 줄 누르기와 같다(노트 열기).
  await row.locator('.nl-tag').first().click();
  await expect(page.locator('#basketView [data-note-detail]')).toBeVisible();
  expect(s.errors).toEqual([]);
});

test('PC 1280: 태그 칸 끄면 줄에 #태그 0개', async ({ page }) => {
  const s = await fixture(page, 1280, { prefs: { note_cols: ['folder', 'day'] } });
  await expect(rowsBox(page).locator('[data-nx-note="n1"]')).toBeVisible();
  await expect(rowsBox(page).locator('.nl-cols [data-nx-tags], .nl-cols .nl-tag')).toHaveCount(0);
  expect(await rowsBox(page).locator('[data-nx-note="n1"] .note-row').innerText()).not.toContain('#');
  expect(s.errors).toEqual([]);
});

test('폰 390: 태그는 앞 두 개 + N(아래 작은 줄)', async ({ page }) => {
  const s = await fixture(page, 390);
  await expect.poll(() => tagsOf(rowsBox(page).locator('[data-nx-note="n1"]'))).toEqual({ shown: 2, more: '+2' });
  expect(s.errors).toEqual([]);
});
