import {test, expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {openHome} from './helpers/home-entry.mjs';

// UX-이미있는파일알림(S60-15): 자료실에 있는 한글 파일을 다른 넣는 곳(홈 빠른 입력 📎 — 노트·정리함·업데이트·조직 기록 📎과 같은 고르기 부품)에 넣으면
// 올리기 전에 '이미 있는 자료예요 · 자료실 › 폴더 › 이름 · 날짜'가 뜨고, [올리지 않기]는 그 파일만 빼고 [그래도 올리기]는 그대로 둔다.
// Supabase REST는 합성(소유자 RLS 흉내: 내 작업공간 줄만), 화면은 실제 앱이다.
test.use({hasTouch: true});
const HWP = Buffer.from('합성 한글 파일 내용');
const DOC = '33333333-3333-4333-8333-333333333333', FOLDER = '44444444-4444-4444-8444-444444444444';
const shots = process.env.SAME_FILE_SHOTS === '1' ? 'docs/design/screens/s60-15' : '';

async function fixture(page, width) {
  await page.setViewportSize({width, height: 900});
  const reads = [];
  await openHome(page, {beforeLoad: async () => {
    await page.route('**/rest/v1/app_task_attachments**', r => r.fulfill({json: []}));
  }});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/rest/v1/app_documents?**', r => {
    const url = decodeURIComponent(r.request().url());
    if (!url.includes('file_name=in.')) return r.fallback();
    reads.push(url);
    const ws = /workspace_id=eq\.([^&]+)/.exec(url)?.[1];
    // 같은 이름·같은 크기 자료 하나가 내 작업공간 자료실 '예시 폴더'에 있다.
    return r.fulfill({json: url.includes('"예시 보도자료.hwp"') && new RegExp(`file_size=in\\.\\([^)]*\\b${HWP.length}\\b`).test(url) && ws ? [{id: DOC, workspace_id: ws, title: '예시 보도자료', file_name: '예시 보도자료.hwp', file_size: HWP.length, created_at: '2026-11-11T01:00:00Z'}] : []});
  });
  await page.route('**/rest/v1/app_library_folder_items?**', r => r.fulfill({json: [{document_id: DOC, folder_id: FOLDER}]}));
  await page.route('**/rest/v1/app_library_folders?**', r => r.fulfill({json: [{id: FOLDER, name: '예시 폴더'}]}));
  return {reads, errors};
}

for (const width of [412, 1280]) test(`이미 있는 파일 알림 · 홈 📎 ${width}`, async ({page}) => {
  const {reads, errors} = await fixture(page, width);
  const q = page.locator('#homeView [data-home-quick]');
  const input = q.locator('input[type=file]').first();
  await input.setInputFiles([{name: '예시 보도자료.hwp', mimeType: 'application/x-hwp', buffer: HWP}, {name: '새 파일.txt', mimeType: 'text/plain', buffer: Buffer.from('new')}]);
  const ask = page.locator('.kptu-ask.same-file-ask');
  await expect(ask).toBeVisible();
  await expect(ask.locator('.kptu-ask-text')).toHaveText('이미 있는 자료예요');
  await expect(ask.locator('.kptu-ask-lines li')).toHaveText(['자료실 › 예시 폴더 › 예시 보도자료.hwp · 11/11']);
  await expect(ask.locator('.kptu-ask-note')).toHaveText('나머지 1개는 바로 올려요');
  expect(reads.every(u => /workspace_id=eq\./.test(u))).toBe(true);
  // 확인창은 하단바·화면 밖으로 나가지 않는다.
  const box = await ask.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
  if (shots) { mkdirSync(shots, {recursive: true}); await page.screenshot({path: `${shots}/same-file-${width}.png`}); }
  await ask.getByRole('button', {name: '올리지 않기'}).click();
  await expect(ask).toHaveCount(0);
  await expect(q.locator('[data-basket-file]')).toHaveCount(1);
  await expect(q.locator('[data-basket-file] b')).toHaveText('새 파일.txt');
  // 다시 넣고 [그래도 올리기] → 그대로 담긴다.
  await input.setInputFiles([{name: '예시 보도자료.hwp', mimeType: 'application/x-hwp', buffer: HWP}]);
  await expect(ask).toBeVisible();
  await ask.getByRole('button', {name: '그래도 올리기'}).click();
  await expect(q.locator('[data-basket-file] b')).toHaveText(['새 파일.txt', '예시 보도자료.hwp']);
  expect(errors).toEqual([]);
});

test('같은 것이 없으면 묻지 않는다 · 찾기가 실패해도 그대로 담긴다', async ({page}) => {
  await fixture(page, 412);
  await page.route('**/rest/v1/app_notes?**attachments=cs.**', r => r.fulfill({status: 500, json: {message: 'QA'}}));
  const q = page.locator('#homeView [data-home-quick]');
  await q.locator('input[type=file]').first().setInputFiles([{name: '다른 파일.hwp', mimeType: 'application/x-hwp', buffer: HWP}]);
  await expect(q.locator('[data-basket-file] b')).toHaveText(['다른 파일.hwp']);
  await page.waitForTimeout(300);
  await expect(page.locator('.kptu-ask')).toHaveCount(0);
});
