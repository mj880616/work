import { test, expect } from '@playwright/test';
import { start, openNews } from './helpers/news-server.mjs';
// S52-12 NEWS-원문먼저번역(요청함 11/07 10:53, 시안 docs/design/mockups/news-detail-translate.html):
// 글 보기 순서 = 꼬리 줄 → 제목 → 원문 전체 → 요약 → 시사점. 외국어 뉴스 기사에만 원문 칸 머리 줄 [번역](글자 크기 단추 왼쪽).
// 누르면 서버 news-feed translate(로그인·하루 한도·저장은 서버) → 기사 줄 body_ko를 같은 순서의 글자 블록에 넣는다(사진·캡션 자리 그대로).
// 다시 누르면 원문. 한 번 번역한 글은 다시 서버 번역을 부르지 않는다. 한도 오류는 한 줄 + 원문 그대로. 서버는 흉내, 글은 모두 가짜.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const T1 = 'd1000000-0000-4000-8000-000000000001', T2 = 'd1000000-0000-4000-8000-000000000002';
const row = (id, extra) => ({ id, lane: 'channel', url: 'https://example.org/' + id.slice(-1), title: 'A fake story ' + id.slice(-1), lang: 'en', publisher: 'Fake Wire', source_key: null, keywords: [], published_at: '2026-10-06T00:40:00Z', scrapped_at: '2026-10-06T00:41:00Z', created_at: '2026-10-06T00:42:00Z', state: 'ok', summary: 'One fake line.', body_kind: 'full', title_ko: '가짜 외국 기사', translated_at: null, starred_at: null, folder_id: null, _body: 'First fake paragraph.\nFake heading\nFake quote.\nSecond fake paragraph.', ...extra });
const BLOCKS = [{ t: 'p', text: 'First fake paragraph.' }, { t: 'img', src: 'https://img.example.org/t.jpg', cap: 'Fake caption', alt: null }, { t: 'h', text: 'Fake heading' }, { t: 'quote', text: 'Fake quote.' }, { t: 'p', text: 'Second fake paragraph.' }];
const DETAIL = { level: 'full', summary: '가짜 상세 요약.', key_sentences: [], relevance: null, implications: { kptu: '가짜 시사점.', labor: '' }, related: [], generated_at: '2026-10-06T01:00:00Z', context_at: null };
const KO = '가짜 첫 문단.\n가짜 소제목\n가짜 인용.\n가짜 둘째 문단.';

async function extraServer(page, server) {
  const s = { translate: [] };
  s.trGate = new Promise(r => { s.trRelease = r; });
  await page.route('https://img.example.org/**', route => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"/>' }));
  await page.route(SB + '/**', async route => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname;
    const ok = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    const body = req.postDataJSON?.() ?? null;
    if (p === '/rest/v1/app_feed_bodies') {
      const id = (u.searchParams.get('news_item_id') || '').replace(/^eq\./, '');
      return ok(id === T1 || id === T2 ? [{ state: 'ok', reason: null, blocks: BLOCKS }] : []);
    }
    if (p === '/functions/v1/ai-assist' && body?.kind === 'now_detail') return ok({ ok: true, kind: 'now_detail', detail: DETAIL, stale: false });
    if (p === '/functions/v1/news-feed' && u.searchParams.get('action') === 'translate') {
      s.translate.push({ body, auth: req.headers().authorization || '' });
      if (body.id === T2) return ok({ ok: false, error: 'DAILY_LIMIT' }, 429);
      await s.trGate;
      const it = server.items.find(i => i.id === body.id);
      it._body_ko = KO;
      return ok({ ok: true, status: 'translated' });
    }
    return route.fallback();
  });
  return s;
}
const nd = page => page.locator('#nowDetail .nd');
const item = (page, id) => page.locator(`#newsRoot [data-nc-item="${id}"]`);
const noWideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

for (const width of [412, 884, 1440]) {
  test(`News 글 보기 ${width}: 원문 먼저 · 요약·시사점 아래 · 영문 [번역] 켜고 끄기 · 다시 부르지 않음 · 한도 한 줄`, async ({ page }) => {
    test.setTimeout(90000);
    const { errors, server } = await start(page, width);
    server.items.unshift(row(T1), row(T2, { published_at: '2026-10-06T00:35:00Z', title: 'A fake story 2' }));
    const s = await extraServer(page, server);
    await openNews(page, width);
    await item(page, T1).locator('.now-open').click();
    const d = nd(page);
    await expect(d.locator('.nd-sum')).toHaveText('가짜 상세 요약.');
    // 순서: 꼬리 줄 → 제목 → 원문 전체 → 요약 → 시사점 → 단추 줄.
    const order = await d.evaluate(el => [...el.children].map(c => c.dataset.ndSummary !== undefined ? 'sum' : c.dataset.ndImplications !== undefined ? 'imp' : c.dataset.ndBody !== undefined ? 'body' : c.matches('[data-nd-acts]') ? 'acts' : c.matches('.nd-title') ? 'title' : c.matches('.nd-top') ? 'top' : '').filter(Boolean));
    expect(order).toEqual(['top', 'title', 'body', 'sum', 'imp', 'acts']);
    // [번역]은 원문 칸 머리 줄, 글자 크기 단추 왼쪽.
    const head = d.locator('[data-nd-body] .nd-ob');
    const tr = head.locator('[data-nd-translate]');
    await expect(tr).toHaveText('번역');
    await expect(tr).toHaveAttribute('aria-pressed', 'false');
    const kids = await head.evaluate(el => [...el.children].map(c => c.matches('[data-nd-translate]') ? 'tr' : c.matches('.nd-size') ? 'size' : c.tagName.toLowerCase()));
    expect(kids.indexOf('tr')).toBe(kids.indexOf('size') - 1);
    const tb = await tr.boundingBox(), sb = await head.locator('.nd-size').boundingBox();
    expect(tb.x + tb.width).toBeLessThanOrEqual(sb.x + 1);
    expect(Math.abs((tb.y + tb.height / 2) - (sb.y + sb.height / 2))).toBeLessThan(4);
    const prose = d.locator('[data-nd-prose]');
    await expect(prose.locator('p').first()).toHaveText('First fake paragraph.');

    // 누르면 번역 중 표시(원문 칸) → 한국어. 글자 블록만 바뀌고 사진·캡션 자리는 그대로.
    await tr.click();
    await expect(d.locator('[data-nd-tr-wait]')).toContainText('번역하는 중');
    await expect(d.locator('[data-nd-translate]')).toBeDisabled();
    s.trRelease();
    await expect(d.locator('[data-nd-translated]')).toHaveCount(1);
    await expect(d.locator('[data-nd-translate]')).toHaveAttribute('aria-pressed', 'true');
    await expect(prose).toHaveAttribute('lang', 'ko');
    const shape = await prose.evaluate(el => [...el.children].map(c => c.tagName.toLowerCase() + ':' + (c.matches('figure') ? c.querySelector('figcaption')?.textContent : c.textContent)));
    expect(shape).toEqual(['p:가짜 첫 문단.', 'figure:Fake caption', 'h4:가짜 소제목', 'blockquote:가짜 인용.', 'p:가짜 둘째 문단.']);
    await expect(head.locator('.nd-ob-src')).toHaveText('한국어 번역');
    expect(s.translate).toHaveLength(1);
    expect(s.translate[0].body).toEqual({ id: T1 });
    expect(s.translate[0].auth).toMatch(/^Bearer /);
    // 글자 크기는 번역본에도 그대로.
    await d.locator('[data-nd-font="l"]').click();
    expect(await prose.evaluate(el => getComputedStyle(el).fontSize)).toBe('19px');
    expect(await noWideScroll(page)).toBe(true);
    // 다시 누르면 원문.
    await d.locator('[data-nd-translate]').click();
    await expect(d.locator('[data-nd-translated]')).toHaveCount(0);
    await expect(prose.locator('p').first()).toHaveText('First fake paragraph.');
    await expect(d.locator('[data-nd-translate]')).toHaveAttribute('aria-pressed', 'false');

    // 다른 글로 갔다 와도 다시 누르면 바로(서버 번역을 다시 부르지 않음).
    if (width <= 760) await page.goBack();
    await item(page, T2).locator('.now-open').click();
    await expect(nd(page).locator('.nd-title')).toHaveText('가짜 외국 기사');
    // 하루 한도: 한 줄 + 원문 그대로.
    await nd(page).locator('[data-nd-translate]').click();
    await expect(nd(page).locator('[data-nd-tr-note]')).toHaveText('오늘 번역을 다 씀 · 내일 다시');
    await expect(nd(page).locator('[data-nd-prose] p').first()).toHaveText('First fake paragraph.');
    await expect(nd(page).locator('[data-nd-translate]')).toHaveAttribute('aria-pressed', 'false');
    if (width <= 760) await page.goBack();
    await item(page, T1).locator('.now-open').click();
    await nd(page).locator('[data-nd-translate]').click();
    await expect(nd(page).locator('[data-nd-translated] p').first()).toHaveText('가짜 첫 문단.');
    expect(s.translate.filter(t => t.body.id === T1)).toHaveLength(1);

    // 한글 기사에는 [번역]이 없다.
    if (width <= 760) await page.goBack();
    await item(page, 'c1').locator('.now-open').click();
    await expect(nd(page).locator('.nd-title')).toHaveText('가짜 채널 기사');
    await expect(nd(page).locator('[data-nd-translate]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
