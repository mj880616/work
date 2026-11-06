import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
// S50-2 NOW-원문안열림 ②③(요청함 11/04 12:53, 명진 13:16): Now 상세의 [본문]을 누르면 글 전체를 Web2 안에서 읽는다
// (제목·꼬리 줄 + 본문, 글자 크기 3단계, [원문 ↗]는 옆에 작게). 본문을 저장하지 않은 출처엔 [본문]이 없고, 못 읽은 글은 '본문을 못 읽었어요 · 원문 ↗'.
// 폰은 뒤로가기 한 번 = 상세로. 서버는 흉내 낸다. 글은 모두 가상.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const P1 = 'a1000000-0000-4000-8000-000000000001', P2 = 'a1000000-0000-4000-8000-000000000002', P3 = 'a1000000-0000-4000-8000-000000000003', N1 = 'b1000000-0000-4000-8000-000000000001';
const post = (id, extra) => ({ id, source_key: 'kctu', kind: 'statement', lang: 'ko', title: '가상 글 ' + id.slice(-1), title_ko: null, url: 'https://nodong.org/statement/' + id.slice(-1), published_at: '2026-10-06T00:30:00Z', fetched_at: '2026-10-06T00:40:00Z', summary_ko: '가상 요약 한 문장이다.', key_sentences: [], has_body: true, ...extra });
const POSTS = [post(P1, {}), post(P2, { has_body: false, published_at: '2026-10-05T00:30:00Z' }), post(P3, { published_at: '2026-10-04T00:30:00Z' })];
const SENTENCES = { [P1]: [{ idx: 1, text: '둘째 가상 문장이다.' }, { idx: 0, text: '첫째 가상 문장이다 <b>태그</b>.' }], [P3]: [] };
const NEWS = { id: N1, lane: 'keyword', url: 'https://news.example.org/a/1', title: '가상 뉴스 기사', lang: 'ko', publisher: '가상일보', published_at: '2026-10-06T00:10:00Z', created_at: '2026-10-06T00:20:00Z', summary: '가상 기사 요약.', title_ko: null, starred_at: '2026-10-06T00:50:00Z', folder_id: null, state: 'ok', body_kind: 'full' };
const NEWS_BODY = { body: '<p>가상 기사 첫 문단이다.</p><p>가상 기사 둘째 문단이다.</p><img src="https://x.example/a.jpg">', body_kind: 'full' };
const DETAIL = { level: 'full', summary: '가상 상세 요약.', key_sentences: [], relevance: null, implications: null, related: [], generated_at: '2026-10-06T01:00:00Z', context_at: null };

async function server(page) {
  const calls = [];
  await page.route(SB + '/**', async route => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname, method = req.method();
    const ok = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (p === '/functions/v1/outside-feed') return ok({ ok: true, sources: [{ key: 'kctu', name: '민주노총', group: 'labor', lang: 'ko' }] });
    if (p === '/functions/v1/news-feed') return ok({ ok: true, sources: [], limits: {} });
    if (p === '/functions/v1/ai-assist') { const b = req.postDataJSON?.(); return ok(b?.kind === 'now_detail' ? { ok: true, kind: 'now_detail', detail: DETAIL, stale: false } : { ok: true, ran: false, added: 0 }); }
    const table = p.startsWith('/rest/v1/') ? p.slice('/rest/v1/'.length) : '';
    if (table) calls.push(table + u.search);
    if (table === 'app_outside_posts') { const id = (u.searchParams.get('id') || '').replace(/^eq\./, ''); return ok(id ? POSTS.filter(x => x.id === id) : POSTS); }
    if (table === 'app_outside_sentences') {
      const id = (u.searchParams.get('post_id') || '').replace(/^eq\./, '');
      return ok(SENTENCES[id] || []);
    }
    if (table === 'app_outside_sources') return ok([{ source_key: 'kctu', enabled: true, last_ok_at: '2026-10-05T09:07:00Z', last_error: null }]);
    if (table === 'app_outside_seen') return ok([{ seen_at: '2026-10-06T00:00:00Z' }]);
    if (table === 'app_outside_marks') return ok([]);
    if (table === 'app_news_items') {
      if ((u.searchParams.get('select') || '') === 'body,body_kind') return ok([NEWS_BODY]);
      return ok([NEWS]);
    }
    if (table === 'app_now_signals') return method === 'POST' ? route.fulfill({ status: 201 }) : ok([]);
    if (table.startsWith('app_now_') || table.startsWith('app_news_') || table === 'app_notes') return ok([]);
    return route.fallback();
  });
  return calls;
}
async function start(page, width) {
  await page.setViewportSize({ width, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await openHome(page);
  const calls = await server(page);
  if (width <= 760) {
    await page.locator('#mobileMenuTab').click();
    await page.locator('#mobileMenu nav button:visible', { hasText: 'Now' }).click();
  } else await page.locator('#appView>.app-nav').getByRole('button', { name: 'Now', exact: true }).click();
  await expect(page.locator('#outsideView')).toBeVisible();
  return { errors, calls };
}
const root = page => page.locator('#outsideRoot');
const detail = page => root(page).locator('[data-now-detail]');
const noWideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

for (const width of [412, 1440]) {
  test(`Now ${width}: 상세 [본문]으로 글 전체 읽기·글자 크기·못 읽음·본문 없는 출처`, async ({ page }) => {
    test.setTimeout(90000);
    const { errors, calls } = await start(page, width);
    const open = id => root(page).locator(`[data-os-list] [data-nw-key="outside:${id}"] .now-open`).click();
    await root(page).getByRole('tab', { name: '사회운동' }).click();
    await expect(root(page).locator('[data-os-list] [data-nw-key]')).toHaveCount(3);

    // 본문을 저장하지 않은 글(has_body=false)에는 [본문]이 없다.
    await open(P2);
    await expect(detail(page).locator('.nd-title')).toHaveText('가상 글 2');
    await expect(detail(page).locator('button[data-nd-reader]')).toHaveCount(0);
    if (width <= 760) { await page.goBack(); await expect(root(page).locator('#nowMain')).toBeVisible(); }

    // 본문이 있는 글: [원문 ↗]는 그대로, 옆에 [본문].
    await open(P1);
    const nd = detail(page).locator('.nd');
    await expect(nd.getByRole('link', { name: /원문/ })).toHaveAttribute('href', 'https://nodong.org/statement/1');
    await nd.locator('button[data-nd-reader]').click();
    const rd = detail(page).locator('.nd-reader');
    await expect(rd).toBeVisible();
    await expect(rd.locator('.nd-title')).toHaveText('가상 글 1');
    await expect(rd.locator('.nd-meta')).toContainText('민주노총');
    // 글 전체가 순서대로, 글자로만(태그는 글자 그대로).
    await expect(rd.locator('[data-nd-prose]')).toContainText('첫째 가상 문장이다 <b>태그</b>. 둘째 가상 문장이다.');
    await expect(rd.locator('[data-nd-prose] b')).toHaveCount(0);
    await expect(rd.getByRole('link', { name: /원문/ })).toHaveAttribute('href', 'https://nodong.org/statement/1');
    // 읽는 길은 서버 저장본뿐: 원문 사이트·Edge를 부르지 않는다.
    expect(calls.some(c => c.startsWith('app_outside_sentences?') && c.includes(P1))).toBe(true);
    // 글자 크기 3단계.
    const fs = () => rd.locator('[data-nd-prose]').evaluate(el => getComputedStyle(el).fontSize);
    expect(await fs()).toBe('16px');
    await rd.locator('[data-nd-size="1"]').click();
    expect(await fs()).toBe('19px');
    await expect(rd.locator('[data-nd-size="1"]')).toBeDisabled();
    await rd.locator('[data-nd-size="-1"]').click();
    await rd.locator('[data-nd-size="-1"]').click();
    expect(await fs()).toBe('14px');
    expect(await noWideScroll(page)).toBe(true);

    // 닫기: 폰은 뒤로가기 한 번 = 상세로(목록이 아님), PC는 ‹.
    if (width <= 760) {
      await page.goBack();
      await expect(detail(page).locator('.nd:not(.nd-reader)')).toBeVisible();
      await expect(detail(page).locator('.nd-reader')).toHaveCount(0);
      await page.goBack();
      await expect(root(page).locator('#nowMain')).toBeVisible();
    } else {
      await rd.locator('[data-nd-reader-close]').click();
      await expect(detail(page).locator('.nd:not(.nd-reader)')).toBeVisible();
    }

    // 못 읽은 글: 안내 + 원문 ↗.
    await open(P3);
    await detail(page).locator('button[data-nd-reader]').click();
    const none = detail(page).locator('.nd-reader [data-nd-reader-none]');
    await expect(none).toContainText('본문을 못 읽었어요');
    await expect(none.getByRole('link', { name: /원문/ })).toHaveAttribute('href', 'https://nodong.org/statement/3');
    expect(errors).toEqual([]);
  });

  test(`Now ${width}: 보관 탭 뉴스 기사도 [본문]으로 읽는다(태그 없이 글자만)`, async ({ page }) => {
    test.setTimeout(90000);
    const { errors } = await start(page, width);
    await root(page).getByRole('tab', { name: '보관' }).click();
    await root(page).locator(`[data-now-panel-saved] [data-nw-key="news:${N1}"] .now-open`).click();
    const nd = detail(page).locator('.nd');
    await expect(nd.locator('.nd-title')).toHaveText('가상 뉴스 기사');
    await nd.locator('button[data-nd-reader]').click();
    const rd = detail(page).locator('.nd-reader');
    await expect(rd.locator('[data-nd-prose] p')).toHaveText(['가상 기사 첫 문단이다.', '가상 기사 둘째 문단이다.']);
    await expect(rd.locator('img')).toHaveCount(0);
    await expect(rd.getByRole('link', { name: /원문/ })).toHaveAttribute('href', 'https://news.example.org/a/1');
    expect(await noWideScroll(page)).toBe(true);
    expect(errors).toEqual([]);
  });
}
