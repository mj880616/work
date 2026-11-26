import { test, expect } from '@playwright/test';
import { pickInSheet } from './helpers/folder-sheet.mjs';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';

// S66-06 NOTE-폴더고른뒤크게(명진 11/18 17:47, 폰 폴드 접은 화면·폰 앱): 노트 [목록] 보기에서 입력 줄 [폴더 ▾]로 폴더를 고른 뒤
// ① [⤢ 크게]를 누르면 노트 쓰기 창이 그 폴더로 열려야 하고 ② 입력칸을 누르면 [목록] 보기 그대로(화면을 다시 그리지 않음)여야 한다.
// 폴더를 고르지 않은 경우(지금 잘 되는 길)도 같은 기대로 함께 본다. 가짜 자료만 쓴다. 폰 412 · PC 1280.
test.use({ hasTouch: true });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
// S66-08: 폰 앱(KPTUAndroid) 흉내 = 앱 UA + 가짜 다리(앱 전용 모듈이 붙는다). 늦은 뒤로 = 고르기 창이 닫으며 부르는 history.back()의
// popstate가 늦게(400ms 뒤) 오는 WebView 가설. 두 경우 모두 지금 코드에서 재현되지 않음을 지키는 시험으로 둔다.
async function fixture(page, width, { app = false, lateBack = false } = {}) {
  await page.setViewportSize({ width, height: 900 });
  if (app) await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (Linux; Android 14) KPTUAndroid/1' });
    window.KPTUAppShell = { postMessage() {}, addEventListener() {} };
  });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await openHome(page);
  const row = (id, title, t) => ({ id, workspace_id: 'w', kind: 'note', title, raw_text: title + ' 본문', occurred_at: t, created_at: t, updated_at: t, archived_at: null, ai_export_allowed: true, attachments: [], metadata: {} });
  const rows = [row('n1', '가 노트', '2026-10-16T01:00:00Z'), row('n2', '나 노트', '2026-10-12T01:00:00Z')];
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', r => r.request().method() === 'GET' ? r.fulfill({ json: structuredClone(rows) }) : r.fulfill({ status: 500, json: {} }));
  const folders = [{ id: U(1), workspace_id: 'w', parent_id: null, name: '00. 잊지 말기', sort_order: 1024, created_at: '2026-10-01T00:00:00Z' }, { id: U(2), workspace_id: 'w', parent_id: null, name: '회의', sort_order: 2048, created_at: '2026-10-01T00:00:00Z' }];
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_folders', r => r.request().method() === 'GET' ? r.fulfill({ json: structuredClone(folders) }) : r.fulfill({ status: 500, json: {} }));
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  await expect(page.locator('[data-nx-count]')).toHaveText(`노트 · ${rows.length}`);
  if (lateBack) await page.evaluate(() => { const real = history.back.bind(history); history.back = () => { setTimeout(real, 400); }; });
  return { errors };
}
const press = async (page, l, width) => { await expect(l).toBeVisible(); if (width < 761) await l.tap(); else await l.click(); };
const q = (page, sel) => page.locator(`[data-note-list] ${sel}`);
async function toList(page, width) {
  await press(page, page.locator('[data-note-view="list"]'), width);
  await expect(page.locator('[data-note-view="list"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-nx-note="n1"]').first()).toBeVisible();
}
async function pickFolder(page, width) {
  await press(page, q(page, '[data-quick-folder]'), width);
  // S69-62: [파일] '옮길 곳' 창과 같은 창 — 줄 누르기 = 고르기, [이 폴더로 정하기]로 정한다.
  await pickInSheet(page, ['00. 잊지 말기']);
  await expect(q(page, '[data-quick-folder]')).toContainText('00. 잊지');
}

for (const width of [412, 1280]) for (const picked of [true, false]) {
  const name = picked ? '폴더를 고른 뒤' : '폴더를 고르지 않고';
  test(`노트 [목록]에서 ${name} [⤢ 크게] → 노트 쓰기 창이 열린다 ${width}`, async ({ page }) => {
    const f = await fixture(page, width);
    await toList(page, width);
    if (picked) await pickFolder(page, width);
    await press(page, q(page, '[data-quick-big]'), width);
    const win = page.locator('#edWindow');
    await expect(win).toBeVisible();
    await expect(win.locator('[data-edw-folder]')).toHaveAttribute('title', picked ? '노트 폴더: 00. 잊지 말기' : '노트 폴더: 폴더 없음');
    expect(f.errors).toEqual([]);
  });
  test(`노트 [목록]에서 ${name} 입력칸을 누르면 [목록] 그대로 ${width}`, async ({ page }) => {
    const f = await fixture(page, width);
    await toList(page, width);
    if (picked) await pickFolder(page, width);
    // 다시 그리면 줄이 새로 만들어진다: 누르기 전 줄에 표시를 달아 두고 누른 뒤에도 같은 줄인지 본다.
    await page.locator('[data-nx-note="n1"]').first().evaluate(el => { el.dataset.s6606 = 'kept'; });
    await page.evaluate(() => { window.__s6606 = 0; addEventListener('kptu:view-changed', () => { window.__s6606++; }); });
    await press(page, q(page, '[data-quick-input]'), width);
    await expect(q(page, '[data-quick-input]')).toBeFocused();
    await expect(page.locator('[data-note-view="list"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-nx-note="n1"][data-s6606="kept"]')).toHaveCount(1);
    expect(await page.evaluate(() => window.__s6606)).toBe(0);
    await expect(q(page, '[data-quick-folder]')).toHaveAccessibleName(picked ? /^폴더: 00\. 잊지/ : '폴더: 폴더 없음'); // NOTE-입력줄높이: 폴더 없음은 아이콘만
    expect(f.errors).toEqual([]);
  });
}

// S66-08 NOTE-폴더고른뒤크게(명진 11/18 20:28 "앱 맞음"): 폰 앱 흉내·늦은 뒤로에서도 같은 기대(폰 412·폴드 접은 화면 344).
for (const width of [344, 412]) for (const [label, opts] of [['폰 앱 흉내', { app: true }], ['늦은 뒤로', { lateBack: true }], ['폰 앱 흉내 + 늦은 뒤로', { app: true, lateBack: true }]]) {
  test(`${label}: 폴더를 고른 뒤 [⤢ 크게] → 노트 쓰기 창 ${width}`, async ({ page }) => {
    const f = await fixture(page, width, opts);
    await toList(page, width);
    await pickFolder(page, width);
    await press(page, q(page, '[data-quick-big]'), width);
    await expect(page.locator('#edWindow')).toBeVisible();
    await expect(page.locator('#edWindow [data-edw-folder]')).toHaveAttribute('title', '노트 폴더: 00. 잊지 말기');
    expect(f.errors).toEqual([]);
  });
  test(`${label}: 폴더를 고른 뒤 입력칸 → [목록] 그대로 ${width}`, async ({ page }) => {
    const f = await fixture(page, width, opts);
    await toList(page, width);
    await pickFolder(page, width);
    await page.locator('[data-nx-note="n1"]').first().evaluate(el => { el.dataset.s6608 = 'kept'; });
    await page.evaluate(() => { window.__s6608 = 0; addEventListener('kptu:view-changed', () => { window.__s6608++; }); });
    await press(page, q(page, '[data-quick-input]'), width);
    await expect(q(page, '[data-quick-input]')).toBeFocused();
    await page.waitForTimeout(600); // 늦은 popstate(400ms)가 도착한 뒤를 본다(기다리는 대상이 있는 고정 시간)
    await expect(page.locator('[data-nx-note="n1"][data-s6608="kept"]')).toHaveCount(1);
    expect(await page.evaluate(() => window.__s6608)).toBe(0);
    await expect(page.locator('#edWindow')).toBeHidden();
    expect(f.errors).toEqual([]);
  });
}
