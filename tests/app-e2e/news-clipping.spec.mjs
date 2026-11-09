import { test, expect } from '@playwright/test';
import { start, openNews } from './helpers/news-server.mjs';
// NEWS-클리핑 C1(docs/design/news-clipping.md) → S51-8 NEWS-전면개편 P4b: News [언론] 탭(?view=outside).
// 제목 중심 줄(색 띠·매체 이름·국제 꼬리표·시각, 요약·접기·번역은 상세로) · 위 찾기 칸 제목 거르기 · [매체 ▾] 거르기
// · 껍데기 ⋯ [지금 채우기]·[키워드 고치기]·[언론 매체 켜고 끄기](서버 저장, 뒤로가기 한 번 = 목록) · 폰 좌우 밀기로 탭 이동.
// 서버는 흉내 낸다(시계 2026-10-06 10:00 서울, home-entry.mjs). 기사·매체·주소는 모두 가짜(example.org).
const root = page => page.locator('#newsRoot');
const items = page => root(page).locator('[data-nc-item]');
const item = (page, id) => root(page).locator(`[data-nc-item="${id}"]`);
const noWideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

for (const width of [412, 884, 1440]) {
  test(`News [언론] ${width}: 제목 중심 줄·색 띠·국제 꼬리표·읽음 굵기·지금 채우기·키워드·매체 켜고 끄기(서버 저장)`, async ({ page }) => {
    test.setTimeout(90000);
    const { errors, server } = await start(page, width);
    await openNews(page, width);
    await expect(items(page)).toHaveCount(5);
    expect(await noWideScroll(page)).toBe(true);
    // 카탈로그는 사용자 로그인으로 Edge에서, 목록은 자기 작업공간·지우지 않은 줄만.
    expect(server.calls.find(c => c.what === 'edge')).toMatchObject({ action: 'catalog', method: 'POST', auth: expect.stringMatching(/^Bearer /) });
    const listQuery = server.calls.find(c => c.what === 'app_news_items').query;
    expect(listQuery).toContain('workspace_id=eq.w'); expect(listQuery).toContain('hidden_at=is.null'); expect(listQuery).not.toMatch(/[,=]body(,|&|$)/);
    // 날짜 묶음(새 글 수) → 흰 상자 안 줄. 칩 줄([전체]·[별표])·이 칸의 ⋯는 없다(S51-8: 위 [매체 ▾]·껍데기 ⋯로).
    await expect(root(page).locator('.nw-day-head')).toHaveText(['오늘 · 새 글 2', '어제 · 새 글 2', '10. 4. (일) · 새 글 1']);
    await expect(root(page).locator('[data-nc-tab], [data-nc-more], .nc-chips')).toHaveCount(0);
    await expect(root(page)).not.toContainText('명진');
    const c1 = item(page, 'c1');
    await expect(c1.locator('.nw-title')).toHaveText('가짜 채널 기사');
    await expect(c1.locator('.nw-src')).toHaveText('가짜노동신문');
    await expect(c1.locator('.nw-time')).toHaveText('09:20');
    // 요약·본문 접기·번역·메모는 목록에 없다(상세에서). 줄은 제목 단추 하나가 덮는다(누르면 공용 상세).
    await expect(c1.locator('.nc-sum, details, [data-nc-translate], [data-nc-memo]')).toHaveCount(0);
    await expect(c1.getByRole('link', { name: /원문/ })).toHaveCount(0);
    await expect(c1.locator('[data-nc-open="c1"]')).toHaveText('가짜 채널 기사');
    await expect(c1).toHaveClass(/is-new/);
    // 외국어: 제목은 서버가 미리 번역한 한국어, 꼬리표 '국제', 매체 색은 언론 계열.
    const e1 = item(page, 'e1');
    await expect(e1.locator('.nw-title')).toHaveText('가짜 외국 기사');
    await expect(e1.locator('.nw-tag')).toHaveText('국제');
    await expect(e1).toHaveAttribute('style', /--nw-c:var\(--ds-news-press-[1-4]\)/);
    await expect(c1.locator('.nw-tag')).toHaveCount(0);
    // 대기 줄: 주소의 도메인.
    await expect(item(page, 'w1').locator('.nw-title')).toHaveText('제목 읽기 전 · example.org');
    // 위 찾기 칸: 제목으로 바로 거름.
    await page.locator('#outsideRoot [data-nw-find]').fill('유료');
    await expect(items(page)).toHaveCount(1);
    await page.locator('#outsideRoot [data-nw-find]').fill('');
    await expect(items(page)).toHaveCount(5);

    // ⋯ → 지금 채우기: 언론은 fill_now → 결과 한 줄 + 목록 다시 읽기.
    server.fillArmed = true;
    await page.locator('#outsideRoot [data-os-more]').click();
    await page.locator('#osMenu').getByRole('button', { name: '지금 채우기' }).click();
    await expect(root(page).locator('[data-nc-when]')).toHaveText('1건 채움');
    await expect(item(page, 'w1').locator('.nw-title')).toHaveText('채운 가짜 기사');

    // ⋯ → 키워드 고치기: 더하기·끄기·지우기(서버 저장), 뒤로가기 한 번 = 목록. 위 찾기 줄은 감춘다.
    await page.locator('#outsideRoot [data-os-more]').click();
    await page.locator('#osMenu').getByRole('button', { name: '키워드 수정' }).click();
    await expect(root(page).locator('[data-nc-kw]')).toHaveCount(1);
    await expect(items(page)).toHaveCount(0);
    await expect(page.locator('#outsideRoot [data-nw-top]')).toBeHidden();
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

    // ⋯ → 언론 매체 켜고 끄기: news- 키만, 국내·해외 묶음, 켜기 = 새 줄 넣기. 켜면 [매체 ▾] 창에도 나온다.
    const callsBefore = server.calls.length;
    await page.locator('#outsideRoot [data-os-more]').click();
    await page.locator('#osMenu').getByRole('button', { name: '언론 매체 켜고 끄기' }).click();
    await expect(root(page).locator('.nc-group-head')).toHaveText(['국내', '해외']);
    // 이 창이 읽는 것은 news- 키뿐이다. (같은 표를 다른 칸 — 외부 소식 탭의 'news- 아님' 읽기 — 도 읽어 마지막 한 건으로 가리지 않고, 연 뒤의 읽기 중에서 찾는다.)
    await expect.poll(() => server.calls.slice(callsBefore).some(c => c.what === 'app_outside_sources' && c.method === 'GET' && c.query.includes('source_key=like.news-*'))).toBe(true);
    await expect(root(page).locator('[data-nc-source="news-fake-a"]')).toHaveAttribute('aria-checked', 'true');
    await root(page).locator('[data-nc-source="news-fake-en"]').click();
    await expect(root(page).locator('[data-nc-source="news-fake-en"]')).toHaveAttribute('aria-checked', 'true');
    expect(server.calls.find(c => c.what === 'app_outside_sources' && c.method === 'POST').body).toEqual({ workspace_id: 'w', source_key: 'news-fake-en', enabled: true });
    await root(page).locator('[data-nc-back]').click();
    await expect(items(page)).toHaveCount(5);
    // [매체 ▾] → 'Fake Wire'만: 서버에 그 news- 키만 묻는다.
    await page.locator('#outsideRoot [data-nw-media]').click();
    await expect(page.locator('#nwMediaPicker .lu-move-item')).toHaveText([/^전체/, '언론 국내', '가짜노동신문', '언론 외국', 'Fake Wire']);
    await page.locator('#nwMediaPicker [data-lu-move-folder="n:news-fake-en"]').click();
    await expect(items(page)).toHaveCount(1);
    expect(server.calls.filter(c => c.what === 'app_news_items').at(-1).query).toContain('source_key=in.(news-fake-en)');
    expect(await noWideScroll(page)).toBe(true);
    expect(errors).toEqual([]);
  });
}

// 매체 창을 열 때 시작한 읽기가 늦게 돌아와도(켜고 끈 뒤에 도착), 옛 값이 방금 켠 것을 되돌리면 안 된다(STAB-뉴스·검색).
test('News [언론] 1440: 매체 창 읽기가 늦게 와도 방금 켠 매체는 그대로 켜져 있다', async ({ page }) => {
  test.setTimeout(60000);
  const { errors, server } = await start(page, 1440);
  await openNews(page, 1440);
  await expect(items(page)).toHaveCount(5);
  let release; server.sourcesHold = new Promise(r => { release = r; });
  await page.locator('#outsideRoot [data-os-more]').click();
  await page.locator('#osMenu').getByRole('button', { name: '언론 매체 켜고 끄기' }).click();
  const en = root(page).locator('[data-nc-source="news-fake-en"]');
  await expect(en).toHaveAttribute('aria-checked', 'false');
  await en.click();
  await expect(en).toHaveAttribute('aria-checked', 'true');
  expect(server.calls.find(c => c.what === 'app_outside_sources' && c.method === 'POST').body).toMatchObject({ source_key: 'news-fake-en', enabled: true });
  // 켠 뒤에야 옛 읽기 답이 도착한다: 답이 화면에 닿고 두 번 그린 뒤까지 기다린다.
  const late = page.waitForResponse(r => r.request().method() === 'GET' && r.url().includes('/rest/v1/app_outside_sources'));
  release();
  await late;
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await expect(en).toHaveAttribute('aria-checked', 'true');
  await expect(root(page).locator('[data-nc-source="news-fake-a"]')).toHaveAttribute('aria-checked', 'true');
  expect(errors).toEqual([]);
});

test('News [언론] 폰 412: 좌우로 밀면 탭 이동, ⋯ 메뉴는 하단바에 가리지 않음', async ({ page }) => {
  test.setTimeout(60000);
  const { errors } = await start(page, 412);
  await openNews(page, 412);
  await expect(items(page)).toHaveCount(5);
  const swipe = async dx => page.evaluate(async d => {
    const el = document.querySelector('#outsideRoot [data-os-tabs]'), r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + 12;
    const t = (cx) => new Touch({ identifier: 1, target: el, clientX: cx, clientY: y });
    el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [t(x)], changedTouches: [t(x)] }));
    el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [t(x + d)] }));
  }, dx);
  // 탭 줄 [전체] [사회운동] [언론] [보관] — 왼쪽으로 밀면 다음 탭.
  await swipe(-120);
  await expect(page.locator('#outsideRoot [data-os-tab="archive"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#nowPanelNews')).toBeHidden();
  await swipe(120);
  await expect(page.locator('#outsideRoot [data-os-tab="media"]')).toHaveAttribute('aria-selected', 'true');
  await expect(items(page)).toHaveCount(5);
  await page.locator('#outsideRoot [data-os-more]').click();
  const menu = page.locator('#osMenu');
  await expect(menu).toBeVisible();
  const [m, bar] = await Promise.all([menu.boundingBox(), page.locator('.mobile-tabs').boundingBox()]);
  expect(m.y + m.height).toBeLessThanOrEqual(bar.y + 1);
  expect(errors).toEqual([]);
});

test('Now [사회운동] ⋯ [지금 채우기]: 켠 단체만 read_now로 하나씩(뉴스 클리핑 매체 키는 빼고)', async ({ page }) => {
  test.setTimeout(60000);
  const { errors, server } = await start(page, 1440);
  server.sources.set('kctu', { source_key: 'kctu', enabled: true, last_ok_at: '2026-10-05T09:07:00Z', last_error: null });
  await page.locator('#appView>.app-nav').getByRole('button', { name: 'News', exact: true }).click();
  await expect(page.locator('#outsideView')).toBeVisible();
  await page.locator('#outsideRoot [data-os-more]').click();
  await page.locator('#osMenu').getByRole('button', { name: '지금 채우기' }).click();
  await expect.poll(() => server.calls.filter(c => c.what === 'outside-edge' && c.action === 'read_now').length).toBe(1);
  expect(server.calls.find(c => c.action === 'read_now').body).toEqual({ source: 'kctu' });
  expect(errors).toEqual([]);
});

// S48-66 NOW-뉴스상세: 아직 안 읽은 기사는 상세 전에 그 기사 하나를 먼저 읽는다(news-feed open → ai-assist now_detail 순서).
// 읽지 못하면 AI를 부르지 않고 이유·[다시]·[원래 사이트 ↗]만 보인다. 저장 원문(app_feed_bodies) 줄이 없는 옛 기사만 이 길(S51-14).
const NOW_DETAIL = { ok: true, kind: 'now_detail', detail: { level: 'full', summary: '가짜 기사 한 줄 요약입니다.', key_sentences: [{ orig: '가짜 본문 첫 문단.', ko: null }], relevance: null, implications: null, related: [], generated_at: '2026-10-06T01:00:00Z', context_at: null }, stale: false };
for (const width of [412, 1440]) {
  test(`뉴스 상세 ${width}: 제목 읽기 전 기사를 누르면 먼저 읽고 요약 상세가 뜬다`, async ({ page }) => {
    test.setTimeout(60000);
    const { errors, server } = await start(page, width);
    const order = [];
    await page.route('**/functions/v1/ai-assist', async route => { if (route.request().postDataJSON()?.kind !== 'now_detail') return route.fallback(); if (route.request().postDataJSON()?.news_item_id === 'w1') order.push('detail'); await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(NOW_DETAIL) }); });
    page.on('request', r => { if (/news-feed\?action=open/.test(r.url()) && r.postDataJSON()?.id === 'w1') order.push('open'); });
    await openNews(page, width);
    await item(page, 'w1').locator('[data-nc-open="w1"]').click();
    await expect(page.locator('[data-nd-summary]')).toContainText('가짜 기사 한 줄 요약입니다.');
    expect(order.slice(0, 2)).toEqual(['open', 'detail']);
    expect(server.calls.find(c => c.action === 'open')).toMatchObject({ body: { id: 'w1' } });
    await expect(page.locator('[data-nd-unread]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
  test(`뉴스 상세 ${width}: 읽지 못한 기사는 AI를 부르지 않고 이유·다시·원문`, async ({ page }) => {
    test.setTimeout(60000);
    const { errors } = await start(page, width);
    let detailCalls = 0;
    await page.route('**/functions/v1/ai-assist', async route => { if (route.request().postDataJSON()?.kind !== 'now_detail') return route.fallback(); if (route.request().postDataJSON()?.news_item_id === 'w1') detailCalls++; await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(NOW_DETAIL) }); });
    await page.route('**/functions/v1/news-feed?action=open', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, status: 'robots' }) }));
    await openNews(page, width);
    await item(page, 'w1').locator('[data-nc-open="w1"]').click();
    // S51-14 P4c: 요약 칸에 까닭 + [다시], 원문 칸에 까닭 한 줄 + [원래 사이트 ↗].
    const bad = page.locator('[data-nd-unread]');
    await expect(bad).toContainText('요약할 재료가 없어요');
    await expect(bad.getByRole('button', { name: '다시' })).toBeVisible();
    await expect(page.locator('#nowDetail [data-nd-why]')).toContainText('이 사이트가 읽기를 막아 둠');
    await expect(page.locator('#nowDetail [data-nd-why]').getByRole('link', { name: /원래 사이트/ })).toBeVisible();
    expect(detailCalls).toBe(0);
    expect(errors).toEqual([]);
  });
}

for (const width of [412, 1440]) {
  test(`뉴스 클리핑 ${width}: 목록을 열면 읽기 전 채널 기사를 서버가 바로 채운다(10분에 한 번)`, async ({ page }) => {
    test.setTimeout(60000);
    const { errors, server } = await start(page, width);
    server.fillArmed = true;
    await openNews(page, width);
    await expect(item(page, 'w1').locator('.nw-title')).toHaveText('채운 가짜 기사');
    expect(server.calls.filter(c => c.action === 'fill_now')).toHaveLength(1);
    expect(server.calls.find(c => c.action === 'fill_now').body).toEqual({});
    // 채운 뒤 목록을 다시 읽어도(읽기 전 기사가 없고 10분 안이므로) 다시 부르지 않는다.
    await page.locator('#outsideRoot [data-os-tab="all"]').click();
    await page.locator('#outsideRoot [data-os-tab="media"]').click();
    await expect(item(page, 'w1')).toBeVisible();
    expect(server.calls.filter(c => c.action === 'fill_now')).toHaveLength(1);
    expect(errors).toEqual([]);
  });
}
