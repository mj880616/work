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
const headCell = (page, key) => head(page).locator(`.nl-h-${key}`);

async function fixture(page, width, { prefs = null } = {}) {
  await page.setViewportSize({ width, height: 700 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const server = await installViewPrefsServer(page, { note_view: 'list', ...(prefs || {}) });
  await openHome(page);
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
  await expect(head(page).locator('[role="columnheader"]')).toHaveText(['제목', '폴더', '태그', '수정일', '첨부']);
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

test('[태그]·[폴더] 보기 줄은 지금 모양 그대로(칸 줄 아님)', async ({ page }) => {
  const s = await fixture(page, 1280);
  await page.locator('#basketView [data-note-view="tag"]').click();
  await expect(rowsBox(page).locator('.nx-note').first()).toBeVisible();
  await expect(rowsBox(page).locator('.nl-cols')).toHaveCount(0);
  await expect(head(page)).toHaveCount(0);
  await page.locator('#basketView [data-note-view="folder"]').click();
  await expect(rowsBox(page).locator('.nl-cols')).toHaveCount(0);
  await expect(head(page)).toHaveCount(0);
  expect(s.errors).toEqual([]);
});
