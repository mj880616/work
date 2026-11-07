import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { noticeText } from './helpers/small-notice.mjs';
// S52-39 NEWS-원문복사선택(시안 docs/design/mockups/news-copy-select.html, 명진 11/08 01:39 'ㅇ'):
// 원문 칸 머리 줄 [복사][번역(외국어 글만)][가 가 가] ⋯. [복사] = 제목 / 매체·날짜 / 본문 전체(문단 그대로) / 원래 주소를 한 번에(번역해서 보는 중이면 한국어 본문),
// 위쪽 작은 알림 '복사했어요'. ⋯ = [모두 선택](원문 본문 전체가 선택된 상태)·[복사]·[공유](폰 공유 창 — 제목·주소만, 공유 창이 없는 화면엔 없음).
// PC는 원문 위 우클릭도 같은 ⋯ 메뉴. 복사·선택은 화면 안에서만(서버에 새로 보내는 요청 없음). 서버는 흉내, 글은 모두 가상.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const EN = 'a2000000-0000-4000-8000-000000000001', KO = 'a2000000-0000-4000-8000-000000000002';
const post = (id, extra) => ({ id, source_key: 'kctu', kind: 'statement', lang: 'ko', title: '가상 글 ' + id.slice(-1), title_ko: null, url: 'https://nodong.org/statement/' + id.slice(-1), published_at: '2026-10-06T00:30:00Z', fetched_at: '2026-10-06T00:40:00Z', summary_ko: '가상 요약.', key_sentences: [], has_body: true, author: null, body_ko: null, ...extra });
const BLOCKS = [{ t: 'p', text: 'First fake paragraph.' }, { t: 'img', src: 'https://img.example.org/o.jpg', cap: 'Fake caption', alt: null }, { t: 'h', text: 'Fake heading' }, { t: 'quote', text: 'Fake quote.' }, { t: 'p', text: 'Second fake paragraph.' }];
const KO_TEXT = '가짜 첫 문단.\n가짜 소제목\n가짜 인용.\n가짜 둘째 문단.';
const DETAIL = { level: 'full', summary: '가상 상세 요약.', key_sentences: [], relevance: null, implications: { kptu: '가상 시사점.', labor: '' }, related: [], generated_at: '2026-10-06T01:00:00Z', context_at: null };
const SOURCES = [{ key: 'kctu', name: '민주노총', group: 'labor', lang: 'ko' }, { key: 'jacobin', name: 'Jacobin', group: 'foreign', lang: 'en' }];

async function server(page) {
  const s = { calls: [], translate: [] };
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
    if (table === 'app_feed_bodies') { const id = (u.searchParams.get('outside_post_id') || '').replace(/^eq\./, ''); return ok(id === EN || id === KO ? [{ state: 'ok', reason: null, blocks: id === EN ? BLOCKS : [{ t: 'p', text: '가상 한글 문단.' }] }] : []); }
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
const menuBox = page => page.locator('#ndObMenu');

for (const width of [412, 884, 1440]) {
  test(`원문 [복사]·⋯ [모두 선택]·[공유] ${width}`, async ({ page }) => {
    test.setTimeout(90000);
    const { errors, s } = await start(page, width);
    await open(page, EN);
    const d = nd(page);
    await expect(d.locator('.nd-title')).toHaveText('가상 파업 물결');
    const prose = d.locator('[data-nd-prose]');
    await expect(prose.locator('p').first()).toHaveText('First fake paragraph.');
    const head = d.locator('[data-nd-body] .nd-ob');
    const copy = head.locator('[data-nd-copy]'), more = head.locator('[data-nd-ob-more]');
    await expect(copy).toHaveText('복사');
    await expect(copy).toHaveClass(/ds-chip/);
    await expect(more).toHaveClass(/icon-btn/);
    // 머리 줄은 한 줄(폰에서도 [복사][번역][가 가 가] ⋯가 같은 높이), 가로 넘침 없음.
    const ys = await head.locator('.nd-ob-r > *').evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return Math.round(r.top + r.height / 2); }));
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(4);
    const hb = await head.boundingBox(), mb = await more.boundingBox();
    expect(mb.x + mb.width).toBeLessThanOrEqual(hb.x + hb.width + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    // [복사]: 제목 / 매체 · 날짜 / 문단 그대로(사진·캡션 빼고) / 원래 주소.
    const before = s.calls.length;
    await copy.click();
    expect(await noticeText(page)).toContain('복사했어요');
    const text = await copied(page);
    expect(text).toMatch(/^가상 파업 물결\nJacobin · \S/);
    expect(text).toContain('\n\nFirst fake paragraph.\n\nFake heading\n\nFake quote.\n\nSecond fake paragraph.\n\nhttps://jacobin.com/2026/10/fake');
    expect(text).not.toContain('Fake caption');
    expect(text.endsWith('https://jacobin.com/2026/10/fake')).toBe(true);
    // 번역해서 보는 중이면 한국어 본문.
    await d.locator('[data-nd-translate]').click();
    s.trRelease();
    await expect(d.locator('[data-nd-translated] p').first()).toHaveText('가짜 첫 문단.');
    await d.locator('[data-nd-copy]').click();
    await expect.poll(() => copied(page)).toContain('가짜 첫 문단.\n\n가짜 소제목\n\n가짜 인용.\n\n가짜 둘째 문단.');
    expect(await copied(page)).not.toContain('First fake paragraph.');
    await d.locator('[data-nd-translate]').click();
    await expect(d.locator('[data-nd-translated]')).toHaveCount(0);
    const extra = s.calls.slice(before).filter(c => !c.startsWith('app_outside_posts?') || !c.includes('select=body_ko'));
    expect(extra.filter(c => !/^(app_now_signals|app_feed_reads)/.test(c))).toEqual([]);

    // ⋯ 작은 메뉴: [모두 선택][복사][공유] 차례.
    await d.locator('[data-nd-ob-more]').click();
    await expect(menuBox(page)).toBeVisible();
    await expect(menuBox(page).locator('button')).toHaveText(['모두 선택', '복사', '공유']);
    await expect(menuBox(page).locator('button').first()).toHaveClass(/row-act/);
    await menuBox(page).getByRole('button', { name: '모두 선택' }).click();
    await expect(menuBox(page)).toBeHidden();
    const sel = await page.evaluate(() => String(window.getSelection()));
    expect(sel).toContain('First fake paragraph.');
    expect(sel).toContain('Second fake paragraph.');
    expect(sel).not.toContain('원문 전체');
    expect(sel).not.toContain('가상 상세 요약.');
    // ⋯ [공유]: 제목·주소만.
    await d.locator('[data-nd-ob-more]').click();
    await menuBox(page).getByRole('button', { name: '공유' }).click();
    await expect.poll(() => page.evaluate(() => window.__shared.length)).toBe(1);
    expect(await page.evaluate(() => window.__shared[0])).toEqual({ title: '가상 파업 물결', url: 'https://jacobin.com/2026/10/fake' });
    // ⋯ [복사]도 같은 글.
    await d.locator('[data-nd-ob-more]').click();
    await menuBox(page).getByRole('button', { name: '복사' }).click();
    await expect.poll(() => copied(page)).toMatch(/First fake paragraph\.[\s\S]*https:\/\/jacobin\.com\/2026\/10\/fake$/);
    // 공유 창이 없는 화면(폰 앱 WebView 등)에는 [공유]를 두지 않는다.
    await page.evaluate(() => { navigator.share = undefined; });
    await d.locator('[data-nd-ob-more]').click();
    await expect(menuBox(page).locator('button')).toHaveText(['모두 선택', '복사']);
    await page.keyboard.press('Escape');
    await expect(menuBox(page)).toBeHidden();

    // PC(761px~): 원문 위 우클릭 = 같은 ⋯ 메뉴.
    if (width > 760) {
      await page.evaluate(() => window.getSelection().removeAllRanges());
      const pb = await prose.locator('p').first().boundingBox();
      await prose.locator('p').first().click({ button: 'right', position: { x: 10, y: pb.height / 2 } });
      await expect(menuBox(page)).toBeVisible();
      // 누른 자리 바로 옆(⋯ 밑이 아니라).
      const mb2 = await menuBox(page).boundingBox();
      expect(Math.abs(mb2.x - (pb.x + 10))).toBeLessThan(16);
      await expect(menuBox(page).locator('button').first()).toHaveText('모두 선택');
      await page.keyboard.press('Escape');
    }

    // 한글 글: [복사][가 가 가] ⋯ (번역 없음).
    if (width <= 760) await page.goBack();
    await open(page, KO);
    await expect(nd(page).locator('[data-nd-prose] p').first()).toHaveText('가상 한글 문단.');
    const kids = await nd(page).locator('[data-nd-body] .nd-ob-r').evaluate(el => [...el.children].map(c => c.matches('[data-nd-copy]') ? 'copy' : c.matches('[data-nd-translate]') ? 'tr' : c.matches('.nd-size') ? 'size' : c.matches('[data-nd-ob-more]') ? 'more' : c.tagName.toLowerCase()));
    expect(kids).toEqual(['copy', 'size', 'more']);
    await nd(page).locator('[data-nd-copy]').click();
    await expect.poll(() => copied(page)).toMatch(/^가상 글 2\n민주노총 · [\s\S]*\n\n가상 한글 문단\.\n\nhttps:\/\/nodong\.org\/statement\/2$/);
    expect(errors).toEqual([]);
  });
}
