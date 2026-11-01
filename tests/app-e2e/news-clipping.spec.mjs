import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
// NEWS-클리핑 C1(docs/design/news-clipping.md, 명진 11/01 22:34): '뉴스 클리핑' 메뉴(?view=news).
// 한 목록(꼬리표 채널/자동) · 한 문장 요약 늘 보임 · 본문 접기([본문 열기]=news-feed open) · 외국어 [번역](저장본 재사용) · 유료는 공개 요약만 + 원문
// · ⋯ [지금 채우기]·[키워드 고치기]·[매체 켜고 끄기](서버 저장, 뒤로가기 한 번 = 목록) · 폰 좌우 밀기로 칩 이동. 사회운동 Now ⋯에도 [지금 채우기](read_now 재사용).
// 서버는 흉내 낸다(시계 2026-10-06 10:00 서울, home-entry.mjs). 기사·매체·주소는 모두 가짜(example.org).
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const CATALOG = [
  { key: 'news-fake-a', name: '가짜노동신문', region: 'domestic', lang: 'ko' },
  { key: 'news-fake-b', name: '가짜일보', region: 'domestic', lang: 'ko' },
  { key: 'news-fake-en', name: 'Fake Wire', region: 'foreign', lang: 'en' },
];
const LIMITS = { fill: 10, translate: 20, open: 60, keyword_items: 30, keywords: 30 };
const ITEMS = () => [
  { id: 'c1', lane: 'channel', url: 'https://example.org/c1', title: '가짜 채널 기사', lang: 'ko', publisher: '가짜노동신문', source_key: null, keywords: [], published_at: '2026-10-06T00:00:00Z', scrapped_at: '2026-10-06T00:20:00Z', created_at: '2026-10-06T00:21:00Z', state: 'ok', summary: '가짜 채널 기사 한 문장 요약.', body_kind: null, title_ko: null, translated_at: null, starred_at: null, folder_id: null, _body: null },
  { id: 'k1', lane: 'keyword', url: 'https://news.google.com/rss/articles/fake-1', title: '가짜 키워드 기사', lang: 'ko', publisher: '가짜일보', source_key: null, keywords: ['가짜어'], published_at: '2026-10-05T22:00:00Z', scrapped_at: null, created_at: '2026-10-06T00:10:00Z', state: 'ok', summary: '가짜 키워드 요약.', body_kind: null, title_ko: null, translated_at: null, starred_at: null, folder_id: null, _body: null },
  { id: 'e1', lane: 'media', url: 'https://example.org/en1', title: 'A fake foreign story', lang: 'en', publisher: 'Fake Wire', source_key: 'news-fake-en', keywords: [], published_at: '2026-10-05T03:00:00Z', scrapped_at: null, created_at: '2026-10-05T03:10:00Z', state: 'ok', summary: 'One fake line.', body_kind: 'full', title_ko: null, translated_at: null, starred_at: null, folder_id: null, _body: 'Fake body paragraph.' },
  { id: 'p1', lane: 'channel', url: 'https://example.org/paid', title: '가짜 유료 기사', lang: 'ko', publisher: '가짜일보', source_key: null, keywords: [], published_at: null, scrapped_at: '2026-10-05T02:00:00Z', created_at: '2026-10-05T02:01:00Z', state: 'paywall', summary: '공개된 가짜 요약.', body_kind: 'lead', title_ko: null, translated_at: null, starred_at: null, folder_id: null, _body: '공개된 가짜 앞부분.' },
  { id: 'w1', lane: 'channel', url: 'https://www.example.org/wait', title: null, lang: 'ko', publisher: null, source_key: null, keywords: [], published_at: null, scrapped_at: '2026-10-04T02:00:00Z', created_at: '2026-10-04T02:01:00Z', state: 'pending', summary: null, body_kind: null, title_ko: null, translated_at: null, starred_at: null, folder_id: null, _body: null },
];

async function newsServer(page) {
  const server = { items: ITEMS(), keywords: [{ word: '가짜어', enabled: true, created_at: '2026-10-01T00:00:00Z' }], sources: new Map([['news-fake-a', { source_key: 'news-fake-a', enabled: true, last_ok_at: '2026-10-06T00:07:00Z', last_error: null }]]), calls: [] };
  await page.route(SB + '/**', async route => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname, method = req.method();
    const ok = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    const body = req.postDataJSON?.() ?? null;
    if (p === '/functions/v1/news-feed') {
      const action = u.searchParams.get('action');
      server.calls.push({ what: 'edge', action, method, auth: req.headers().authorization || '', body });
      if (action === 'catalog') return ok({ ok: true, sources: CATALOG, limits: LIMITS });
      if (action === 'open') { const it = server.items.find(i => i.id === body.id); it._body = '가짜 본문 첫 문단.'; it.body_kind = 'full'; return ok({ ok: true, status: 'ok' }); }
      if (action === 'translate') { const it = server.items.find(i => i.id === body.id); it.title_ko = '가짜 외국 기사'; it._body_ko = '가짜 번역 본문.'; it.translated_at = '2026-10-06T01:00:00Z'; return ok({ ok: true, status: 'translated' }); }
      if (action === 'fill_now') { const it = server.items.find(i => i.id === 'w1'); Object.assign(it, { state: 'ok', title: '채운 가짜 기사', summary: '채운 가짜 요약.' }); return ok({ ok: true, done: 1, deferred: 0 }); }
      return ok({ ok: false, error: 'UNKNOWN_ACTION' }, 400);
    }
    if (p === '/functions/v1/outside-feed') {
      const action = u.searchParams.get('action');
      server.calls.push({ what: 'outside-edge', action, body });
      if (action === 'catalog') return ok({ ok: true, sources: [{ key: 'kctu', name: '가짜총연맹', group: 'kctu', lang: 'ko' }] });
      if (action === 'read_now') return ok({ ok: true, source: body.source, status: 'ok', inserted: 0 });
      return ok({ ok: false }, 400);
    }
    if (p.startsWith('/rest/v1/app_outside_') && !p.endsWith('app_outside_sources')) return ok([]);
    if (!p.startsWith('/rest/v1/app_news_') && p !== '/rest/v1/app_outside_sources') return route.fallback();
    server.calls.push({ what: p.slice('/rest/v1/'.length), method, query: decodeURIComponent(u.search), body });
    if (p === '/rest/v1/app_news_items') {
      const id = (u.searchParams.get('id') || '').replace(/^eq\./, '');
      const view = it => { const { _body, _body_ko, ...row } = it; return { ...row, body: _body ?? null, body_ko: _body_ko ?? null }; };
      if (id) return ok(server.items.filter(i => i.id === id).map(view));
      const lane = u.searchParams.get('lane');
      const rows = server.items.filter(i => !lane || (lane === 'eq.channel' ? i.lane === 'channel' : i.lane !== 'channel'));
      return ok(rows.map(({ _body, _body_ko, ...row }) => row));
    }
    if (p === '/rest/v1/app_news_keywords') {
      const word = (u.searchParams.get('word') || '').replace(/^eq\./, '');
      if (method === 'POST') { const row = { word: body.word, enabled: body.enabled, created_at: '2026-10-06T01:00:00Z' }; server.keywords.push(row); return ok([row], 201); }
      if (method === 'PATCH') { const row = server.keywords.find(k => k.word === word); row.enabled = body.enabled; return ok([row]); }
      if (method === 'DELETE') { server.keywords = server.keywords.filter(k => k.word !== word); return route.fulfill({ status: 204 }); }
      return ok(server.keywords);
    }
    if (p === '/rest/v1/app_outside_sources') {
      const key = (u.searchParams.get('source_key') || '').replace(/^eq\./, '');
      if (method === 'PATCH') { const row = server.sources.get(key); row.enabled = body.enabled; return ok([row]); }
      if (method === 'POST') { const row = { source_key: body.source_key, enabled: body.enabled, last_ok_at: null, last_error: null }; server.sources.set(row.source_key, row); return ok([row], 201); }
      const like = u.searchParams.get('source_key');
      return ok([...server.sources.values()].filter(r => like !== 'like.news-*' || r.source_key.startsWith('news-')));
    }
    return ok([]);
  });
  return server;
}

async function start(page, width) {
  await page.setViewportSize({ width, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await openHome(page);
  const server = await newsServer(page);
  return { errors, server };
}
async function openNews(page, width) {
  if (width <= 760) {
    await page.locator('#mobileMenuTab').click();
    await page.locator('#mobileMenu nav button:visible', { hasText: '뉴스 클리핑' }).click();
  } else await page.locator('#appView>.app-nav').getByRole('button', { name: '뉴스 클리핑', exact: true }).click();
  await expect(page.locator('#newsView')).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get('view')).toBe('news');
}
const root = page => page.locator('#newsRoot');
const items = page => root(page).locator('[data-nc-item]');
const item = (page, id) => root(page).locator(`[data-nc-item="${id}"]`);
const noWideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

for (const width of [412, 884, 1440]) {
  test(`뉴스 클리핑 ${width}: 한 목록·요약·본문 열기·번역·지금 채우기·키워드·매체(서버 저장)`, async ({ page }) => {
    test.setTimeout(90000);
    const { errors, server } = await start(page, width);
    await openNews(page, width);
    await expect(items(page)).toHaveCount(5);
    expect(await noWideScroll(page)).toBe(true);
    // 카탈로그는 사용자 로그인으로 Edge에서, 목록은 자기 작업공간·지우지 않은 줄만.
    expect(server.calls.find(c => c.what === 'edge')).toMatchObject({ action: 'catalog', method: 'POST', auth: expect.stringMatching(/^Bearer /) });
    const listQuery = server.calls.find(c => c.what === 'app_news_items').query;
    expect(listQuery).toContain('workspace_id=eq.w'); expect(listQuery).toContain('hidden_at=is.null'); expect(listQuery).not.toMatch(/[,=]body(,|&|$)/);
    // 날짜 묶음 + 꼬리표 채널/자동만('명진이 고른' 같은 말 없음).
    await expect(root(page).locator('.nc-day-head')).toHaveText(['오늘', '어제', '10. 4. (일)']);
    await expect(root(page).locator('.nc-tag')).toHaveText(['채널', '자동', '자동', '채널', '채널']);
    await expect(root(page)).not.toContainText('명진');
    const c1 = item(page, 'c1');
    await expect(c1.locator('.nc-title')).toHaveText('가짜 채널 기사');
    await expect(c1.locator('.nc-sum')).toHaveText('가짜 채널 기사 한 문장 요약.');
    await expect(c1.locator('.nc-time')).toHaveText('09:20');
    await expect(c1.getByRole('link', { name: /원문/ })).toHaveAttribute('href', 'https://example.org/c1');
    await expect(item(page, 'k1').locator('.nc-kw')).toHaveText('가짜어');
    // 대기 줄: 주소의 도메인 + '아직 안 읽음', 본문 칸 없음.
    await expect(item(page, 'w1').locator('.nc-title')).toHaveText('example.org');
    await expect(item(page, 'w1').locator('.nc-note')).toHaveText('아직 안 읽음');
    await expect(item(page, 'w1').locator('details')).toHaveCount(0);
    // 유료: 공개 요약만 표시 + 펼치면 공개 앞부분만(Edge open을 부르지 않음).
    await expect(item(page, 'p1').locator('.nc-note')).toHaveText('유료 기사 · 공개 요약만');
    await item(page, 'p1').locator('summary').click();
    await expect(item(page, 'p1').locator('.nc-text')).toHaveText('공개된 가짜 앞부분.');
    expect(server.calls.filter(c => c.action === 'open')).toHaveLength(0);

    // 본문 열기: 서버 줄에 본문이 없으면 news-feed open(몸통 id 하나) → 다시 읽어 보인다.
    await c1.locator('summary').click();
    await expect(c1.locator('.nc-text')).toHaveText('가짜 본문 첫 문단.');
    expect(server.calls.find(c => c.action === 'open')).toMatchObject({ method: 'POST', body: { id: 'c1' } });

    // 외국어: 원문 그대로, [번역]을 누를 때만 번역(저장본은 다시 부르지 않고 원문 보기와 오감).
    const e1 = item(page, 'e1');
    await expect(e1.locator('.nc-title')).toHaveText('A fake foreign story');
    await expect(e1.locator('.nc-title')).toHaveAttribute('lang', 'en');
    expect(server.calls.filter(c => c.action === 'translate')).toHaveLength(0);
    await e1.locator('summary').click();
    await expect(e1.locator('.nc-text')).toHaveText('Fake body paragraph.');
    await e1.locator('[data-nc-translate]').click();
    await expect(e1.locator('.nc-title')).toHaveText('가짜 외국 기사');
    await expect(e1.locator('.nc-text')).toHaveText('가짜 번역 본문.');
    await expect(e1.locator('[data-nc-translate]')).toHaveText('원문 보기');
    await e1.locator('[data-nc-translate]').click();
    await expect(e1.locator('.nc-title')).toHaveText('A fake foreign story');
    await e1.locator('[data-nc-translate]').click();
    await expect(e1.locator('.nc-title')).toHaveText('가짜 외국 기사');
    expect(server.calls.filter(c => c.action === 'translate')).toHaveLength(1);
    expect(server.calls.find(c => c.action === 'translate').body).toEqual({ id: 'e1' });

    // 칩: 채널만 · 자동만(서버 조건).
    await root(page).locator('[data-nc-tab="channel"]').click();
    await expect(items(page)).toHaveCount(3);
    expect(server.calls.filter(c => c.what === 'app_news_items' && c.method === 'GET').at(-1).query).toContain('lane=eq.channel');
    await root(page).locator('[data-nc-tab="auto"]').click();
    await expect(items(page)).toHaveCount(2);
    expect(server.calls.filter(c => c.what === 'app_news_items' && c.method === 'GET').at(-1).query).toContain('lane=in.(keyword,media)');
    await root(page).locator('[data-nc-tab="all"]').click();
    await expect(items(page)).toHaveCount(5);

    // ⋯ → 지금 채우기: fill_now → 결과 한 줄 + 목록 다시 읽기.
    await root(page).locator('[data-nc-more]').click();
    await page.locator('#ncMenu').getByRole('button', { name: /지금 채우기/ }).click();
    await expect(root(page).locator('[data-nc-when]')).toHaveText('1건 채움');
    await expect(item(page, 'w1').locator('.nc-title')).toHaveText('채운 가짜 기사');

    // ⋯ → 키워드 고치기: 더하기·끄기·지우기(서버 저장), 뒤로가기 한 번 = 목록.
    await root(page).locator('[data-nc-more]').click();
    await page.locator('#ncMenu').getByRole('button', { name: '키워드 고치기' }).click();
    await expect(root(page).locator('[data-nc-kw]')).toHaveCount(1);
    await expect(items(page)).toHaveCount(0);
    await expect(root(page).locator('.nc-panel-head')).toContainText('1/30 · 하루 30개까지');
    await root(page).locator('[data-nc-kw-input]').fill('  새 가짜어 ');
    await root(page).locator('[data-nc-kw-form] button[type="submit"]').click();
    await expect(root(page).locator('[data-nc-kw]')).toHaveCount(2);
    expect(server.calls.find(c => c.what === 'app_news_keywords' && c.method === 'POST').body).toEqual({ workspace_id: 'w', word: '새 가짜어', enabled: true });
    await root(page).locator('[data-nc-kw="가짜어"]').click();
    await expect(root(page).locator('[data-nc-kw="가짜어"]')).toHaveAttribute('aria-checked', 'false');
    expect(Object.keys(server.calls.find(c => c.what === 'app_news_keywords' && c.method === 'PATCH').body).sort()).toEqual(['enabled', 'updated_at']);
    await root(page).locator('[data-nc-kw-del="새 가짜어"]').click();
    await expect(root(page).locator('[data-nc-kw]')).toHaveCount(1);
    await page.goBack();
    await expect(items(page)).toHaveCount(5);

    // ⋯ → 매체 켜고 끄기: news- 키만, 국내·해외 묶음, 켜기 = 새 줄 넣기.
    await root(page).locator('[data-nc-more]').click();
    await page.locator('#ncMenu').getByRole('button', { name: '매체 켜고 끄기' }).click();
    await expect(root(page).locator('.nc-group-head')).toHaveText(['국내', '해외']);
    expect(server.calls.filter(c => c.what === 'app_outside_sources' && c.method === 'GET').at(-1).query).toContain('source_key=like.news-*');
    await expect(root(page).locator('[data-nc-source="news-fake-a"]')).toHaveAttribute('aria-checked', 'true');
    await root(page).locator('[data-nc-source="news-fake-en"]').click();
    await expect(root(page).locator('[data-nc-source="news-fake-en"]')).toHaveAttribute('aria-checked', 'true');
    expect(server.calls.find(c => c.what === 'app_outside_sources' && c.method === 'POST').body).toEqual({ workspace_id: 'w', source_key: 'news-fake-en', enabled: true });
    await root(page).locator('[data-nc-back]').click();
    await expect(items(page)).toHaveCount(5);
    expect(await noWideScroll(page)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('뉴스 클리핑 폰 412: 좌우로 밀어 칩 이동, ⋯ 메뉴는 하단바에 가리지 않음', async ({ page }) => {
  test.setTimeout(60000);
  const { errors } = await start(page, 412);
  await openNews(page, 412);
  await expect(items(page)).toHaveCount(5);
  const swipe = async dx => page.evaluate(async d => {
    const el = document.querySelector('#newsRoot [data-nc-list]'), r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + 40;
    const t = (cx) => new Touch({ identifier: 1, target: el, clientX: cx, clientY: y });
    el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [t(x)], changedTouches: [t(x)] }));
    el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [t(x + d)] }));
  }, dx);
  await swipe(-120);
  await expect(root(page).locator('[data-nc-tab="channel"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(items(page)).toHaveCount(3);
  await swipe(-120);
  await expect(root(page).locator('[data-nc-tab="auto"]')).toHaveAttribute('aria-pressed', 'true');
  await swipe(120);
  await expect(root(page).locator('[data-nc-tab="channel"]')).toHaveAttribute('aria-pressed', 'true');
  await root(page).locator('[data-nc-more]').click();
  const menu = page.locator('#ncMenu');
  await expect(menu).toBeVisible();
  const [m, bar] = await Promise.all([menu.boundingBox(), page.locator('.mobile-tabs').boundingBox()]);
  expect(m.y + m.height).toBeLessThanOrEqual(bar.y + 1);
  expect(errors).toEqual([]);
});

test('사회운동 Now ⋯ [지금 채우기]: 켠 단체만 read_now로 하나씩(뉴스 클리핑 매체 키는 빼고)', async ({ page }) => {
  test.setTimeout(60000);
  const { errors, server } = await start(page, 1440);
  server.sources.set('kctu', { source_key: 'kctu', enabled: true, last_ok_at: '2026-10-05T09:07:00Z', last_error: null });
  await page.locator('#appView>.app-nav').getByRole('button', { name: '사회운동 Now', exact: true }).click();
  await expect(page.locator('#outsideView')).toBeVisible();
  await page.locator('#outsideRoot [data-os-more]').click();
  await page.locator('#osMenu').getByRole('button', { name: '지금 채우기' }).click();
  await expect.poll(() => server.calls.filter(c => c.what === 'outside-edge' && c.action === 'read_now').length).toBe(1);
  expect(server.calls.find(c => c.action === 'read_now').body).toEqual({ source: 'kctu' });
  expect(errors).toEqual([]);
});
