import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
// S52-36 NEWS-바깥소식번역(명진 실기기 확인 11/08 01:36: News Jacobin 영어 기사 [원문 전체]에 [번역]이 없음):
// 사회운동 영어 소식에도 원문 칸 머리 줄 [번역](글자 크기 단추 왼쪽). 누르면 서버 outside-feed translate(로그인·하루 한도·저장은 서버)
// → 그 글 줄의 body_ko를 같은 순서의 글자 블록에 넣는다(사진·캡션 자리 그대로). 다시 누르면 원문. 한 번 번역한 글은 다시 부르지 않는다.
// 한국어 사회운동 글에는 [번역]이 없다. 서버는 흉내, 글은 모두 가상.
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
  await openHome(page);
  const s = await server(page);
  if (width <= 760) {
    await page.locator('#mobileMenuTab').click();
    await page.locator('#mobileMenu nav button:visible', { hasText: 'News' }).click();
  } else await page.locator('#appView>.app-nav').getByRole('link', { name: 'News', exact: true }).click();
  await expect(page.locator('#outsideView')).toBeVisible();
  await page.locator('#outsideRoot').getByRole('tab', { name: '사회운동' }).click();
  await expect(page.locator('#outsideRoot [data-os-list] [data-nw-key]')).toHaveCount(2);
  return { errors, s };
}
const root = page => page.locator('#outsideRoot');
const nd = page => root(page).locator('[data-now-detail] .nd');
const open = (page, id) => root(page).locator(`[data-os-list] [data-nw-key="outside:${id}"] .now-open`).click();

for (const width of [412, 1440]) {
  test(`사회운동 영어 소식 ${width}: [번역] 켜고 끄기 · outside-feed translate 한 번 · 한글 글엔 없음`, async ({ page }) => {
    test.setTimeout(90000);
    const { errors, s } = await start(page, width);
    await open(page, EN);
    const d = nd(page);
    await expect(d.locator('.nd-title')).toHaveText('가상 파업 물결');
    const head = d.locator('[data-nd-body] .nd-ob');
    const tr = head.locator('[data-nd-translate]');
    await expect(tr).toHaveText('번역');
    await expect(tr).toHaveAttribute('aria-pressed', 'false');
    // 머리 줄 오른쪽 차례(S52-39 NEWS-원문복사선택): [복사] [번역] [가 가 가] ⋯.
    const kids = await head.locator('.nd-ob-r').evaluate(el => [...el.children].map(c => c.matches('[data-nd-copy]') ? 'copy' : c.matches('[data-nd-translate]') ? 'tr' : c.matches('.nd-size') ? 'size' : c.matches('[data-nd-ob-more]') ? 'more' : c.tagName.toLowerCase()));
    expect(kids).toEqual(['copy', 'tr', 'size', 'more']);
    const prose = d.locator('[data-nd-prose]');
    await expect(prose.locator('p').first()).toHaveText('First fake paragraph.');

    await tr.click();
    await expect(d.locator('[data-nd-tr-wait]')).toContainText('번역하는 중');
    s.trRelease();
    await expect(d.locator('[data-nd-translated]')).toHaveCount(1);
    await expect(d.locator('[data-nd-translate]')).toHaveAttribute('aria-pressed', 'true');
    const shape = await prose.evaluate(el => [...el.children].map(c => c.tagName.toLowerCase() + ':' + (c.matches('figure') ? c.querySelector('figcaption')?.textContent : c.textContent)));
    expect(shape).toEqual(['p:가짜 첫 문단.', 'figure:Fake caption', 'h4:가짜 소제목', 'blockquote:가짜 인용.', 'p:가짜 둘째 문단.']);
    expect(s.translate).toHaveLength(1);
    expect(s.translate[0].body).toEqual({ id: EN });
    expect(s.translate[0].auth).toMatch(/^Bearer /);
    // 번역본은 그 글 줄(내 작업공간)의 body_ko만 읽는다. 뉴스 함수는 부르지 않는다.
    expect(s.calls.some(c => c.startsWith('app_outside_posts?') && c.includes(`id=eq.${EN}`) && c.includes('select=body_ko') && c.includes('workspace_id=eq.w'))).toBe(true);
    expect(s.calls.some(c => c.includes('news-feed?action=translate'))).toBe(false);
    // 다시 누르면 원문, 또 누르면 서버를 다시 부르지 않고 바로.
    await d.locator('[data-nd-translate]').click();
    await expect(d.locator('[data-nd-translated]')).toHaveCount(0);
    await expect(prose.locator('p').first()).toHaveText('First fake paragraph.');
    await d.locator('[data-nd-translate]').click();
    await expect(d.locator('[data-nd-translated] p').first()).toHaveText('가짜 첫 문단.');
    expect(s.translate).toHaveLength(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    // 한글 사회운동 글에는 [번역]이 없다.
    if (width <= 760) await page.goBack();
    await open(page, KO);
    await expect(nd(page).locator('.nd-title')).toHaveText('가상 글 2');
    await expect(nd(page).locator('[data-nd-prose] p').first()).toHaveText('가상 한글 문단.');
    await expect(nd(page).locator('[data-nd-translate]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
