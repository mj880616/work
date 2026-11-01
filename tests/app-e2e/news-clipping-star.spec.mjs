import { test, expect } from '@playwright/test';
import { start, openNews } from './helpers/news-server.mjs';
// NEWS-클리핑 C2: 별표 → 폴더 트리(폴더 안 폴더, 노트·자료실과 같은 폴더 고르기 창), 기사 메모 = 노트(kind='note', metadata.news_item_id),
// 노트 화면 [기사로 가기] → 뉴스 클리핑에서 그 기사. 서버 흉내(helpers/news-server.mjs), 글은 모두 가짜.
const root = page => page.locator('#newsRoot');
const item = (page, id) => root(page).locator(`[data-nc-item="${id}"]`);
const noWideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const UID = 'c0000000-0000-4000-8000-0000000000c9';
const extra = { id: UID, lane: 'channel', url: 'https://example.org/u', title: '가짜 메모 기사', lang: 'ko', publisher: '가짜일보', source_key: null, keywords: [], published_at: null, scrapped_at: '2026-10-06T00:30:00Z', created_at: '2026-10-06T00:31:00Z', state: 'ok', summary: '메모할 가짜 기사 요약.', body_kind: 'full', title_ko: null, translated_at: null, starred_at: null, folder_id: null, _body: '가짜 본문.' };

for (const width of [412, 884, 1440]) {
  test(`뉴스 클리핑 별표 폴더 ${width}: 별표 → 새 폴더에 넣기 → 별표 칩 트리 → 안 폴더 · 이름 바꾸기 · 지우기 · 별표 빼기`, async ({ page }) => {
    test.setTimeout(90000);
    const { errors, server } = await start(page, width);
    await openNews(page, width);
    const c1 = item(page, 'c1');
    await expect(c1.locator('[data-nc-star]')).toHaveAttribute('aria-pressed', 'false');
    // 별표 → 서버에 starred_at → 바로 폴더 고르기 창 → [+ 새 폴더 만들어 넣기](이름 묻기) → 그 폴더에.
    page.once('dialog', d => d.accept('가짜 폴더'));
    await c1.locator('[data-nc-star]').click();
    await expect(page.locator('#luMovePicker')).toBeVisible();
    await page.locator('#luMovePicker [data-lu-move-new]').click();
    await expect(c1.locator('[data-nc-star]')).toHaveAttribute('aria-pressed', 'true');
    await expect(c1.locator('[data-nc-folder]')).toHaveText('가짜 폴더');
    const patches = server.calls.filter(c => c.what === 'app_news_items' && c.method === 'PATCH');
    expect(Object.keys(patches[0].body).sort()).toEqual(['starred_at', 'updated_at']);
    expect(patches.at(-1).body.folder_id).toBe(server.folders[0].id);
    expect(server.calls.find(c => c.what === 'app_news_folders' && c.method === 'POST').body).toMatchObject({ workspace_id: 'w', parent_id: null, name: '가짜 폴더' });

    // 별표 칩: 폴더 트리(열린 폴더 안에 기사).
    await root(page).locator('[data-nc-tab="star"]').click();
    await expect(root(page).locator('[data-nc-folder-toggle]')).toHaveCount(1);
    expect(server.calls.filter(c => c.what === 'app_news_items' && c.method === 'GET').at(-1).query).toContain('starred_at=not.is.null');
    await expect(root(page).locator('.nc-folder-name')).toHaveText('가짜 폴더');
    await expect(root(page).locator('[data-nc-item]')).toHaveCount(1);
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
    // 별표 빼기 = 별표·폴더 함께 비움, 별표 칩에서 빠짐.
    await item(page, 'c1').locator('[data-nc-star]').click();
    await expect(root(page).locator('[data-nc-item]')).toHaveCount(0);
    expect(server.calls.filter(c => c.what === 'app_news_items' && c.method === 'PATCH').at(-1).body).toMatchObject({ starred_at: null, folder_id: null });
    expect(errors).toEqual([]);
  });
}

test('기사 메모 = 노트: 메모 쓰기(노트 하나, metadata.news_item_id) → 노트에서 열기 → [기사로 가기]로 그 기사', async ({ page }) => {
  test.setTimeout(90000);
  const { errors, server } = await start(page, 1440);
  server.items.unshift(extra);
  server.serveNotes = true;
  await openNews(page, 1440);
  const it = item(page, UID);
  await it.locator('[data-nc-memo]').click();
  await it.locator('[data-nc-memo-input]').fill('가짜 메모 첫 줄');
  await it.getByRole('button', { name: '저장' }).click();
  await expect(it.locator('[data-nc-memo-text]')).toContainText('가짜 메모 첫 줄');
  const created = server.calls.find(c => c.what === 'memo-create').body;
  expect(created).toMatchObject({ workspace_id: 'w', kind: 'note', title: '기사 메모 · 가짜 메모 기사', raw_text: '가짜 메모 첫 줄', metadata: { news_item_id: UID } });
  // 고치기 = 같은 노트의 글자만(새 노트 없음).
  await it.locator('[data-nc-memo]').click();
  await expect(it.locator('[data-nc-memo]')).toBeHidden();
  await it.locator('[data-nc-memo-input]').fill('가짜 메모 고침');
  await it.getByRole('button', { name: '저장' }).click();
  await expect(it.locator('[data-nc-memo-text]')).toContainText('가짜 메모 고침');
  expect(server.calls.filter(c => c.what === 'memo-create')).toHaveLength(1);
  expect(server.calls.find(c => c.what === 'memo-update').body).toMatchObject({ raw_text: '가짜 메모 고침' });
  // 노트에서 열기 → 노트 화면 → [기사로 가기] → 뉴스 클리핑, 그 기사 펼침.
  await it.locator('[data-nc-memo]').click();
  await it.getByRole('button', { name: '노트에서 열기' }).click();
  await expect(page.locator('[data-note-news]')).toBeVisible();
  await page.locator('[data-note-news]').click();
  await expect(page.locator('#newsView')).toBeVisible();
  await expect(item(page, UID)).toHaveClass(/is-focus/);
  await expect(item(page, UID).locator('.nc-text')).toHaveText('가짜 본문.');
  expect(errors).toEqual([]);
});
