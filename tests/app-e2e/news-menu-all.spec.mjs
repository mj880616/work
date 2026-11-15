import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { newsServer, openNews, ITEMS } from './helpers/news-server.mjs';
// NEWS-모두에게열기(S62-12g): News 메뉴는 로그인 가입자 모두에게 열린다(운영자 기능 키 없음, 공용 기사 표는 서버 정책이 차단 명단을 막는다).
// - 새 계정(운영자 기능 없음, 저장된 메뉴 순서 없음): [메뉴] 창·PC 왼쪽 메뉴에 News가 있고, 열면 공용 기사 목록이 보인다.
// - 거절: 같은 새 계정에게 텔레그램 소식·통화 메뉴와 [뉴스방으로] 단추는 어디에도 없다(서버 판정은 그대로, 화면은 운영자 키로 뺀다).
// - 화면 사진: docs/design/screens/s62-12g/news-new-{412,880,1280}.png. 기사·주소는 모두 가짜(example.org).
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';

// 공용 기사 표(가입자 모두 같은 줄)·내 표시·읽음·반응(새 계정은 아직 없음).
async function sharedNews(page) {
  const articles = ITEMS().map(({ starred_at, folder_id, keywords, _body, _body_ko, ...a }) => ({ ...a, body: _body, body_ko: null }));
  await page.route(u => u.origin === SB && /^\/rest\/v1\/(app_news_articles|app_news_marks|app_news_reads|app_news_now_signals|app_news_items|app_feed_reads|rpc\/app_news_article_of)$/.test(u.pathname), async route => {
    const p = new URL(route.request().url()).pathname.slice('/rest/v1/'.length);
    const ok = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    if (p === 'app_news_articles') return ok(articles);
    if (route.request().method() === 'POST') return route.fulfill({ status: 201 });
    return ok([]);
  });
}

const menuViews = page => page.evaluate(() => {
  const view = el => el.dataset.view || el.dataset.basketKindNav || '';
  return {
    sheet: [...document.querySelectorAll('#mobileMenu nav[aria-label="더 보기"] button')].map(view),
    pc: [...document.querySelectorAll('#appNav .nav-btn[data-view]')].map(view),
  };
});

for (const width of [412, 880, 1280]) {
  test(`NEWS-모두에게열기 새 계정 ${width}px: News 메뉴가 있고 열린다, 텔레그램 소식·통화·[뉴스방으로]는 없다`, async ({ page }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 900 });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await openHome(page, { features: [], menuLayout: null });
    await newsServer(page);
    await sharedNews(page);
    await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, { timeout: 20000 });
    await expect.poll(async () => (await menuViews(page)).sheet).toEqual(['basket', 'library', 'files', 'brief', 'hwp', 'pages', 'photos', 'outside']);
    const views = await menuViews(page);
    for (const v of ['calls', 'telegram', 'arsenal']) {
      expect(views.sheet).not.toContain(v);
      expect(views.pc).not.toContain(v);
    }
    expect(views.pc).toContain('outside');
    await openNews(page, width);
    await expect(page.locator('#newsRoot [data-nc-item]').first()).toBeVisible();
    await expect(page.locator('body')).not.toContainText('뉴스방으로');
    await expect(page.locator('[data-tg-ract="news"]')).toHaveCount(0);
    for (const where of ['#appNav', '#mobileMenu']) await expect(page.locator(where)).not.toContainText('텔레그램 소식');
    await page.screenshot({ path: `docs/design/screens/s62-12g/news-new-${width}.png` });
    expect(errors).toEqual([]);
  });
}
