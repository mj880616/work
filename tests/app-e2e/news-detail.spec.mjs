import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
// S51-14 NEWS-전면개편 P4c 상세(docs/design/news-overhaul.md 맨 앞 D2′ 메모·6.2절, 시안 docs/design/mockups/news-overhaul.html ②·③):
// 글을 누르면 저장 원문(app_feed_bodies 블록)이 바로 뜨고, 동시에 요약·시사점 만들기(ai-assist now_detail)를 시작한다.
// AI가 늦어도 원문은 먼저 보이고, 요약·시사점 칸에만 '만드는 중' → 다 되면 그 칸만 채운다. 글자 크기 [가 가 가]는 서버(view_prefs.news_font).
// 사진은 https만·리퍼러 안 보냄·늦게 불러오기. 원문이 없는 글은 까닭 한 줄 + [원래 사이트 ↗]. 폰은 뒤로 키 = 목록, 주소에 글 id.
// 서버는 흉내 낸다(사진 주소도 가짜 — 실제로 불러오지 않게 가로챔). 글은 모두 가상.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const P1 = 'a1000000-0000-4000-8000-000000000001', P2 = 'a1000000-0000-4000-8000-000000000002', P3 = 'a1000000-0000-4000-8000-000000000003';
const post = (id, extra) => ({ id, source_key: 'kctu', kind: 'statement', lang: 'ko', title: '가상 글 ' + id.slice(-1), title_ko: null, url: 'https://nodong.org/statement/' + id.slice(-1), published_at: '2026-10-06T00:30:00Z', fetched_at: '2026-10-06T00:40:00Z', summary_ko: '가상 요약.', key_sentences: [], has_body: true, author: null, ...extra });
const POSTS = [post(P1, { author: '가상 글쓴이' }), post(P2, { published_at: '2026-10-05T00:30:00Z' }), post(P3, { published_at: '2026-10-04T00:30:00Z' })];
const BODIES = {
  [P1]: { state: 'ok', reason: null, blocks: [{ t: 'p', text: '가상 첫 문단이다 <b>태그</b>.' }, { t: 'h', text: '가상 소제목' }, { t: 'img', src: 'https://img.example.org/a.jpg', cap: '가상 사진 설명', alt: null }, { t: 'img', src: 'http://img.example.org/b.jpg', cap: null, alt: null }, { t: 'quote', text: '가상 인용.' }, { t: 'p', text: '가상 둘째 문단이다.' }] },
  [P2]: { state: 'failed', reason: 'robots', blocks: [] },
  [P3]: { state: 'lead', reason: 'paywall', blocks: [{ t: 'p', text: '가상 앞부분 문단.' }] },
};
const DETAIL = { level: 'full', summary: '가상 상세 요약.', key_sentences: [{ orig: '가상 주요 문장.', ko: null }], relevance: { topics: [], reason: '가상 연관 이유.' }, implications: { kptu: '가상 공공운수노조 시사점.', labor: '' }, related: [], generated_at: '2026-10-06T01:00:00Z', context_at: null };

async function server(page) {
  // AI 답은 처음부터 붙잡아 둔다(늦은 서버 흉내, PC는 [전체]에서 맨 위 글이 먼저 저절로 열림). 시험이 release()로 푼다.
  const s = { calls: [], aiStarted: [] };
  s.aiGate = new Promise(r => { s.release = r; });
  await page.route('https://img.example.org/**', route => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"/>' }));
  await page.route(SB + '/**', async route => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname, method = req.method();
    const ok = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (p === '/functions/v1/outside-feed') return ok({ ok: true, sources: [{ key: 'kctu', name: '민주노총', group: 'labor', lang: 'ko' }] });
    if (p === '/functions/v1/news-feed') { s.calls.push('news-feed' + u.search); return ok({ ok: true, sources: [], limits: {} }); }
    if (p === '/functions/v1/ai-assist') {
      const b = req.postDataJSON?.();
      if (b?.kind !== 'now_detail') return ok({ ok: true, ran: false, added: 0 });
      s.aiStarted.push(b.outside_post_id);
      if (s.aiGate) await s.aiGate;
      return ok({ ok: true, kind: 'now_detail', detail: DETAIL, stale: false });
    }
    const table = p.startsWith('/rest/v1/') ? p.slice('/rest/v1/'.length) : '';
    if (table) s.calls.push(table + decodeURIComponent(u.search));
    if (table === 'app_outside_posts') { const id = (u.searchParams.get('id') || '').replace(/^eq\./, ''); return ok(id ? POSTS.filter(x => x.id === id) : POSTS); }
    if (table === 'app_feed_bodies') { const id = (u.searchParams.get('outside_post_id') || '').replace(/^eq\./, ''); return ok(BODIES[id] ? [BODIES[id]] : []); }
    if (table === 'app_feed_reads') return method === 'POST' ? route.fulfill({ status: 201 }) : ok([]);
    if (table === 'app_outside_sources') return ok([{ source_key: 'kctu', enabled: true, last_ok_at: '2026-10-05T09:07:00Z', last_error: null }]);
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
  const { prefs } = await openHome(page);
  const s = await server(page);
  if (width <= 760) {
    await page.locator('#mobileMenuTab').click();
    await page.locator('#mobileMenu nav button:visible', { hasText: 'News' }).click();
  } else await page.locator('#appView>.app-nav').getByRole('button', { name: 'News', exact: true }).click();
  await expect(page.locator('#outsideView')).toBeVisible();
  await page.locator('#outsideRoot').getByRole('tab', { name: '사회운동' }).click();
  await expect(page.locator('#outsideRoot [data-os-list] [data-nw-key]')).toHaveCount(3);
  return { errors, s, prefs };
}
const root = page => page.locator('#outsideRoot');
const nd = page => root(page).locator('[data-now-detail] .nd');
const open = (page, id) => root(page).locator(`[data-os-list] [data-nw-key="outside:${id}"] .now-open`).click();
const noWideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

for (const width of [412, 884, 1440]) {
  test(`News 상세 ${width}: 원문이 요약보다 먼저·요약 칸만 채움·사진·글자 크기 서버 저장·원문 없는 글`, async ({ page }) => {
    test.setTimeout(90000);
    const { errors, s, prefs } = await start(page, width);
    await open(page, P1);
    const d = nd(page);
    await expect(d.locator('.nd-title')).toHaveText('가상 글 1');
    // 순서(S52-12 NEWS-원문먼저번역): 꼬리 줄 → 제목 → 원문 전체 → 요약 → 시사점 → 단추 줄.
    await expect(d.locator('.nd-meta > span')).toHaveText(['민주노총', '성명', '2026. 10. 6. 09:30', '가상 글쓴이']);
    const order = await d.evaluate(el => [...el.children].map(c => c.dataset.ndSummary !== undefined ? 'sum' : c.dataset.ndImplications !== undefined ? 'imp' : c.dataset.ndBody !== undefined ? 'body' : c.matches('[data-nd-acts]') ? 'acts' : c.matches('.nd-title') ? 'title' : c.matches('.nd-top') ? 'top' : '').filter(Boolean));
    expect(order).toEqual(['top', 'title', 'body', 'sum', 'imp', 'acts']);
    // 한글 사회운동 글에는 [번역]이 없다.
    await expect(d.locator('[data-nd-translate]')).toHaveCount(0);
    // AI가 아직인데 원문 전체가 보인다(글자로만 — 태그는 글자 그대로). 요약·시사점 칸에만 '만드는 중'.
    const prose = d.locator('[data-nd-prose]');
    await expect(prose.locator('p').first()).toHaveText('가상 첫 문단이다 <b>태그</b>.');
    await expect(prose.locator('b')).toHaveCount(0);
    await expect(prose.locator('h4')).toHaveText('가상 소제목');
    await expect(prose.locator('blockquote')).toHaveText('가상 인용.');
    await expect.poll(() => s.aiStarted.includes(P1)).toBe(true);
    await expect(d.locator('[data-nd-summary] .nd-bh-note')).toHaveText('만드는 중');
    await expect(d.locator('[data-nd-implications] .nd-bh-note')).toHaveText('만드는 중');
    await expect(d.locator('.nd-sum')).toHaveCount(0);
    // 사진: https만(http 주소 블록은 버림), 리퍼러 안 보냄, 늦게 불러오기, 캡션.
    const img = prose.locator('img');
    await expect(img).toHaveCount(1);
    await expect(img).toHaveAttribute('src', 'https://img.example.org/a.jpg');
    await expect(img).toHaveAttribute('referrerpolicy', 'no-referrer');
    await expect(img).toHaveAttribute('loading', 'lazy');
    await expect(prose.locator('figcaption')).toHaveText('가상 사진 설명');
    // 원문 칸 마디를 표시해 두고, AI 답이 와도 그 칸은 다시 그리지 않는지 본다.
    await prose.evaluate(el => { el.dataset.mark = '1'; });
    s.release();
    await expect(d.locator('.nd-sum')).toHaveText('가상 상세 요약.');
    await expect(d.locator('.nd-imp')).toHaveText('공공운수노조 운동 가상 공공운수노조 시사점.');
    await expect(d.locator('[data-nd-implications] [data-nd-more] .nd-reason')).toHaveText('가상 연관 이유.');
    await expect(d.locator('[data-nd-prose][data-mark="1"]')).toHaveCount(1);
    // 저장 원문을 사용자 로그인으로 읽었고, 원문 사이트·기사 먼저 읽기(open)는 부르지 않았다. 열면 읽음 한 줄.
    expect(s.calls.some(c => c.startsWith('app_feed_bodies?') && c.includes(`outside_post_id=eq.${P1}`) && c.includes('workspace_id=eq.w'))).toBe(true);
    expect(s.calls.some(c => c.includes('action=open'))).toBe(false);
    expect(s.calls.some(c => c.startsWith('app_feed_reads'))).toBe(true);
    // 글자 크기 세 단계: 기본 보통(16px) → 크게(19px, 서버 저장) → 작게(14px).
    const fs = () => prose.evaluate(el => getComputedStyle(el).fontSize);
    expect(await fs()).toBe('16px');
    await expect(d.locator('[data-nd-font="m"]')).toHaveAttribute('aria-pressed', 'true');
    await d.locator('[data-nd-font="l"]').click();
    expect(await fs()).toBe('19px');
    await expect.poll(() => prefs.value?.news_font).toBe('l');
    await d.locator('[data-nd-font="s"]').click();
    expect(await fs()).toBe('14px');
    await expect.poll(() => prefs.value?.news_font).toBe('s');
    // 단추 줄 끝 [원래 사이트 ↗](새 창, 리퍼러 안 보냄).
    const site = d.locator('[data-nd-acts] .nd-site');
    await expect(site).toHaveText('원래 사이트 ↗');
    await expect(site).toHaveAttribute('href', 'https://nodong.org/statement/1');
    await expect(site).toHaveAttribute('rel', 'noopener noreferrer');
    expect(await noWideScroll(page)).toBe(true);

    // 폰: 상세 전체 화면, 주소에 글 id, 뒤로 키 = 목록(주소에서도 빠짐).
    if (width <= 760) {
      await expect(root(page).locator('#nowMain')).toBeHidden();
      await expect.poll(() => new URL(page.url()).searchParams.get('item')).toBe(`outside:${P1}`);
      await page.goBack();
      await expect(root(page).locator('#nowMain')).toBeVisible();
      await expect.poll(() => new URL(page.url()).searchParams.get('item')).toBe(null);
      await expect.poll(() => new URL(page.url()).searchParams.get('view')).toBe('news');
    } else {
      // 폴드 펼침·PC: 왼쪽 목록 | 오른쪽 상세, 폭 끌기 경계.
      await expect(root(page).locator('[data-os-list] [data-nw-key]').first()).toBeVisible();
      await expect(root(page).locator('.split-resize-handle')).toHaveCount(1);
      await expect.poll(() => new URL(page.url()).searchParams.get('item')).toBe(`outside:${P1}`);
    }

    // 원문이 없는 글(사이트가 막음): 까닭 한 줄 + [원래 사이트 ↗]. 글자 크기는 고른 값 그대로.
    await open(page, P2);
    const why = nd(page).locator('[data-nd-body] [data-nd-why]');
    await expect(why).toContainText('사이트가 자동 읽기를 막아 둠');
    await expect(why.getByRole('link', { name: /원래 사이트/ })).toHaveAttribute('href', 'https://nodong.org/statement/2');
    await expect(nd(page).locator('[data-nd-prose]')).toHaveCount(0);
    await expect(nd(page)).toHaveAttribute('data-font', 's');
    if (width <= 760) { await page.goBack(); await expect(root(page).locator('#nowMain')).toBeVisible(); }
    // 유료벽: 있는 만큼 + '나머지는 원래 사이트 ↗'.
    await open(page, P3);
    await expect(nd(page).locator('[data-nd-prose] p')).toHaveText(['가상 앞부분 문단.']);
    await expect(nd(page).locator('[data-nd-body] [data-nd-why]')).toContainText('유료 기사라 앞부분만');
    await expect(nd(page).locator('[data-nd-body] [data-nd-why] a')).toHaveText('나머지는 원래 사이트 ↗');
    expect(errors).toEqual([]);
  });
}

test('News 상세 PC: 주소에 남은 글은 새로고침해도 그 글이 열린다', async ({ page }) => {
  test.setTimeout(60000);
  const { errors, s } = await start(page, 1280);
  s.release();
  await open(page, P3);
  await expect(nd(page).locator('.nd-title')).toHaveText('가상 글 3');
  await expect.poll(() => new URL(page.url()).searchParams.get('item')).toBe(`outside:${P3}`);
  await page.reload();
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, { timeout: 20000 });
  await expect(nd(page).locator('.nd-title')).toHaveText('가상 글 3');
  expect(errors).toEqual([]);
});
