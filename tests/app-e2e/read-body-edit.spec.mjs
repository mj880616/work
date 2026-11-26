import { test, expect } from '@playwright/test';
import { start, openNews } from './helpers/news-server.mjs';
// S71-68 ② READ-원문고치기(사용자 결정 2026-11-26 "읽을 거리에서 불필요한 글자 가져온 거 직접 수정 가능하게 수정 버튼 추가"):
// 글 보기 '원문 전체' ⋯ [수정] → 같은 자리 문단 목록(문단마다 선택 칸·글 칸·×, 선택한 문단 삭제) → [저장]은 내 작업공간 직접 수정본(app_feed_body_edits),
// [취소]는 그대로. 다시 열어도(새로 고침) 직접 수정본. 지운 문단의 밑줄은 저장 전 확인 뒤 함께 삭제. ⋯ [원문 다시 가져오기]는 확인 뒤 직접 수정본을 지움.
// 서버는 흉내, 기사·주소는 모두 가짜(example.org). 남의 작업공간 줄 거절은 DB 시험(tests/auth-handoff/feed-body-edits-db.test.mjs)이 본다.
const NOW_DETAIL = { ok: true, kind: 'now_detail', detail: { level: 'full', summary: '가짜 요약.', key_sentences: [], relevance: null, implications: null, related: [], generated_at: '2026-11-26T01:00:00Z', context_at: null }, stale: false };
const detail = page => page.locator('#outsideRoot [data-now-detail] .nd');
const row = (page, id) => page.locator(`#newsRoot [data-nc-item="${id}"]`);
const ITEM = { id: 'x1', lane: 'media', url: 'https://www.example.org/x1', title: '가짜 부동산 세금 기사', lang: 'ko', publisher: '가짜일보', source_key: 'news-fake-b', keywords: [], published_at: '2026-11-26T02:04:00Z', scrapped_at: null,
  created_at: '2026-11-26T02:10:00Z', state: 'ok', summary: '가짜 소개.', body_kind: 'full', title_ko: null, translated_at: null, starred_at: null, folder_id: null, _body: '가짜 본문.', author: null, manual_at: null };
const BLOCKS = [{ t: 'p', text: '가짜 메뉴 줄 하나' }, { t: 'p', text: '가짜 메뉴 줄 둘' }, { t: 'p', text: '가짜 읽기 설정 줄' }, { t: 'p', text: '가짜 본문 첫 문단이다.' }, { t: 'p', text: '가짜 본문 둘째 문단이다.' }];
const MARK = { id: 'a7100000-0000-4000-8000-000000000001', workspace_id: 'w', source_type: 'news', source_id: 'x1', quote: '가짜 메뉴 줄 둘', quote_prefix: '', quote_suffix: '', memo: null, mark_kind: null, mark_color: null,
  source_title: null, source_media: null, source_date: null, source_url: null, created_at: '2026-11-26T01:00:00Z', updated_at: '2026-11-26T01:00:00Z' };
const MARK2 = { ...MARK, id: 'a7100000-0000-4000-8000-000000000002', quote: '본문 둘째', created_at: '2026-11-26T01:01:00Z' };

async function setup(page, width, { marks = [] } = {}) {
  const { errors, server } = await start(page, width);
  server.items.unshift({ ...ITEM });
  const store = { edits: new Map(), calls: [], marks: [...marks], dropped: [], opens: [] };
  const json = (route, data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
  await page.route('**/rest/v1/app_news_article_bodies*', route => json(route, [{ state: 'ok', reason: null, rule: 'open@1', blocks: BLOCKS }]));
  await page.route('**/rest/v1/app_feed_body_edits*', route => {
    const req = route.request(), u = new URL(req.url()), m = req.method();
    const ws = (u.searchParams.get('workspace_id') || '').replace(/^eq\./, ''), art = (u.searchParams.get('news_article_id') || '').replace(/^eq\./, '');
    const key = `${ws}:${art}`;
    store.calls.push({ m, query: u.search, body: req.postDataJSON?.() ?? null });
    if (m === 'GET') return json(route, store.edits.has(key) ? [store.edits.get(key)] : []);
    if (m === 'PATCH') { if (!store.edits.has(key)) return json(route, []); const b = req.postDataJSON(); Object.assign(store.edits.get(key), b); return json(route, [store.edits.get(key)]); }
    if (m === 'POST') { const b = req.postDataJSON(); const k = `${b.workspace_id}:${b.news_article_id}`; const r = { blocks: b.blocks, edited_at: b.edited_at }; store.edits.set(k, r); return json(route, [r], 201); }
    if (m === 'DELETE') { store.edits.delete(key); return route.fulfill({ status: 204 }); }
    return route.fallback();
  });
  await page.route('**/rest/v1/app_news_highlights*', route => {
    const req = route.request(), u = new URL(req.url());
    if (req.method() === 'DELETE') { const id = (u.searchParams.get('id') || '').replace(/^eq\./, ''); store.dropped.push(id); store.marks = store.marks.filter(h => h.id !== id); return route.fulfill({ status: 204 }); }
    return json(route, store.marks);
  });
  await page.route('**/functions/v1/news-feed?action=open', route => { store.opens.push(route.request().postDataJSON()); return json(route, { ok: true, status: 'same' }); });
  await page.route('**/functions/v1/ai-assist', route => (route.request().postDataJSON()?.kind === 'now_detail' ? json(route, NOW_DETAIL) : route.fallback()));
  return { errors, server, store };
}
async function openItem(page, width) {
  await openNews(page, width);
  await expect(row(page, 'x1')).toBeVisible();
  await row(page, 'x1').locator('[data-nc-open="x1"]').click();
  await expect(detail(page).locator('[data-nd-prose] p')).toHaveCount(BLOCKS.length);
}
const menu = async page => { await detail(page).locator('[data-nd-ob-more]').click(); return page.locator('#ndObMenu'); };

for (const width of [390, 1280]) {
  test(`원문 고치기 ${width}: ⋯ [수정] → × 한 문단·선택한 두 문단 삭제·글 수정 → 저장 → 다시 열어도 그대로`, async ({ page }) => {
    test.setTimeout(90000);
    const { errors, store } = await setup(page, width);
    await openItem(page, width);
    const nd = detail(page);
    await expect(nd.locator('[data-nd-edited]')).toHaveCount(0);
    await (await menu(page)).locator('[data-nd-menu="edit"]').click();
    const form = nd.locator('[data-nd-edit-form]');
    await expect(form.locator('[data-nd-edit-row]')).toHaveCount(5);
    // 첫 줄 ×
    await form.getByRole('button', { name: '1번째 문단 삭제' }).click();
    await expect(form.locator('[data-nd-edit-row]')).toHaveCount(4);
    // 남은 앞 두 줄 선택 → 선택한 문단 삭제
    await form.getByRole('checkbox', { name: '1번째 문단 선택' }).check();
    await form.getByRole('checkbox', { name: '2번째 문단 선택' }).check();
    await expect(form.locator('[data-nd-edit-bar]')).toContainText('2개 선택');
    await form.getByRole('button', { name: '선택한 문단 삭제' }).click();
    await expect(form.locator('[data-nd-edit-row]')).toHaveCount(2);
    // 글 직접 수정
    await form.getByRole('textbox', { name: '1번째 문단' }).fill('가짜 본문 첫 문단을 고쳤다.');
    expect(store.calls.filter(c => c.m !== 'GET')).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await form.getByRole('button', { name: '저장' }).click();
    await expect(nd.locator('[data-nd-prose] p')).toHaveText(['가짜 본문 첫 문단을 고쳤다.', '가짜 본문 둘째 문단이다.']);
    await expect(nd.locator('[data-nd-edited]')).toHaveText('직접 수정');
    const post = store.calls.find(c => c.m === 'POST');
    expect(post.body.news_article_id).toBe('x1');
    expect(post.body.blocks).toEqual([{ t: 'p', text: '가짜 본문 첫 문단을 고쳤다.' }, { t: 'p', text: '가짜 본문 둘째 문단이다.' }]);
    // 다시 열기(새로 고침 — 이 탭 메모리 없이 서버 직접 수정본)
    await page.reload();
    await openNews(page, width);
    await row(page, 'x1').locator('[data-nc-open="x1"]').click();
    await expect(detail(page).locator('[data-nd-prose] p')).toHaveText(['가짜 본문 첫 문단을 고쳤다.', '가짜 본문 둘째 문단이다.']);
    await expect(detail(page).locator('[data-nd-edited]')).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('원문 고치기: [취소]하면 원문 그대로 · 서버에 쓰지 않음', async ({ page }) => {
  test.setTimeout(60000);
  const { store } = await setup(page, 1280);
  await openItem(page, 1280);
  const nd = detail(page);
  await (await menu(page)).locator('[data-nd-menu="edit"]').click();
  const form = nd.locator('[data-nd-edit-form]');
  await form.getByRole('button', { name: '1번째 문단 삭제' }).click();
  await form.getByRole('button', { name: '취소' }).click();
  await expect(nd.locator('[data-nd-edit-form]')).toHaveCount(0);
  await expect(nd.locator('[data-nd-prose] p')).toHaveText(BLOCKS.map(b => b.text));
  expect(store.calls.filter(c => c.m !== 'GET')).toEqual([]);
});

test('원문 고치기: 밑줄이 있는 문단을 지우면 저장 전 "밑줄 1개도 함께 삭제돼요" → 저장하면 그 밑줄만 삭제, 남은 문단 밑줄은 그 자리', async ({ page }) => {
  test.setTimeout(60000);
  const { store } = await setup(page, 1280, { marks: [MARK, MARK2] });
  await openItem(page, 1280);
  const nd = detail(page);
  await expect(nd.locator('[data-nd-prose] mark[data-hl-id]')).toHaveCount(2);
  await (await menu(page)).locator('[data-nd-menu="edit"]').click();
  const form = nd.locator('[data-nd-edit-form]');
  await form.getByRole('button', { name: '2번째 문단 삭제' }).click();
  await form.getByRole('button', { name: '저장' }).click();
  const ask = page.locator('.kptu-ask-text');
  await expect(ask).toHaveText('밑줄 1개도 함께 삭제돼요');
  // 확인 창 취소 → 아무것도 쓰지 않음, 칸은 열린 채
  await page.locator('.kptu-ask-actions').getByRole('button', { name: '취소' }).click();
  await expect(form).toBeVisible();
  expect(store.calls.filter(c => c.m !== 'GET')).toEqual([]);
  await form.getByRole('button', { name: '저장' }).click();
  await page.locator('.kptu-ask-actions').getByRole('button', { name: '저장' }).click();
  await expect(nd.locator('[data-nd-edited]')).toBeVisible();
  await expect.poll(() => store.dropped).toEqual([MARK.id]);
  await expect(nd.locator('[data-nd-prose] mark[data-hl-id]')).toHaveCount(1);
  await expect(nd.locator(`[data-nd-prose] mark[data-hl-id="${MARK2.id}"]`)).toHaveText('본문 둘째');
});

test('원문 고치기: 직접 수정한 글의 ⋯ [원문 다시 가져오기]는 한 줄 확인 뒤 직접 수정본을 지우고 처음 원문으로', async ({ page }) => {
  test.setTimeout(60000);
  const { store } = await setup(page, 1280);
  await openItem(page, 1280);
  const nd = detail(page);
  await (await menu(page)).locator('[data-nd-menu="edit"]').click();
  await nd.locator('[data-nd-edit-form]').getByRole('button', { name: '1번째 문단 삭제' }).click();
  await nd.locator('[data-nd-edit-form]').getByRole('button', { name: '저장' }).click();
  await expect(nd.locator('[data-nd-prose] p')).toHaveCount(4);
  await (await menu(page)).locator('[data-nd-menu="refetch"]').click();
  await expect(page.locator('.kptu-ask-text')).toHaveText('직접 수정한 내용이 처음 가져온 원문으로 바뀌어요');
  await page.locator('.kptu-ask-actions').getByRole('button', { name: '원문 다시 가져오기' }).click();
  await expect.poll(() => store.calls.some(c => c.m === 'DELETE')).toBe(true);
  await expect(nd.locator('[data-nd-prose] p')).toHaveText(BLOCKS.map(b => b.text));
  await expect(nd.locator('[data-nd-edited]')).toHaveCount(0);
  await expect.poll(() => store.opens).toEqual([{ id: 'x1', again: true }]);
});

// 사례 1(사회운동 글 — 예전에는 ⋯에 [수정]이 없었다): 같은 [수정]이 보이고 저장은 사회운동 글 칸(outside_article_id)으로.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const P1 = 'a1000000-0000-4000-8000-000000000068';
const POST = { id: P1, source_key: 'kctu', kind: 'article', lang: 'ko', title: '가상 신문 기사', title_ko: null, url: 'https://www.example.org/p68', published_at: '2026-11-26T00:30:00Z', fetched_at: '2026-11-26T00:40:00Z', summary_ko: null, key_sentences: [], has_body: true, author: null };
for (const width of [390, 1280]) {
  test(`원문 고치기 ${width}: 사회운동 글 ⋯에도 [수정] → 앞 덧줄 삭제 → 저장(사회운동 글 칸)`, async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width, height: 900 });
    const { openHome } = await import('./helpers/home-entry.mjs');
    await openHome(page);
    const posts = [];
    await page.route(SB + '/**', async route => {
      const req = route.request(), u = new URL(req.url()), p = u.pathname, method = req.method();
      const ok = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
      if (p === '/functions/v1/outside-feed') return ok({ ok: true, sources: [{ key: 'kctu', name: '가상연맹', group: 'labor', lang: 'ko' }] });
      if (p === '/functions/v1/news-feed') return ok({ ok: true, sources: [], limits: {} });
      if (p === '/functions/v1/ai-assist') return ok({ ok: true, kind: 'now_detail', detail: NOW_DETAIL.detail, stale: false });
      const table = p.startsWith('/rest/v1/') ? p.slice('/rest/v1/'.length) : '';
      if (table === 'app_feed_body_edits') {
        if (method === 'POST') { const b = req.postDataJSON(); posts.push(b); return ok([{ blocks: b.blocks, edited_at: b.edited_at }], 201); }
        return ok([]);
      }
      if (table === 'app_outside_articles') return ok([POST]);
      if (table === 'app_outside_article_bodies') return ok([{ state: 'ok', reason: null, rule: 'kctu@3', blocks: BLOCKS }]);
      if (table === 'app_outside_reads' || table === 'app_news_reads') return method === 'POST' ? route.fulfill({ status: 201 }) : ok([]);
      if (table === 'app_outside_sources') return ok([{ source_key: 'kctu', enabled: true, last_ok_at: '2026-11-26T00:07:00Z', last_error: null }]);
      if (table === 'app_outside_seen') return ok([{ seen_at: '2026-11-26T00:00:00Z' }]);
      if (table === 'app_now_signals') return method === 'POST' ? route.fulfill({ status: 201 }) : ok([]);
      if (table.startsWith('app_now_') || table.startsWith('app_news_') || table.startsWith('app_outside_') || table === 'app_notes') return ok([]);
      return route.fallback();
    });
    if (width <= 760) {
      await page.locator('#mobileMenuTab').click();
      await page.locator('#mobileMenu nav button:visible', { hasText: '읽을 거리' }).click();
    } else await page.locator('#appView>.app-nav').getByRole('link', { name: '읽을 거리', exact: true }).click();
    await page.locator('#outsideRoot').getByRole('tab', { name: '사회운동' }).click();
    await page.locator(`#outsideRoot [data-os-list] [data-nw-key="outside:${P1}"] .now-open`).click();
    const nd = detail(page);
    await expect(nd.locator('[data-nd-prose] p')).toHaveCount(BLOCKS.length);
    await (await menu(page)).locator('[data-nd-menu="edit"]').click();
    const form = nd.locator('[data-nd-edit-form]');
    for (const n of [1, 2, 3]) await form.getByRole('checkbox', { name: `${n}번째 문단 선택` }).check();
    await form.getByRole('button', { name: '선택한 문단 삭제' }).click();
    await form.getByRole('button', { name: '저장' }).click();
    await expect(nd.locator('[data-nd-prose] p')).toHaveText(['가짜 본문 첫 문단이다.', '가짜 본문 둘째 문단이다.']);
    expect(posts.length).toBe(1);
    expect(posts[0].outside_article_id).toBe(P1);
    expect(posts[0].news_article_id).toBeUndefined();
  });
}

test('원문 고치기: 바깥 글자는 글자로만(꼬리표 글이 칸에 그대로, 새 그림·꼬리표가 생기지 않음)', async ({ page }) => {
  test.setTimeout(60000);
  const { store } = await setup(page, 1280);
  await page.unroute('**/rest/v1/app_news_article_bodies*');
  await page.route('**/rest/v1/app_news_article_bodies*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ state: 'ok', reason: null, rule: 'open@1', blocks: [{ t: 'p', text: '<img src=x onerror="window.__bad=1"> 가짜 꼬리표 문단' }, ...BLOCKS.slice(1)] }]) }));
  await openNews(page, 1280);
  await row(page, 'x1').locator('[data-nc-open="x1"]').click();
  const nd = detail(page);
  await expect(nd.locator('[data-nd-prose] p').first()).toHaveText('<img src=x onerror="window.__bad=1"> 가짜 꼬리표 문단');
  await (await menu(page)).locator('[data-nd-menu="edit"]').click();
  const form = nd.locator('[data-nd-edit-form]');
  await expect(form.getByRole('textbox', { name: '1번째 문단' })).toHaveValue('<img src=x onerror="window.__bad=1"> 가짜 꼬리표 문단');
  await expect(form.locator('img')).toHaveCount(0);
  expect(await page.evaluate(() => window.__bad)).toBeUndefined();
  await form.getByRole('button', { name: '2번째 문단 삭제' }).click();
  await form.getByRole('button', { name: '저장' }).click();
  await expect(nd.locator('[data-nd-edited]')).toBeVisible();
  expect(store.calls.find(c => c.m === 'POST').body.blocks[0].text).toBe('<img src=x onerror="window.__bad=1"> 가짜 꼬리표 문단');
  expect(await page.evaluate(() => window.__bad)).toBeUndefined();
});
