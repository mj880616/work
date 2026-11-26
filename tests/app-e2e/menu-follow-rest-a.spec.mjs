import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { answerAsk } from './helpers/small-notice.mjs';
// MENU-자리나머지(S61-15) 묶음 A: 통합 검색 결과 줄 메뉴·원문 ⋯ 메뉴를 연 채 그 화면이 뒤에서 다시 그려져도(자료 바뀜 알림·같은 글 다시 열기)
// (참고 묶음 ⋯ 시험은 ORG-참고묶음삭제 S71-22에서 화면과 함께 지움)
// 메뉴는 같은 칸의 새 자리 옆에 그대로 붙어 있고(왼쪽 위로 튀지 않음), 항목을 누르면 그 칸에 대해 실행된다. 칸이 사라지면 메뉴는 닫힌다(공용 anchored-menu keepMenus).
// 가짜 서버만(이름 모두 가짜). 사진: MENU_FOLLOW_SHOTS 폴더가 있으면 남긴다.
const SHOTS = process.env.MENU_FOLLOW_SHOTS || '';
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';

// 지금 그 칸에 표시를 달고 화면을 다시 그리게 한 뒤, 표시 없는 새 칸이 그려질 때까지 기다린다(정말 다시 그려졌는지).
async function redraw(trigger, fire) {
  await trigger.evaluate(el => { el.dataset.oldDraw = '1'; });
  await fire();
  await expect(trigger).toBeVisible();
  await expect(trigger).not.toHaveAttribute('data-old-draw', '1');
}
// 메뉴 상자가 그 칸 바로 옆(위·아래 24px 안)에 있는지.
async function nextTo(panel, trigger) {
  const p = await panel.boundingBox(), t = await trigger.boundingBox();
  return Math.min(Math.abs(p.y - (t.y + t.height)), Math.abs(p.y + p.height - t.y)) < 24;
}
const shot = (page, width, name) => SHOTS ? page.screenshot({ path: `${SHOTS}/${width < 761 ? 'phone' : 'pc'}-${width}-${name}.png` }) : null;
const watchErrors = page => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  return errors;
};

// ---------- 통합 검색 결과 줄(PC 우클릭) ----------
const D = '00000000-0000-4000-8000-0000000000d1';
const item = (kind, source, id, title) => ({ kind, source, id, title, matched_in: 'title', snippet: null, occurred_at: '2026-10-01T00:00:00+00:00', day: null, state: null, project_id: null, project_name: null, organization_id: null, organization_name: null });
async function searchServer(page) {
  await page.route(SB + '/rest/v1/rpc/app_search_records', route => {
    const body = route.request().postDataJSON();
    const all = { update: [item('update', 'note', 'n1', '가짜 교섭 메모')], document: [item('document', 'document', D, '가짜 교섭 자료')] };
    const kinds = body.p_kind ? [body.p_kind] : ['update', 'note', 'work', 'document', 'meeting', 'project', 'organization', 'milestone'];
    return route.fulfill({ json: { words: String(body.p_query).split(/\s+/).filter(Boolean), groups: kinds.map(kind => ({ kind, total: (all[kind] || []).length, capped: false, offset: 0, items: all[kind] || [] })) } });
  });
  await page.route(SB + '/rest/v1/app_library_folder_items*', route => route.fulfill({ json: [{ document_id: D, folder_id: '00000000-0000-4000-8000-0000000000f1' }] }));
  await page.route(SB + '/rest/v1/app_library_folders*', route => route.fulfill({ json: [{ id: '00000000-0000-4000-8000-0000000000f1', name: '가짜 폴더' }] }));
}
test('통합 검색 결과 줄 우클릭 메뉴 1280: 연 채 다시 그려도 누른 자리 그대로 · 새 줄 · 항목이 눌린다', async ({ page }) => {
  const width = 1280;
  await page.setViewportSize({ width, height: 860 });
  const errors = watchErrors(page);
  await openHome(page, { beforeLoad: () => searchServer(page) });
  const input = page.locator('[data-search-slot] input[type="search"]');
  await input.click(); await input.fill('교섭');
  const row = () => page.locator('#gsPanel [data-gs-group="document"] .gs-row').first(), panel = page.locator('#gsRowMenu');
  await expect(row().locator('.gs-row-folder')).toHaveText('가짜 폴더');
  await row().click({ button: 'right' });
  await expect(panel).toBeVisible();
  const before = await panel.boundingBox();
  // 자료실에서 자료가 바뀌었다는 알림 → 폴더 다시 읽기 → 결과 창 전체를 다시 그림.
  await redraw(row(), () => page.evaluate(() => window.dispatchEvent(new CustomEvent('kptu:documents-changed'))));
  await expect(panel).toBeVisible();
  await expect(row()).toHaveAttribute('aria-expanded', 'true');
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  const after = await panel.boundingBox();
  expect(Math.abs(after.x - before.x) + Math.abs(after.y - before.y)).toBeLessThan(4);
  await shot(page, width, 'search-row-menu-kept');
  // 다시 그린 뒤에도 그 자료에 대해 실행된다: [선택] → 자료실 화면.
  await panel.getByRole('button', { name: '선택', exact: true }).click();
  await expect(page.locator('#libraryView')).toBeVisible();
  expect(errors).toEqual([]);
});

// ---------- 원문 ⋯(사회운동 글 상세) ----------
const EN = 'a2000000-0000-4000-8000-000000000001';
const POST = { id: EN, source_key: 'jacobin', kind: 'article', lang: 'en', title: 'A fake strike wave', title_ko: '가상 파업 물결', url: 'https://jacobin.com/2026/10/fake', published_at: '2026-10-06T00:35:00Z', fetched_at: '2026-10-06T00:40:00Z', summary_ko: '가상 요약.', key_sentences: [], has_body: false, author: null, body_ko: null };
const SOURCES = [{ key: 'jacobin', name: 'Jacobin', group: 'foreign', lang: 'en' }];
async function outsideServer(page) {
  await page.route(SB + '/**', async route => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname, method = req.method();
    const ok = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    const body = req.postDataJSON?.() ?? null;
    if (p === '/functions/v1/outside-feed') return ok({ ok: true, sources: SOURCES });
    if (p === '/functions/v1/news-feed') return ok({ ok: true, sources: [], limits: {} });
    if (p === '/functions/v1/ai-assist') {
      if (body?.kind !== 'now_detail') return ok({ ok: true, ran: false, added: 0 });
      return ok({ ok: true, kind: 'now_detail', detail: { level: 'full', summary: '가상 상세 요약.', key_sentences: [], relevance: null, implications: { kptu: '', labor: '' }, related: [], generated_at: '2026-10-06T01:00:00Z', context_at: null }, stale: false });
    }
    const table = p.startsWith('/rest/v1/') ? p.slice('/rest/v1/'.length) : '';
    if (table === 'app_outside_articles') return ok([POST]);
    if (table === 'app_outside_article_bodies') return ok([{ state: 'ok', reason: null, blocks: [{ t: 'p', text: 'First fake paragraph.' }, { t: 'p', text: 'Second fake paragraph.' }] }]);
    if (table === 'app_outside_reads' || table === 'app_outside_now_signals' || table === 'app_feed_reads' || table === 'app_now_signals') return method === 'POST' ? route.fulfill({ status: 201 }) : ok([]);
    if (table === 'app_outside_sources') return ok(SOURCES.map(x => ({ source_key: x.key, enabled: true, last_ok_at: '2026-10-05T09:07:00Z', last_error: null })));
    if (table === 'app_outside_seen') return ok([{ seen_at: '2026-10-06T00:00:00Z' }]);
    if (table.startsWith('app_now_') || table.startsWith('app_news_') || table.startsWith('app_outside_') || table === 'app_notes') return ok([]);
    return route.fallback();
  });
}
for (const width of [412, 1280]) test(`원문 ⋯ 메뉴 ${width}: 연 채 상세가 다시 그려져도 새 ⋯ 옆에 붙고 항목이 눌린다`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const errors = watchErrors(page);
  await page.addInitScript(() => {
    window.__copied = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async t => { window.__copied.push(t); }, write: async () => {} } });
  });
  await openHome(page);
  await outsideServer(page);
  if (width <= 760) {
    await page.locator('#mobileMenuTab').click();
    await page.locator('#mobileMenu nav button:visible', { hasText: '읽을 거리' }).click();
  } else await page.locator('#appView>.app-nav').getByRole('link', { name: '읽을 거리', exact: true }).click();
  const root = page.locator('#outsideRoot');
  await root.getByRole('tab', { name: '사회운동' }).click();
  await root.locator('[data-os-list] details[data-os-intl] > summary').click(); // S63-11: 국제 글은 접힌 '국제' 묶음 안
  await root.locator(`[data-os-list] [data-nw-key="outside:${EN}"] .now-open`).click();
  const d = root.locator('[data-now-detail] .nd');
  await expect(d.locator('[data-nd-prose] p').first()).toHaveText('First fake paragraph.');
  const more = d.locator('[data-nd-ob-more]'), panel = page.locator('#ndObMenu');
  await more.click();
  await expect(panel).toBeVisible();
  // 같은 글을 다시 연다(읽기 끝·목록이 머리를 새로 줄 때와 같은 길) → 상세 전체를 다시 그림.
  await redraw(more, () => page.evaluate(id => window.KPTUNow.open({ type: 'outside', id }, window.KPTUNow.describe('outside', {
    id, source_key: 'jacobin', kind: 'article', lang: 'en', title: 'A fake strike wave', title_ko: '가상 파업 물결', url: 'https://jacobin.com/2026/10/fake', published_at: '2026-10-06T00:35:00Z', summary_ko: '가상 요약.', key_sentences: [], has_body: false,
  })), EN));
  await expect(panel).toBeVisible();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  expect(await nextTo(panel, more)).toBe(true);
  await shot(page, width, 'source-menu-kept');
  // 다시 그린 뒤에도 실행된다: [복사] → 원문이 클립보드로.
  await panel.getByRole('button', { name: '복사', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__copied.at(-1) ?? '')).toContain('First fake paragraph.');
  expect(errors).toEqual([]);
});
