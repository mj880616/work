import { test, expect } from '@playwright/test';
import { folderSheet, sheetRow, sheetGo, pickInSheet } from './helpers/folder-sheet.mjs';
import { start, openNews } from './helpers/news-server.mjs';
import { routeMemos } from './helpers/memo-server.mjs';
// NEWS-클리핑 C2 → S51-8: 별표 → ⋯ [별표 폴더] 칸의 폴더 트리(폴더 안 폴더, 노트·자료실과 같은 폴더 고르기 창), 기사 메모 = 노트(상세 [메모], metadata.news_item_id),
// 노트 화면 [기사로 가기] → News [언론]에서 그 기사 상세. 서버 흉내(helpers/news-server.mjs), 글은 모두 가짜.
const root = page => page.locator('#newsRoot');
const item = (page, id) => root(page).locator(`[data-nc-item="${id}"]`);
const noWideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
// UI-알림창정리: 폴더 이름은 브라우저 기본 prompt가 아니라 공용 작은 글 입력창(.kptu-ask)으로 묻는다.
const answerName = async (page, value, ok) => {
  const ask = page.locator('.kptu-ask');
  await ask.waitFor({ state: 'visible' });
  await expect(ask.locator('.kptu-ask-actions button').nth(1)).toHaveText(ok);
  await ask.locator('.kptu-ask-field').fill(value);
  await ask.locator('.kptu-ask-actions button').nth(1).click();
  await ask.waitFor({ state: 'detached' });
};
const UID = 'c0000000-0000-4000-8000-0000000000c9';
const extra = { id: UID, lane: 'channel', url: 'https://example.org/u', title: '가짜 메모 기사', lang: 'ko', publisher: '가짜일보', source_key: null, keywords: [], published_at: null, scrapped_at: '2026-10-06T00:30:00Z', created_at: '2026-10-06T00:31:00Z', state: 'ok', summary: '메모할 가짜 기사 요약.', body_kind: 'full', title_ko: null, translated_at: null, starred_at: null, folder_id: null, _body: '가짜 본문.' };

// S51-8 NEWS P4b: 목록 줄에는 별표 단추가 없다(★ 표시만). 별표는 상세 [☆ 별표]·줄 밀기, 폴더 정리는 ⋯ [별표 폴더] 칸(옛 [별표] 칩의 트리).
async function openFolders(page) {
  await page.locator('.sf-tools [data-os-more]').click();
  await page.locator('#osMenu').getByRole('button', { name: '별표 폴더' }).click();
  await expect(root(page).locator('.nc-panel-head')).toContainText('별표 폴더');
}
for (const width of [412, 884, 1440]) {
  test(`언론 별표 폴더 ${width}: 상세 별표 → ⋯ [별표 폴더] → 새 폴더에 넣기 → 안 폴더 · 이름 바꾸기 · 삭제 · 별표 빼기`, async ({ page }) => {
    test.setTimeout(90000);
    const { errors, server } = await start(page, width);
    await openNews(page, width);
    const c1 = item(page, 'c1');
    await expect(c1.locator('.nw-star')).toHaveCount(0);
    // 상세 [☆ 별표] → 내 읽을 거리 한 줄(서버 함수 app_reading_keep, S68-27), 목록 줄에 ★.
    await c1.locator('[data-nc-open="c1"]').click();
    await page.locator('#nowDetail [data-nd-act="star"]').click();
    await expect(page.locator('#nowDetail [data-nd-act="star"]')).toHaveAttribute('aria-pressed', 'true');
    // S68-27 READ-보관기록일원화: 보관(별표)의 원본은 읽을 거리 줄 — 표시 표의 별표 칸에는 쓰지 않는다.
    expect(server.calls.filter(c => c.what === 'reading_keep')[0].body).toEqual({ p_workspace: 'w', p_source: 'news', p_article: 'c1', p_on: true, p_saved_at: null });
    expect(server.calls.some(c => c.what === 'app_news_marks' && c.method !== 'GET' && c.body && 'starred_at' in c.body)).toBe(false);
    if (width <= 760) await page.goBack();
    await expect(item(page, 'c1').locator('.nw-star')).toHaveCount(1);

    // ⋯ → 별표 폴더: 별표한 기사 전부(폴더 없음 펼침) → [폴더] → [+ 새 폴더 만들어 넣기](이름 묻기) → 그 폴더에.
    await openFolders(page);
    expect(server.calls.filter(c => c.what === 'app_reading_items').at(-1).query).toContain('news_article_id=not.is.null');
    await expect(root(page).locator('[data-nc-item]')).toHaveCount(1);
    await expect(item(page, 'c1').locator('[data-nc-star]')).toHaveAttribute('aria-pressed', 'true');
    await item(page, 'c1').locator('[data-nc-folder]').click();
    // S69-62: [파일] '옮길 곳' 창과 같은 창 — [새 폴더]는 고른 곳(맨 위 줄 '별표' = 폴더 없음) 안에 만들고 그 폴더를 고른다. 넣기는 [여기에 넣기]로만.
    await expect(folderSheet(page)).toBeVisible();
    await expect(sheetRow(page, '별표')).toHaveAttribute('aria-current', 'true');
    await folderSheet(page).locator('[data-fx-dest-mkdir]').click();
    await answerName(page, '가짜 폴더', '만들기');
    await expect(sheetRow(page, '가짜 폴더')).toHaveAttribute('aria-current', 'true');
    await sheetGo(page).click();
    await expect(folderSheet(page)).toHaveCount(0);
    await expect(item(page, 'c1').locator('[data-nc-folder]')).toHaveText('가짜 폴더');
    expect(server.calls.filter(c => c.what === 'app_news_marks' && c.method === 'PATCH').at(-1).body.folder_id).toBe(server.folders[0].id);
    expect(server.calls.find(c => c.what === 'app_news_folders' && c.method === 'POST').body).toMatchObject({ workspace_id: 'w', parent_id: null, name: '가짜 폴더' });
    await expect(root(page).locator('.nc-folder-name')).toHaveText('가짜 폴더');
    // 폴더 ⋯ → 안에 폴더 만들기 → 기사 [폴더] → 안 폴더로.
    await root(page).locator('[data-nc-folder-more]').click();
    await page.locator('#ncFolderMenu').getByRole('button', { name: '안에 폴더 만들기' }).click();
    await answerName(page, '가짜 안 폴더', '만들기');
    await expect(root(page).locator('[data-nc-folder-toggle]')).toHaveCount(2);
    expect(server.folders[1].parent_id).toBe(server.folders[0].id);
    await item(page, 'c1').locator('[data-nc-folder]').click();
    await pickInSheet(page, ['가짜 폴더', '가짜 안 폴더']);
    await expect(item(page, 'c1').locator('[data-nc-folder]')).toHaveText('가짜 폴더 › 가짜 안 폴더');
    await expect(root(page).locator('.nc-tree-item [data-nc-item="c1"]')).toBeVisible();
    // 이름 바꾸기 · 지우기(안 기사는 위 폴더로, 기사는 남음).
    await root(page).locator(`[data-nc-folder-more="${server.folders[1].id}"]`).click();
    await page.locator('#ncFolderMenu').getByRole('button', { name: '이름 바꾸기' }).click();
    await expect(page.locator('.kptu-ask .kptu-ask-field')).toHaveValue('가짜 안 폴더');
    await answerName(page, '바꾼 가짜 폴더', '바꾸기');
    await expect(root(page).locator('.nc-folder-name').nth(1)).toHaveText('바꾼 가짜 폴더');
    await root(page).locator(`[data-nc-folder-more="${server.folders[1].id}"]`).click();
    await page.locator('#ncFolderMenu').getByRole('button', { name: '삭제' }).click();
    await page.getByRole('button', { name: '삭제', exact: true }).last().click();
    await expect(root(page).locator('[data-nc-folder-toggle]')).toHaveCount(1);
    await expect(item(page, 'c1').locator('[data-nc-folder]')).toHaveText('가짜 폴더');
    expect(await noWideScroll(page)).toBe(true);
    // 별표 빼기 = 읽을 거리 줄을 지우고 폴더도 서버가 함께 비움, 이 칸에서 빠짐. 뒤로가기 한 번 = 목록.
    await item(page, 'c1').locator('[data-nc-star]').click();
    await expect(root(page).locator('[data-nc-item]')).toHaveCount(0);
    expect(server.calls.filter(c => c.what === 'reading_keep').at(-1).body).toMatchObject({ p_article: 'c1', p_on: false });
    expect(server.items.find(i => i.id === 'c1')).toMatchObject({ starred_at: null, folder_id: null });
    await page.goBack();
    await expect(root(page).locator('[data-nc-item]')).toHaveCount(5);
    expect(errors).toEqual([]);
  });
}

test('기사 메모(S69-94): 상세 아래 메모 칸에 남김(app_memos, 대상 news·그 기사) → 노트 [기사로 가기]는 News [언론]에서 그 기사 상세', async ({ page }) => {
  test.setTimeout(90000);
  const { errors, server } = await start(page, 1440);
  const memos = await routeMemos(page);
  server.items.unshift(extra);
  await openNews(page, 1440);
  await item(page, UID).locator('.now-open').click();
  const nd = page.locator('#nowDetail');
  await expect(nd.locator('[data-nd-memo-go]')).toHaveCount(0); // READ-메모칩삭제: 아래 메모 칸에 바로 쓴다
  await nd.locator('[data-nd-memos] [data-cm-text]').fill('가짜 메모 첫 줄');
  await nd.locator('[data-nd-memos]').getByRole('button', { name: '메모 남기기', exact: true }).click();
  await expect(nd.locator('[data-nd-memos] .memo-th-row')).toContainText('가짜 메모 첫 줄');
  expect(memos.posts).toHaveLength(1);
  expect(memos.posts[0]).toMatchObject({ workspace_id: 'w', target_type: 'news', target_id: UID, body: '가짜 메모 첫 줄' });
  expect(server.calls.some(c => c.what === 'memo-create')).toBe(false);
  // 노트 [기사로 가기]와 같은 길(requestNewsItem → go('news')): 다른 화면에서 와도 [언론] 탭, 그 기사 상세가 열린다.
  await page.evaluate(() => window.KPTURouter.go('home'));
  await page.evaluate(async id => { const m = await import('./news-request.mjs'); m.requestNewsItem(id); window.KPTURouter.go('news', { source: 'delegated' }); }, UID);
  await expect(page.locator('#outsideRoot [data-os-tab="media"]')).toHaveAttribute('aria-selected', 'true');
  await expect(nd.locator(`[data-nd="news:${UID}"]`)).toBeVisible();
  await expect(item(page, UID)).toHaveClass(/is-open/);
  expect(errors).toEqual([]);
});
