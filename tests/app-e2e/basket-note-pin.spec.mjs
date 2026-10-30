import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { closeNote } from './helpers/note-close.mjs';

// UI-노트고정: [고정] in a note's ⋯ puts it on top of the note list (most recently pinned first); [고정 풀기] returns it to
// last-change order. Stored in the existing metadata jsonb (metadata.pinned_at) by an owner-RLS PATCH of metadata only;
// the note's "고친 날" (updated_at) and its text are not changed. Phone 390 and PC 1280, touch and keyboard.
test.use({ hasTouch: true });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
async function fixture(page, width) {
  await page.setViewportSize({ width, height: 900 });
  const errors = [], writes = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await openHome(page);
  const row = (id, title, updated_at, metadata = {}) => ({ id, workspace_id: 'w', kind: 'note', title, raw_text: title + ' 본문', occurred_at: updated_at, created_at: updated_at, updated_at, archived_at: null, ai_export_allowed: true, attachments: [], metadata });
  const rows = [row('n-new', '최근 노트', '2026-10-16T01:00:00Z'), row('n-mid', '중간 노트', '2026-10-10T01:00:00Z', { tasks: [] }), row('n-old', '오래된 노트', '2026-10-01T01:00:00Z')];
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams;
    const pick = x => (!q.get('kind') || 'eq.' + x.kind === q.get('kind')) && (!q.get('id') || 'eq.' + x.id === q.get('id'))
      && (!q.get('updated_at') || 'eq.' + x.updated_at === q.get('updated_at'))
      && (!q.has('metadata->>pinned_at') || (q.get('metadata->>pinned_at') === 'is.null' ? x.metadata.pinned_at == null : 'eq.' + x.metadata.pinned_at === q.get('metadata->>pinned_at')));
    if (req.method() === 'GET') { if (q.get('metadata')) return r.fulfill({ json: [] }); return r.fulfill({ json: rows.filter(pick).slice(Number(q.get('offset') || 0)) }); }
    if (req.method() === 'PATCH') { const body = req.postDataJSON(); writes.push({ query: Object.fromEntries(q), body }); const hit = rows.filter(pick); hit.forEach(x => Object.assign(x, body)); return r.fulfill({ json: hit }); }
    return r.fulfill({ status: 500, json: {} });
  });
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page,'note');
  await expect(page.locator('[data-note-row]')).toHaveCount(3);
  return { rows, writes, errors };
}
const order = page => page.locator('[data-note-row] .basket-title-text').allTextContents();
const press = async (page, l, width) => { await expect(l).toBeVisible(); if (width < 761) await l.tap(); else await l.click(); };

for (const width of [390, 1280]) test(`pin a note to the top of the list and unpin it ${width}`, async ({ page }, info) => {
  const f = await fixture(page, width);
  expect(await order(page)).toEqual(['최근 노트', '중간 노트', '오래된 노트']);
  // Pin the oldest note from its ⋯ menu.
  await press(page, page.locator('[data-note-row="n-old"]'), width);
  await press(page, page.locator('[data-note-more]'), width);
  const pin = page.locator('#noteDocMenu [data-note-pin]');
  await expect(pin).toHaveText('고정');
  await press(page, pin, width);
  await expect(page.locator('#toast')).toHaveText('노트를 맨 위에 고정했어요.');
  expect(f.writes).toHaveLength(1);
  expect(Object.keys(f.writes[0].body)).toEqual(['metadata']);
  expect(f.writes[0].query).toMatchObject({ id: 'eq.n-old', kind: 'eq.note', updated_at: 'eq.2026-10-01T01:00:00Z', 'metadata->>pinned_at': 'is.null' });
  expect(Date.parse(f.writes[0].body.metadata.pinned_at)).toBeGreaterThan(0);
  expect(f.rows.find(r => r.id === 'n-old').updated_at).toBe('2026-10-01T01:00:00Z');
  await closeNote(page);
  expect(await order(page)).toEqual(['오래된 노트', '최근 노트', '중간 노트']);
  await expect(page.locator('[data-note-row="n-old"] [data-note-pinned]')).toBeVisible();
  await expect(page.locator('[data-note-row="n-old"]')).toContainText('10.01'); // NOTE-탐색기 ②: one-line date (MM.DD)
  await page.screenshot({ path: info.outputPath(`note-pin-${width}.png`) });
  // Pin a second note by keyboard: the most recently pinned goes on top; other metadata keys stay.
  await page.locator('[data-note-row="n-mid"]').focus(); await page.keyboard.press('Enter');
  await page.locator('[data-note-more]').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#noteDocMenu [data-note-pin]')).toBeVisible();
  await page.locator('#noteDocMenu [data-note-pin]').focus(); await page.keyboard.press('Enter');
  await expect.poll(() => f.writes.length).toBe(2);
  expect(f.writes[1].body.metadata).toMatchObject({ tasks: [] });
  await expect(page.locator('#toast')).toHaveText('노트를 맨 위에 고정했어요.');
  await closeNote(page);
  await expect(page.locator('[data-note-detail]')).toBeHidden();
  expect(await order(page)).toEqual(['중간 노트', '오래된 노트', '최근 노트']);
  // Unpin: back to last-change order, the pin key removed.
  await press(page, page.locator('[data-note-row="n-old"]'), width);
  await press(page, page.locator('[data-note-more]'), width);
  await expect(page.locator('#noteDocMenu [data-note-pin]')).toHaveText('고정 풀기');
  await press(page, page.locator('#noteDocMenu [data-note-pin]'), width);
  await expect(page.locator('#toast')).toHaveText('고정을 풀었어요.');
  expect(f.writes[2].body.metadata).toEqual({});
  await closeNote(page);
  expect(await order(page)).toEqual(['중간 노트', '최근 노트', '오래된 노트']);
  await expect(page.locator('[data-note-row="n-old"] [data-note-pinned]')).toHaveCount(0);
  expect(f.errors).toEqual([]);
});

test('a note changed elsewhere is not overwritten by pinning', async ({ page }) => {
  const f = await fixture(page, 390);
  await page.locator('[data-note-row="n-new"]').tap();
  // Another device edits the note after this screen read it, before the pin's own read: the guarded PATCH must match the fresh row.
  f.rows.find(r => r.id === 'n-new').updated_at = '2026-10-17T01:00:00Z';
  await page.locator('[data-note-more]').tap(); await page.locator('#noteDocMenu [data-note-pin]').tap();
  await expect(page.locator('#toast')).toHaveText('노트를 맨 위에 고정했어요.');
  expect(f.writes[0].query.updated_at).toBe('eq.2026-10-17T01:00:00Z');
  expect(f.errors).toEqual([]);
});
