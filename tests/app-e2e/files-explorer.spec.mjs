import { test, expect } from '@playwright/test';
import { start, openFiles } from './helpers/files-server.mjs';
// FILES-클라우드탐색기 ④(docs/design/files-explorer.md, 명진 결정 F1~F9 11/02): 메뉴 '파일'(?view=files).
// 색인 목록 · 폴더 들어가기·위치 줄·위 폴더 · 찾기(이름 + 자료실 글자) · 미리보기(사진·PDF·오피스 → PDF·글) · 갱신(바뀐 줄만) · 폰 첫 화면 최근 파일(F9).
// 서버는 흉내 낸다(시계 2026-10-06 10:00 서울, home-entry.mjs). 파일·폴더 이름은 모두 가짜.
const root = page => page.locator('#filesRoot');
const row = (page, key) => root(page).locator(`[data-fx-row="${key}"]`);
const rows = page => root(page).locator('[data-fx-list] [data-fx-row]');
const noWideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const names = page => rows(page).locator('.fx-name').allTextContents();

test('폰 412: 첫 화면은 최근 파일(F9)·날짜 묶음, 탭 폴더로 들어가기·위 폴더, 미리보기는 전체 화면이고 뒤로가기 한 번에 닫힘', async ({ page }) => {
  test.setTimeout(90000);
  const { errors, server } = await start(page, 412);
  await openFiles(page, 412);
  // 첫 화면: 최근 파일(바뀐 날 최근 순), 날짜 머리, 탭 [최근] 선택.
  await expect(root(page).locator('[data-fx-tab="recent"]')).toHaveAttribute('aria-selected', 'true');
  await expect(rows(page)).toHaveCount(6);
  await expect(root(page).locator('.fx-day-head').first()).toHaveText('오늘');
  expect((await names(page)).slice(0, 2)).toEqual(['가짜 예산표.xlsx', '가짜 계획안.hwpx']);
  expect(server.calls.find(c => c.what === 'app_cloud_find').body).toEqual({ p_query: null, p_shelf: 'recent', p_limit: 200 });
  expect(server.calls.find(c => c.what === 'edge' && c.action === 'status').auth).toMatch(/^Bearer /);
  await expect(row(page, 'gd:gdDoc1').locator('.fx-tag')).toHaveText('자료실');
  await expect(row(page, 'gd:gdDoc1').locator('.fx-sub')).toContainText('구글 드라이브 › 가짜 업무 공간');
  await expect(root(page).locator('[data-fx-tree]')).toBeHidden();
  expect(await noWideScroll(page)).toBe(true);
  // 화면에 들어오면 바로 맞추기(sync)를 한 번 부른다(F2).
  await expect.poll(() => server.calls.filter(c => c.action === 'sync').length).toBeGreaterThan(0);

  // [폴더] 탭 → 원드라이브 맨 위 → 폴더 들어가기(폴더 옆 숫자 = 바로 든 파일 수, F3).
  await root(page).locator('[data-fx-tab="folders"]').click();
  await expect(row(page, 'od:OD!1')).toBeVisible();
  await expect(row(page, 'od:OD!1').locator('.fx-sub')).toContainText('3개');
  await row(page, 'od:OD!1').click();
  await expect(root(page).locator('.fx-crumb-now')).toHaveText('가짜 문서함');
  await expect.poll(() => names(page)).toEqual(['가짜 2026', '가짜 메모.txt', '가짜 안내문.pdf', '가짜 예산표.xlsx']);
  await expect.poll(() => new URL(page.url()).searchParams.get('at')).toBe('od:OD:1');
  // PDF 미리보기: 전체 화면 칸, pdf.js로 쪽을 그린다. 뒤로가기 한 번 = 닫힘(화면은 그대로).
  await row(page, 'od:OD!11').click();
  const prev = root(page).locator('[data-fx-prev]');
  await expect(prev).toBeVisible();
  await expect(prev.locator('.fx-pv-nm')).toHaveText('가짜 안내문.pdf');
  await expect(prev.locator('canvas.fx-page')).toHaveCount(1, { timeout: 20000 });
  expect(server.calls.find(c => c.action === 'media')?.body).toMatchObject({ source: 'od', id: 'OD!11' });
  await expect(prev.locator('[data-fx-open]')).toBeVisible();
  await page.goBack();
  await expect(prev).toBeHidden();
  await expect(page.locator('#filesView')).toBeVisible();
  // 위 폴더(‹) → 원드라이브 맨 위.
  await root(page).locator('[data-fx-up]').click();
  await expect(root(page).locator('.fx-crumb-now')).toHaveText('원드라이브');
  // 좌우 밀기 대신 탭 [별표] → 별표 파일.
  await root(page).locator('[data-fx-tab="starred"]').click();
  await expect.poll(() => names(page)).toEqual(['가짜 예산표.xlsx']);
  expect(errors).toEqual([]);
});

for (const width of [884, 1440]) {
  test(`${width}: 나무·목록${width >= 1200 ? '·미리보기 세 칸' : ' 두 칸'} — 폴더 들어가기·찾기(자료실 글자)·오피스 미리보기·갱신은 바뀐 줄만`, async ({ page }) => {
    test.setTimeout(90000);
    const { errors, server } = await start(page, width);
    await openFiles(page, width);
    const tree = root(page).locator('[data-fx-tree]');
    await expect(tree).toBeVisible();
    // 나무: 묶음 3개(최근·별표·큰 파일) + 두 클라우드 뿌리.
    await expect(tree.locator('[data-fx-shelf]')).toHaveText(['최근', '별표', '큰 파일']);
    await expect(tree.locator('.fx-root .nx-name')).toHaveText(['원드라이브', '구글 드라이브']);
    await expect(tree.locator('[data-fx-shelf="recent"]')).toHaveAttribute('aria-current', 'true');
    // 원드라이브 뿌리 → 폴더 → 하위 폴더.
    await tree.locator('[data-fx-go="od"][data-fx-id=""]').click();
    await expect(row(page, 'od:OD!1')).toBeVisible();
    await expect(tree.locator('[data-fx-go="od"][data-fx-id="OD!1"] .nx-num')).toHaveText('3');
    await row(page, 'od:OD!1').click();
    await expect.poll(() => names(page)).toEqual(['가짜 2026', '가짜 메모.txt', '가짜 안내문.pdf', '가짜 예산표.xlsx']);
    await expect(root(page).locator('.fx-crumb-step')).toHaveText(['원드라이브']);
    expect(server.calls.find(c => c.what === 'app_cloud_trail').body).toEqual({ p_source: 'od', p_item_id: 'OD!1' });
    // 정렬: 크기(큰 것부터), 폴더는 늘 위.
    await root(page).locator('[data-fx-sort]').selectOption('size');
    await expect.poll(() => names(page)).toEqual(['가짜 2026', '가짜 안내문.pdf', '가짜 예산표.xlsx', '가짜 메모.txt']);
    // 오피스(F4): 서버가 PDF로 바꾼 것(preview)을 그린다.
    await row(page, 'od:OD!12').click();
    const prev = root(page).locator('[data-fx-prev]');
    await expect(prev).toBeVisible();
    await expect(prev.locator('canvas.fx-page')).toHaveCount(1, { timeout: 20000 });
    expect(server.calls.find(c => c.action === 'preview')?.body).toMatchObject({ source: 'od', id: 'OD!12' });
    if (width >= 1200) {
      // PC: 미리보기는 목록 옆 칸(목록이 그대로 보인다). 키보드 ↑↓로 고르면 옆 칸이 바뀐다.
      await expect(rows(page).first()).toBeVisible();
      await row(page, 'od:OD!12').focus();
      await page.keyboard.press('ArrowDown');
      await expect(prev.locator('.fx-pv-nm')).toHaveText('가짜 메모.txt');
      await expect(prev.locator('.fx-pv-text')).toHaveText('가짜 메모 첫 줄\n둘째 줄');
      expect(server.calls.find(c => c.action === 'media' && c.body.id === 'OD!13').range).toBe('bytes=0-204799');
    } else {
      await page.goBack();
      await expect(prev).toBeHidden();
    }
    // 갱신: 서버가 돌려준 바뀐 줄만 입힌다(이름 바뀜·새 파일·지운 파일). 목록을 다시 읽지 않는다.
    server.pendingSync = { changed: [{ source: 'od', item_id: 'OD!13', parent_id: 'OD!1', name: '가짜 메모 새이름.txt', is_folder: false, mime: 'text/plain', size_bytes: 3000, modified_at: '2026-10-06T00:30:00Z', hash: null, trashed: false }], removed: [{ source: 'od', id: 'OD!11' }] };
    const lists = () => server.calls.filter(c => c.what === 'app_cloud_list' && c.body.p_parent_id === 'OD!1').length;
    const before = lists();
    await root(page).locator('[data-fx-sync]').click();
    await expect.poll(() => names(page)).toEqual(['가짜 2026', '가짜 예산표.xlsx', '가짜 메모 새이름.txt']);
    expect(server.calls.filter(c => c.action === 'sync').at(-1).body).toEqual({ action: 'sync', force: true });
    expect(lists()).toBe(before);
    // 찾기: 이름 + 자료실이 이미 읽은 글자(F7), 두 클라우드 함께, 경로 함께.
    await root(page).locator('[data-fx-search]').fill('협약');
    await expect(rows(page)).toHaveCount(1);
    await expect(row(page, 'gd:gdDoc1').locator('.fx-tag')).toHaveText('자료실 · 글자 맞음');
    await expect(row(page, 'gd:gdDoc1').locator('.fx-path')).toHaveText('구글 드라이브 › 가짜 업무 공간');
    await expect(root(page).locator('.fx-crumb-now')).toHaveText('찾은 것 1 · 이름 0 · 자료실 글자 1');
    expect(server.calls.filter(c => c.what === 'app_cloud_find').at(-1).body).toEqual({ p_query: '협약', p_shelf: null, p_limit: 200 });
    expect(await noWideScroll(page)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('1440: 사진 미리보기는 공용 그림 칸(큰 썸네일), [열기]는 클라우드 보기 주소를 새 창으로', async ({ page, context }) => {
  test.setTimeout(60000);
  const { errors, server } = await start(page, 1440);
  await openFiles(page, 1440);
  await root(page).locator('[data-fx-tree] [data-fx-go="od"][data-fx-id=""]').click();
  await row(page, 'od:OD!2').click();
  await row(page, 'od:OD!20').click();
  const prev = root(page).locator('[data-fx-prev]');
  await expect(prev.locator('.fx-pv-imgbox')).toHaveAttribute('data-img-state', 'shown');
  expect(server.calls.find(c => c.action === 'thumb').body).toEqual({ action: 'thumb', source: 'od', id: 'OD!20', size: 'large' });
  await context.route('https://example.org/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>가짜</p>' }));
  const popup = context.waitForEvent('page');
  await prev.locator('[data-fx-open]').click();
  await expect.poll(async () => (await popup).url()).toBe('https://example.org/fake-open');
  expect(server.calls.find(c => c.action === 'open-url').body).toEqual({ action: 'open-url', source: 'od', id: 'OD!20' });
  expect(errors).toEqual([]);
});

test('412: 연결된 클라우드가 없으면 한 줄만, 맞추기를 부르지 않는다', async ({ page }) => {
  const { errors, server } = await start(page, 412, { connected: { od: false, gd: false } });
  await openFiles(page, 412);
  await expect(root(page).locator('[data-fx-list]')).toContainText('연결된 클라우드 없음');
  await page.waitForTimeout(300);
  expect(server.calls.filter(c => c.action === 'sync')).toHaveLength(0);
  expect(errors).toEqual([]);
});

test('1440: 폴더를 열면 그 폴더만 클라우드에서 바로 읽어 색인에 없던 파일도 보임(한 폴더에 한 번)', async ({ page }) => {
  test.setTimeout(90000);
  const { errors, server } = await start(page, 1440);
  server.directItems = [{ source: 'od', item_id: 'OD!15', parent_id: 'OD!1', name: '가짜 직접읽기.docx', is_folder: false, mime: null, size_bytes: 2048,
    modified_at: '2026-10-02T01:00:00Z', hash: null, trashed: false, starred: false, library_doc_id: null }];
  await openFiles(page, 1440);
  await root(page).locator('[data-fx-tree] [data-fx-go="od"][data-fx-id=""]').click();
  await row(page, 'od:OD!1').click();
  await expect(root(page).locator('.fx-crumb-now')).toHaveText('가짜 문서함');
  await expect.poll(() => names(page)).toContain('가짜 직접읽기.docx');
  expect(server.calls.filter(c => c.action === 'folder')).toHaveLength(1);
  expect(server.calls.find(c => c.action === 'folder').body).toMatchObject({ source: 'od', id: 'OD!1' });
  expect(errors).toEqual([]);
});
