import { test, expect } from '@playwright/test';
import { start, openNews } from './helpers/news-server.mjs';
// S71-68 ② READ-원문고치기(사용자 결정 2026-11-26 "읽을 거리에서 불필요한 글자 가져온 거 직접 수정 가능하게 수정 버튼 추가"),
// READ-수정한창(사용자 요청 2026-11-28 "문단별로 창을 구분하지 말고 걍 원문 전체를 노트처럼"):
// 글 보기 '원문 전체' ⋯ [수정] → 같은 자리에 원문 전체 한 창(노트와 같은 공용 편집기, 문단 상자·선택 칸·× 없음) → 글을 지우면 문단 삭제,
// 엔터로 문단 나누기 → [저장]은 내 작업공간 직접 수정본(app_feed_body_edits), [취소]는 그대로. 다시 열어도(새로 고침) 직접 수정본.
// 밑줄은 글자로 다시 찾아 앞 문단을 지워도 같은 문장에 남고, 밑줄 친 글을 지우면 저장 전 확인 뒤 함께 삭제. ⋯ [원문 다시 가져오기]는 확인 뒤 직접 수정본을 지움.
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

// 한 창 편집기: 원문 전체 글 칸 하나. n번째(0부터) 문단 글을 모두 지운다(빈 문단은 저장할 때 빠진다).
const editor = form => form.getByRole('textbox', { name: '원문 전체' });
const para = (form, n) => editor(form).locator(':scope > p').nth(n);
async function clearPara(page, form, n) {
  await para(form, n).click();
  await page.keyboard.press('End');
  await page.keyboard.press('Shift+Home');
  await page.keyboard.press('Backspace');
}
async function openEdit(page) {
  await (await menu(page)).locator('[data-nd-menu="edit"]').click();
  const form = detail(page).locator('[data-nd-edit-form]');
  await expect(editor(form)).toBeVisible();
  return form;
}

for (const width of [390, 1280]) {
  test(`원문 고치기 ${width}: ⋯ [수정] → 원문 전체 한 창(문단 상자 없음) → 글 지우기·고치기·엔터 나누기 → 저장 → 다시 열어도 그대로`, async ({ page }) => {
    test.setTimeout(90000);
    const { errors, store } = await setup(page, width);
    await openItem(page, width);
    const nd = detail(page);
    await expect(nd.locator('[data-nd-edited]')).toHaveCount(0);
    const form = await openEdit(page);
    // 한 창: 편집기 하나에 원문 다섯 문단(+ 끝 빈 줄), 문단마다 상자·선택 칸·×·서식 줄 없음. 글자 크기·[제목·정보]는 그대로.
    await expect(form.getByRole('textbox')).toHaveCount(1);
    await expect(para(form, 0)).toHaveText('가짜 메뉴 줄 하나');
    await expect(para(form, 4)).toHaveText('가짜 본문 둘째 문단이다.');
    await expect(form.locator('input[type="checkbox"], textarea, [data-nd-edit-row], .ed-bar')).toHaveCount(0);
    await expect(form.getByRole('button', { name: '제목·정보' })).toBeVisible();
    await expect(nd.locator('[data-text-size-ctl]')).toBeVisible();
    await expect(form.getByText('노트처럼 바로 수정하고, 필요 없는 글은 삭제하면 돼요')).toBeVisible();
    // 앞 세 줄은 글을 지워서 삭제
    for (const n of [0, 1, 2]) await clearPara(page, form, n);
    // 첫 문단 고치기: 끝에 글을 더하고 엔터로 나눠 새 문단
    await para(form, 3).click();
    await page.keyboard.press('End');
    await page.keyboard.type(' 덧붙인 말.');
    await page.keyboard.press('Enter');
    await page.keyboard.type('엔터로 나눈 새 문단.');
    expect(store.calls.filter(c => c.m !== 'GET')).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await form.getByRole('button', { name: '저장' }).click();
    const want = ['가짜 본문 첫 문단이다. 덧붙인 말.', '엔터로 나눈 새 문단.', '가짜 본문 둘째 문단이다.'];
    await expect(nd.locator('[data-nd-prose] p')).toHaveText(want);
    await expect(nd.locator('[data-nd-edited]')).toHaveText('직접 수정');
    const post = store.calls.find(c => c.m === 'POST');
    expect(post.body.news_article_id).toBe('x1');
    expect(post.body.blocks).toEqual(want.map(text => ({ t: 'p', text })));
    // 다시 열기(새로 고침 — 이 탭 메모리 없이 서버 직접 수정본) · 다시 [수정]하면 고친 글이 한 창에
    await page.reload();
    await openNews(page, width);
    await row(page, 'x1').locator('[data-nc-open="x1"]').click();
    await expect(detail(page).locator('[data-nd-prose] p')).toHaveText(want);
    await expect(detail(page).locator('[data-nd-edited]')).toBeVisible();
    const again = await openEdit(page);
    await expect(para(again, 0)).toHaveText(want[0]);
    await expect(para(again, 2)).toHaveText(want[2]);
    expect(errors).toEqual([]);
  });
}

test('원문 고치기: [취소]하면 원문 그대로 · 서버에 쓰지 않음', async ({ page }) => {
  test.setTimeout(60000);
  const { store } = await setup(page, 1280);
  await openItem(page, 1280);
  const nd = detail(page);
  const form = await openEdit(page);
  await clearPara(page, form, 0);
  await form.getByRole('button', { name: '취소' }).click();
  await expect(nd.locator('[data-nd-edit-form]')).toHaveCount(0);
  await expect(nd.locator('[data-nd-prose] p')).toHaveText(BLOCKS.map(b => b.text));
  expect(store.calls.filter(c => c.m !== 'GET')).toEqual([]);
});

test('원문 고치기: 밑줄 친 글을 지우면 저장 전 "밑줄 1개도 함께 삭제돼요" → 저장하면 그 밑줄만 삭제, 남은 밑줄은 그 자리', async ({ page }) => {
  test.setTimeout(60000);
  const { store } = await setup(page, 1280, { marks: [MARK, MARK2] });
  await openItem(page, 1280);
  const nd = detail(page);
  await expect(nd.locator('[data-nd-prose] mark[data-hl-id]')).toHaveCount(2);
  const form = await openEdit(page);
  await clearPara(page, form, 1);
  await form.getByRole('button', { name: '저장' }).click();
  const ask = page.locator('.kptu-ask-text');
  await expect(ask).toHaveText('밑줄 1개도 함께 삭제돼요');
  // 확인 창 취소 → 아무것도 쓰지 않음, 칸은 열린 채(쓰던 글 그대로)
  await page.locator('.kptu-ask-actions').getByRole('button', { name: '취소' }).click();
  await expect(form).toBeVisible();
  await expect(para(form, 1)).toHaveText('');
  expect(store.calls.filter(c => c.m !== 'GET')).toEqual([]);
  await form.getByRole('button', { name: '저장' }).click();
  await page.locator('.kptu-ask-actions').getByRole('button', { name: '저장' }).click();
  await expect(nd.locator('[data-nd-edited]')).toBeVisible();
  await expect.poll(() => store.dropped).toEqual([MARK.id]);
  await expect(page.getByText('저장했어요 · 밑줄 1개 함께 삭제')).toBeVisible();
  await expect(nd.locator('[data-nd-prose] mark[data-hl-id]')).toHaveCount(1);
  await expect(nd.locator(`[data-nd-prose] mark[data-hl-id="${MARK2.id}"]`)).toHaveText('본문 둘째');
});

// 밑줄 보존: 밑줄 앞뒤 실마리 글(quote_prefix)이 들어 있던 앞 문단을 지우고, 밑줄 문단 안 다른 글을 고쳐도 밑줄은 같은 문장에(확인 창 없음, 밑줄 삭제 없음).
test('원문 고치기: 밑줄 있는 문단 앞 문단을 지우고 같은 문단 다른 글을 고쳐도 밑줄은 같은 문장에 남는다', async ({ page }) => {
  test.setTimeout(60000);
  const MARK3 = { ...MARK, id: 'a7100000-0000-4000-8000-000000000003', quote: '본문 첫 문단', quote_prefix: '가짜 읽기 설정 줄가짜 ', quote_suffix: '이다.가짜 본문 둘째', created_at: '2026-11-26T01:02:00Z' };
  const { store } = await setup(page, 1280, { marks: [MARK3] });
  await openItem(page, 1280);
  const nd = detail(page);
  await expect(nd.locator(`[data-nd-prose] mark[data-hl-id="${MARK3.id}"]`)).toHaveText('본문 첫 문단');
  const form = await openEdit(page);
  for (const n of [0, 1, 2]) await clearPara(page, form, n);
  await para(form, 4).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' 끝에 더함.');
  await form.getByRole('button', { name: '저장' }).click();
  await expect(nd.locator('[data-nd-edited]')).toBeVisible();
  await expect(page.locator('.kptu-ask-text')).toHaveCount(0);
  await expect(nd.locator('[data-nd-prose] p')).toHaveText(['가짜 본문 첫 문단이다.', '가짜 본문 둘째 문단이다. 끝에 더함.']);
  await expect(nd.locator(`[data-nd-prose] mark[data-hl-id="${MARK3.id}"]`)).toHaveText('본문 첫 문단');
  expect(store.dropped).toEqual([]);
});

test('원문 고치기: 원문 사진은 한 창에 그대로 보이고, 글만 고치면 사진은 같은 자리로 저장', async ({ page }) => {
  test.setTimeout(60000);
  const { store } = await setup(page, 1280);
  const IMG = 'https://img.example.org/a.png';
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
  await page.route('https://img.example.org/**', route => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.unroute('**/rest/v1/app_news_article_bodies*');
  const withImg = [BLOCKS[0], { t: 'img', src: IMG, cap: '가짜 사진 설명', alt: null }, ...BLOCKS.slice(3)];
  await page.route('**/rest/v1/app_news_article_bodies*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ state: 'ok', reason: null, rule: 'open@1', blocks: withImg }]) }));
  await openNews(page, 1280);
  await row(page, 'x1').locator('[data-nc-open="x1"]').click();
  const nd = detail(page);
  await expect(nd.locator('[data-nd-prose] p')).toHaveCount(3);
  const form = await openEdit(page);
  await expect(editor(form).locator('img')).toHaveAttribute('src', IMG);
  await clearPara(page, form, 0);
  await form.getByRole('button', { name: '저장' }).click();
  await expect(nd.locator('[data-nd-edited]')).toBeVisible();
  expect(store.calls.find(c => c.m === 'POST').body.blocks).toEqual([{ t: 'img', src: IMG, cap: '가짜 사진 설명', alt: null }, ...BLOCKS.slice(3)]);
});

test('원문 고치기: 직접 수정한 글의 ⋯ [원문 다시 가져오기]는 한 줄 확인 뒤 직접 수정본을 지우고 처음 원문으로', async ({ page }) => {
  test.setTimeout(60000);
  const { store } = await setup(page, 1280);
  await openItem(page, 1280);
  const nd = detail(page);
  const form = await openEdit(page);
  await clearPara(page, form, 0);
  await form.getByRole('button', { name: '저장' }).click();
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
  test(`원문 고치기 ${width}: 사회운동 글 ⋯에도 [수정] → 앞 덧줄 글 지우기 → 저장(사회운동 글 칸)`, async ({ page }) => {
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
    const form = await openEdit(page);
    await expect(form.getByRole('button', { name: '제목·정보' })).toHaveCount(0);
    for (const n of [0, 1, 2]) await clearPara(page, form, n);
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
  const form = await openEdit(page);
  await expect(para(form, 0)).toHaveText('<img src=x onerror="window.__bad=1"> 가짜 꼬리표 문단');
  await expect(form.locator('img')).toHaveCount(0);
  expect(await page.evaluate(() => window.__bad)).toBeUndefined();
  await clearPara(page, form, 1);
  await form.getByRole('button', { name: '저장' }).click();
  await expect(nd.locator('[data-nd-edited]')).toBeVisible();
  expect(store.calls.find(c => c.m === 'POST').body.blocks[0].text).toBe('<img src=x onerror="window.__bad=1"> 가짜 꼬리표 문단');
  expect(await page.evaluate(() => window.__bad)).toBeUndefined();
});
