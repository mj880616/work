import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { noticeText } from './helpers/small-notice.mjs';
// S53-5 NEWS-밑줄모으기(시안 docs/design/mockups/news-highlights.html #2090): 원문에서 글을 고르면(끌기·⋯ [모두 선택]) 하단바 위 줄
// [밑줄 저장][노트로][복사][공유] ✕. [밑줄 저장] → 노란 밑줄(누르면 메모·노트로·복사·지우기) → News [밑줄] 탭에 모임(찾기 칸이 밑줄 글도 찾음, 누르면 그 글로).
// 서버는 흉내(app_news_highlights·app_notes 넣기만 적어 둠), 글은 모두 가상.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const EN = 'a2000000-0000-4000-8000-000000000001', KO = 'a2000000-0000-4000-8000-000000000002';
const QUOTE = '권력의 냉소를 받아들이지 않는다.';
const QUOTE_LINE = '첫 문장이 여기 있어요. ' + QUOTE + ' 끝 문장이에요.';
const post = (id, extra) => ({ id, source_key: 'kctu', kind: 'statement', lang: 'ko', title: '가상 글 ' + id.slice(-1), title_ko: null, url: 'https://nodong.org/statement/' + id.slice(-1), published_at: '2026-10-06T00:30:00Z', fetched_at: '2026-10-06T00:40:00Z', summary_ko: '가상 요약.', key_sentences: [], has_body: true, author: null, body_ko: null, ...extra });
const BLOCKS = [{ t: 'p', text: 'First fake paragraph.' }];
const KO_TEXT = '가짜 첫 문단.';
const DETAIL = { level: 'full', summary: '가상 상세 요약.', key_sentences: [], relevance: null, implications: { kptu: '가상 시사점.', labor: '' }, related: [], generated_at: '2026-10-06T01:00:00Z', context_at: null };
const SOURCES = [{ key: 'kctu', name: '민주노총', group: 'labor', lang: 'ko' }, { key: 'jacobin', name: 'Jacobin', group: 'foreign', lang: 'en' }];

async function server(page) {
  const s = { calls: [], translate: [], hl: [], hlPosts: [], notes: [] };
  s.trGate = new Promise(r => { s.trRelease = r; });
  const POSTS = [post(EN, { source_key: 'jacobin', kind: 'article', lang: 'en', title: 'A fake strike wave', title_ko: '가상 파업 물결', url: 'https://jacobin.com/2026/10/fake', has_body: false, published_at: '2026-10-06T00:35:00Z' }), post(KO)];
  await page.route('https://img.example.org/**', route => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"/>' }));
  await page.route(SB + '/**', async route => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname, method = req.method();
    const ok = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    const body = req.postDataJSON?.() ?? null;
    if (p === '/functions/v1/outside-feed') {
      if (u.searchParams.get('action') === 'translate') {
        s.translate.push({ body, auth: req.headers().authorization || '' });
        await s.trGate;
        const it = POSTS.find(x => x.id === body.id);
        if (it.body_ko) return ok({ ok: true, status: 'stored' });
        it.body_ko = KO_TEXT;
        return ok({ ok: true, status: 'translated', engine: 'google' });
      }
      return ok({ ok: true, sources: SOURCES });
    }
    if (p === '/functions/v1/news-feed') { s.calls.push('news-feed' + u.search); return ok({ ok: true, sources: [], limits: {} }); }
    if (p === '/functions/v1/ai-assist') {
      if (body?.kind !== 'now_detail') return ok({ ok: true, ran: false, added: 0 });
      return ok({ ok: true, kind: 'now_detail', detail: DETAIL, stale: false });
    }
    const table = p.startsWith('/rest/v1/') ? p.slice('/rest/v1/'.length) : '';
    if (table) s.calls.push(table + decodeURIComponent(u.search));
    if (table === 'app_outside_posts') { const id = (u.searchParams.get('id') || '').replace(/^eq\./, ''); return ok(id ? POSTS.filter(x => x.id === id) : POSTS); }
    if (table === 'app_feed_bodies') { const id = (u.searchParams.get('outside_post_id') || '').replace(/^eq\./, ''); return ok(id === EN || id === KO ? [{ state: 'ok', reason: null, blocks: id === EN ? BLOCKS : [{ t: 'p', text: QUOTE_LINE }] }] : []); }
    if (table === 'app_news_highlights') {
      if (method === 'POST') { const row = { ...body, id: 'b3000000-0000-4000-8000-00000000000' + (s.hl.length + 1), created_at: '2026-11-08T01:0' + s.hl.length + ':00Z', updated_at: '2026-11-08T01:00:00Z' }; s.hlPosts.push(body); s.hl.unshift(row); return ok([row], 201); }
      if (method === 'PATCH') { const id = (u.searchParams.get('id') || '').replace(/^eq\./, ''); const h = s.hl.find(x => x.id === id); if (h) Object.assign(h, body); return ok(h ? [h] : []); }
      if (method === 'DELETE') { const id = (u.searchParams.get('id') || '').replace(/^eq\./, ''); s.hl = s.hl.filter(x => x.id !== id); return route.fulfill({ status: 204 }); }
      return ok(s.hl);
    }
    if (table === 'app_notes' && method === 'POST') { s.notes.push(body); return ok([{ id: 'c3000000-0000-4000-8000-00000000000' + s.notes.length, kind: 'note', title: body.title, raw_text: body.raw_text, metadata: body.metadata || {}, created_at: '2026-11-08T01:00:00Z', updated_at: '2026-11-08T01:00:00Z', archived_at: null }], 201); }
    if (table === 'app_feed_reads') return method === 'POST' ? route.fulfill({ status: 201 }) : ok([]);
    if (table === 'app_outside_sources') return ok(SOURCES.map(x => ({ source_key: x.key, enabled: true, last_ok_at: '2026-10-05T09:07:00Z', last_error: null })));
    if (table === 'app_outside_seen') return ok([{ seen_at: '2026-10-06T00:00:00Z' }]);
    if (table === 'app_now_signals') return method === 'POST' ? route.fulfill({ status: 201 }) : ok([]);
    if (table.startsWith('app_now_') || table.startsWith('app_news_') || table.startsWith('app_outside_') || table === 'app_notes') return ok([]);
    return route.fallback();
  });
  return s;
}
async function start(page, width) {
  await page.setViewportSize({ width, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  // 클립보드·공유 창은 흉내(폰 앱·브라우저마다 다름): 넣은 글·넘긴 것만 적어 둔다.
  await page.addInitScript(() => {
    window.__copied = []; window.__shared = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async t => { window.__copied.push(t); }, write: async () => {} } });
    Object.defineProperty(navigator, 'share', { configurable: true, writable: true, value: async d => { window.__shared.push(d); } });
  });
  await openHome(page);
  const s = await server(page);
  if (width <= 760) {
    await page.locator('#mobileMenuTab').click();
    await page.locator('#mobileMenu nav button:visible', { hasText: 'News' }).click();
  } else await page.locator('#appView>.app-nav').getByRole('button', { name: 'News', exact: true }).click();
  await expect(page.locator('#outsideView')).toBeVisible();
  await page.locator('#outsideRoot').getByRole('tab', { name: '사회운동' }).click();
  await expect(page.locator('#outsideRoot [data-os-list] [data-nw-key]')).toHaveCount(2);
  return { errors, s };
}
const root = page => page.locator('#outsideRoot');
const nd = page => root(page).locator('[data-now-detail] .nd');
const open = (page, id) => root(page).locator(`[data-os-list] [data-nw-key="outside:${id}"] .now-open`).click();


const copied = page => page.evaluate(() => window.__copied.at(-1) ?? null);
const bar = page => page.locator('div[data-hl-bar]');
// 원문 글자 일부를 고른다(손가락으로 끈 것과 같은 선택 — 폰 기본 메뉴는 브라우저 몫이라 여기서는 보지 않는다).
const pick = (page, text) => page.evaluate(t => {
  const p = document.querySelector('#outsideRoot [data-now-detail] [data-nd-prose] p'), node = [...p.childNodes].find(n => n.nodeType === 3 && n.data.includes(t));
  const i = node.data.indexOf(t), r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + t.length);
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
}, text);

for (const width of [412, 1440]) {
  test(`원문 고르기 줄 · 밑줄 저장 · [밑줄] 탭 ${width}`, async ({ page }) => {
    test.setTimeout(90000);
    const { errors, s } = await start(page, width);
    await open(page, KO);
    const d = nd(page);
    await expect(d.locator('[data-nd-prose] p').first()).toHaveText(QUOTE_LINE);

    // ⋯ [모두 선택] 뒤에도 줄이 떠서 복사·공유가 된다(11/08 09:56 고장).
    await d.locator('[data-nd-ob-more]').click();
    await page.locator('#ndObMenu').getByRole('button', { name: '모두 선택' }).click();
    await expect(bar(page)).toBeVisible();
    await expect(bar(page).locator('.kptu-act:visible')).toHaveText(['밑줄 저장', '노트로', '복사', '공유']);
    await bar(page).getByRole('button', { name: '복사' }).click();
    await expect.poll(() => copied(page)).toContain(QUOTE_LINE);
    expect(await copied(page)).toContain('https://nodong.org/statement/2');
    await expect(bar(page)).toBeHidden();
    // 줄은 하단바 위(폰), 화면 밖으로 넘치지 않는다.
    await pick(page, QUOTE);
    await expect(bar(page)).toBeVisible();
    const bb = await bar(page).boundingBox();
    expect(bb.x).toBeGreaterThanOrEqual(0); expect(bb.x + bb.width).toBeLessThanOrEqual(width + 1);
    if (width <= 760) { const tabs = await page.locator('.mobile-tabs').boundingBox(); if (tabs) expect(bb.y + bb.height).toBeLessThanOrEqual(tabs.y + 1); }
    await bar(page).getByRole('button', { name: '공유' }).click();
    await expect.poll(() => page.evaluate(() => window.__shared.length)).toBe(1);
    expect((await page.evaluate(() => window.__shared[0])).text).toContain(QUOTE);

    // [밑줄 저장] → 서버에 고른 글·앞뒤 글·출처, 원문 위 노란 밑줄.
    await pick(page, QUOTE);
    await bar(page).getByRole('button', { name: '밑줄 저장' }).click();
    await expect.poll(() => s.hlPosts.length).toBe(1);
    const sent = s.hlPosts[0];
    expect(sent).toMatchObject({ source_type: 'outside', source_id: KO, quote: QUOTE, source_media: '민주노총', source_title: '가상 글 2', source_url: 'https://nodong.org/statement/2', memo: null });
    expect(sent.quote_prefix).toBe('첫 문장이 여기 있어요. '); expect(sent.quote_suffix).toBe(' 끝 문장이에요.');
    expect(Object.keys(sent).sort()).toEqual(['memo', 'quote', 'quote_prefix', 'quote_suffix', 'source_date', 'source_id', 'source_media', 'source_title', 'source_type', 'source_url', 'workspace_id']);
    await expect.poll(() => noticeText(page)).toContain('밑줄 저장함');
    const mark = d.locator('[data-nd-prose] mark.hl-mark');
    await expect(mark).toHaveText(QUOTE);
    await expect(d.locator('[data-nd-prose] p').first()).toHaveText(QUOTE_LINE);

    // 밑줄을 누르면 작은 메뉴 → [노트로] = 고른 글 + 출처.
    await mark.click();
    const menu = page.locator('#hlMarkMenu');
    await expect(menu).toBeVisible();
    await expect(menu.locator('button')).toHaveText(['메모 달기', '노트로', '복사', '지우기']);
    await menu.getByRole('button', { name: '노트로' }).click();
    await expect.poll(() => s.notes.length).toBe(1);
    expect(s.notes[0].raw_text).toContain('> ' + QUOTE);
    expect(s.notes[0].raw_text).toContain('민주노총');
    expect(s.notes[0].raw_text).toContain('https://nodong.org/statement/2');
    expect(s.notes[0].metadata).toBeUndefined();

    // [밑줄] 탭: 새 것이 위, 글·매체·제목. 찾기 칸이 밑줄 글도 찾는다. 누르면 그 글의 그 자리.
    if (width <= 760) await page.goBack();
    await root(page).getByRole('tab', { name: '밑줄' }).click();
    const rows = root(page).locator('[data-nh-row]');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(QUOTE);
    await expect(rows.first()).toContainText('가상 글 2');
    await root(page).locator('[data-nw-find]').fill('없는 말');
    await expect(rows).toHaveCount(0);
    await root(page).locator('[data-nw-find]').fill('냉소');
    await expect(rows).toHaveCount(1);
    await root(page).locator('[data-nw-find]').fill('');
    await rows.first().locator('[data-nh-open]').click();
    await expect(nd(page).locator('[data-nd-prose] mark.hl-mark')).toHaveText(QUOTE);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}
