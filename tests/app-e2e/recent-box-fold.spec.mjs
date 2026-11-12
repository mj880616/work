import { test, expect } from '@playwright/test';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
// S51-22 (요청함 11/06 19:50 "어디든 최신 접을 수 있게"): 파일·노트·자료실 맨 위 '최근' 상자 머리 줄을 누르면 접기/펼치기.
// S51-33 UI-접기꺾쇠(요청함 11/06 23:28): 접기 표시는 '최근' 글자 바로 옆 공용 꺾쇠(⌃ 펼침·⌄ 접힘, 회색·글자 높이), '펼치기 ›'는 오른쪽 따로, 세모 글자 없음.
// 접으면 머리 줄 한 줄만, 접은 상태는 화면마다 서버 view_prefs.recent_folded에 기억(기기 저장 없음) — 다시 열어도 접힘. 이름은 모두 가짜.
// 노트·파일의 '최근' 상자는 폰 한 칸에만 있다(폴드·PC 노트의 '최근'은 왼쪽 나무의 한 줄, 파일은 나무 | 목록).
const caret = box => box.locator('.ft-box-caret');
// 꺾쇠: 공용 .kptu-chev, 펼침이면 180도(⌃). 세모 글자 없음. 이름 글자 바로 옆(8px 안)·글자와 같은 높이(세로 가운데 3px 안)·회색.
const expectChev = async (box, open, titleSel) => {
  const c = caret(box);
  await expect(c).toHaveClass(/kptu-chev/);
  await expect(c).toHaveText('');
  expect(await c.evaluate(el => getComputedStyle(el).transform)).toBe(open ? 'matrix(-1, 0, 0, -1, 0, 0)' : 'none');
  const g = await box.locator(titleSel).evaluate(btn => {
    const chev = btn.querySelector('.ft-box-caret'), r = document.createRange();
    const text = [...btn.childNodes].find(n => n.nodeType === 3 && n.textContent.trim()); r.selectNodeContents(text);
    const t = r.getBoundingClientRect(), c = chev.getBoundingClientRect();
    return { gap: c.left - t.right, dy: Math.abs((c.top + c.bottom) / 2 - (t.top + t.bottom) / 2), h: c.height, th: t.height, color: getComputedStyle(chev).backgroundColor, ink: getComputedStyle(btn).color };
  });
  expect(g.gap).toBeGreaterThanOrEqual(0); expect(g.gap).toBeLessThanOrEqual(8);
  expect(g.dy).toBeLessThanOrEqual(3); expect(g.h).toBeGreaterThanOrEqual(10); expect(g.h).toBeLessThanOrEqual(g.th + 2);
  expect(await box.innerText()).not.toMatch(/[▴▾▸]/);
};

test('파일 폰 412: \'최근\' 머리 줄 누르면 접힘(▾, 줄 없음) → 새로고침해도 접힘 → 다시 누르면 펼침', async ({ page }) => {
  const { start, openFiles } = await import('./helpers/files-server.mjs');
  const { errors, server } = await start(page, 412);
  // LIB-사진숨김나머지(S61-1): 사진(가짜 현장.jpg)은 '최근' 줄 수에 들지 않으므로 사진 아닌 파일을 하나 더 두어 6개(→ [펼치기 ›])로 맞춘다.
  server.items.push({ ...server.items.find(i => i.item_id === 'OD!13'), item_id: 'OD!40', name: '가짜 회의록.txt', modified_at: '2026-09-10T01:00:00Z' });
  const prefs = await installViewPrefsServer(page);
  await openFiles(page, 412);
  const box = page.locator('#filesRoot [data-fx-tree] [data-fx-box="recent"]');
  await expect(box.locator('[data-fx-tfile]')).toHaveCount(5);
  await expectChev(box, true, '[data-fx-recent-fold]');
  // '펼치기 ›'는 접기 단추 밖 오른쪽 글자 단추.
  const more = box.locator('[data-fx-recent-more]');
  await expect(more).toHaveText('펼치기 ›');
  expect(await more.evaluate(el => !el.closest('[data-fx-recent-fold]'))).toBe(true);
  await box.locator('[data-fx-recent-fold]').click();
  await expect(box.locator('[data-fx-tfile]')).toHaveCount(0);
  await expect(box.locator('[data-fx-recent-more]')).toHaveCount(0);
  await expectChev(box, false, '[data-fx-recent-fold]');
  await expect(box.locator('[data-fx-recent-fold]')).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(() => prefs.value?.recent_folded).toEqual(['files']);
  await page.reload();
  await openFiles(page, 412);
  await expect(box.locator('[data-fx-recent-fold]')).toHaveAttribute('aria-expanded', 'false');
  await expect(box.locator('[data-fx-tfile]')).toHaveCount(0);
  await box.locator('[data-fx-recent-fold]').click();
  await expect(box.locator('[data-fx-tfile]')).toHaveCount(5);
  await expect.poll(() => prefs.value?.recent_folded).toEqual([]);
  expect(errors).toEqual([]);
});

test('노트 폰 412: \'최근\' 상자 접기·펼치기, 서버에 기억', async ({ page }) => {
  const { openHome } = await import('./helpers/home-entry.mjs');
  const { chooseBasketKind } = await import('./helpers/basket-kind.mjs');
  const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
  await page.setViewportSize({ width: 412, height: 915 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const prefs = await installViewPrefsServer(page);
  await openHome(page);
  const folders = [{ id: '00000000-0000-4000-8000-000000000001', workspace_id: 'w', parent_id: null, name: '가짜 폴더', sort_order: 1024, created_at: '2026-10-01T00:00:00Z' }];
  const rows = Array.from({ length: 6 }, (_, i) => ({ id: 'n' + i, workspace_id: 'w', kind: 'note', title: `가짜 노트 ${i}`, raw_text: '본문', occurred_at: `2026-10-0${i + 1}T01:00:00Z`, created_at: `2026-10-0${i + 1}T01:00:00Z`, updated_at: `2026-10-0${i + 1}T01:00:00Z`, archived_at: null, ai_export_allowed: true, attachments: [], metadata: {} }));
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', r => r.request().method() === 'GET' ? r.fulfill({ json: structuredClone(rows) }) : r.fulfill({ status: 500, json: {} }));
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_folders', r => r.request().method() === 'GET' ? r.fulfill({ json: structuredClone(folders) }) : r.fulfill({ status: 500, json: {} }));
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  const box = page.locator('[data-nx-recent] .ft-box');
  await expect(box.locator('[data-note-row]')).toHaveCount(5);
  await expectChev(box, true, '[data-nx-recent-fold]');
  await expect(box.locator('[data-nx-recent-more]')).toHaveText('펼치기 ›');
  await box.locator('[data-nx-recent-fold]').click();
  await expect(box.locator('[data-note-row]')).toHaveCount(0);
  await expectChev(box, false, '[data-nx-recent-fold]');
  await expect(box.locator('[data-nx-recent-more]')).toHaveCount(0);
  await expect.poll(() => prefs.value?.recent_folded).toEqual(['notes']);
  await page.locator('[data-nx-recent] [data-nx-recent-fold]').click();
  await expect(page.locator('[data-nx-recent] [data-note-row]')).toHaveCount(5);
  await expect.poll(() => prefs.value?.recent_folded).toEqual([]);
  expect(errors).toEqual([]);
});

for (const width of [412, 884, 1280]) test(`자료실 ${width}: '최근 올린 파일' 머리 줄 접기 → 다시 열어도 접힘`, async ({ page }) => {
  const { bootLibrary } = await import('./helpers/library-folder-server.mjs');
  const prefs = await installViewPrefsServer(page);
  const { errors } = await bootLibrary(page, width);
  const box = page.locator('#libraryRecent');
  await expect(box.locator('[data-lu-recent]').first()).toBeVisible();
  await expectChev(box, true, '[data-lu-recent-fold]');
  // 이 가짜 자료는 최근 파일이 적어 '더보기'가 없다(있으면 '펼치기 ›').
  for (const m of await box.locator('[data-lu-recent-more]').all()) await expect(m).toHaveText('펼치기 ›');
  await box.locator('[data-lu-recent-fold]').click();
  await expect(box.locator('[data-lu-recent]')).toHaveCount(0);
  await expectChev(box, false, '[data-lu-recent-fold]');
  await expect(box.locator('[data-lu-recent-fold]')).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(() => prefs.value?.recent_folded).toEqual(['library']);
  await page.reload();
  await expect(page.locator('#libraryRecent [data-lu-recent-fold]')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#libraryRecent [data-lu-recent]')).toHaveCount(0);
  await page.locator('#libraryRecent [data-lu-recent-fold]').click();
  await expect(page.locator('#libraryRecent [data-lu-recent]').first()).toBeVisible();
  await page.screenshot({ path: `test-results/recent-fold-library-${width}.png` });
  expect(errors).toEqual([]);
});
