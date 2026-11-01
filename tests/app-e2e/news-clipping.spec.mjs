import { test, expect } from '@playwright/test';
import { start, openNews } from './helpers/news-server.mjs';
// NEWS-클리핑 C1(docs/design/news-clipping.md, 명진 11/01 22:34): '뉴스 클리핑' 메뉴(?view=news).
// 한 목록(꼬리표 채널/자동) · 한 문장 요약 늘 보임 · 본문 접기([본문 열기]=news-feed open) · 외국어 [번역](저장본 재사용) · 유료는 공개 요약만 + 원문
// · ⋯ [지금 채우기]·[키워드 고치기]·[매체 켜고 끄기](서버 저장, 뒤로가기 한 번 = 목록) · 폰 좌우 밀기로 칩 이동. 사회운동 Now ⋯에도 [지금 채우기](read_now 재사용).
// 서버는 흉내 낸다(시계 2026-10-06 10:00 서울, home-entry.mjs). 기사·매체·주소는 모두 가짜(example.org).
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
    // 대기 줄: 주소의 도메인 + '읽는 중', 본문 칸 없음.
    await expect(item(page, 'w1').locator('.nc-title')).toHaveText('example.org');
    await expect(item(page, 'w1').locator('.nc-note')).toHaveText('읽는 중');
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
