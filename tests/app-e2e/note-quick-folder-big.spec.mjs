import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';

// S66-06 NOTE-폴더고른뒤크게(명진 11/18 17:47, 폰 폴드 접은 화면·폰 앱): 노트 [목록] 보기에서 입력 줄 [폴더 ▾]로 폴더를 고른 뒤
// ① [⤢ 크게]를 누르면 노트 쓰기 창이 그 폴더로 열려야 하고 ② 입력칸을 누르면 [목록] 보기 그대로(화면을 다시 그리지 않음)여야 한다.
// 폴더를 고르지 않은 경우(지금 잘 되는 길)도 같은 기대로 함께 본다. 가짜 자료만 쓴다. 폰 412 · PC 1280.
test.use({ hasTouch: true });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function fixture(page, width) {
  await page.setViewportSize({ width, height: 900 });
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
  await press(page, page.locator('#luMovePicker .lu-move-item', { hasText: '00. 잊지 말기' }), width);
  await expect(page.locator('#luMovePicker')).toBeHidden();
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
    await expect(q(page, '[data-quick-folder]')).toContainText(picked ? '00. 잊지' : '폴더 없음');
    expect(f.errors).toEqual([]);
  });
}
