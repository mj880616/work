import { test, expect } from '@playwright/test';
// S51-23 FILES-최근자동제외(요청함 11/06 21:29): 파일 '최근' 상자에 Web2 자동화가 되풀이해 만드는 파일(텔레그램 수집기 메시지·첨부,
// 통화 전사, 편집 백업 등 시스템 폴더 안)이 줄지어 보이지 않게 한다. 사람 파일은 그대로, 시스템 폴더 자체는 나무에 그대로 보인다.
// 판별은 파일 이름이 아니라 폴더(files-auto-model.mjs). 이름·폴더는 모두 가짜.
const item = o => ({ parent_id: null, is_folder: false, mime: null, size_bytes: 600, hash: null, trashed: false, starred: false, library_doc_id: null, ...o });
const folder = (item_id, name, parent_id = null) => item({ source: 'gd', item_id, parent_id, name, is_folder: true, size_bytes: null, modified_at: '2026-10-01T00:00:00Z' });

test('파일 폰 412: 자동 생성 파일은 \'최근\'에서 빠지고 사람 파일 5줄이 그대로, 서버에는 한도까지 한 번 묻는다', async ({ page }) => {
  const { start, openFiles } = await import('./helpers/files-server.mjs');
  const { errors, server } = await start(page, 412);
  // 사람 파일보다 모두 더 최근(10/06 00:30~)에 바뀐 자동 생성 파일 12개.
  server.items.push(
    folder('gdCollect', '가짜 수집'), folder('gdRaw', '원문', 'gdCollect'), folder('gdRoom', '10001_가짜방', 'gdRaw'),
    folder('gdMsg', 'messages', 'gdRoom'), folder('gdMonth', '2026-10', 'gdMsg'),
    folder('gdCall', '통화 녹음'), folder('gdTr', '전사', 'gdCall'), folder('gdBak', 'Web2 편집 백업'),
    ...Array.from({ length: 8 }, (_, i) => item({ source: 'gd', item_id: `gdTg${i}`, parent_id: 'gdMonth', name: i % 2 ? `${900 + i}_attachment.jpg` : `${900 + i}.json`, modified_at: `2026-10-06T00:${String(59 - i).padStart(2, '0')}:00Z` })),
    item({ source: 'gd', item_id: 'gdTr1', parent_id: 'gdTr', name: '가짜 전사.txt', modified_at: '2026-10-06T00:40:00Z' }),
    item({ source: 'gd', item_id: 'gdTr2', parent_id: 'gdTr', name: '가짜 전사 2.txt', modified_at: '2026-10-06T00:39:00Z' }),
    item({ source: 'gd', item_id: 'gdBak1', parent_id: 'gdBak', name: '가짜 백업.hwp', modified_at: '2026-10-06T00:38:00Z' }),
    item({ source: 'gd', item_id: 'gdBak2', parent_id: 'gdBak', name: '가짜 백업 2.hwp', modified_at: '2026-10-06T00:37:00Z' }),
  );
  await openFiles(page, 412);
  const box = page.locator('#filesRoot [data-fx-tree] [data-fx-box="recent"]');
  await expect(box.locator('[data-fx-tfile]')).toHaveCount(5);
  await expect(box).not.toContainText('.json');
  await expect(box).not.toContainText('_attachment');
  await expect(box).not.toContainText('가짜 전사');
  await expect(box).not.toContainText('가짜 백업');
  // 사람 파일(최근 바뀐 순) 그대로.
  await expect(box.locator('[data-fx-tfile]').first()).toContainText('가짜 예산표');
  await expect(box).toContainText('가짜 계획안');
  // [더보기]면 사람 파일만 6줄(전부).
  await box.locator('[data-fx-recent-more]').click();
  await expect(box.locator('[data-fx-tfile]')).toHaveCount(6);
  await expect(box).not.toContainText('.json');
  // 시스템 폴더는 나무에 그대로 보인다(숨김 아님).
  await expect(page.locator('#filesRoot [data-fx-tree]')).toContainText('Web2 편집 백업');
  await expect(page.locator('#filesRoot [data-fx-tree]')).toContainText('통화 녹음');
  // '최근'은 서버 한도(300)까지 한 번에 읽고 화면이 거른다(데이터·서버 그대로).
  const recentCalls = server.calls.filter(c => c.what === 'app_cloud_find_in' && c.body.p_shelf === 'recent');
  expect(recentCalls.length).toBeGreaterThan(0);
  for (const c of recentCalls) expect(c.body.p_limit).toBe(300);
  expect(server.items.filter(i => i.item_id.startsWith('gdTg')).length).toBe(8);
  expect(errors).toEqual([]);
});
