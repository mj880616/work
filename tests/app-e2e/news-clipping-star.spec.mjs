import { test, expect } from '@playwright/test';
import { start, openNews } from './helpers/news-server.mjs';
// NEWS-클리핑 C2 → S51-8: 별표 → ⋯ [별표 폴더] 칸의 폴더 트리(폴더 안 폴더, 노트·자료실과 같은 폴더 고르기 창), 기사 메모 = 노트(상세 [메모], metadata.news_item_id),
// 노트 화면 [기사로 가기] → News [언론]에서 그 기사 상세. 서버 흉내(helpers/news-server.mjs), 글은 모두 가짜.
const root = page => page.locator('#newsRoot');
const item = (page, id) => root(page).locator(`[data-nc-item="${id}"]`);
const noWideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const UID = 'c0000000-0000-4000-8000-0000000000c9';
const extra = { id: UID, lane: 'channel', url: 'https://example.org/u', title: '가짜 메모 기사', lang: 'ko', publisher: '가짜일보', source_key: null, keywords: [], published_at: null, scrapped_at: '2026-10-06T00:30:00Z', created_at: '2026-10-06T00:31:00Z', state: 'ok', summary: '메모할 가짜 기사 요약.', body_kind: 'full', title_ko: null, translated_at: null, starred_at: null, folder_id: null, _body: '가짜 본문.' };

// S51-8 NEWS P4b: 목록 줄에는 별표 단추가 없다(★ 표시만). 별표는 상세 [☆ 별표]·줄 밀기, 폴더 정리는 ⋯ [별표 폴더] 칸(옛 [별표] 칩의 트리).
async function openFolders(page) {
  await page.locator('#outsideRoot [data-os-more]').click();
  await page.locator('#osMenu').getByRole('button', { name: '별표 폴더' }).click();
  await expect(root(page).locator('.nc-panel-head')).toContainText('별표 폴더');
}
for (const width of [412, 884, 1440]) {
  test(`언론 별표 폴더 ${width}: 상세 별표 → ⋯ [별표 폴더] → 새 폴더에 넣기 → 안 폴더 · 이름 바꾸기 · 지우기 · 별표 빼기`, async ({ page }) => {
    test.setTimeout(90000);
    const { errors, server } = await start(page, width);
    await openNews(page, width);
    const c1 = item(page, 'c1');
    await expect(c1.locator('.nw-star')).toHaveCount(0);
    // 상세 [☆ 별표] → 서버에 starred_at, 목록 줄에 ★.
    await c1.locator('[data-nc-open="c1"]').click();
    await page.locator('#nowDetail [data-nd-act="star"]').click();
    await expect(page.locator('#nowDetail [data-nd-act="star"]')).toHaveAttribute('aria-pressed', 'true');
    expect(Object.keys(server.calls.filter(c => c.what === 'app_news_items' && c.method === 'PATCH')[0].body).sort()).toEqual(['starred_at', 'updated_at']);
    if (width <= 760) await page.goBack();
    await expect(item(page, 'c1').locator('.nw-star')).toHaveCount(1);

    // ⋯ → 별표 폴더: 별표한 기사 전부(폴더 없음 펼침) → [폴더] → [+ 새 폴더 만들어 넣기](이름 묻기) → 그 폴더에.
    await openFolders(page);
    expect(server.calls.filter(c => c.what === 'app_news_items' && c.method === 'GET').at(-1).query).toContain('starred_at=not.is.null');
    await expect(root(page).locator('[data-nc-item]')).toHaveCount(1);
    await expect(item(page, 'c1').locator('[data-nc-star]')).toHaveAttribute('aria-pressed', 'true');
    page.once('dialog', d => d.accept('가짜 폴더'));
    await item(page, 'c1').locator('[data-nc-folder]').click();
    await expect(page.locator('#luMovePicker')).toBeVisible();
    await page.locator('#luMovePicker [data-lu-move-new]').click();
    await expect(item(page, 'c1').locator('[data-nc-folder]')).toHaveText('가짜 폴더');
    expect(server.calls.filter(c => c.what === 'app_news_items' && c.method === 'PATCH').at(-1).body.folder_id).toBe(server.folders[0].id);
    expect(server.calls.find(c => c.what === 'app_news_folders' && c.method === 'POST').body).toMatchObject({ workspace_id: 'w', parent_id: null, name: '가짜 폴더' });
    await expect(root(page).locator('.nc-folder-name')).toHaveText('가짜 폴더');
    // 폴더 ⋯ → 안에 폴더 만들기 → 기사 [폴더] → 안 폴더로.
    page.once('dialog', d => d.accept('가짜 안 폴더'));
    await root(page).locator('[data-nc-folder-more]').click();
    await page.locator('#ncFolderMenu').getByRole('button', { name: '안에 폴더 만들기' }).click();
    await expect(root(page).locator('[data-nc-folder-toggle]')).toHaveCount(2);
    expect(server.folders[1].parent_id).toBe(server.folders[0].id);
    await item(page, 'c1').locator('[data-nc-folder]').click();
    await page.locator('#luMovePicker').getByRole('button', { name: /가짜 안 폴더/ }).click();
    await expect(item(page, 'c1').locator('[data-nc-folder]')).toHaveText('가짜 폴더 › 가짜 안 폴더');
    await expect(root(page).locator('.nc-tree-item [data-nc-item="c1"]')).toBeVisible();
    // 이름 바꾸기 · 지우기(안 기사는 위 폴더로, 기사는 남음).
    page.once('dialog', d => d.accept('바꾼 가짜 폴더'));
    await root(page).locator(`[data-nc-folder-more="${server.folders[1].id}"]`).click();
    await page.locator('#ncFolderMenu').getByRole('button', { name: '이름 바꾸기' }).click();
    await expect(root(page).locator('.nc-folder-name').nth(1)).toHaveText('바꾼 가짜 폴더');
    await root(page).locator(`[data-nc-folder-more="${server.folders[1].id}"]`).click();
    await page.locator('#ncFolderMenu').getByRole('button', { name: '지우기' }).click();
    await page.getByRole('button', { name: '지우기', exact: true }).last().click();
    await expect(root(page).locator('[data-nc-folder-toggle]')).toHaveCount(1);
    await expect(item(page, 'c1').locator('[data-nc-folder]')).toHaveText('가짜 폴더');
    expect(await noWideScroll(page)).toBe(true);
    // 별표 빼기 = 별표·폴더 함께 비움, 이 칸에서 빠짐. 뒤로가기 한 번 = 목록.
    await item(page, 'c1').locator('[data-nc-star]').click();
    await expect(root(page).locator('[data-nc-item]')).toHaveCount(0);
    expect(server.calls.filter(c => c.what === 'app_news_items' && c.method === 'PATCH').at(-1).body).toMatchObject({ starred_at: null, folder_id: null });
    await page.goBack();
    await expect(root(page).locator('[data-nc-item]')).toHaveCount(5);
    expect(errors).toEqual([]);
  });
}

test('기사 메모 = 노트: 상세 [메모](노트 하나, metadata.news_item_id) → 노트 [기사로 가기]는 News [언론]에서 그 기사 상세', async ({ page }) => {
  test.setTimeout(90000);
  const { errors, server } = await start(page, 1440);
  server.items.unshift(extra);
  await openNews(page, 1440);
  await item(page, UID).locator('.now-open').click();
  const nd = page.locator('#nowDetail');
  await nd.locator('[data-nd-act="memo"]').click();
  await nd.locator('[data-nd-memo-input]').fill('가짜 메모 첫 줄');
  await nd.getByRole('button', { name: '저장' }).click();
  await expect(nd.locator('[data-nd-memo-text]')).toContainText('가짜 메모 첫 줄');
  expect(server.calls.find(c => c.what === 'memo-create').body).toMatchObject({ workspace_id: 'w', kind: 'note', raw_text: '가짜 메모 첫 줄', metadata: { news_item_id: UID } });
  // 노트 [기사로 가기]와 같은 길(requestNewsItem → go('news')): 다른 화면에서 와도 [언론] 탭, 그 기사 상세가 열린다.
  await page.evaluate(() => window.KPTURouter.go('home'));
  await page.evaluate(async id => { const m = await import('./news-request.mjs'); m.requestNewsItem(id); window.KPTURouter.go('news', { source: 'delegated' }); }, UID);
  await expect(page.locator('#outsideRoot [data-os-tab="media"]')).toHaveAttribute('aria-selected', 'true');
  await expect(nd.locator(`[data-nd="news:${UID}"]`)).toBeVisible();
  await expect(item(page, UID)).toHaveClass(/is-open/);
  expect(errors).toEqual([]);
});
