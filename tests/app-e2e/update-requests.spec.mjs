import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { showBasketRow } from './helpers/basket-more.mjs';

// JOURNAL-요청표시: an update (app_notes kind=basket) can be marked [임원 요청] (임원 일정 배정 요청) and/or [논의 요청]. The marks live
// in the row's existing metadata as metadata.requests (no database change). They are set from the home and basket inputs (small
// toggles that turn off again after [추가]) and from an open update (pressed = marked), shown as small tags on the list row and in
// the work journal, and gathered at the top of the weekly report draft. Phone 390 and PC 1280; fake content only.
test.use({ hasTouch: true });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const at = '2026-10-06T00:30:00Z';
const pgText = value => `[${value.map(item => JSON.stringify(item)).join(', ')}]`;
const row = (id, raw_text, metadata = {}, extra = {}) => ({ id, workspace_id: 'w', kind: 'basket', title: null, journal_day: null, raw_text, occurred_at: at, created_at: at, updated_at: at, archived_at: null, ai_export_allowed: true, attachments: [], metadata, ...extra });
// The guards the guarded metadata write sends, checked like PostgREST would.
function guardsHold(x, q) {
  const m = x.metadata || {};
  const text = key => { const v = m[key]; return v == null ? null : typeof v === 'string' ? v : pgText(v); };
  for (const [key, value] of q.entries()) {
    if (key === 'updated_at' && value !== 'eq.' + x.updated_at) return false;
    const meta = /^metadata->>(\w+)$/.exec(key);
    if (meta && (value === 'is.null' ? text(meta[1]) != null : value !== 'eq.' + text(meta[1]))) return false;
    if (key === 'metadata->tasks->0->>task_id') { const first = Array.isArray(m.tasks) ? m.tasks[0]?.task_id ?? null : null; if (value === 'is.null' ? first != null : value !== 'eq.' + first) return false; }
  }
  return true;
}
async function fixture(page, width, rows) {
  await page.setViewportSize({ width, height: 900 });
  const errors = [], writes = [], hooks = { beforePatch: null };
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await openHome(page);
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams, method = req.method();
    const pick = x => (!q.get('kind') || 'eq.' + x.kind === q.get('kind')) && (!q.get('id') || 'eq.' + x.id === q.get('id'));
    if (method === 'GET') { if (q.get('metadata') || q.has('journal_day')) return r.fulfill({ json: [] }); return r.fulfill({ json: rows.filter(pick).slice(Number(q.get('offset') || 0)) }); }
    if (method === 'POST') {
      const body = req.postDataJSON(); writes.push({ method, body });
      const saved = row('new-' + writes.length, body.raw_text, body.metadata || {}, { occurred_at: '2026-10-06T01:00:00Z', updated_at: '2026-10-06T01:00:00Z' });
      rows.unshift(saved); return r.fulfill({ status: 201, json: [saved] });
    }
    if (method === 'PATCH') {
      const body = req.postDataJSON(); writes.push({ method, query: Object.fromEntries(q), body });
      if (hooks.beforePatch) { hooks.beforePatch(rows); hooks.beforePatch = null; }
      const hit = rows.filter(x => pick(x) && guardsHold(x, q)); hit.forEach(x => Object.assign(x, body));
      return r.fulfill({ json: hit.map(x => ({ id: x.id, updated_at: x.updated_at, metadata: x.metadata })) });
    }
    return r.fulfill({ status: 500, json: {} });
  });
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_record_links', r => r.fulfill({ json: [] }));
  return { errors, writes, hooks, rows };
}
const press = async (page, l, width) => { await expect(l).toBeVisible(); if (width < 761) await l.tap(); else await l.click(); };
// Visible 32px, pressing range 44px (::after) for every toggle.
async function touchRange(locator) {
  for (const b of await locator.all()) {
    const size = await b.evaluate(el => ({ h: el.getBoundingClientRect().height, after: parseFloat(getComputedStyle(el, '::after').height) }));
    expect(size.h).toBeGreaterThanOrEqual(30); expect(size.after).toBeGreaterThanOrEqual(44);
  }
}

for (const width of [390, 1280]) test(`home input marks the next update; the toggles turn off after [추가] ${width}`, async ({ page }, info) => {
  const f = await fixture(page, width, [row('b-old', '기존 업데이트')]);
  const q = page.locator('#homeView [data-home-quick]'), input = q.locator('[data-quick-input]'), box = q.locator('[data-quick-requests]');
  await expect(q).toHaveAttribute('data-mode', 'basket');
  await expect(box).toBeHidden();
  await input.focus(); await input.fill('가상 간담회 일정 잡아 주세요');
  await expect(box).toBeVisible();
  await expect(box.locator('button')).toHaveText(['임원 요청', '논의 요청']);
  await touchRange(box.locator('button'));
  const exec = box.locator('[data-quick-request="exec_schedule"]'), talk = box.locator('[data-quick-request="discussion"]');
  await press(page, exec, width); await press(page, talk, width);
  await expect(exec).toHaveAttribute('aria-pressed', 'true'); await expect(talk).toHaveAttribute('aria-pressed', 'true');
  await press(page, talk, width);
  await expect(talk).toHaveAttribute('aria-pressed', 'false');
  await page.screenshot({ path: info.outputPath(`home-request-${width}.png`) });
  await press(page, q.locator('[data-quick-save]'), width);
  await expect(page.locator('#toast')).toContainText('바구니에 저장했습니다.');
  expect(f.writes).toHaveLength(1);
  expect(f.writes[0].body).toMatchObject({ raw_text: '가상 간담회 일정 잡아 주세요', metadata: { requests: ['exec_schedule'] } });
  await expect(input).toHaveValue('');
  await expect(exec).toHaveAttribute('aria-pressed', 'false');
  // The next update without a mark carries no metadata at all.
  await input.focus(); await input.fill('표시 없는 업데이트');
  await press(page, q.locator('[data-quick-save]'), width);
  await expect.poll(() => f.writes.length).toBe(2);
  expect(f.writes[1].body.metadata).toBeUndefined();
  // [할 일] has no marks: the toggles are not offered there.
  await input.focus();
  await expect(box).toBeVisible();
  await press(page, q.locator('[data-quick-mode="task"]'), width);
  await expect(box).toBeHidden();
  await press(page, q.locator('[data-quick-mode="update"]'), width);
  await expect(box).toBeVisible();
  // The basket screen's input has the same toggles.
  await page.evaluate(() => window.KPTURouter.go('basket'));
  const bq = page.locator('#basketView [data-home-quick]');
  await bq.locator('[data-quick-input]').focus(); await bq.locator('[data-quick-input]').fill('바구니 화면 입력');
  await expect(bq.locator('[data-quick-requests]')).toBeVisible();
  await press(page, bq.locator('[data-quick-request="discussion"]'), width);
  await press(page, bq.locator('[data-quick-save]'), width);
  await expect.poll(() => f.writes.length).toBe(3);
  expect(f.writes[2].body.metadata).toEqual({ requests: ['discussion'] });
  await expect(bq.locator('[data-quick-request="discussion"]')).toHaveAttribute('aria-pressed', 'false');
  // The list shows the marks as small tags on each row.
  await expect(page.locator('[data-basket-row="new-1"] [data-request-tag]')).toHaveText(['임원 요청']);
  await expect(page.locator('[data-basket-row="new-3"] [data-request-tag]')).toHaveText(['논의 요청']);
  await expect(page.locator('[data-basket-row="new-2"] [data-request-tag]')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath(`basket-list-request-${width}.png`) });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(f.errors).toEqual([]);
});

for (const width of [390, 1280]) test(`an open update turns marks on and off; other metadata (folder, pin, tasks) stays ${width}`, async ({ page }, info) => {
  const meta = { folder: '가상 폴더', pinned_at: '2026-10-05T00:00:00.000Z', tasks: [{ task_id: 't-1', task_list_id: '@default', title: '가상 할 일', created_at: at }], keep: 1 };
  const f = await fixture(page, width, [row('b1', '가상 교섭 상황 공유\n둘째 줄', meta)]);
  await page.evaluate(() => window.KPTURouter.go('basket'));
  // A note with a recorded task counts as classified (분류 완료).
  await showBasketRow(page, 'b1');
  await press(page, page.locator('[data-basket-row="b1"]'), width);
  const toggles = page.locator('[data-basket-detail] [data-basket-requests]');
  await expect(toggles.locator('button')).toHaveText(['임원 요청', '논의 요청']);
  for (const b of await toggles.locator('button').all()) await expect(b).toHaveAttribute('aria-pressed', 'false');
  await touchRange(toggles.locator('button'));
  await press(page, toggles.locator('[data-basket-request="discussion"]'), width);
  await expect(page.locator('#toast')).toHaveText('논의 요청으로 표시했어요.');
  await expect(toggles.locator('[data-basket-request="discussion"]')).toHaveAttribute('aria-pressed', 'true');
  expect(f.writes).toHaveLength(1);
  expect(Object.keys(f.writes[0].body)).toEqual(['metadata']);
  expect(f.writes[0].body.metadata).toEqual({ ...meta, requests: ['discussion'] });
  expect(f.writes[0].query).toMatchObject({ id: 'eq.b1', kind: 'eq.basket', updated_at: 'eq.' + at, 'metadata->>requests': 'is.null', 'metadata->>folder': 'eq.가상 폴더', 'metadata->tasks->0->>task_id': 'eq.t-1' });
  expect(f.rows[0].updated_at).toBe(at);
  // Keyboard: 임원 요청 on — both marks, in the fixed order.
  await toggles.locator('[data-basket-request="exec_schedule"]').focus(); await page.keyboard.press('Enter');
  await expect(toggles.locator('[data-basket-request="exec_schedule"]')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => f.writes.length).toBe(2);
  expect(f.writes[1].query['metadata->>requests']).toBe('eq.' + pgText(['discussion']));
  expect(f.rows[0].metadata).toEqual({ ...meta, requests: ['exec_schedule', 'discussion'] });
  await page.screenshot({ path: info.outputPath(`detail-request-${width}.png`) });
  // Off again: the key goes away when no mark is left; the folder, pin and tasks are still there.
  await press(page, toggles.locator('[data-basket-request="discussion"]'), width);
  await expect(page.locator('#toast')).toHaveText('논의 요청 표시를 껐어요.');
  await press(page, toggles.locator('[data-basket-request="exec_schedule"]'), width);
  await expect(toggles.locator('[data-basket-request="exec_schedule"]')).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => f.writes.length).toBe(4);
  expect(f.rows[0].metadata).toEqual(meta);
  // Changed elsewhere between the read and the write (another device recorded a task): nothing is overwritten.
  f.hooks.beforePatch = rows => { rows[0].metadata = { ...rows[0].metadata, tasks: [{ task_id: 't-2', task_list_id: '@default', title: '다른 기기 할 일', created_at: at }, ...rows[0].metadata.tasks] }; };
  await press(page, toggles.locator('[data-basket-request="exec_schedule"]'), width);
  await expect(page.locator('[data-basket-detail] [data-basket-status]')).toHaveText('업데이트가 그사이 바뀌었어요. 다시 불러온 뒤 눌러 주세요.');
  await expect(toggles.locator('[data-basket-request="exec_schedule"]')).toHaveAttribute('aria-pressed', 'false');
  expect(f.rows[0].metadata.tasks.map(t => t.task_id)).toEqual(['t-2', 't-1']);
  expect(f.rows[0].metadata.requests).toBeUndefined();
  // Back to the list: the row has no tag.
  await press(page, page.locator('[data-basket-close]'), width);
  await expect(page.locator('[data-basket-row="b1"] [data-request-tag]')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(f.errors).toEqual([]);
});
