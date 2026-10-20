import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { notePreview, plainLines, noteCopyPayload } from '../../app/note-preview.mjs';

// UI-노트메뉴정리: every note row has [복사] and [⋯] on its right; the ⋯ (list row and open note alike) holds 고정/고정 해제 · 수정 ·
// (연결하기 · 바구니로 돌리기, open note only) · 삭제, and opens right under the pressed ⋯ (anchored-popup.js). The open note's head
// is one line "‹ 노트 … 제목 … [복사] [⋯]"; [수정]·[연결하기] are no longer buttons under the body. Rows show plain-letter previews
// without a repeated title, and a note with only attachments copies their file names.
test.use({ hasTouch: true });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
async function fixture(page, width) {
  await page.setViewportSize({ width, height: 900 });
  const errors = [], writes = [], deletes = [];
  page.on('pageerror', e => errors.push(e.message + ' ' + (e.stack || '').split('\n').slice(0, 4).join(' | ')));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await openHome(page);
  await page.addInitScript(() => {});
  await page.evaluate(() => { window.__copied = []; const w = async text => { window.__copied.push(text); }; try { Object.defineProperty(navigator, 'clipboard', { value: { writeText: w, write: async items => { for (const i of items) { const b = await i.getType('text/plain'); window.__copied.push(await b.text()); } } }, configurable: true }); } catch {} });
  const row = (id, title, raw_text, updated_at, extra = {}) => ({ id, workspace_id: 'w', kind: 'note', title, raw_text, occurred_at: updated_at, created_at: updated_at, updated_at, archived_at: null, ai_export_allowed: true, attachments: [], metadata: {}, ...extra });
  const rows = [
    row('n-md', '정리 노트', '# 정리 노트\n\n## 쟁점\n\n- **기본급** 인상\n```\ncode line\n```\n[링크](https://example.com/a)', '2026-10-16T01:00:00Z'),
    row('n-plain', '평범한 노트', '둘째 줄 글', '2026-10-12T01:00:00Z'),
    row('n-file', '첨부 노트', '', '2026-10-10T01:00:00Z', { attachments: [{ drive_file_id: 'f1', file_name: '회의록.hwp', mime_type: 'application/x-hwp', size_bytes: 2048 }, { drive_file_id: 'f2', file_name: '표.xlsx', mime_type: 'application/vnd.ms-excel', size_bytes: 100 }] }),
    row('n-empty', '', '', '2026-10-01T01:00:00Z'),
  ];
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams;
    const pick = x => (!q.get('kind') || 'eq.' + x.kind === q.get('kind')) && (!q.get('id') || 'eq.' + x.id === q.get('id'))
      && (!q.get('updated_at') || 'eq.' + x.updated_at === q.get('updated_at'))
      && (!q.has('metadata->>pinned_at') || (q.get('metadata->>pinned_at') === 'is.null' ? x.metadata.pinned_at == null : 'eq.' + x.metadata.pinned_at === q.get('metadata->>pinned_at')));
    if (req.method() === 'GET') { if (q.get('metadata')) return r.fulfill({ json: [] }); return r.fulfill({ json: rows.filter(pick).slice(Number(q.get('offset') || 0)) }); }
    if (req.method() === 'PATCH') { const body = req.postDataJSON(); writes.push({ query: Object.fromEntries(q), body }); const hit = rows.filter(pick); hit.forEach(x => Object.assign(x, body)); return r.fulfill({ json: hit }); }
    if (req.method() === 'DELETE') { const hit = rows.filter(pick); deletes.push(Object.fromEntries(q)); hit.forEach(x => rows.splice(rows.indexOf(x), 1)); return r.fulfill({ json: hit }); }
    return r.fulfill({ status: 500, json: {} });
  });
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await page.locator('[data-basket-kind="note"]').click();
  await expect(page.locator('[data-note-row]')).toHaveCount(4);
  return { rows, writes, deletes, errors };
}
const press = async (page, l, width) => { await expect(l).toBeVisible(); if (width < 761) await l.tap(); else await l.click(); };
const menu = page => page.locator('#noteDocMenu');
const rowMore = (page, id) => page.locator(`[data-note-row-more="${id}"]`);
const copied = page => page.evaluate(() => window.__copied.at(-1));

test('preview helpers: plain letters, no repeated title, file-name copy', () => {
  expect(plainLines('# 제목\n\n- **굵게** 와 `코드`\n> 인용\n---\n```js\nlet a\n```\n| a | b |\n| --- | --- |\n| 1 | 2 |\n[링크](https://x.y) ![그림](a.png)')).toEqual(['제목', '굵게 와 코드', '인용', 'let a', 'a b', '1 2', '링크 그림']);
  expect(notePreview({ title: '정리', raw_text: '# 정리\n\n본문 글' })).toEqual({ shown: '정리', preview: '본문 글' });
  expect(notePreview({ title: '', raw_text: '## 첫 줄\n둘째' })).toEqual({ shown: '첫 줄', preview: '둘째' });
  expect(notePreview({ title: '다른 제목', raw_text: '본문 하나' })).toEqual({ shown: '다른 제목', preview: '본문 하나' });
  expect(notePreview({ title: '', raw_text: '' })).toEqual({ shown: '노트', preview: '' });
  expect(noteCopyPayload({ title: '첨부', raw_text: '', attachments: [{ file_name: 'a.hwp' }, { file_name: 'b.pdf' }] })).toMatchObject({ text: 'a.hwp\nb.pdf', done: '첨부 이름을 복사했습니다' });
  expect(noteCopyPayload({ title: '', raw_text: '', attachments: [] })).toBeNull();
});

for (const width of [390, 1280]) {
  test(`list row ⋯: items and order, opens under the pressed ⋯, Esc and outside press close ${width}`, async ({ page }, info) => {
    const f = await fixture(page, width);
    const more = rowMore(page, 'n-plain');
    const mb = await more.boundingBox();
    expect(mb.width).toBeGreaterThanOrEqual(44); expect(mb.height).toBeGreaterThanOrEqual(44);
    // [복사] sits left of [⋯], both on the right side of the row.
    const cb = await page.locator('[data-note-row-copy="n-plain"]').boundingBox();
    expect(cb.x + cb.width).toBeLessThanOrEqual(mb.x + 1); const rb = await page.locator('[data-note-row="n-plain"]').boundingBox(); expect(mb.x + mb.width).toBeGreaterThan(rb.x + rb.width - 8);
    await press(page, more, width);
    await expect(menu(page)).toBeVisible(); await expect(more).toHaveAttribute('aria-expanded', 'true');
    await expect(menu(page).locator('button')).toHaveText(['고정', '수정', '삭제']);
    const m = await menu(page).boundingBox();
    expect(m.y).toBeGreaterThanOrEqual(mb.y + mb.height - 1); expect(m.y - (mb.y + mb.height)).toBeLessThanOrEqual(12);
    expect(m.x).toBeGreaterThanOrEqual(0); expect(m.x + m.width).toBeLessThanOrEqual(width);
    expect(m.x).toBeLessThanOrEqual(mb.x + mb.width); expect(m.x + m.width).toBeGreaterThanOrEqual(mb.x);
    await expect(menu(page).locator('button').first()).toBeFocused();
    await page.screenshot({ path: info.outputPath(`note-row-menu-${width}.png`) });
    await page.keyboard.press('Escape');
    await expect(menu(page)).toBeHidden(); await expect(more).toBeFocused(); await expect(more).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('[data-note-detail]')).toBeHidden();
    // Outside press closes it without opening anything.
    await press(page, more, width); await expect(menu(page)).toBeVisible();
    await page.locator('[data-note-list-status]').click({ force: true });
    await expect(menu(page)).toBeHidden(); await expect(page.locator('[data-note-detail]')).toBeHidden();
    // A second ⋯ moves the menu; the first one is closed.
    await press(page, more, width); await press(page, rowMore(page, 'n-md'), width);
    await expect(menu(page)).toBeVisible(); await expect(more).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Escape');
    expect(f.writes).toEqual([]); expect(f.errors).toEqual([]);
  });

  test(`list row ⋯: pin and unpin, edit opens the edit view, delete asks first and removes the row ${width}`, async ({ page }) => {
    const f = await fixture(page, width);
    // 고정 → on top; the menu then says 고정 해제.
    await press(page, rowMore(page, 'n-plain'), width); await press(page, menu(page).getByRole('button', { name: '고정', exact: true }), width);
    await expect(page.locator('#toast')).toHaveText('노트를 맨 위에 고정했어요.');
    expect(f.writes).toHaveLength(1); expect(Object.keys(f.writes[0].body)).toEqual(['metadata']);
    expect(await page.locator('[data-note-row] .basket-title-text').first().textContent()).toBe('평범한 노트');
    await expect(page.locator('[data-note-row="n-plain"] [data-note-pinned]')).toBeVisible();
    await expect(page.locator('[data-note-detail]')).toBeHidden();
    await press(page, rowMore(page, 'n-plain'), width);
    await expect(menu(page).locator('button').first()).toHaveText('고정 해제');
    await press(page, menu(page).getByRole('button', { name: '고정 해제', exact: true }), width);
    await expect(page.locator('#toast')).toHaveText('고정을 풀었어요.');
    expect(f.writes[1].body.metadata).toEqual({});
    // 수정 → that note's edit view.
    await press(page, rowMore(page, 'n-md'), width); await press(page, menu(page).getByRole('button', { name: '수정', exact: true }), width);
    await expect(page.locator('[data-note-editor]')).toBeVisible(); await expect(page.locator('[data-note-title-input]')).toHaveValue('정리 노트');
    await press(page, page.locator('[data-note-cancel]'), width); await press(page, page.locator('[data-note-close]'), width);
    // 삭제 → a confirmation naming what goes with it; cancel keeps the note, accept removes it.
    let asked = 0; page.once('dialog', d => { asked++; d.dismiss(); });
    await press(page, rowMore(page, 'n-plain'), width); await press(page, menu(page).getByRole('button', { name: '삭제', exact: true }), width);
    await expect.poll(() => asked).toBe(1);
    await expect(page.locator('[data-note-row="n-plain"]')).toBeVisible(); expect(f.deletes).toEqual([]);
    await expect(rowMore(page, 'n-plain')).toBeFocused();
    page.once('dialog', d => { expect(d.message()).toContain('원문을 지웁니다'); d.accept(); });
    await press(page, rowMore(page, 'n-plain'), width); await press(page, menu(page).getByRole('button', { name: '삭제', exact: true }), width);
    await expect(page.locator('[data-note-row="n-plain"]')).toHaveCount(0);
    expect(f.deletes).toHaveLength(1); expect(f.deletes[0]).toMatchObject({ id: 'eq.n-plain' });
    await expect(page.locator('[data-note-list-status]')).toContainText('지웠어요');
    expect(f.errors).toEqual([]);
  });

  test(`open note: one head line ‹ 노트 … 제목 … 복사 ⋯, no [수정][연결하기] under the body, they are in the ⋯ ${width}`, async ({ page }, info) => {
    const f = await fixture(page, width);
    await press(page, page.locator('[data-note-row="n-md"]'), width);
    const detail = page.locator('[data-note-detail]');
    await expect(detail.locator('[data-note-read-title]')).toHaveText('정리 노트');
    const back = await detail.locator('[data-note-close]').boundingBox(), title = await detail.locator('[data-note-read-title]').boundingBox();
    const copy = await detail.locator('[data-note-telegram]').boundingBox(), more = await detail.locator('[data-note-more]').boundingBox();
    // One line: the same top band, left to right back · title · copy · ⋯.
    for (const b of [title, copy, more]) expect(Math.abs((b.y + b.height / 2) - (back.y + back.height / 2))).toBeLessThanOrEqual(12);
    expect(back.x + back.width).toBeLessThanOrEqual(title.x + 1); expect(title.x + title.width).toBeLessThanOrEqual(copy.x + 1); expect(copy.x + copy.width).toBeLessThanOrEqual(more.x + 1);
    const dbox = await detail.boundingBox(); expect(more.x + more.width).toBeGreaterThan(dbox.x + dbox.width - 8);
    // The ⋯ has no frame; the old corner box ⋯ with a border is gone and nothing sits below the body.
    expect(await detail.locator('[data-note-more]').evaluate(el => { const s = getComputedStyle(el); return [s.borderTopWidth, s.borderLeftWidth, s.backgroundColor]; })).toEqual(['0px', '0px', 'rgba(0, 0, 0, 0)']);
    await expect(detail.locator('[data-note-read-actions]')).toHaveCount(0);
    for (const name of ['수정', '연결하기']) await expect(detail.getByRole('button', { name, exact: true })).toHaveCount(0);
    // The connection state stays under the body.
    await expect(detail.locator('[data-note-meta]')).toContainText('연결 없음');
    await press(page, detail.locator('[data-note-more]'), width);
    await expect(menu(page).locator('button')).toHaveText(['고정', '수정', '연결하기', '바구니로 돌리기', '삭제']);
    const mm = await menu(page).boundingBox();
    expect(mm.y).toBeGreaterThanOrEqual(more.y + more.height - 1); expect(mm.x + mm.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: info.outputPath(`note-detail-menu-${width}.png`) });
    await page.keyboard.press('Escape');
    await expect(menu(page)).toBeHidden(); await expect(detail.locator('[data-note-more]')).toBeFocused(); await expect(detail).toBeVisible();
    // 연결하기 in the ⋯ opens the link form; closing it returns to the ⋯.
    await press(page, detail.locator('[data-note-more]'), width); await press(page, menu(page).getByRole('button', { name: '연결하기', exact: true }), width);
    await expect(detail.locator('[data-manual-link]')).toBeVisible();
    await page.keyboard.press('Escape'); await expect(detail.locator('[data-manual-link]')).toHaveCount(0);
    await expect(detail.locator('[data-note-more]')).toBeFocused();
    // 수정 in the ⋯ opens the edit view and the head's copy/⋯ give way to the edit buttons.
    await press(page, detail.locator('[data-note-more]'), width); await press(page, menu(page).getByRole('button', { name: '수정', exact: true }), width);
    await expect(detail.locator('[data-note-editor]')).toBeVisible(); await expect(detail.locator('[data-note-more]')).toBeHidden();
    await press(page, detail.locator('[data-note-cancel]'), width); await expect(detail.locator('[data-note-more]')).toBeVisible();
    // 삭제 from the open note goes back to the list.
    page.once('dialog', d => d.accept());
    await press(page, detail.locator('[data-note-more]'), width); await press(page, menu(page).getByRole('button', { name: '삭제', exact: true }), width);
    await expect(detail).toBeHidden(); await expect(page.locator('[data-note-row="n-md"]')).toHaveCount(0);
    expect(f.deletes).toHaveLength(1);
    expect(f.errors).toEqual([]);
  });

  test(`rows: plain preview without marks or a repeated title, and attachment-only notes copy their file names ${width}`, async ({ page }) => {
    const f = await fixture(page, width);
    const preview = id => page.locator(`[data-note-row="${id}"] .basket-preview`);
    // Title = body first line → the preview starts at the next line; no # * - ``` [] ().
    const text = await preview('n-md').textContent();
    expect(text).toBe('쟁점 기본급 인상 code line 링크');
    expect(text).not.toMatch(/[#*`\[\]()]|^-/);
    await expect(preview('n-plain')).toHaveText('둘째 줄 글');
    // Attachment-only note: the copy icon is there and copies the file names; an empty note has none.
    const fileCopy = page.locator('[data-note-row-copy="n-file"]');
    await expect(fileCopy).toBeVisible(); await press(page, fileCopy, width);
    await expect(page.locator('#toast')).toHaveText('첨부 이름을 복사했습니다');
    expect(await copied(page)).toBe('회의록.hwp\n표.xlsx');
    await expect(page.locator('[data-note-row-copy="n-empty"]')).toBeHidden();
    await expect(rowMore(page, 'n-empty')).toBeVisible();
    // Text notes copy as before (title first line, 텔레그램 conversion).
    await press(page, page.locator('[data-note-row-copy="n-plain"]'), width);
    await expect(page.locator('#toast')).toHaveText('복사했습니다');
    expect(await copied(page)).toBe('평범한 노트\n\n둘째 줄 글');
    // The row's right side never covers the title text: row text keeps clear of the two icons.
    const t = await page.locator('[data-note-row="n-plain"] .basket-title-text').boundingBox(), c = await page.locator('[data-note-row-copy="n-plain"]').boundingBox();
    expect(t.x + t.width).toBeLessThanOrEqual(c.x + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(f.writes).toEqual([]); expect(f.errors).toEqual([]);
  });
}

test('PC: the row menu opens above the ⋯ when there is no room below, and follows scrolling', async ({ page }) => {
  const f = await fixture(page, 1280);
  await page.setViewportSize({ width: 1280, height: 420 });
  const more = rowMore(page, 'n-empty');
  await more.scrollIntoViewIfNeeded(); await more.click();
  await expect(menu(page)).toBeVisible();
  const mb = await more.boundingBox(), m = await menu(page).boundingBox();
  expect(m.y + m.height).toBeLessThanOrEqual(420); expect(m.y).toBeGreaterThanOrEqual(0);
  expect(m.y >= mb.y + mb.height - 1 || m.y + m.height <= mb.y + 1 || m.x >= mb.x + mb.width - 1 || m.x + m.width <= mb.x + 1).toBe(true);
  expect(f.errors).toEqual([]);
});
