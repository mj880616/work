import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
// S69-01(사용자 11/24 06:40·06:46): 읽을 거리·저장한 글 글 보기에서 요약·시사점을 "매번 다시 만들고", "무한 로딩만 반복".
// ① 내 저장본(요약·시사점)이 있으면 서버 답을 기다리지 않고 바로 그린다 — '만드는 중' 없음.
// ② 같은 글에 요약 요청이 겹쳐 나가지 않는다(열었다 닫았다 다시 열어도 한 번), 받은 답은 다시 열면 바로.
// ③ 요약 서버가 실패하면 기다림을 멈추고 까닭 한 줄 + [다시 만들기] → 누르면 다시 묻는다.
// 서버는 흉내 낸다. 글은 모두 가상.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const P1 = 'a1000000-0000-4000-8000-000000006901', P2 = 'a1000000-0000-4000-8000-000000006902';
const post = (id, n) => ({ id, source_key: 'ws', kind: 'article', lang: 'ko', title: `가상 글 ${n}`, title_ko: null, url: `https://ws.or.kr/article/69${n}`, published_at: `2026-11-19T0${n}:00:00Z`, fetched_at: `2026-11-19T0${n}:10:00Z`, summary_ko: null, key_sentences: [], has_body: false, author: null });
const POSTS = [post(P1, 2), post(P2, 1)];
const DETAIL = { level: 'full', summary: '가상 저장 요약.', key_sentences: [], relevance: null, implications: { kptu: '가상 저장 시사점.', labor: '' }, related: [], generated_at: '2026-11-23T04:00:00Z', context_at: null };

// ai: 'ok' | 'fail' | 'hold'(gate를 열 때까지 답하지 않음). saved: 글 id → 저장본(내 자세히 표 한 줄).
async function server(page, { ai = 'ok', saved = {} } = {}) {
  const s = { ai, calls: [], savedReads: [], gate: null, open: null };
  s.gate = new Promise(r => { s.open = r; });
  await page.route(SB + '/**', async route => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname, method = req.method();
    const ok = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (p === '/functions/v1/outside-feed') return ok({ ok: true, sources: [{ key: 'ws', name: '노동자 연대', group: 'movement', lang: 'ko' }] });
    if (p === '/functions/v1/news-feed') return ok({ ok: true, sources: [], limits: {} });
    if (p === '/functions/v1/ai-assist') {
      const b = req.postDataJSON?.();
      if (b?.kind !== 'now_detail') return ok({ ok: true, ran: false, added: 0 });
      s.calls.push(b);
      if (s.ai === 'hold') await s.gate;
      if (s.ai === 'fail') return ok({ ok: false, error: 'ai_busy', message: 'AI 요청을 처리하지 못했어요.' }, 503);
      return ok({ ok: true, kind: 'now_detail', detail: saved[b.outside_post_id] || DETAIL, stale: false });
    }
    const table = p.startsWith('/rest/v1/') ? p.slice('/rest/v1/'.length) : '';
    if (table === 'app_outside_now_details') {
      s.savedReads.push(decodeURIComponent(u.search));
      const id = (u.searchParams.get('article_id') || '').replace(/^eq\./, '');
      return ok(saved[id] ? [saved[id]] : []);
    }
    if (table === 'app_outside_articles') {
      const id = (u.searchParams.get('id') || '').replace(/^eq\./, '');
      return ok(id ? POSTS.filter(x => x.id === id) : POSTS);
    }
    if (table === 'app_outside_article_bodies') return ok([{ state: 'ok', reason: null, rule: 'ws@1', blocks: [{ t: 'p', text: '가상 본문 문단.' }] }]);
    if (table === 'app_outside_reads' || table === 'app_news_reads') return method === 'POST' ? route.fulfill({ status: 201 }) : ok([]);
    if (table === 'app_outside_sources') return ok([{ source_key: 'ws', enabled: true, last_ok_at: '2026-11-23T00:07:00Z', last_error: null }]);
    if (table === 'app_outside_seen') return ok([{ seen_at: '2026-11-23T00:00:00Z' }]);
    if (table.startsWith('app_now_') || table.startsWith('app_news_') || table.startsWith('app_outside_') || table === 'app_notes') return method === 'POST' ? route.fulfill({ status: 201 }) : ok([]);
    return route.fallback();
  });
  return s;
}
const root = page => page.locator('#outsideRoot');
const nd = page => root(page).locator('[data-now-detail] .nd');
async function start(page, width, opts) {
  await page.setViewportSize({ width, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await openHome(page);
  const s = await server(page, opts);
  if (width <= 760) {
    await page.locator('#mobileMenuTab').click();
    await page.locator('#mobileMenu nav button:visible', { hasText: '읽을 거리' }).click();
  } else await page.locator('#appView>.app-nav').getByRole('link', { name: '읽을 거리', exact: true }).click();
  await expect(page.locator('#outsideView')).toBeVisible();
  await root(page).getByRole('tab', { name: '사회운동' }).click();
  await expect(root(page).locator('[data-os-list] [data-nw-key]')).toHaveCount(2);
  return { errors, s };
}
const openPost = (page, id) => root(page).locator(`[data-os-list] [data-nw-key="outside:${id}"] .now-open`).click();
// 폰은 글 보기가 전체 화면이라 뒤로(목록), PC는 다른 글을 눌러 떠난다.
async function leave(page, width) {
  if (width <= 760) { await nd(page).locator('[data-nd-close]').click(); await expect(root(page).locator('[data-os-list]')).toBeVisible(); }
  else { await openPost(page, P2); await expect(nd(page).locator('.nd-title')).toHaveText('가상 글 1'); }
}

for (const width of [412, 1280]) {
  test(`요약 저장본 ${width}: 저장본이 있으면 '만드는 중' 없이 바로 — 서버 답을 기다리지 않음`, async ({ page }) => {
    test.setTimeout(60000);
    const { errors, s } = await start(page, width, { ai: 'hold', saved: { [P1]: DETAIL, [P2]: { ...DETAIL, summary: '가상 저장 요약 둘.', generated_at: '2026-11-23T05:00:00Z' } } });
    await openPost(page, P1);
    const d = nd(page);
    await expect(d.locator('.nd-title')).toHaveText('가상 글 2');
    // 서버(ai-assist)는 아직 답하지 않았는데 저장본이 보인다. 기다림 표시 없음.
    await expect(d.locator('[data-nd-summary] .nd-sum')).toHaveText('가상 저장 요약.');
    await expect(d.locator('[data-nd-implications] .nd-imp')).toContainText('가상 저장 시사점.');
    await expect(d.locator('[data-nd-wait]')).toHaveCount(0);
    await expect(d.locator('.nd-wait')).toHaveCount(0);
    // 저장본은 내 작업공간 줄만 읽는다(글 id로).
    expect(s.savedReads.some(q => q.includes('workspace_id=eq.w') && q.includes(`article_id=eq.${P1}`))).toBe(true);
    // 서버 답(같은 저장본)이 와도 그대로 — 다시 그리지 않음.
    s.open();
    await expect.poll(() => s.calls.length).toBeGreaterThan(0);
    await expect(d.locator('[data-nd-summary] .nd-sum')).toHaveText('가상 저장 요약.');
    await expect(d.locator('.nd-wait')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test(`요약 겹침 막기 ${width}: 만드는 중에 떠났다 다시 열어도 요청은 한 번, 받은 뒤 다시 열면 바로`, async ({ page }) => {
    test.setTimeout(60000);
    const { errors, s } = await start(page, width, { ai: 'hold' });
    await openPost(page, P1);
    await expect(nd(page).locator('[data-nd-summary] [data-nd-wait]')).toHaveCount(1);
    await expect.poll(() => s.calls.filter(c => c.outside_post_id === P1).length).toBe(1);
    await leave(page, width);
    await openPost(page, P1);
    await expect(nd(page).locator('.nd-title')).toHaveText('가상 글 2');
    await expect(nd(page).locator('[data-nd-summary] [data-nd-wait]')).toHaveCount(1);
    s.open();
    await expect(nd(page).locator('[data-nd-summary] .nd-sum')).toHaveText('가상 저장 요약.');
    expect(s.calls.filter(c => c.outside_post_id === P1).length).toBe(1);
    // 다시 떠났다 열면 바로(이 탭에 받은 답) — 서버에 묻지 않는다.
    await leave(page, width);
    await openPost(page, P1);
    await expect(nd(page).locator('[data-nd-summary] .nd-sum')).toHaveText('가상 저장 요약.');
    await expect(nd(page).locator('.nd-wait')).toHaveCount(0);
    expect(s.calls.filter(c => c.outside_post_id === P1).length).toBe(1);
    expect(errors).toEqual([]);
  });

  test(`요약 실패 ${width}: 기다림이 멈추고 까닭 + [다시 만들기] → 누르면 다시 묻고 채운다`, async ({ page }) => {
    test.setTimeout(60000);
    const { errors, s } = await start(page, width, { ai: 'fail' });
    await openPost(page, P1);
    const sum = nd(page).locator('[data-nd-summary]');
    const again = sum.getByRole('button', { name: '다시 만들기' });
    await expect(again).toBeVisible();
    await expect(sum.locator('[data-wait-fail]')).toContainText('상세를 만들지 못함');
    await expect(nd(page).locator('[data-nd-wait]')).toHaveCount(0);
    await expect(nd(page).locator('.nd-wait')).toHaveCount(0);
    const n = s.calls.filter(c => c.outside_post_id === P1).length;
    s.ai = 'ok';
    await again.click();
    await expect(sum.locator('.nd-sum')).toHaveText('가상 저장 요약.');
    expect(s.calls.filter(c => c.outside_post_id === P1).length).toBe(n + 1);
    expect(errors.filter(e => !/503/.test(e))).toEqual([]);
  });
}
