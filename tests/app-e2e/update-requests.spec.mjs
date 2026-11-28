import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import {showBasketRow,noteAction} from './helpers/basket-more.mjs';

// JOURNAL-요청표시 → UI-요청버튼삭제: the [임원 요청]·[논의 요청] toggles are gone from the home and basket inputs and from an open
// update (the owner writes the word in the update's text instead). No save writes request marks any more. Marks already saved
// on old updates (metadata.requests, no database change) still show as small tags on the list row, and every write keeps them.
// Phone 390 and PC 1280; fake content only.
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
  const errors = [], writes = [];
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
      const hit = rows.filter(x => pick(x) && guardsHold(x, q)); hit.forEach(x => Object.assign(x, body));
      return r.fulfill({ json: hit.map(x => ({ ...x })) });
    }
    return r.fulfill({ status: 500, json: {} });
  });
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_record_links', r => r.fulfill({ json: [] }));
  return { errors, writes, rows };
}
const press = async (page, l, width) => { await expect(l).toBeVisible(); if (width < 761) await l.tap(); else await l.click(); };
// No request toggle anywhere in the region (by the old hooks or by the words on a button).
async function noToggles(region) {
  await expect(region.locator('.update-request-toggles,[data-quick-requests],[data-quick-request],[data-basket-requests],[data-basket-request]')).toHaveCount(0);
  await expect(region.getByRole('button', { name: /^(임원 요청|논의 요청|임원 일정 배정 요청)$/ })).toHaveCount(0);
}


for (const width of [390, 1280]) test(`an old update's saved marks still show as tags, the open update has no toggles, and an edit keeps the marks ${width}`, async ({ page }, info) => {
  // S71-58 FORGET-처리전만: 할 일을 만든 업데이트(metadata.tasks)는 처리한 것이라 목록에 없다 — 목록 줄 꼬리표를 보려고 할 일 칸은 뺀다(다른 칸이 그대로인지는 그대로 본다).
  const meta = { requests: ['exec_schedule', 'discussion'], folder: '가상 폴더', pinned_at: '2026-10-05T00:00:00.000Z', keep: 1 };
  const f = await fixture(page, width, [row('b1', '가상 교섭 상황 공유\n둘째 줄', structuredClone(meta)), row('b2', '표시 없는 업데이트')]);
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await showBasketRow(page, 'b1');
  // The list row keeps the small tags of the saved marks (read side unchanged).
  await expect(page.locator('[data-basket-row-item="b1"] [data-request-tag]')).toHaveText(['임원 요청', '논의 요청']);
  await expect(page.locator('[data-basket-row="b2"] [data-request-tag]')).toHaveCount(0);
  await press(page, page.locator('[data-basket-row="b1"]'), width);
  const detail = page.locator('[data-basket-detail]');
  await expect(detail.locator('[data-basket-read-actions]')).toBeVisible();
  await noToggles(detail);
  await page.screenshot({ path: info.outputPath(`detail-no-request-${width}.png`) });
  // Edit and save: the text changes; the write carries no metadata, so the saved marks and the other keys stay.
  await noteAction(page, '[data-basket-edit]', { press: l => press(page, l, width) });
  await noToggles(detail);
  await detail.locator('[data-basket-text]').fill('가상 교섭 상황 공유 고침');
  await press(page, detail.locator('[data-basket-save]'), width);
  await expect.poll(() => f.writes.length).toBe(1);
  expect(f.writes[0].method).toBe('PATCH');
  expect(f.writes[0].body.raw_text).toBe('가상 교섭 상황 공유 고침');
  expect(f.writes[0].body.metadata).toBeUndefined();
  expect(f.rows.find(x => x.id === 'b1').metadata).toEqual(meta);
  await expect(detail.locator('[data-basket-read-actions]')).toBeVisible();
  await noToggles(detail);
  // Back to the list: the tags are still there.
  await press(page, page.locator('[data-basket-close]'), width);
  await expect(page.locator('[data-basket-row-item="b1"] [data-request-tag]')).toHaveText(['임원 요청', '논의 요청']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(f.errors).toEqual([]);
});

// An update saved with an attachment: no metadata write follows it any more.
// BIZ-저장먼저닫기 2차(S59-10): the letters are the one write (no metadata), then the file goes up behind to that update.
