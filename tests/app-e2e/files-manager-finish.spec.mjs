import { test, expect } from '@playwright/test';
import { start, openFiles, treeGo } from './helpers/files-server.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
// S52-43 ③ FILES-관리자마무리(설계 docs/design/files-manager-audit.md C-2·G·I): 미리보기 ←→ 다음 파일, 동영상·소리 재생(200MB까지),
// 파일 ⋯ [경로 복사], 클립보드 그림 붙여넣기 = 지금 폴더에 올리기. 서버·클라우드는 흉내(파일 이름은 모두 가짜).
const root = page => page.locator('#filesRoot');
const row = (page, key) => root(page).locator(`[data-fx-row="${key}"]`);
const prev = page => root(page).locator('[data-fx-prev]');
const edgeCalls = (server, action) => server.calls.filter(c => c.what === 'edge' && c.action === action);
const fake = o => ({ parent_id: null, is_folder: false, mime: null, size_bytes: 1000, modified_at: '2026-10-01T01:00:00Z', hash: null, trashed: false, starred: false, library_doc_id: null, ...o });

async function begin(page) {
  const { errors, server } = await start(page, 1440);
  await installViewPrefsServer(page);
  server.items.push(fake({ source: 'od', item_id: 'OD!40', parent_id: 'OD!1', name: '가짜 영상.mp4', mime: 'video/mp4', size_bytes: 4000 }),
    fake({ source: 'od', item_id: 'OD!41', parent_id: 'OD!1', name: '가짜 큰 영상.mp4', mime: 'video/mp4', size_bytes: 300 * 1024 * 1024 }),
    fake({ source: 'od', item_id: 'OD!42', parent_id: 'OD!1', name: '가짜 녹음.m4a', mime: 'audio/mp4', size_bytes: 2000 }));
  await page.reload();
  await openFiles(page, 1440);
  await treeGo(page, 'od', '');
  await row(page, 'od:OD!1').click();
  await expect(row(page, 'od:OD!11')).toBeVisible();
  return { errors, server };
}

test('PC 1440: 미리보기 ← → 단추·키 = 같은 목록의 앞·다음 파일(폴더는 건너뜀), 동영상·소리는 재생 칸, 200MB 넘는 것은 안내만', async ({ page }) => {
  test.setTimeout(90000);
  const { errors, server } = await begin(page);
  const keys = await root(page).locator('[data-fx-list] [data-fx-row]').evaluateAll(bs => bs.map(b => b.dataset.fxRow));
  const files = keys.filter(k => k !== 'od:OD!10');
  await row(page, files[0]).click();
  await expect(prev(page).locator('[data-fx-pv-step="-1"]')).toBeDisabled();
  await prev(page).locator('[data-fx-pv-step="1"]').click();
  await expect(row(page, files[1])).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(row(page, files[2])).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(row(page, files[1])).toHaveAttribute('aria-selected', 'true');
  // 동영상: Edge media로 받아 화면 메모리(blob:)에서 재생 칸.
  await row(page, 'od:OD!40').click();
  const video = prev(page).locator('video[data-fx-media]');
  await expect(video).toBeVisible();
  expect(await video.getAttribute('src')).toMatch(/^blob:/);
  expect(edgeCalls(server, 'media').some(c => c.body.id === 'OD!40')).toBe(true);
  await row(page, 'od:OD!42').click();
  await expect(prev(page).locator('audio[data-fx-media]')).toBeVisible();
  // 200MB 넘는 동영상은 받지 않고 한 줄 + [열기].
  const before = edgeCalls(server, 'media').length;
  await row(page, 'od:OD!41').click();
  await expect(prev(page)).toContainText('200MB가 넘어 여기서는 재생하지 않아요');
  await expect(prev(page).locator('[data-fx-media]')).toHaveCount(0);
  expect(edgeCalls(server, 'media').length).toBe(before);
  expect(errors).toEqual([]);
});

test('PC 1440: 파일 우클릭 [경로 복사] = 클립보드에 위치 글자, 그림 붙여넣기(Ctrl+V) = 지금 폴더에 올리기', async ({ page, context }) => {
  test.setTimeout(90000);
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:8123' });
  const { errors, server } = await begin(page);
  await row(page, 'od:OD!11').click({ button: 'right' });
  const menu = page.locator('#rowMenu');
  await expect(menu).toBeVisible();
  await menu.getByRole('button', { name: '경로 복사' }).click();
  await expect(page.getByText('경로를 복사했어요').first()).toBeVisible();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text.startsWith('원드라이브')).toBe(true);
  expect(text.endsWith('가짜 안내문.pdf')).toBe(true);
  // 붙여넣기: 그림 한 장 → 지금 폴더(가짜 문서함)로 upload_open(이름은 '붙여넣은 그림 10-06 01.00.png' 꼴).
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'image.png', { type: 'image/png' }));
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await expect.poll(() => edgeCalls(server, 'upload_open').length).toBe(1);
  const open = edgeCalls(server, 'upload_open')[0].body;
  expect(open).toMatchObject({ to_source: 'od', to: 'OD!1', size: 4, mime: 'image/png' });
  expect(open.name).toMatch(/^붙여넣은 그림 \d\d-\d\d \d\d\.\d\d\.png$/); // ':'는 클라우드 이름에 못 써서 '.'
  expect(errors).toEqual([]);
});
