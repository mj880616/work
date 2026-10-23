import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { basketKindButton } from './helpers/basket-kind.mjs';
import { expectNoteTitle } from './helpers/note-title.mjs';

// UI-업데이트목록메뉴: every update row has [복사] and [⋯] at its top right (same look and behavior as the note rows, UI-노트메뉴정리).
// The ⋯ holds 수정 · 연결하기 · 할 일 만들기 · 노트로 옮기기 · 삭제 (삭제 last, danger color) and opens right under the pressed ⋯.
// Esc (focus back to the ⋯), an outside press or choosing an item closes it; only one is open at a time. Each item reuses the
// update detail's own path: 수정 opens the detail in edit mode, 연결하기·할 일 만들기 open the detail with that panel open,
// 노트로 옮기기 asks once then moves like the detail's button, 삭제 is the detail's delete (same confirmation, server note-delete).
// Pressing the row itself still opens the detail; pressing ⋯ or [복사] does not. Phone 390 and PC 1280. Synthetic data only.
// UI-모바일노트복사메뉴: on a phone (390) the row has no [복사] button; [복사] is the first item of the ⋯ menu (same copy, same notice) and the
// title, preview, date and state run right up to the ⋯. PC (1280) is unchanged.
test.use({ hasTouch: true });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co', stamp = '2026-10-06T01:00:00Z';
const A = '10000000-0000-4000-8000-0000000000a1', B = '10000000-0000-4000-8000-0000000000b2', C = '10000000-0000-4000-8000-0000000000c3';
async function fixture(page, width, {archived = null} = {}) {
  await page.setViewportSize({ width, height: 900 });
  const errors = [], writes = [], posts = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await openHome(page);
  const base = { workspace_id: 'w', kind: 'basket', title: null, created_at: stamp, updated_at: stamp, archived_at: null, ai_export_allowed: true, metadata: {} };
  const rows = [
    { ...base, id: A, raw_text: '합성 교섭 결과 공유\n다음 회의 10/27', occurred_at: '2026-10-06T03:00:00Z', attachments: [{ drive_file_id: 'f1', file_name: '합성.txt', mime_type: 'text/plain', size_bytes: 10 }] },
    { ...base, id: B, raw_text: '합성 둘째 업데이트', occurred_at: '2026-10-06T02:00:00Z', attachments: [], archived_at: archived },
    { ...base, id: C, raw_text: '', occurred_at: '2026-10-06T01:00:00Z', attachments: [{ drive_file_id: 'f2', file_name: '첨부만.pdf', mime_type: 'application/pdf', size_bytes: 10 }] },
  ];
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams;
    const pick = row => (!q.get('kind') || 'eq.' + row.kind === q.get('kind')) && (!q.get('id') || 'eq.' + row.id === q.get('id'));
    if (req.method() === 'GET') { if (q.get('metadata')) return r.fulfill({ json: [] }); return r.fulfill({ json: rows.filter(pick).slice(Number(q.get('offset') || 0)) }); }
    if (req.method() === 'PATCH') { const body = req.postDataJSON(); writes.push({ query: Object.fromEntries(q), body }); const hit = rows.filter(pick); hit.forEach(row => Object.assign(row, body)); return r.fulfill({ json: hit }); }
    return r.fulfill({ status: 500, json: {} });
  });
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') || q.has('google_task_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  for (const t of ['app_documents', 'app_suborganizations', 'app_suborganization_assignees', 'app_spaces']) await page.route(SB + '/rest/v1/' + t + '?**', r => r.fulfill({ json: [] }));
  await page.route(u => u.href === SB + '/functions/v1/basket-files?action=note-delete', r => {
    const body = JSON.parse(r.request().postData()); posts.push(body);
    const i = rows.findIndex(row => row.id === body.note_id), total = i < 0 ? 0 : rows[i].attachments.length; if (i >= 0) rows.splice(i, 1);
    return r.fulfill({ json: { action: 'note-delete', note_id: body.note_id, attachments_total: total, trashed: total, failed: 0, unknown: 0, ok: true, note_deleted: i >= 0 } });
  });
  await page.evaluate(() => { window.__copied = []; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async t => window.__copied.push(t), write: async () => {} } }); });
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await expect(page.locator(`[data-basket-row="${A}"]`)).toBeVisible();
  return { rows, writes, posts, errors };
}
const press = async (page, l, width) => { await expect(l).toBeVisible(); if (width < 761) await l.tap(); else await l.click(); };
const menu = page => page.locator('#basketRowMenu');
const rowMore = (page, id) => page.locator(`[data-basket-row-more="${id}"]`);
const detail = page => page.locator('[data-basket-detail]');
async function choose(page, id, label, width) {
  await press(page, rowMore(page, id), width);
  await expect(menu(page)).toBeVisible();
  await press(page, menu(page).getByRole('button', { name: label, exact: true }), width);
}

for (const width of [390, 1280]) {
  test(`update row ⋯: beside [복사], items and order, opens under the ⋯, Esc·outside press close, one at a time ${width}`, async ({ page }, info) => {
    const f = await fixture(page, width);
    const more = rowMore(page, A), copy = page.locator(`[data-basket-row-copy="${A}"]`), row = page.locator(`[data-basket-row="${A}"]`);
    await expect(more).toHaveAccessibleName('합성 교섭 결과 공유 메뉴');
    const mb = await more.boundingBox(), rb = await row.boundingBox();
    expect(mb.width).toBeGreaterThanOrEqual(44); expect(mb.height).toBeGreaterThanOrEqual(44);
    expect(mb.x + mb.width).toBeGreaterThan(rb.x + rb.width - 8);
    const title = await row.locator('.basket-title').boundingBox();
    if (width >= 761) {
      // [복사] sits left of [⋯] on the same line, both on the right side of the row; the title does not run under them.
      const cb = await copy.boundingBox(); expect(cb.width).toBeGreaterThanOrEqual(44); expect(cb.height).toBeGreaterThanOrEqual(44);
      expect(cb.x + cb.width).toBeLessThanOrEqual(mb.x + 1); expect(Math.round(cb.y)).toBe(Math.round(mb.y));
      expect(title.x + title.width).toBeLessThanOrEqual(cb.x + 1);
    } else {
      // Phone: no [복사] button; the title, preview and date run to the ⋯ (the old [복사] place is used) and nothing sits under the ⋯.
      await expect(copy).toBeHidden(); await expect(page.locator('[data-basket-row-copy]:visible')).toHaveCount(0);
      expect(title.x + title.width).toBeLessThanOrEqual(mb.x + 1); expect(title.x + title.width).toBeGreaterThan(mb.x - 8);
      expect(title.width).toBeGreaterThanOrEqual(rb.width - 48 - 16 - 2);
      for (const sel of ['.basket-preview', 'time']) { const b = await row.locator(sel).first().boundingBox(); expect(b.x + b.width).toBeLessThanOrEqual(mb.x + 1); }
    }
    // A row with nothing to copy keeps only the ⋯, in the same place.
    await expect(page.locator(`[data-basket-row-copy="${C}"]`)).toBeHidden();
    const mc = await rowMore(page, C).boundingBox(); expect(Math.round(mc.x)).toBe(Math.round(mb.x));
    if (width < 761) { await press(page, rowMore(page, C), width); await expect(menu(page).getByRole('button', { name: '복사', exact: true })).toHaveCount(0); await expect(menu(page).locator('button').first()).toHaveText('수정'); await page.keyboard.press('Escape'); await expect(menu(page)).toBeHidden(); }
    await press(page, more, width);
    await expect(menu(page)).toBeVisible(); await expect(more).toHaveAttribute('aria-expanded', 'true');
    await expect(menu(page).locator('button')).toHaveText([...(width < 761 ? ['복사'] : []), '수정', '연결하기', '할 일 만들기', '노트로 옮기기', '사업 보고로 옮기기', '업무일지에 남기기', '삭제']);
    await expect(menu(page).locator('button').last()).toHaveClass(/basket-menu-danger/);
    for (const b of await menu(page).locator('button').all()) expect((await b.boundingBox()).height).toBeGreaterThanOrEqual(44);
    const m = await menu(page).boundingBox();
    expect(m.y).toBeGreaterThanOrEqual(mb.y + mb.height - 1); expect(m.y - (mb.y + mb.height)).toBeLessThanOrEqual(12);
    expect(m.x).toBeGreaterThanOrEqual(0); expect(m.x + m.width).toBeLessThanOrEqual(width);
    await expect(menu(page).locator('button').first()).toBeFocused();
    await expect(detail(page)).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`update-row-menu-${width}.png`) });
    // Keyboard: Tab walks the items in order; Esc closes and returns focus to the ⋯.
    const items = menu(page).locator('button');
    for (let i = 1; i < 5; i++) { await page.keyboard.press('Tab'); await expect(items.nth(i)).toBeFocused(); }
    await page.keyboard.press('Escape');
    await expect(menu(page)).toBeHidden(); await expect(more).toBeFocused(); await expect(more).toHaveAttribute('aria-expanded', 'false');
    await expect(detail(page)).toBeHidden();
    // Enter on the focused ⋯ opens it again (keyboard).
    await page.keyboard.press('Enter'); await expect(menu(page)).toBeVisible(); await expect(items.first()).toBeFocused();
    // Pressing the ⋯ again closes it.
    await press(page, more, width); await expect(menu(page)).toBeHidden();
    // Only one at a time: another row's ⋯ (above the open menu, so it is not covered) moves the menu there.
    await press(page, rowMore(page, B), width); await expect(rowMore(page, B)).toHaveAttribute('aria-expanded', 'true');
    await press(page, more, width);
    await expect(menu(page)).toBeVisible(); await expect(rowMore(page, B)).toHaveAttribute('aria-expanded', 'false'); await expect(more).toHaveAttribute('aria-expanded', 'true');
    // Keyboard: moving focus out of the menu to another row's ⋯ closes it; Enter there opens that row's menu.
    await rowMore(page, B).focus(); await expect(menu(page)).toBeHidden(); await expect(more).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Enter'); await expect(menu(page)).toBeVisible(); await expect(rowMore(page, B)).toHaveAttribute('aria-expanded', 'true');
    await expect(menu(page).locator('[aria-expanded]')).toHaveCount(0);
    // An outside press closes it without opening anything.
    await press(page, page.locator('[data-basket-list-status]'), width);
    await expect(menu(page)).toBeHidden(); await expect(detail(page)).toBeHidden();
    // [복사] copies without opening the update or the menu (a phone: the menu's first item, which closes the menu).
    if (width >= 761) await press(page, copy, width);
    else { await press(page, more, width); await press(page, menu(page).getByRole('button', { name: '복사', exact: true }), width); await expect(more).toBeFocused(); }
    await expect(page.locator('#toast')).toHaveText('복사했습니다'); await expect(detail(page)).toBeHidden(); await expect(menu(page)).toBeHidden();
    expect(await page.evaluate(() => window.__copied.at(-1))).toBe('합성 교섭 결과 공유\n다음 회의 10/27');
    expect(await page.evaluate(() => window.__copied.length)).toBe(1);
    // The row itself still opens the update.
    await press(page, row, width);
    await expect(detail(page).locator('[data-basket-read-text]')).toBeVisible(); await expect(menu(page)).toBeHidden();
    expect(f.writes).toEqual([]); expect(f.posts).toEqual([]); expect(f.errors).toEqual([]);
  });

  test(`update row ⋯ items reuse the detail: 수정, 연결하기, 할 일 만들기 ${width}`, async ({ page }) => {
    const f = await fixture(page, width);
    // 수정: the detail opens in edit mode with the text focused.
    await choose(page, B, '수정', width);
    const text = detail(page).locator('[data-basket-text]');
    await expect(text).toBeVisible(); await expect(text).toBeFocused(); await expect(text).toHaveValue('합성 둘째 업데이트');
    await expect(detail(page).locator('[data-basket-save]')).toBeVisible(); await expect(detail(page).locator('[data-basket-read]')).toBeHidden();
    await press(page, detail(page).locator('[data-basket-cancel]'), width);
    await press(page, detail(page).locator('[data-basket-close]'), width);
    await expect(rowMore(page, B)).toBeVisible();
    // 연결하기: the detail opens with the link panel already open (the detail's own [연결하기]).
    await choose(page, B, '연결하기', width);
    await expect(detail(page).locator('[data-basket-manual]')).toBeVisible();
    await expect(detail(page).locator('[data-manual-pick="organization"]')).toBeVisible();
    await expect(detail(page).locator('[data-basket-read-actions]')).toBeHidden();
    await page.keyboard.press('Escape'); await expect(detail(page).locator('[data-basket-read-actions]')).toBeVisible();
    await press(page, detail(page).locator('[data-basket-close]'), width);
    // 할 일 만들기: the detail opens with the task form open, its title from the first line.
    await choose(page, A, '할 일 만들기', width);
    await expect(detail(page).locator('[data-basket-manual]')).toBeVisible();
    await expect(detail(page).locator('[data-manual-task-title]')).toHaveValue('합성 교섭 결과 공유');
    await expect(detail(page).locator('[data-basket-read-actions]')).toBeHidden();
    expect(f.writes).toEqual([]); expect(f.posts).toEqual([]); expect(f.errors).toEqual([]);
  });

  test(`update row ⋯: 노트로 옮기기 asks first, 삭제 uses the detail's confirmation and server delete ${width}`, async ({ page }) => {
    const f = await fixture(page, width);
    // Each native confirm takes the next planned answer; every message is kept.
    const asked = [], answers = [];
    page.on('dialog', d => { asked.push(d.message()); return answers.shift() ? d.accept() : d.dismiss(); });
    // 노트로 옮기기: one question; cancel changes nothing and stays on the list.
    answers.push(false);
    await choose(page, B, '노트로 옮기기', width);
    await expect.poll(() => asked.length).toBe(1);
    expect(asked[0]).toBe('‘합성 둘째 업데이트’을(를) 노트로 옮길까요?');
    await expect(detail(page)).toBeHidden(); await expect(rowMore(page, B)).toBeFocused(); expect(f.writes).toEqual([]);
    // Accept: the detail's own move (first line as the title), then the note opens.
    answers.push(true);
    await choose(page, B, '노트로 옮기기', width);
    await expect(page.locator('#toast')).toHaveText('노트로 옮겼어요.');
    await expect(page.locator('[data-basket-kind="note"]')).toHaveAttribute('aria-pressed', 'true');
    await expectNoteTitle(page,'합성 둘째 업데이트');
    expect(f.writes).toHaveLength(1);
    expect(f.writes[0].query).toMatchObject({ id: 'eq.' + B, kind: 'eq.basket' }); expect(f.writes[0].body).toMatchObject({ kind: 'note', title: '합성 둘째 업데이트' });
    await press(page, page.locator('[data-note-close]'), width);
    await press(page, basketKindButton(page,'memo'), width);
    await expect(page.locator(`[data-basket-row="${B}"]`)).toHaveCount(0);
    // 삭제: cancel keeps everything and returns focus to the ⋯.
    answers.push(false);
    await choose(page, A, '삭제', width);
    await expect.poll(() => asked.length).toBe(3);
    await expect(rowMore(page, A)).toBeFocused(); expect(f.posts).toEqual([]);
    // Accept: the same wording as the detail's 삭제, one server note-delete, the row leaves the list.
    answers.push(true);
    await choose(page, A, '삭제', width);
    await expect(page.locator(`[data-basket-row="${A}"]`)).toHaveCount(0);
    const DELETE = '업데이트 원문을 지웁니다. 연결된 조직·프로젝트 0곳에서도 사라집니다. 첨부 파일 1개는 Drive 휴지통으로 옮깁니다(30일 안에 복구 가능).';
    expect(asked).toEqual(['‘합성 둘째 업데이트’을(를) 노트로 옮길까요?', '‘합성 둘째 업데이트’을(를) 노트로 옮길까요?', DELETE, DELETE]);
    expect(f.posts).toEqual([{ action: 'note-delete', note_id: A, note_updated_at: stamp }]);
    await expect(page.locator('[data-basket-list-status]')).toHaveText('업데이트를 지우고 첨부를 Drive 휴지통으로 옮겼어요.');
    await expect(detail(page)).toBeHidden(); await expect(page.locator(`[data-basket-row="${C}"]`)).toBeVisible();
    expect(f.errors).toEqual([]);
  });
}

test('an archived update leaves 연결하기 out of its row menu, as the detail refuses it', async ({ page }) => {
  const f = await fixture(page, 1280, { archived: '2026-10-06T05:00:00Z' });
  await page.locator('[data-basket-filter="archived"]').click();
  await expect(rowMore(page, B)).toBeVisible();
  await rowMore(page, B).click();
  await expect(menu(page).locator('button')).toHaveText(['수정', '할 일 만들기', '노트로 옮기기', '사업 보고로 옮기기', '삭제']);
  await page.keyboard.press('Escape'); await expect(menu(page)).toBeHidden();
  expect(f.errors).toEqual([]);
});
