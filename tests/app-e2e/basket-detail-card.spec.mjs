import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { basketKindButton } from './helpers/basket-kind.mjs';

// UI-바구니상세개편: an update's detail is one card — text (with a small 원문 toggle and [복사] beside it), state·time,
// attachments (photo previews through the owner-only basket-files photo view, a kind mark for other files, small text links
// with icons), then [연결하기]·[할 일 만들기]·[노트로 옮기기] in one row inside the card. [복사] on every update and note row
// and in both read views copies the 텔레그램 conversion and says "복사했습니다" in a passing notice. [노트로 옮기기] moves at
// once (no title form), and a note without a title shows the start of its body in the list. Phone 390 and PC 1280.
test.use({ hasTouch: true });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co', stamp = '2026-10-06T01:00:00Z';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const U = '10000000-0000-4000-8000-000000000001';
const files = [
  { drive_file_id: 'drive-photo', file_name: '현수막.jpg', mime_type: 'image/jpeg', size_bytes: 123456 },
  { drive_file_id: 'drive-hwp', file_name: '요구안.hwp', mime_type: 'application/x-hwp', size_bytes: 2048 },
  { drive_file_id: 'drive-pdf', file_name: '공문.pdf', mime_type: 'application/pdf', size_bytes: 3 * 1048576 },
];
async function fixture(page, width) {
  await page.setViewportSize({ width, height: 900 });
  const errors = [], writes = [], photos = [], external = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await openHome(page);
  const rows = [
    { id: U, workspace_id: 'w', kind: 'basket', title: null, raw_text: '**교섭** 결과 공유\n- 다음 회의 10/27', occurred_at: stamp, created_at: stamp, updated_at: stamp, archived_at: null, ai_export_allowed: true, attachments: files, metadata: {} },
    { id: 'n-titled', workspace_id: 'w', kind: 'note', title: '정리 노트', raw_text: '## 쟁점\n\n- **기본급**', occurred_at: stamp, created_at: stamp, updated_at: '2026-10-05T01:00:00Z', archived_at: null, ai_export_allowed: true, attachments: [], metadata: {} },
  ];
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams;
    const pick = row => (!q.get('kind') || 'eq.' + row.kind === q.get('kind')) && (!q.get('id') || 'eq.' + row.id === q.get('id'));
    if (req.method() === 'GET') { if (q.get('metadata')) return r.fulfill({ json: [] }); return r.fulfill({ json: rows.filter(pick).slice(Number(q.get('offset') || 0)) }); }
    if (req.method() === 'PATCH') {
      const body = req.postDataJSON(); writes.push({ query: Object.fromEntries(q), body });
      const hit = rows.filter(pick);
      for (const row of hit) { const next = { ...row, ...body }; if (next.kind === 'note' && !String(next.title || '').trim()) return r.fulfill({ status: 400, json: { code: '23514' } }); Object.assign(row, next); }
      return r.fulfill({ json: hit });
    }
    return r.fulfill({ status: 500, json: {} });
  });
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  await page.route(SB + '/rest/v1/app_documents?**', r => r.fulfill({ json: [] }));
  await page.route(SB + '/functions/v1/basket-files?**', r => {
    const u = new URL(r.request().url()); photos.push(Object.fromEntries(u.searchParams));
    return r.fulfill({ status: 200, contentType: 'image/png', body: PNG });
  });
  await page.route(u => !['127.0.0.1', new URL(SB).hostname].includes(u.hostname), r => { external.push(r.request().url()); return r.abort(); });
  await page.evaluate(() => { window.__copied = []; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async t => window.__copied.push(t), write: async () => {} } }); });
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await expect(page.locator(`[data-basket-row="${U}"]`)).toBeVisible();
  return { rows, writes, photos, errors, external };
}
const press = async (page, locator, width) => { await expect(locator).toBeVisible(); if (width < 761) await locator.tap(); else await locator.click(); };
const toast = page => page.locator('#toast');
const copied = page => page.evaluate(() => window.__copied.at(-1));

for (const width of [390, 1280]) {
  test(`update detail is one card with photo preview, small file links and one action row ${width}`, async ({ page }, info) => {
    const f = await fixture(page, width);
    await press(page, page.locator(`[data-basket-row="${U}"]`), width);
    const card = page.locator('[data-basket-detail] [data-basket-card]');
    await expect(card).toBeVisible();
    // Everything sits inside the one card: text, state·time, files, then the action row.
    for (const part of ['[data-basket-read-text]', '.basket-note-meta', '[data-basket-attachments]', '[data-basket-read-actions]']) await expect(card.locator(part)).toBeVisible();
    const box = await card.boundingBox(), y = async sel => (await card.locator(sel).boundingBox()).y;
    expect(await y('[data-basket-read-text]')).toBeLessThan(await y('.basket-note-meta'));
    expect(await y('.basket-note-meta')).toBeLessThan(await y('[data-basket-attachments]'));
    expect(await y('[data-basket-attachments]')).toBeLessThan(await y('[data-basket-read-actions]'));
    const actions = card.locator('[data-basket-read-actions] button');
    await expect(actions).toHaveText(['연결하기', '할 일 만들기', '노트로 옮기기']);
    const ab = await Promise.all((await actions.all()).map(b => b.boundingBox()));
    for (const b of ab) { expect(Math.round(b.y)).toBe(Math.round(ab[0].y)); expect(b.y + b.height).toBeLessThanOrEqual(box.y + box.height); }
    // ⋯ keeps 수정·보관·삭제 only.
    await press(page, page.locator('[data-basket-note-more]'), width);
    await expect(page.locator('#basketNoteMenu button')).toHaveText(['수정', '보관', '업무일지에 남기기', '삭제']);
    await page.keyboard.press('Escape');
    // Photo: a small preview through the owner-only photo view (never a public or Drive share address).
    const photo = card.locator('[data-basket-file-card="drive-photo"]');
    const thumb = photo.getByRole('button', { name: '현수막.jpg 크게 보기' });
    await expect(thumb.locator('img')).toBeVisible();
    await expect(thumb.locator('img')).toHaveAttribute('src', /^blob:/);
    const tb = await thumb.boundingBox(); expect(tb.width).toBe(56); expect(tb.height).toBe(56);
    expect(f.photos).toContainEqual({ action: 'photo', note_id: U, file_id: 'drive-photo', size: 'small' });
    // Other files: their kind instead of a picture.
    await expect(card.locator('[data-basket-file-card="drive-hwp"] .file-kind')).toHaveText('HWP');
    await expect(card.locator('[data-basket-file-card="drive-pdf"] .file-kind')).toHaveText('PDF');
    // Size in KB/MB; small text links with an icon under the name and size, 44px to press.
    await expect(photo.locator('.basket-file-meta')).toHaveText('120.6 KB');
    await expect(card.locator('[data-basket-file-card="drive-pdf"] .basket-file-meta')).toHaveText('3.0 MB');
    await expect(card.locator('[data-basket-file-card="drive-hwp"] .basket-file-links > *')).toHaveText(['Drive에서 열기', '자료실로 보내기', '편집']);
    const nameBox = await photo.locator('.basket-file-meta').boundingBox();
    for (const link of await photo.locator('.basket-file-link').all()) {
      const b = await link.boundingBox(); expect(b.y).toBeGreaterThanOrEqual(nameBox.y + nameBox.height - 1); expect(b.height).toBeGreaterThanOrEqual(44);
      expect(await link.evaluate(el => [getComputedStyle(el).fontSize, !!el.querySelector('svg')])).toEqual(['12px', true]);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`detail-card-${width}.png`), fullPage: true });
    // Press the preview: the large photo, closed by × (and focus returns to the preview).
    await press(page, thumb, width);
    const view = page.locator('[data-basket-photo-view]');
    await expect(view).toBeVisible(); await expect(view.locator('img')).toBeVisible();
    expect(f.photos).toContainEqual({ action: 'photo', note_id: U, file_id: 'drive-photo', size: 'large' });
    await press(page, view.getByRole('button', { name: '크게 보기 닫기' }), width);
    await expect(view).toHaveCount(0); await expect(thumb).toBeFocused();
    // Esc and phone Back close it too, without leaving the update.
    await thumb.press('Enter'); await expect(view).toBeVisible(); await page.keyboard.press('Escape'); await expect(view).toHaveCount(0);
    await thumb.press('Enter'); await expect(view).toBeVisible(); await page.goBack(); await expect(view).toHaveCount(0); await expect(card).toBeVisible();
    expect(f.writes).toEqual([]); expect(f.external).toEqual([]); expect(f.errors).toEqual([]);
  });

  test(`[복사] on rows and in read views, 원문 toggle, and a notice that goes away ${width}`, async ({ page }) => {
    const f = await fixture(page, width);
    // List row: [복사] copies the 텔레그램 conversion without opening the update.
    const rowCopy = page.locator(`[data-basket-row-copy="${U}"]`);
    await expect(rowCopy).toHaveAttribute('aria-label', /복사$/);
    if (width >= 761) {
      await expect(rowCopy).toHaveAccessibleName(/복사$/);
      const rb = await rowCopy.boundingBox(); expect(rb.width).toBeGreaterThanOrEqual(44); expect(rb.height).toBeGreaterThanOrEqual(44);
      await press(page, rowCopy, width);
    } else {
      // UI-모바일노트복사메뉴: on a phone the row's [복사] is the first item of its ⋯ menu.
      await expect(rowCopy).toBeHidden();
      await press(page, page.locator(`[data-basket-row-more="${U}"]`), width);
      await expect(page.locator('#basketRowMenu button').first()).toHaveText('복사');
      await press(page, page.locator('#basketRowMenu').getByRole('button', { name: '복사', exact: true }), width);
    }
    await expect(toast(page)).toHaveText('복사했습니다'); await expect(toast(page)).not.toHaveClass(/hidden/);
    expect(await copied(page)).toBe('교섭 결과 공유\n• 다음 회의 10/27');
    await expect(page.locator('[data-basket-detail]')).toBeHidden();
    await expect(toast(page)).toHaveClass(/hidden/, { timeout: 5000 });
    // Detail: the same copy beside the text; the 원문 toggle is a small icon (formatted by default).
    await press(page, page.locator(`[data-basket-row="${U}"]`), width);
    const detail = page.locator('[data-basket-detail]'), read = detail.locator('[data-basket-read-text]'), raw = detail.locator('[data-basket-read-raw]');
    await expect(read.locator('strong')).toHaveText('교섭');
    await expect(raw).toHaveAttribute('aria-pressed', 'false'); await expect(raw).toHaveAccessibleName('원문 그대로 보기');
    const textBox = await read.boundingBox(), rawBox = await raw.boundingBox();
    expect(rawBox.y).toBeLessThan(textBox.y + 30); expect(rawBox.width).toBe(44);
    await press(page, raw, width);
    await expect(read).toHaveText('**교섭** 결과 공유\n- 다음 회의 10/27'); await expect(raw).toHaveAttribute('aria-pressed', 'true');
    await press(page, raw, width); await expect(read.locator('strong')).toHaveText('교섭');
    await page.evaluate(() => { window.__copied.length = 0; });
    await press(page, detail.getByRole('button', { name: '복사', exact: true }), width);
    await expect(toast(page)).toHaveText('복사했습니다'); expect(await copied(page)).toBe('교섭 결과 공유\n• 다음 회의 10/27');
    // Notes: the row and the read view copy the same way (title as the first line).
    await press(page, page.locator('[data-basket-close]'), width);
    await press(page, basketKindButton(page,'note'), width);
    if (width >= 761) await press(page, page.locator('[data-note-row-copy="n-titled"]'), width);
    else {
      await expect(page.locator('[data-note-row-copy="n-titled"]')).toBeHidden();
      await press(page, page.locator('[data-note-row-more="n-titled"]'), width);
      await press(page, page.locator('#noteDocMenu').getByRole('button', { name: '복사', exact: true }), width);
    }
    await expect(toast(page)).toHaveText('복사했습니다'); expect(await copied(page)).toBe('정리 노트\n\n쟁점\n\n• 기본급');
    await press(page, page.locator('[data-note-row="n-titled"]'), width);
    await page.evaluate(() => { window.__copied.length = 0; });
    await press(page, page.locator('[data-note-detail]').getByRole('button', { name: '복사', exact: true }), width);
    await expect(toast(page)).toHaveText('복사했습니다'); expect(await copied(page)).toBe('정리 노트\n\n쟁점\n\n• 기본급');
    expect(f.writes).toEqual([]); expect(f.errors).toEqual([]);
  });

  test(`[노트로 옮기기] moves at once, says so, opens the note; saving an edit is a passing notice ${width}`, async ({ page }) => {
    const f = await fixture(page, width);
    await press(page, page.locator(`[data-basket-row="${U}"]`), width);
    const detail = page.locator('[data-basket-detail]');
    // Saving an edit: the result is a notice, not a sentence left in the page.
    await press(page, page.locator('[data-basket-note-more]'), width); await press(page, page.locator('#basketNoteMenu [data-basket-edit]'), width);
    await detail.locator('[data-basket-text]').fill('교섭 결과 공유\n- 다음 회의 10/27');
    await press(page, detail.locator('[data-basket-save]'), width);
    await expect(toast(page)).toHaveText('수정한 글을 저장했습니다.'); await expect(detail.locator('[data-basket-status]')).toHaveText('');
    await expect(detail).not.toContainText('저장했습니다');
    // One press: no title form; the first line becomes the note's title (the database needs one), then the note opens.
    await press(page, detail.locator('[data-basket-read-actions] [data-basket-to-note]'), width);
    await expect(page.locator('[data-basket-to-note-form]')).toHaveCount(0);
    await expect(toast(page)).toHaveText('노트로 옮겼어요.');
    await expect(page.locator('[data-basket-kind="note"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-note-read-title]')).toHaveText('교섭 결과 공유');
    const move = f.writes.at(-1);
    expect(move.query).toMatchObject({ id: 'eq.' + U, kind: 'eq.basket' }); expect(move.body).toMatchObject({ kind: 'note', title: '교섭 결과 공유' });
    expect(f.rows.find(r => r.id === U).attachments).toHaveLength(3);
    expect(f.errors).toEqual([]);
  });

  test(`a note without a title shows its body start in the list, cut with … ${width}`, async ({ page }) => {
    const f = await fixture(page, width);
    // A note saved without a title elsewhere (older rows, other tools): the list shows the body's first line instead.
    f.rows.push({ id: 'n-untitled', workspace_id: 'w', kind: 'note', title: '', raw_text: '제목 없이 쓴 아주 긴 노트의 첫 줄입니다 '.repeat(4) + '\n둘째 줄', occurred_at: stamp, created_at: stamp, updated_at: '2026-10-06T02:00:00Z', archived_at: null, ai_export_allowed: true, attachments: [], metadata: {} });
    await press(page, basketKindButton(page,'note'), width);
    const title = page.locator('[data-note-row="n-untitled"] .basket-title-text');
    await expect(title).toHaveText(/^제목 없이 쓴 아주 긴 노트의 첫 줄입니다/);
    await expect(page.locator('[data-note-row="n-untitled"] .basket-preview')).toHaveText('둘째 줄');
    // One line, cut with … when it does not fit (the phone cuts it; PC has room for the 80 characters shown).
    expect(await title.evaluate(el => [getComputedStyle(el).textOverflow, getComputedStyle(el).whiteSpace])).toEqual(['ellipsis', 'nowrap']);
    if (width === 390) expect(await title.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
    expect((await title.boundingBox()).height).toBeLessThan(30);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(f.errors).toEqual([]);
  });
}
