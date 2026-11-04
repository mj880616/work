import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { noteTrash } from './helpers/note-trash.mjs';
import { answerAsk } from './helpers/small-notice.mjs';

// S48-56 노트 → 일기로 보내기: 노트 줄 ⋯ [일기로 보내기] → 작은 날짜 창(기본 = 노트를 만든 날) → 그날 일기를 기존 길(POST kind=diary)로 만들고
// 글을 넣은 뒤, 원래 노트는 기존 휴지통 길로(알림 'M월 D일 일기로 보냈어요' · 되돌리기). 일기 저장이 실패하면 노트는 그대로.
test.use({ hasTouch: true });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
async function fixture(page, width) {
  await page.setViewportSize({ width, height: 900 });
  const errors = [], writes = [], deletes = [];
  page.on('pageerror', e => errors.push(e.message + ' ' + (e.stack || '').split('\n').slice(0, 4).join(' | ')));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await openHome(page);
  const trash = await noteTrash(page, SB);
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
    if (req.method() === 'DELETE') { const hit = rows.filter(pick); deletes.push(Object.fromEntries(q)); hit.forEach(x => { rows.splice(rows.indexOf(x), 1); trash.take(x, 0); }); return r.fulfill({ json: [] }); }
    return r.fulfill({ status: 500, json: {} });
  });
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page,'note');
  await expect(page.locator('[data-note-row]')).toHaveCount(4);
  return { rows, writes, deletes, errors };
}
const press = async (page, l, width) => { await expect(l).toBeVisible(); if (width < 761) await l.tap(); else await l.click(); };
const menu = page => page.locator('#noteDocMenu');
const rowMore = (page, id) => page.locator(`[data-note-row-more="${id}"]`);
async function diaryRoute(page, f, {fail = false} = {}) {
  const posts = [];
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams;
    if (req.method() === 'GET' && q.get('kind') === 'in.(note,basket)') return r.fulfill({ json: f.rows.filter(x => 'eq.' + x.id === q.get('id') && ['note', 'basket'].includes(x.kind)) });
    if (req.method() === 'POST') {
      const body = req.postDataJSON(); posts.push(body);
      if (fail) return r.fulfill({ status: 503, json: { message: 'down' } });
      const day = { id: 'd-new', workspace_id: 'w', title: null, attachments: [], metadata: {}, doc: null, updated_at: '2026-11-03T00:00:00Z', ...body };
      f.rows.push(day); return r.fulfill({ status: 201, json: [day] });
    }
    return r.fallback();
  });
  return posts;
}
for (const width of [390, 1280]) {
  test(`노트 ⋯ [일기로 보내기]: 날짜 창 기본 = 만든 날, 그날 일기에 글이 들어가고 노트는 휴지통 ${width}`, async ({ page }) => {
    const f = await fixture(page, width);
    const posts = await diaryRoute(page, f);
    await press(page, rowMore(page, 'n-plain'), width);
    await press(page, menu(page).getByRole('button', { name: '일기로 보내기', exact: true }), width);
    const ask = page.locator('.kptu-ask');
    await expect(ask.locator('input[type="date"]')).toHaveValue('2026-10-12');
    expect(await answerAsk(page, true)).toContain('어느 날 일기로 보낼까요?');
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toMatchObject({ kind: 'diary', journal_day: '2026-10-12', raw_text: '평범한 노트\n둘째 줄 글', ai_export_allowed: false });
    await expect(page.locator('[data-note-row="n-plain"]')).toHaveCount(0);
    expect(f.deletes).toHaveLength(1); expect(f.deletes[0]).toMatchObject({ id: 'eq.n-plain' });
    await expect(page.locator('[data-undo-notice]')).toContainText('10월 12일 일기로 보냈어요');
    expect(f.errors).toEqual([]);
  });
}
test('일기 저장이 실패하면 노트는 지우지 않고 그대로 둔다 1280', async ({ page }) => {
  const f = await fixture(page, 1280);
  const posts = await diaryRoute(page, f, { fail: true });
  await press(page, rowMore(page, 'n-plain'), 1280);
  await press(page, menu(page).getByRole('button', { name: '일기로 보내기', exact: true }), 1280);
  await answerAsk(page, true);
  await expect.poll(() => posts.length).toBe(1);
  await expect(page.locator('#kptuNotice:not([hidden]) .kptu-notice-text')).toContainText('원래 기록은 그대로');
  await expect(page.locator('[data-note-row="n-plain"]')).toBeVisible();
  expect(f.deletes).toEqual([]);
});
