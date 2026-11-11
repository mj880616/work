import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
import { expectPickerAtButton } from './helpers/picker-anchor.mjs';
import { segBox } from './helpers/seg-box.mjs'; // UI-보기탭한모양(S52-17): 보기 탭은 보이는 알약 자리로 잰다
// OUTSIDE-바깥성명 ④ 화면 1 → S51-8 NEWS-전면개편 P4b(docs/design/news-overhaul.md 6.1·6.3절, 시안 mockups/news-overhaul.html): News 목록(?view=outside).
// 탭 [전체][사회운동][언론][보관] — 폰 아래 떠 있는 탭 줄·폴드 오른쪽 아래·PC 위, 좌우 밀기 = 탭 이동, 고른 탭은 서버 view_prefs.news_tab.
// 위 찾기 칸(제목 바로 거르기), [매체: 전체 ▾](자료실 분류 창 부품), 줄은 날짜 묶음 → 흰 상자 안 줄(매체 색 띠·같은 색 이름·분류 꼬리표·시각·★),
// 안 읽은 글 굵게·읽은 글 흐리게(app_feed_reads, 상세를 열면 넣음). ⋯ → [단체 켜고 끄기]는 서버 표(app_outside_sources), 뒤로가기 한 번 = 목록.
// 서버는 흉내 낸다(시계 2026-10-06 10:00 서울, home-entry.mjs). 글은 모두 가상의 글.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const CATALOG = [
  { key: 'kctu', name: '민주노총', group: 'labor', lang: 'ko' },
  { key: 'kptu', name: '공공운수노조', group: 'labor', lang: 'ko' },
  { key: 'laborparty', name: '노동당', group: 'party', lang: 'ko' },
  { key: 'kgreens', name: '녹색당', group: 'party', lang: 'ko' },
  { key: 'jacobin', name: 'Jacobin', group: 'foreign', lang: 'en' },
];
const POSTS = [
  { id: 'p1', source_key: 'kctu', kind: 'statement', lang: 'ko', title: '[성명] 가상 성명 하나', title_ko: null, url: 'https://nodong.org/statement/101', published_at: '2026-10-06T00:30:00Z', fetched_at: '2026-10-06T00:40:00Z', summary_ko: '가상 성명 한 문장 요약이다.', key_sentences: [], has_body: true },
  { id: 'p2', source_key: 'laborparty', kind: 'comment', lang: 'ko', title: '[논평] 가상 논평 둘', title_ko: null, url: 'https://laborparty.kr/?mod=document&page_id=13642&uid=7', published_at: '2026-10-05T03:00:00Z', fetched_at: '2026-10-05T09:07:00Z', summary_ko: '가상 논평 요약이다.', key_sentences: [], has_body: true },
  { id: 'p3', source_key: 'jacobin', kind: 'article', lang: 'en', title: 'An Imaginary Article', title_ko: '가상의 외국 글', url: 'https://jacobin.com/2026/10/imaginary', published_at: '2026-10-05T01:00:00Z', fetched_at: '2026-10-04T09:07:00Z', summary_ko: '첫 요약 문장임. 둘째 요약 문장임.', key_sentences: [{ orig: 'An imaginary key line.', ko: '가상의 핵심 문장.' }], has_body: false },
  { id: 'p4', source_key: 'kgreens', kind: 'press', lang: 'ko', title: '[보도자료] 가상 보도자료', title_ko: null, url: 'https://kgreens.org/press/?bmode=view&idx=3', published_at: '2026-10-01T05:00:00Z', fetched_at: '2026-10-01T09:07:00Z', summary_ko: '가상 보도자료 요약이다.', key_sentences: [], has_body: true },
  { id: 'p5', source_key: 'kctu', kind: 'statement', lang: 'ko', title: '[성명] 오래된 가상 성명', title_ko: null, url: 'https://nodong.org/statement/1', published_at: '2023-03-02T01:00:00Z', fetched_at: '2026-10-01T09:07:00Z', summary_ko: '오래된 성명 요약이다. 가상 공대위 공동 입장이다.', key_sentences: [], has_body: false },
];
// 언론 쪽(가짜): 국내 매체 하나·외국 매체 하나. 사회운동 글과 시각이 섞이게.
const NEWS_CATALOG = [{ key: 'news-fake-a', name: '가짜일보', region: 'domestic', lang: 'ko' }, { key: 'news-fake-en', name: 'Fake Wire', region: 'foreign', lang: 'en' }];
const NEWS = [
  { id: 'a1', lane: 'channel', url: 'https://example.org/a1', title: '가짜 언론 기사', lang: 'ko', publisher: '가짜일보', source_key: 'news-fake-a', published_at: '2026-10-06T00:50:00Z', scrapped_at: '2026-10-06T00:55:00Z', created_at: '2026-10-06T00:56:00Z', state: 'ok', summary: '가짜 요약.', body_kind: null, title_ko: null, starred_at: '2026-10-06T00:58:00Z' },
  { id: 'e1', lane: 'media', url: 'https://example.org/e1', title: 'A fake wire story', lang: 'en', publisher: 'Fake Wire', source_key: 'news-fake-en', published_at: '2026-10-05T02:00:00Z', scrapped_at: null, created_at: '2026-10-05T02:10:00Z', state: 'ok', summary: 'One line.', body_kind: null, title_ko: '가짜 외신 기사', starred_at: null },
];
const SENTENCES = { p1: [{ idx: 0, text: '가상 본문 첫 문장이다.' }, { idx: 1, text: '가상 본문 둘째 문장이다.' }] };

async function outsideServer(page) {
  const server = {
    sources: new Map([['kctu', true], ['laborparty', true], ['kgreens', true], ['jacobin', true]].map(([k, on]) => [k, { source_key: k, enabled: on, last_ok_at: '2026-10-05T09:07:00Z', last_error: null }])),
    // 같은 표의 뉴스 클리핑 매체 줄(news- 키): 사회운동 Now 계산에 섞이면 안 된다(흉내 서버는 조건을 무시하고 함께 돌려준다).
    newsRows: [{ source_key: 'news-fake-en', enabled: true, last_ok_at: '2026-10-06T00:30:00Z', last_error: null }, { source_key: 'news-fake-a', enabled: true, last_ok_at: '2026-10-06T00:30:00Z', last_error: null }],
    seen: [{ seen_at: '2026-10-05T00:00:00Z' }], calls: [], extra: [], reads: new Set(['p2']),
  };
  // 바로 읽기(read_now)는 열어 줄 때까지 붙잡아 둔다('읽는 중…' 확인용).
  let release;
  server.gate = new Promise(r => { release = r; });
  server.release = () => release();
  server.sources.get('kgreens').last_error = 'robots';
  server.sources.get('laborparty').last_error = 'parse_empty';
  await page.route(SB + '/**', async route => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname, method = req.method();
    const ok = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (p === '/functions/v1/outside-feed') {
      const action = u.searchParams.get('action');
      server.calls.push({ what: 'edge', action, method, auth: req.headers().authorization || '', body: req.postDataJSON?.() ?? null });
      if (action === 'read_now' && method === 'POST') {
        await server.gate;
        const key = req.postDataJSON().source;
        server.extra.unshift({ id: 'n-' + key, source_key: key, kind: 'statement', lang: 'ko', title: '[성명] 바로 읽은 가상 성명', title_ko: null, url: 'https://www.kptu.net/board/detail.aspx?mid=F686C1F3&idx=1', published_at: '2026-10-06T00:50:00Z', fetched_at: '2026-10-06T01:00:00Z', summary_ko: '바로 읽은 가상 요약이다.', key_sentences: [], has_body: false });
        const row = server.sources.get(key); if (row) row.last_ok_at = '2026-10-06T01:00:00Z';
        return ok({ ok: true, source: key, status: 'ok', inserted: 1, deferred: 0 });
      }
      return action === 'catalog' && method === 'POST' ? ok({ ok: true, sources: CATALOG }) : ok({ ok: false, error: 'UNKNOWN_ACTION' }, 400);
    }
    // S51-8 News: 언론 카탈로그·기사(가짜 둘), 읽음 표(p2만 읽음 → 넣으면 기억).
    if (p === '/functions/v1/news-feed') {
      const action = u.searchParams.get('action');
      if (action === 'catalog') return ok({ ok: true, sources: NEWS_CATALOG, limits: { fill: 10, translate: 20, keyword_items: 30, keywords: 30 } });
      if (action === 'fill_now') return ok({ ok: true, done: 0, status: 'nothing' });
      return ok({ ok: false }, 400);
    }
    if (p === '/rest/v1/app_news_items') {
      server.calls.push({ what: 'app_news_items', method, query: decodeURIComponent(u.search) });
      const inKeys = /^in\.\((.*)\)$/.exec(u.searchParams.get('source_key') || '')?.[1]?.split(',');
      return ok(NEWS.filter(r => !inKeys || inKeys.includes(r.source_key)));
    }
    if (p === '/rest/v1/app_news_keywords' || p === '/rest/v1/app_news_folders' || p === '/rest/v1/app_notes') return ok([]);
    if (p === '/rest/v1/app_feed_reads') {
      const body = req.postDataJSON?.() ?? null;
      server.calls.push({ what: 'app_feed_reads', method, query: decodeURIComponent(u.search), body, prefer: req.headers().prefer || '' });
      if (method === 'POST') { server.reads.add(body.outside_post_id || body.news_item_id); return route.fulfill({ status: 201 }); }
      const col = u.searchParams.has('outside_post_id') ? 'outside_post_id' : 'news_item_id';
      const ids = /^in\.\((.*)\)$/.exec(u.searchParams.get(col) || '')?.[1]?.split(',') || [];
      return ok(ids.filter(id => server.reads.has(id)).map(id => ({ [col]: id })));
    }
    // S48-27 Now: 관심 주제·환류 기록·보관 표시는 비어 있음, 관심 후보 묻기는 '아직'(서버 규칙).
    if (p.startsWith('/rest/v1/app_now_')) return method === 'POST' ? route.fulfill({ status: 201 }) : ok([]);
    if (p === '/functions/v1/ai-assist' && req.postDataJSON?.()?.kind === 'now_interests') return ok({ ok: true, kind: 'now_interests', ran: false, added: 0 });
    if (!p.startsWith('/rest/v1/app_outside_')) return route.fallback();
    const body = req.postDataJSON?.() ?? null;
    server.calls.push({ what: p.slice('/rest/v1/'.length), method, query: decodeURIComponent(u.search), body });
    if (p === '/rest/v1/app_outside_posts') {
      const inKeys = /^in\.\((.*)\)$/.exec(u.searchParams.get('source_key') || '')?.[1]?.split(',');
      const rows = [...server.extra, ...POSTS].filter(r => !inKeys || inKeys.includes(r.source_key));
      const offset = Number(u.searchParams.get('offset') || 0), limit = Number(u.searchParams.get('limit') || 100);
      return ok(rows.slice(offset, offset + limit));
    }
    if (p === '/rest/v1/app_outside_sentences') return ok(SENTENCES[(u.searchParams.get('post_id') || '').replace(/^eq\./, '')] || []);
    if (p === '/rest/v1/app_outside_seen') {
      if (method === 'PATCH') { server.seen = [{ seen_at: body.seen_at }]; return ok(server.seen); }
      return ok(server.seen);
    }
    if (p === '/rest/v1/app_outside_sources') {
      const key = (u.searchParams.get('source_key') || '').replace(/^eq\./, '');
      if (method === 'PATCH') { const row = server.sources.get(key); if (!row) return ok([]); row.enabled = body.enabled; return ok([row]); }
      if (method === 'POST') { const row = { source_key: body.source_key, enabled: body.enabled, last_ok_at: null, last_error: null }; server.sources.set(row.source_key, row); return ok([row], 201); }
      if (u.searchParams.get('source_key') === 'like.news-*') return ok(server.newsRows);
      return ok([...server.sources.values(), ...server.newsRows]);
    }
    return ok([]);
  });
  return server;
}

async function start(page, width, initialPrefs = null) {
  await page.setViewportSize({ width, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  if (initialPrefs) await installViewPrefsServer(page, initialPrefs);
  const home = await openHome(page);
  const server = await outsideServer(page);
  server.prefs = home.prefs;
  return { errors, server };
}
async function openOutside(page, width) {
  if (width <= 760) {
    await page.locator('#mobileMenuTab').click();
    await page.locator('#mobileMenu nav button:visible', { hasText: 'News' }).click();
  } else await page.locator('#appView>.app-nav').getByRole('link', { name: 'News', exact: true }).click();
  await expect(page.locator('#outsideView')).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get('view')).toBe('news');
}
const root = page => page.locator('#outsideRoot');
const rows = (page, panel) => root(page).locator(`${panel} [data-nw-key]`);
const row = (page, key) => root(page).locator(`[data-nw-key="${key}"]:visible`);
const tab = (page, id) => root(page).locator(`[data-os-tab="${id}"]`);
const noWideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
// 줄·탭 밖(날짜 머리)에서 손가락으로 왼쪽(dx<0)·오른쪽으로 민다.
async function swipeOn(locator, dx) {
  await locator.evaluate((el, dx) => {
    const r = el.getBoundingClientRect(), y = r.top + r.height / 2, x0 = r.left + r.width / 2;
    const t = (type, x) => { const p = new Touch({ identifier: 1, target: el, clientX: x, clientY: y }); el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [p], changedTouches: [p] })); };
    t('touchstart', x0); t('touchend', x0 + dx);
  }, dx);
}

for (const width of [412, 884, 1280]) {
  test(`News 목록 ${width}: 탭 넷 자리·[전체] 한 줄·색 띠·꼬리표·읽음 굵기·찾기·매체 선택·탭 서버 저장·단체 켜고 끄기`, async ({ page }) => {
    test.setTimeout(90000);
    const { errors, server } = await start(page, width);
    await openOutside(page, width);
    // 탭 넷, 처음은 [전체](news_tab·옛 now_tab 둘 다 없음 → 저장 안 함).
    await expect(root(page).getByRole('tab')).toHaveText(['전체', '사회운동', '언론', '보관', '밑줄']);
    await expect(tab(page, 'all')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#osTitle')).toHaveText('News');
    // [전체] = 사회운동 글 + 언론 기사를 시각 최신 순으로(날짜 묶음 → 흰 상자).
    const all = rows(page, '[data-nw-all]');
    await expect(all).toHaveCount(POSTS.length + NEWS.length);
    await expect(all.first()).toHaveAttribute('data-nw-key', 'news:a1');
    await expect(root(page).locator('[data-nw-all] .nw-day-head').first()).toHaveText(/^오늘/);
    await expect(root(page).locator('[data-nw-all] .nw-card')).toHaveCount(4);
    // 줄: 색 띠·같은 색 매체 이름·분류 꼬리표(성명 = 성명·논평·보도자료, 국제 = 외국 글)·시각·★(별표한 기사). 요약 줄은 없다.
    const p1 = row(page, 'outside:p1');
    await expect(p1.locator('.nw-title')).toHaveText('[성명] 가상 성명 하나');
    await expect(p1.locator('.nw-src')).toHaveText('민주노총');
    await expect(p1.locator('.nw-tag')).toHaveText('성명');
    await expect(p1.locator('.nw-time')).toHaveText('09:30');
    await expect(p1).toHaveAttribute('style', '--nw-c:var(--ds-news-id-kctu);--nw-bar:var(--ds-news-id-kctu-bar)');
    const [bar, src] = await Promise.all([p1.locator('.nw-bar').evaluate(el => getComputedStyle(el).backgroundColor), p1.locator('.nw-src').evaluate(el => getComputedStyle(el).color)]);
    expect(bar).toBe(src);
    await expect(row(page, 'outside:p3').locator('.nw-tag')).toHaveText('국제');
    // 공대위 표시(L3): 매체 이름 바로 뒤 작은 꼬리표 — 민주노총·공공운수노조 글 중 제목·요약에 '공대위'가 든 글만.
    await expect(row(page, 'outside:p5').locator('.nw-meta > span:nth-child(-n+2)')).toHaveText(['민주노총', '공대위']);
    await expect(p1.locator('.nw-badge')).toHaveCount(0);
    await expect(row(page, 'news:e1').locator('.nw-tag')).toHaveText('국제');
    await expect(row(page, 'news:e1').locator('.nw-title')).toHaveText('가짜 외신 기사');
    await expect(row(page, 'news:a1').locator('.nw-tag')).toHaveCount(0);
    await expect(row(page, 'news:a1').locator('.nw-star')).toHaveCount(1);
    await expect(root(page).locator('.os-lead, .nc-sum')).toHaveCount(0);
    // 읽음: 서버 표에 있는 p2만 흐리게, 나머지는 굵게. 묶음 머리에 새 글 수.
    await expect(row(page, 'outside:p2')).toHaveClass(/is-read/);
    await expect(p1).toHaveClass(/is-new/);
    expect(await p1.locator('.nw-title').evaluate(el => getComputedStyle(el).fontWeight)).toBe('700');
    expect(server.calls.find(c => c.what === 'app_feed_reads' && c.method === 'GET').query).toContain('workspace_id=eq.w');
    expect(await noWideScroll(page)).toBe(true);

    // 탭 자리(명진 11/06): 폰 = 아래 가운데 떠 있음, 폴드 = 오른쪽 아래, PC = 위.
    const tb = await segBox(root(page).locator('[data-os-tabs]')), vw = width, top = await root(page).locator('[data-nw-top]').boundingBox();
    if (width <= 760) { expect(Math.abs(tb.x + tb.width / 2 - vw / 2)).toBeLessThan(4); expect(tb.y).toBeGreaterThan(700); }
    else if (width < 1200) { expect(vw - (tb.x + tb.width)).toBeLessThan(20); expect(tb.y).toBeGreaterThan(800); }
    else expect(tb.y + tb.height).toBeLessThanOrEqual(top.y + 1);

    // 상세를 열면 읽음 한 줄(on_conflict + ignore-duplicates = 이미 있으면 그대로), 줄은 흐리게.
    await p1.locator('.now-open').click();
    await expect.poll(() => server.calls.filter(c => c.what === 'app_feed_reads' && c.method === 'POST').map(c => c.body)).toContainEqual({ workspace_id: 'w', outside_post_id: 'p1' });
    const post = server.calls.find(c => c.what === 'app_feed_reads' && c.method === 'POST' && c.body.outside_post_id === 'p1');
    expect(post.query).toBe('?on_conflict=outside_post_id');
    expect(post.prefer).toContain('resolution=ignore-duplicates');
    if (width <= 760) await page.goBack();
    await expect(row(page, 'outside:p1')).toHaveClass(/is-read/);

    // 위 찾기 칸: 글자를 넣으면 지금 목록에서 제목으로 바로 거른다(서버 안 부름).
    const find = root(page).locator('[data-nw-find]');
    await find.fill('외신');
    await expect(rows(page, '[data-nw-all]')).toHaveCount(1);
    await find.fill('');
    await expect(rows(page, '[data-nw-all]')).toHaveCount(POSTS.length + NEWS.length);

    // [매체: 전체 ▾]: 자료실 분류 창과 같은 부품 — 전체 → 묶음 → 켠 매체. 고르면 그 매체 글만(서버에 그 키만 묻는다).
    const dd = root(page).locator('[data-nw-media]');
    await expect(dd).toHaveText('매체: 전체 ▾');
    await dd.click();
    const pick = page.locator('#nwMediaPicker');
    await expect(pick).toBeVisible();
    await expect(pick.locator('.lu-move-item')).toHaveText([/^전체/, '노동', '민주노총', '정당', '노동당', '녹색당', '외국', 'Jacobin', '언론 국내', '가짜일보', '언론 외국', 'Fake Wire']);
    await expect(pick.locator('.lu-move-foot')).toBeHidden();
    await pick.locator('[data-lu-move-folder="g:party"]').click();
    await expect(dd).toHaveText('매체: 정당 ▾');
    await expect(rows(page, '[data-nw-all]')).toHaveCount(2);
    expect(server.calls.filter(c => c.what === 'app_outside_posts').at(-1).query).toContain('source_key=in.(laborparty,kgreens)');
    await dd.click();
    await pick.locator('[data-lu-move-folder="n:news-fake-en"]').click();
    await expect(rows(page, '[data-nw-all]')).toHaveCount(1);
    expect(server.calls.filter(c => c.what === 'app_news_items').at(-1).query).toContain('source_key=in.(news-fake-en)');
    await dd.click();
    await pick.locator('[data-lu-move-folder="all"]').click();
    await expect(rows(page, '[data-nw-all]')).toHaveCount(POSTS.length + NEWS.length);

    // 탭 이동: 폰·폴드는 줄 밖(날짜 머리)을 왼쪽으로 밀어서, PC는 눌러서. 고른 탭은 서버 view_prefs.news_tab.
    if (width < 1200) await swipeOn(root(page).locator('[data-nw-all] .nw-day-head').first(), -160);
    else await tab(page, 'movement').click();
    await expect(tab(page, 'movement')).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => server.prefs.value?.news_tab).toBe('movement');
    const mv = rows(page, '[data-os-list]');
    await expect(mv).toHaveCount(POSTS.length);
    await expect(root(page).locator('[data-os-when]')).toHaveText('마지막으로 읽음 어제 18:07 · 다음 곧(08:07 예정분)');
    // [사회운동] 탭의 매체 창에는 언론이 없다.
    await dd.click();
    await expect(pick.locator('.lu-move-item')).toHaveText([/^전체/, '노동', '민주노총', '정당', '노동당', '녹색당', '외국', 'Jacobin']);
    await page.keyboard.press('Escape');
    // 글 줄 위를 밀면 탭이 아니라 줄 밀기(숨기기·보관)의 몫 — 탭은 그대로.
    if (width < 1200) { await swipeOn(row(page, 'outside:p4'), -160); await expect(tab(page, 'movement')).toHaveAttribute('aria-selected', 'true'); }

    // ⋯ → 단체 켜고 끄기: 카탈로그 단체마다 켬/끔 + 상태(마지막 읽은 시각·막힘). 위 줄·탭 줄은 감춘다.
    await root(page).locator('[data-os-more]').click();
    await page.locator('#osMenu').getByRole('button', { name: '단체 켜고 끄기' }).click();
    const sw = key => root(page).locator(`[data-os-source="${key}"]`);
    await expect(sw('kctu')).toBeVisible();
    await expect(root(page).locator('[data-nw-top]')).toBeHidden();
    await expect(root(page).locator('[data-os-tabs]')).toBeHidden();
    await expect(sw('kptu')).toHaveAttribute('aria-checked', 'false');
    await expect(root(page).locator('[data-os-on-count]')).toHaveText('켬 4');
    await expect(root(page).locator('.os-src-note.is-bad')).toHaveText(['못 읽음 · 사이트 구조 바뀜', '못 읽음 · 사이트가 자동 읽기 막음']);
    await sw('kptu').click();
    await expect(sw('kptu')).toHaveAttribute('aria-checked', 'true');
    expect(server.calls.filter(c => c.what === 'app_outside_sources' && c.method === 'POST').at(-1).body).toEqual({ workspace_id: 'w', source_key: 'kptu', enabled: true });
    await expect.poll(() => server.calls.filter(c => c.what === 'edge' && c.action === 'read_now').length).toBe(1);
    await expect(root(page).locator('.os-src-row:has([data-os-source="kptu"]) [data-os-reading] [data-wait]')).toHaveCount(1);
    server.release();
    await expect(root(page).locator('.os-src-row:has([data-os-source="kptu"]) .os-src-note')).toHaveText('마지막 10. 6. (화) 10:00');
    // 뒤로가기 한 번 = 목록. 바로 읽은 글이 곧바로 보인다.
    await page.goBack();
    await expect(mv).toHaveCount(POSTS.length + 1);
    await expect(row(page, 'outside:n-kptu').locator('.nw-title')).toHaveText('[성명] 바로 읽은 가상 성명');
    await expect.poll(() => server.calls.some(c => c.what === 'app_outside_seen' && c.method === 'PATCH')).toBe(true);
    expect(await noWideScroll(page)).toBe(true);

    // 새로고침해도 마지막 탭은 서버에서 다시 읽는다(기기 저장 없음).
    await page.reload();
    await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, { timeout: 20000 });
    await expect(page.locator('#outsideView')).toBeVisible();
    await expect(tab(page, 'movement')).toHaveAttribute('aria-selected', 'true');
    expect(errors).toEqual([]);
  });
}

test('News 처음 탭: news_tab이 없으면 옛 now_tab을 바꿔 한 번 옮겨 적는다(옛 값은 그대로)', async ({ page }) => {
  const { server } = await start(page, 1280, { now_tab: 'news' });
  await openOutside(page, 1280);
  await expect(tab(page, 'media')).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => server.prefs.value?.news_tab).toBe('media');
  expect(server.prefs.value.now_tab).toBe('news');
});

// S54-04 UI-고르기창버튼아래(11/08 명진 결정 B): [매체: 전체 ▾] 창은 폰·폴드·PC 모두 누른 버튼 바로 아래 작은 창 — 첫 줄 '전체'가 다 보이고 아래 메뉴 줄과 겹치지 않는다.
for (const width of [390, 884, 1280]) test(`News 매체 고르기 창은 누른 버튼 바로 아래 ${width}`, async ({ page }) => {
  const { errors } = await start(page, width);
  await openOutside(page, width);
  const dd = root(page).locator('[data-nw-media]');
  await dd.click();
  const pick = page.locator('#nwMediaPicker');
  await expectPickerAtButton(page, pick, dd);
  await expect(pick.locator('.lu-move-item').first()).toHaveText(/^전체/);
  await expect(pick.locator('.lu-move-item').first()).toBeInViewport({ ratio: 1 });
  await pick.locator('[data-lu-move-folder="g:party"]').click();
  await expect(pick).toBeHidden();
  await expect(dd).toHaveText('매체: 정당 ▾');
  expect(errors).toEqual([]);
});
