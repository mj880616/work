import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';

// STAB-노트핀시험 임시 조사(이 PR이 끝나기 전에 지운다): 노트 목록 시험 준비 단계에서 줄이 0개로 남는 흔들림을 CI와 같은 조건에서 다시 일으키고,
// 그때 화면·라우터 상태와 요청 순서를 줄로 남긴다.
test.use({ hasTouch: true });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const row = (id, title, updated_at) => ({ id, workspace_id: 'w', kind: 'note', title, raw_text: title + ' 본문', occurred_at: updated_at, created_at: updated_at, updated_at, archived_at: null, ai_export_allowed: true, attachments: [], metadata: {} });
for (const width of [390, 1280]) for (let i = 0; i < 24; i++) test(`probe note list fixture ${width} #${i}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const errors = [], log = [], t0 = Date.now();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await openHome(page);
  const rows = [row('n-a', '가 노트', '2026-10-16T01:00:00Z'), row('n-b', '나 노트', '2026-10-10T01:00:00Z'), row('n-c', '다 노트', '2026-10-01T01:00:00Z')];
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams;
    log.push(`${Date.now() - t0} notes ${req.method()} kind=${q.get('kind')} meta=${q.get('metadata') || ''}`);
    if (req.method() !== 'GET') return r.fulfill({ status: 500, json: {} });
    if (q.get('metadata')) return r.fulfill({ json: [] });
    return r.fulfill({ json: rows.filter(x => !q.get('kind') || 'eq.' + x.kind === q.get('kind')).slice(Number(q.get('offset') || 0)) });
  });
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  await page.evaluate(() => {
    window.__probe = []; const t = Date.now(), add = s => window.__probe.push(`${Date.now() - t} ${s}`);
    for (const n of ['kptu:view-changed', 'kptu:sub-changed', 'kptu:session-changed', 'kptu:view-prefs-ready', 'kptu:view-loader-ready', 'popstate', 'kptu:basket-note-created', 'kptu:basket-notes-restored'])
      window.addEventListener(n, e => add(`${n} ${JSON.stringify(e.detail ? { view: e.detail.view, sub: e.detail.sub, source: e.detail.source } : {})} url=${location.search}`));
  });
  log.push(`${Date.now() - t0} go basket loaded=${await page.evaluate(() => !!window.KPTUViewLoader?.isLoaded?.('basket'))}`);
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  log.push(`${Date.now() - t0} clicked`);
  try { await expect(page.locator('[data-note-row]')).toHaveCount(3); }
  catch (e) {
    const state = await page.evaluate(() => {
      const list = document.querySelector('[data-note-list]'), b = document.querySelector('#basketView');
      return JSON.stringify({ cur: window.KPTURouter.current, sub: window.KPTURouter.sub, url: location.search, kind: b?.dataset.kind, basketHidden: b?.classList.contains('hidden'),
        listExists: !!list, hiddenAncestor: list?.closest('[hidden]')?.tagName + '#' + (list?.closest('[hidden]')?.id || ''), listText: list?.innerText?.slice(0, 300),
        noteRows: document.querySelectorAll('[data-note-row]').length, nxRows: document.querySelectorAll('.nx-row').length, probe: window.__probe });
    });
    console.log(`PROBE FAIL ${width}: ${state}\nPROBE LOG ${log.join(' | ')}\nPROBE ERR ${errors.join(' || ')}`);
    throw e;
  }
  expect(errors).toEqual([]);
});
