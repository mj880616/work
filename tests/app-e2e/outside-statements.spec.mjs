import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
// OUTSIDE-바깥성명 ④ 화면 1(docs/design/outside-statements.md 4절, 12:43 시안): '바깥 성명' 메뉴(?view=outside).
// [새로 온 것]: 칩으로 단체 묶음 거르기(공용 두 줄 + [더보기]), 날짜 묶음, 글마다 단체·종류·시각 / 제목 / 한 문장 요약(늘 보임) / 본문 접기 / [원문](새 창).
// 2년 지난 글은 제목·요약만. ⋯ → [단체 켜고 끄기]는 서버 표(app_outside_sources)에 저장하고, 뒤로가기 한 번 = 목록. 들어오면 본 시각을 서버에 둔다.
// 서버는 흉내 낸다(시계 2026-10-06 10:00 서울, home-entry.mjs). 글은 모두 가상의 글.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const CATALOG = [
  { key: 'kctu', name: '민주노총', group: 'kctu', lang: 'ko' },
  { key: 'kptu', name: '공공운수노조', group: 'kptu', lang: 'ko' },
  { key: 'laborparty', name: '노동당', group: 'party', lang: 'ko' },
  { key: 'kgreens', name: '녹색당', group: 'party', lang: 'ko' },
  { key: 'jacobin', name: 'Jacobin', group: 'foreign', lang: 'en' },
];
const POSTS = [
  { id: 'p1', source_key: 'kctu', kind: 'statement', lang: 'ko', title: '[성명] 가상 성명 하나', title_ko: null, url: 'https://nodong.org/statement/101', published_at: '2026-10-06T00:30:00Z', fetched_at: '2026-10-06T00:40:00Z', summary_ko: '가상 성명 한 문장 요약이다.', key_sentences: [], has_body: true },
  { id: 'p2', source_key: 'laborparty', kind: 'comment', lang: 'ko', title: '[논평] 가상 논평 둘', title_ko: null, url: 'https://laborparty.kr/?mod=document&page_id=13642&uid=7', published_at: '2026-10-05T03:00:00Z', fetched_at: '2026-10-05T09:07:00Z', summary_ko: '가상 논평 요약이다.', key_sentences: [], has_body: true },
  { id: 'p3', source_key: 'jacobin', kind: 'article', lang: 'en', title: 'An Imaginary Article', title_ko: '가상의 외국 글', url: 'https://jacobin.com/2026/10/imaginary', published_at: '2026-10-05T01:00:00Z', fetched_at: '2026-10-04T09:07:00Z', summary_ko: '첫 요약 문장임. 둘째 요약 문장임.', key_sentences: [{ orig: 'An imaginary key line.', ko: '가상의 핵심 문장.' }], has_body: false },
  { id: 'p4', source_key: 'kgreens', kind: 'press', lang: 'ko', title: '[보도자료] 가상 보도자료', title_ko: null, url: 'https://kgreens.org/press/?bmode=view&idx=3', published_at: '2026-10-01T05:00:00Z', fetched_at: '2026-10-01T09:07:00Z', summary_ko: '가상 보도자료 요약이다.', key_sentences: [], has_body: true },
  { id: 'p5', source_key: 'kctu', kind: 'statement', lang: 'ko', title: '[성명] 오래된 가상 성명', title_ko: null, url: 'https://nodong.org/statement/1', published_at: '2023-03-02T01:00:00Z', fetched_at: '2026-10-01T09:07:00Z', summary_ko: '오래된 성명 요약이다.', key_sentences: [], has_body: false },
];
const SENTENCES = { p1: [{ idx: 0, text: '가상 본문 첫 문장이다.' }, { idx: 1, text: '가상 본문 둘째 문장이다.' }] };

async function outsideServer(page) {
  const server = {
    sources: new Map([['kctu', true], ['laborparty', true], ['kgreens', true], ['jacobin', true]].map(([k, on]) => [k, { source_key: k, enabled: on, last_ok_at: '2026-10-05T09:07:00Z', last_error: null }])),
    seen: [{ seen_at: '2026-10-05T00:00:00Z' }], calls: [],
  };
  server.sources.get('kgreens').last_error = 'robots';
  await page.route(SB + '/**', async route => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname, method = req.method();
    const ok = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (p === '/functions/v1/outside-feed') {
      server.calls.push({ what: 'edge', action: u.searchParams.get('action'), method, auth: req.headers().authorization || '' });
      return u.searchParams.get('action') === 'catalog' && method === 'POST' ? ok({ ok: true, sources: CATALOG }) : ok({ ok: false, error: 'UNKNOWN_ACTION' }, 400);
    }
    if (!p.startsWith('/rest/v1/app_outside_')) return route.fallback();
    const body = req.postDataJSON?.() ?? null;
    server.calls.push({ what: p.slice('/rest/v1/'.length), method, query: decodeURIComponent(u.search), body });
    if (p === '/rest/v1/app_outside_posts') {
      const inKeys = /^in\.\((.*)\)$/.exec(u.searchParams.get('source_key') || '')?.[1]?.split(',');
      const rows = POSTS.filter(r => !inKeys || inKeys.includes(r.source_key));
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
      return ok([...server.sources.values()]);
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
  const server = await outsideServer(page);
  return { errors, server };
}
async function openOutside(page, width) {
  if (width <= 760) {
    await page.locator('#mobileMenuTab').click();
    await page.locator('#mobileMenu nav button:visible', { hasText: '바깥 성명' }).click();
  } else await page.locator('#appView>.app-nav').getByRole('button', { name: '바깥 성명', exact: true }).click();
  await expect(page.locator('#outsideView')).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get('view')).toBe('outside');
}
const root = page => page.locator('#outsideRoot');
const posts = page => root(page).locator('[data-os-post]');
const post = (page, id) => root(page).locator(`[data-os-post="${id}"]`);
const chips = page => root(page).locator('[data-os-chip]:visible');
const noWideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

for (const width of [412, 1280]) {
  test(`바깥 성명 ${width}: [새로 온 것] 칩·날짜 묶음·요약·본문 접기·원문, 단체 켜고 끄기는 서버 저장`, async ({ page }) => {
    test.setTimeout(90000);
    const { errors, server } = await start(page, width);
    await openOutside(page, width);
    await expect(posts(page)).toHaveCount(POSTS.length);

    // 칩 줄: 전체 + 켠 단체가 있는 묶음 + 둘 이상 켜진 묶음(정당)의 단체 낱개.
    await expect(chips(page)).toHaveText(['전체', '민주노총', '정당', '외국', '노동당', '녹색당']);
    await expect(root(page).locator('[data-os-chip="all"]')).toHaveAttribute('aria-pressed', 'true');
    // 카탈로그는 사용자 로그인으로 Edge에서, 목록은 자기 작업공간만 묻는다.
    expect(server.calls.find(c => c.what === 'edge')).toMatchObject({ action: 'catalog', method: 'POST', auth: expect.stringMatching(/^Bearer /) });
    expect(server.calls.find(c => c.what === 'app_outside_posts').query).toContain('workspace_id=eq.w');

    // 날짜 묶음: 오늘 · 어제 · 10. 1. (목) · 2023. 3. 2. (목).
    await expect(root(page).locator('.os-day-head')).toHaveText(['오늘', '어제', '10. 1. (목)', '2023. 3. 2. (목)']);
    // 글 한 건: 단체 · 종류 · 시각 / 제목 / 한 문장 요약(늘 보임) / 본문 접힘 / [원문].
    const p1 = post(page, 'p1');
    await expect(p1.locator('.os-meta')).toContainText('민주노총');
    await expect(p1.locator('.os-meta')).toContainText('성명');
    await expect(p1.locator('.os-time')).toHaveText('09:30');
    await expect(p1.locator('.os-title')).toHaveText('[성명] 가상 성명 하나');
    await expect(p1.locator('.os-lead')).toBeVisible();
    await expect(p1.locator('.os-lead')).toHaveText('가상 성명 한 문장 요약이다.');
    await expect(p1.locator('details.os-fold')).not.toHaveAttribute('open', '');
    const link = p1.getByRole('link', { name: /원문/ });
    await expect(link).toHaveAttribute('href', 'https://nodong.org/statement/101');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    // 지난번 본 시각(10. 5. 09:00) 뒤 받은 글에만 작은 '새'.
    await expect(post(page, 'p1').locator('.os-new')).toHaveCount(1);
    await expect(post(page, 'p2').locator('.os-new')).toHaveCount(1);
    await expect(post(page, 'p3').locator('.os-new')).toHaveCount(0);
    // 들어오면 본 시각을 지금으로(서버 저장, 기존 줄 고치기).
    await expect.poll(() => server.calls.some(c => c.what === 'app_outside_seen' && c.method === 'PATCH')).toBe(true);
    expect(server.calls.filter(c => c.what === 'app_outside_sentences')).toHaveLength(0);

    // 본문 펼치기: 그때 서버 문장 표에서 한 번 읽는다.
    await p1.locator('summary').click();
    await expect(p1.locator('.os-text')).toHaveText('가상 본문 첫 문장이다. 가상 본문 둘째 문장이다.');
    expect(server.calls.filter(c => c.what === 'app_outside_sentences')).toHaveLength(1);
    // 외국 글: 한국어 제목, 첫 요약 문장, 펼치면 요약 전체 + 핵심 문장(원문 + 번역).
    const p3 = post(page, 'p3');
    await expect(p3.locator('.os-title')).toHaveText('가상의 외국 글');
    await expect(p3.locator('.os-lead')).toHaveText('첫 요약 문장임.');
    await p3.locator('summary').click();
    await expect(p3.locator('.os-keys li')).toHaveCount(1);
    await expect(p3.locator('.os-key-ko')).toHaveText('가상의 핵심 문장.');
    await expect(p3.locator('.os-key-orig')).toHaveText('An imaginary key line.');
    // 2년 지난 글은 제목·요약만(펼칠 본문 없음).
    await expect(post(page, 'p5').locator('details')).toHaveCount(0);
    await expect(post(page, 'p5').locator('.os-lead')).toHaveText('오래된 성명 요약이다.');
    expect(await noWideScroll(page)).toBe(true);

    // 칩 '정당' → 서버에 그 묶음 단체만 묻는다.
    await root(page).locator('[data-os-chip="g:party"]').click();
    await expect(posts(page)).toHaveCount(2);
    await expect(root(page).locator('[data-os-chip="g:party"]')).toHaveAttribute('aria-pressed', 'true');
    expect(server.calls.filter(c => c.what === 'app_outside_posts').at(-1).query).toContain('source_key=in.(laborparty,kgreens)');
    await root(page).locator('[data-os-chip="all"]').click();
    await expect(posts(page)).toHaveCount(POSTS.length);

    // ⋯ → 단체 켜고 끄기: 카탈로그 단체마다 켬/끔 + 상태(마지막 읽은 시각·막힘).
    await root(page).locator('[data-os-more]').click();
    await page.locator('#osMenu').getByRole('button', { name: '단체 켜고 끄기' }).click();
    const sw = key => root(page).locator(`[data-os-source="${key}"]`);
    await expect(sw('kctu')).toBeVisible();
    await expect(posts(page)).toHaveCount(0);
    await expect(sw('kctu')).toHaveAttribute('aria-checked', 'true');
    await expect(sw('kptu')).toHaveAttribute('aria-checked', 'false');
    await expect(root(page).locator('.os-src-note.is-bad')).toHaveText(['사이트가 자동 읽기를 막음']);
    await expect(root(page).locator('.os-src-row', { has: sw('kctu') }).locator('.os-src-note')).toHaveText('마지막 10. 5. (월) 18:07');
    // 없던 단체 켜기 = 새 줄 넣기(workspace_id·source_key·enabled만), 켠 단체 끄기 = enabled만 고치기.
    await sw('kptu').click();
    await expect(sw('kptu')).toHaveAttribute('aria-checked', 'true');
    expect(server.calls.filter(c => c.what === 'app_outside_sources' && c.method === 'POST').at(-1).body).toEqual({ workspace_id: 'w', source_key: 'kptu', enabled: true });
    await sw('jacobin').click();
    await expect(sw('jacobin')).toHaveAttribute('aria-checked', 'false');
    const patch = server.calls.filter(c => c.what === 'app_outside_sources' && c.method === 'PATCH').at(-1);
    expect(Object.keys(patch.body).sort()).toEqual(['enabled', 'updated_at']);
    expect(patch.query).toContain('source_key=eq.jacobin');
    expect(await noWideScroll(page)).toBe(true);

    // 뒤로가기 한 번 = 목록(바깥 성명 화면 그대로). 칩 줄이 켠 단체대로 바뀐다.
    await page.goBack();
    await expect(posts(page)).toHaveCount(POSTS.length);
    await expect.poll(() => new URL(page.url()).searchParams.get('view')).toBe('outside');
    await expect(chips(page)).toHaveText(['전체', '민주노총', '공공운수노조', '정당', '노동당', '녹색당']);

    // 새로고침해도 켜고 끈 값은 서버에서 다시 읽는다(기기 저장 없음).
    await page.reload();
    await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, { timeout: 20000 });
    await expect(page.locator('#outsideView')).toBeVisible();
    await expect(chips(page)).toHaveText(['전체', '민주노총', '공공운수노조', '정당', '노동당', '녹색당']);
    expect(errors).toEqual([]);
  });
}
