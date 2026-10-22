import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { noteMenuAction } from './helpers/note-menu.mjs';
import { clickView } from './helpers/shell-navigation.mjs';
// UI-상단줄제목(1차 = 노트): on a PC (1024px~) the open note's title goes to the top line's place ("바구니 › 노트 › 제목") through
// kptu:where-item (same signal and renderer as 담당조직); closing the note or leaving the screen clears it; a title edit updates it;
// the note's head has no title line of its own there (the title input in the edit view stays). 390 keeps the head title and no top line.
// Titles and bodies are synthetic.
test.use({ hasTouch: true });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const LONG = '합성 아주 긴 노트 제목 '.repeat(12).trim();
async function fixture(page, width) {
  await page.setViewportSize({ width, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await openHome(page);
  const row = (id, title, raw_text, updated_at) => ({ id, workspace_id: 'w', kind: 'note', title, raw_text, occurred_at: updated_at, created_at: updated_at, updated_at, archived_at: null, ai_export_allowed: true, attachments: [], metadata: {} });
  const rows = [row('n-a', '합성 회의 준비 메모', '합성 본문 하나', '2026-10-16T01:00:00Z'), row('n-b', LONG, '합성 본문 둘', '2026-10-12T01:00:00Z')];
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams;
    const pick = x => (!q.get('kind') || 'eq.' + x.kind === q.get('kind')) && (!q.get('id') || 'eq.' + x.id === q.get('id')) && (!q.get('updated_at') || 'eq.' + x.updated_at === q.get('updated_at'));
    if (req.method() === 'GET') { if (q.get('metadata')) return r.fulfill({ json: [] }); return r.fulfill({ json: rows.filter(pick).slice(Number(q.get('offset') || 0)) }); }
    if (req.method() === 'PATCH') { const body = req.postDataJSON(); const hit = rows.filter(pick); hit.forEach(x => Object.assign(x, body, { updated_at: '2026-10-22T01:00:00Z' })); return r.fulfill({ json: hit }); }
    return r.fulfill({ status: 500, json: {} });
  });
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  await expect(page.locator('[data-note-row]')).toHaveCount(2);
  return { errors };
}
const where = page => page.locator('[data-topline-where]');
for (const width of [1280, 1440]) test(`PC ${width}: 노트를 열면 상단 줄 위치에 제목, 닫으면 지움, 제목 수정 반영, 본문 위 제목 줄 없음`, async ({ page }) => {
  const f = await fixture(page, width);
  await expect(where(page).locator('li')).toHaveText(['바구니', '노트']);
  await page.locator('[data-note-row="n-a"]').click();
  const detail = page.locator('[data-note-detail]');
  await expect(detail).toBeVisible();
  await expect(where(page).locator('li')).toHaveText(['바구니', '노트', '합성 회의 준비 메모']);
  await expect(where(page).locator('[aria-current="page"]')).toHaveText('합성 회의 준비 메모');
  // The title appears nowhere else above the body: no title element in the head; back · copy · ⋯ stay.
  await expect(detail.locator('[data-note-read-title]')).toHaveCount(0);
  await expect(detail.locator('.note-head-title')).toHaveCount(0);
  await expect(detail.locator('[data-note-close]')).toBeVisible();
  await expect(detail.locator('[data-note-more]')).toBeVisible();
  const dbox = await detail.boundingBox(), more = await detail.locator('[data-note-more]').boundingBox();
  expect(more.x + more.width).toBeGreaterThan(dbox.x + dbox.width - 8);
  // Edit the title: the edit field stays for editing; saving updates the place.
  await noteMenuAction(page, 'data-note-edit', { width });
  await expect(detail.locator('[data-note-title-input]')).toHaveValue('합성 회의 준비 메모');
  await detail.locator('[data-note-title-input]').fill('합성 회의 준비 메모 v2');
  await detail.locator('[data-note-save]').click();
  await expect(page.locator('#toast')).toContainText('노트를 저장했습니다.');
  await expect(where(page).locator('[aria-current="page"]')).toHaveText('합성 회의 준비 메모 v2');
  // Another screen: not shown there, and coming back to the basket (it opens on the list) shows no stale title.
  await clickView(page, 'home');
  await expect(where(page).locator('li')).toHaveText(['홈']);
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await expect(where(page).locator('li')).toHaveText(['바구니', '업데이트']);
  await chooseBasketKind(page, 'note');
  await expect(where(page).locator('li')).toHaveText(['바구니', '노트']);
  // Close: the place drops the title.
  await page.locator('[data-note-row="n-a"]').click();
  await expect(where(page).locator('[aria-current="page"]')).toHaveText('합성 회의 준비 메모 v2');
  await detail.locator('[data-note-close]').click();
  await expect(where(page).locator('li')).toHaveText(['바구니', '노트']);
  // A long title: one line with an ellipsis, the whole title on hover, the line does not wrap or grow.
  await page.locator('[data-note-row="n-b"]').click();
  const last = where(page).locator('[aria-current="page"]');
  await expect(last).toHaveText(LONG);
  await expect(last).toHaveAttribute('title', LONG);
  const fit = await last.evaluate(el => ({ clipped: el.scrollWidth > el.clientWidth, ellipsis: getComputedStyle(el).textOverflow, h: document.querySelector('.app-topline').getBoundingClientRect().height }));
  expect(fit.clipped).toBe(true); expect(fit.ellipsis).toBe('ellipsis'); expect(fit.h).toBeLessThan(60);
  // Switching to 업데이트 closes the note and clears the place.
  await page.locator('#appView > .app-nav [data-basket-kind-nav="memo"]:visible').first().click();
  await expect(where(page).locator('li')).toHaveText(['바구니', '업데이트']);
  expect(f.errors).toEqual([]);
});

test('390: 폰은 그대로 - 상단 줄 없음, 머리줄에 제목이 남는다', async ({ page }) => {
  const f = await fixture(page, 390);
  await page.locator('[data-note-row="n-a"]').tap();
  const detail = page.locator('[data-note-detail]');
  await expect(detail.locator('[data-note-read-title]')).toHaveText('합성 회의 준비 메모');
  await expect(page.locator('.app-topline')).toBeHidden();
  const [back, title, more] = await Promise.all(['[data-note-close]', '[data-note-read-title]', '[data-note-more]'].map(s => detail.locator(s).boundingBox()));
  expect(back.x + back.width).toBeLessThanOrEqual(title.x + 1); expect(title.x + title.width).toBeLessThanOrEqual(more.x + 1);
  expect(f.errors).toEqual([]);
});
