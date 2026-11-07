// S52-16 NOTE-폴더스크롤(요청함 11/07 13:24 ★급★ "이 상태에서 폴더 스크롤 이 안됨"): 폰 폴더 나무가 화면보다 살짝 길 때
// 마지막 폴더들이 아래 입력 줄·보기 바꾸기 줄에 가린 채 스크롤이 멈추던 문제.
// 원인: 손짓 칸 채우기(app/gesture-fill.js, #1985)가 '아래 바'를 맨 아래 탭바로만 보고 칸을 입력 줄 뒤까지 늘린 뒤 화면 아래 여백을 당겨
// (내용이 '칸 안에 든다'고 판정), 입력 줄 뒤에 든 줄들이 스크롤로 올라오지 않았다.
// 시험: 412폭에서 화면 높이를 바꿔 가며(내용이 화면과 비슷한 길이가 되는 구간을 모두 지나게) 맨 아래까지 밀었을 때 마지막 줄이
// 화면 아래 고정 줄 묶음(탭바·입력 줄·보기 바꾸기 줄) 위에 보이는지 — 노트(최근 접힘·펼침)·[파일]·자료실·사진, 폴더 12개 이상. 이름은 모두 지어낸 것이다.
import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';

test.use({ hasTouch: true, isMobile: true });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const frames = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

// 지금 화면에서 맨 아래까지 민 뒤: sel에 맞는 (고정 줄 밖) 요소 중 가장 아래 끝, 그리고 화면 아래 고정 줄 묶음의 위 끝(시험이 따로 잰 값).
function measure(sel) {
  const fixed = el => { for (let e = el; e && e !== document.documentElement; e = e.parentElement) if (getComputedStyle(e).position === 'fixed') return true; return false; };
  const items = [...document.querySelectorAll(sel)].filter(e => e.getClientRects().length && !fixed(e) && getComputedStyle(e).visibility !== 'hidden');
  const bottom = Math.max(...items.map(e => e.getBoundingClientRect().bottom));
  const last = items.reduce((a, e) => (e.getBoundingClientRect().bottom > (a?.getBoundingClientRect().bottom ?? -1) ? e : a), null);
  const lr = last.getBoundingClientRect();
  let stack = innerHeight;
  for (const e of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(e);
    if (cs.position !== 'fixed' || cs.visibility === 'hidden' || cs.display === 'none' || !e.getClientRects().length) continue;
    const r = e.getBoundingClientRect();
    if (r.height <= 0 || r.width <= 0 || r.top <= innerHeight / 3 || r.right <= lr.left || r.left >= lr.right) continue;
    stack = Math.min(stack, r.top);
  }
  const se = document.scrollingElement;
  return { bottom: Math.round(bottom), stack: Math.round(stack), top: se.scrollTop, max: se.scrollHeight - innerHeight, text: (last.textContent || '').trim().slice(0, 20) };
}
// 화면 높이를 바꿔 가며 맨 아래까지 밀고, 마지막 줄이 고정 줄 위에 다 보이는지. 내용이 화면보다 긴 높이가 적어도 한 번은 있어야 시험이 뜻이 있다.
async function expectEndVisible(page, sel, { from = 620, to = 1120, step = 20, width = 412 } = {}) {
  const bad = [];
  let longer = 0;
  for (let h = from; h <= to; h += step) {
    await page.setViewportSize({ width, height: h });
    await frames(page); await page.waitForTimeout(60); await frames(page);
    // 넓은 틀의 따라오는 나무(follow-pane)는 내려가는 동안 화면 길이가 늘 수 있어, 더 내려가지 않을 때까지 민다.
    for (let k = 0; k < 6; k++) {
      const before = await page.evaluate(() => { window.scrollTo(0, document.scrollingElement.scrollHeight); return scrollY; });
      await frames(page);
      if (await page.evaluate(y => scrollY === y && scrollY >= document.scrollingElement.scrollHeight - innerHeight - 1, before)) break;
    }
    const m = await page.evaluate(measure, sel);
    if (m.max > 0) longer++;
    if (m.bottom > m.stack + 1) bad.push({ h, ...m });
  }
  expect(bad).toEqual([]);
  expect(longer).toBeGreaterThan(0);
}
// 손가락 하나로 위로 여러 번 밀기(실제 터치 스크롤): 화면 끝까지 가고 마지막 줄이 고정 줄 위에 보인다.
async function expectTouchToEnd(page, sel, height) {
  await page.setViewportSize({ width: 412, height });
  await page.evaluate(() => window.scrollTo(0, 0));
  await frames(page); await page.waitForTimeout(60);
  const cdp = await page.context().newCDPSession(page);
  const x = 206, y = Math.round(height * 0.55);
  for (let k = 0; k < 4; k++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 0 }] });
    for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - i * 25, id: 0 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(120);
  }
  await cdp.detach();
  const m = await page.evaluate(measure, sel);
  expect(m.max).toBeGreaterThan(0);
  expect(m.top).toBeGreaterThanOrEqual(m.max - 1);
  expect(m.bottom).toBeLessThanOrEqual(m.stack + 1);
}

async function bootNotes(page, { folded }) {
  await page.setViewportSize({ width: 412, height: 915 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await installViewPrefsServer(page, folded ? { recent_folded: ['notes'] } : null);
  await openHome(page);
  const folders = Array.from({ length: 12 }, (_, i) => ({ id: U(i + 1), workspace_id: 'w', parent_id: null, name: `${String(i + 1).padStart(2, '0')}. 가상 폴더`, sort_order: 1024 * (i + 1), created_at: '2026-10-01T00:00:00Z' }));
  const rows = Array.from({ length: 6 }, (_, i) => ({ id: 'n' + i, workspace_id: 'w', kind: 'note', title: `가상 노트 ${i}`, raw_text: '본문', occurred_at: `2026-10-0${i + 1}T01:00:00Z`, created_at: `2026-10-0${i + 1}T01:00:00Z`, updated_at: `2026-10-0${i + 1}T01:00:00Z`, archived_at: null, ai_export_allowed: true, attachments: [], metadata: i < 2 ? { folder_id: U(1), folder: folders[0].name } : {} }));
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', r => (r.request().method() === 'GET' ? r.fulfill({ json: structuredClone(rows) }) : r.fulfill({ status: 500, json: {} })));
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_folders', r => (r.request().method() === 'GET' ? r.fulfill({ json: structuredClone(folders) }) : r.fulfill({ status: 500, json: {} })));
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  await expect(page.locator('#noteRows [data-nx-folder]')).toHaveCount(12);
  await expect(page.locator('[data-nx-recent] [data-nx-recent-fold]')).toHaveAttribute('aria-expanded', folded ? 'false' : 'true');
  return errors;
}
// 노트 [폴더]: 나무 상자 + 그 아래 [+ 새 폴더] 줄까지.
const NOTE_END = '[data-nx-body] .ft-box, [data-nx-body] .ft-row, [data-nx-body] button';

for (const folded of [true, false]) test(`노트 폰 412 [폴더] 최근 ${folded ? '접힘' : '펼침'}: 폴더 12개, 어느 높이에서도 맨 아래까지 밀면 마지막 줄이 입력 줄 위에 보임`, async ({ page }) => {
  const errors = await bootNotes(page, { folded });
  // 입력 줄·보기 바꾸기 줄이 화면 아래에 떠 있는 화면이다(이 둘을 넘어 가리지 않아야 한다).
  await expect(page.locator('.home-quick[data-home-quick]:visible, .nv-switch:visible').first()).toBeVisible();
  await expectEndVisible(page, NOTE_END);
  await expectTouchToEnd(page, NOTE_END, 915);
  // 줄 위가 아닌 상자 왼쪽 끝·오른쪽 ⋯ 자리에서 밀어도 같다(손짓 칸이 세로 밀기를 막지 않는다).
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('[data-nx-body]')).touchAction)).toBe('pan-x pan-y');
  expect(errors).toEqual([]);
});

// 폴드 접힘(344)·펼침(884)도 같은 규칙(펼침은 넓은 틀이라 아래 탭바가 없다).
for (const width of [344, 884]) test(`노트 폴드 ${width} [폴더] 최근 접힘: 맨 아래까지 밀면 마지막 줄이 보임`, async ({ page }) => {
  const errors = await bootNotes(page, { folded: true });
  await expectEndVisible(page, NOTE_END, { width, from: 560, to: 1120 });
  expect(errors).toEqual([]);
});

test('[파일] 폰 412: 폴더 14개 나무, 어느 높이에서도 맨 아래까지 밀면 마지막 줄이 보임(최근 펼침·접힘)', async ({ page }) => {
  const { start, openFiles } = await import('./helpers/files-server.mjs');
  const { errors, server } = await start(page, 412);
  await installViewPrefsServer(page);
  for (let i = 0; i < 12; i++) server.items.push({ source: 'od', item_id: `OD!9${i}`, parent_id: null, name: `가상 폴더 ${String(i + 1).padStart(2, '0')}`, is_folder: true, mime: null, size_bytes: null, modified_at: '2026-10-01T01:00:00Z', hash: null, trashed: false, starred: false, library_doc_id: null });
  await openFiles(page, 412);
  const tree = page.locator('#filesRoot [data-fx-tree]');
  await expect(tree.locator('[data-fx-fold^="od:OD!9"]')).toHaveCount(12);
  const END = '#filesRoot [data-fx-tree] .ft-box, #filesRoot [data-fx-tree] .ft-row';
  await expectEndVisible(page, END, { from: 500, to: 1300, step: 25 });
  await expectTouchToEnd(page, END, 700);
  await page.setViewportSize({ width: 412, height: 915 });
  await tree.locator('[data-fx-box="recent"] [data-fx-recent-fold]').click();
  await expect(tree.locator('[data-fx-box="recent"] [data-fx-tfile]')).toHaveCount(0);
  await expectEndVisible(page, END, { from: 500, to: 1300, step: 25 });
  expect(errors).toEqual([]);
});

test('자료실 폰 412: 폴더 14개 나무, 어느 높이에서도 맨 아래까지 밀면 마지막 줄이 보임', async ({ page }) => {
  const { bootLibrary, libFolder } = await import('./helpers/library-folder-server.mjs');
  const folders = Array.from({ length: 14 }, (_, i) => libFolder('f' + i, 'top-a', { name: `가상 ${String(i + 1).padStart(2, '0')}`, sort_order: 1024 * (i + 1) }));
  const { errors } = await bootLibrary(page, 412, { folders, items: [{ document_id: 'n-1', folder_id: 'f0' }] });
  await page.locator('#libraryGroupBy').getByRole('radio', { name: '폴더' }).click();
  await expect(page.locator('#documentList details[data-lu-node="f:f13"] > summary')).toBeVisible();
  const END = '#libraryView #documentList summary, #libraryView #documentList .ft-row, #libraryView #libraryListCard';
  await expectEndVisible(page, END, { from: 500, to: 1400, step: 25 });
  await expectTouchToEnd(page, END, 700);
  expect(errors).toEqual([]);
});

test('사진 폰 412 [폴더]: 폴더 14개, 어느 높이에서도 맨 아래까지 밀면 마지막 줄이 보임', async ({ page }) => {
  const { phonePhotosFixture, openPhotos } = await import('./helpers/phone-photos-fixture.mjs');
  await page.setViewportSize({ width: 412, height: 915 });
  const { state } = await phonePhotosFixture(page);
  const folders = Array.from({ length: 14 }, (_, i) => ({ id: 'S' + (i + 1), name: `가상 ${String(i + 1).padStart(2, '0')}`, parent_id: 'T', enabled: true, count: 0, total: 0 }));
  await page.route(u => u.origin === SB && u.pathname === '/functions/v1/onedrive-photos', r => (r.request().postDataJSON()?.action === 'folders-tree'
    ? r.fulfill({ json: { top: { id: 'T', name: '카메라', count: 2, total: 2 }, folders, indexing: false } }) : r.fallback()));
  await openPhotos(page, 412);
  await page.locator('#photosRoot [data-photos-tab="folders"]').click();
  await expect(page.locator('#photosRoot [data-photos-folder="S14"]').first()).toBeVisible();
  const END = '#photosRoot .ft-box, #photosRoot .ft-row';
  await expectEndVisible(page, END, { from: 500, to: 1400, step: 25 });
  await expectTouchToEnd(page, END, 700);
  expect(state.errors).toEqual([]);
});
