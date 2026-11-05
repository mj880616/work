import { test, expect } from '@playwright/test';
import { start, openFiles } from './helpers/files-server.mjs';
// FILES-클라우드탐색기 ④(docs/design/files-explorer.md, 명진 결정 F1~F9 11/02): 메뉴 '파일'(?view=files).
// 색인 목록 · 폴더 들어가기·위치 줄·위 폴더 · 찾기(이름 + 자료실 글자) · 미리보기(사진·PDF·오피스 → PDF·글) · 갱신(바뀐 줄만) · 폰 첫 화면 나무(S50-33).
// 서버는 흉내 낸다(시계 2026-10-06 10:00 서울, home-entry.mjs). 파일·폴더 이름은 모두 가짜.
const root = page => page.locator('#filesRoot');
const row = (page, key) => root(page).locator(`[data-fx-row="${key}"]`);
const rows = page => root(page).locator('[data-fx-list] [data-fx-row]');
const noWideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const names = page => rows(page).locator('.fx-name').allTextContents();

test('폰 412(S50-33): 첫 화면은 나무 — 탭 줄·"폴더" 제목 없음, ★ 별표 줄·폴더 아이콘·맞춤 글자, 폴더를 누르면 같은 자리에 목록·위치 길, 뒤로가기는 한 단계씩', async ({ page }) => {
  test.setTimeout(90000);
  const { errors, server } = await start(page, 412);
  await openFiles(page, 412);
  const tree = root(page).locator('[data-fx-tree]');
  // 첫 화면: 나무. 탭 줄·'최근'·위치 줄 제목 없음. 찾기 칸과 출처 단추는 한 줄.
  await expect(tree).toBeVisible();
  await expect(root(page).locator('[data-fx-tab]')).toHaveCount(0);
  await expect(root(page).locator('.fx-top [data-fx-crumb]')).toBeHidden();
  await expect(tree.locator('[data-fx-shelf]')).toHaveCount(2);
  await expect(tree.locator('[data-fx-shelf] .nx-name')).toHaveText(['별표', '큰 파일']);
  await expect(tree.locator('[data-fx-shelf="starred"] .nx-ico')).toHaveText('★');
  await expect(tree.locator('[data-fx-shelf="starred"] .nx-num')).toHaveText('1개');
  await expect(tree.locator('.fx-root .nx-name')).toHaveText(['원드라이브', '구글 드라이브']);
  // '○분 전 맞춤'은 원드라이브 줄 오른쪽 작은 글자(위 줄에는 없음).
  await expect(tree.locator('.fx-root').first().locator('[data-fx-sync]')).toBeVisible();
  await expect(root(page).locator('.fx-top [data-fx-sync]')).toBeHidden();
  const search = await root(page).locator('[data-fx-search]').boundingBox(), chip = await root(page).locator('[data-fx-srcs] [data-fx-src="od"]').boundingBox();
  expect(Math.abs((search.y + search.height / 2) - (chip.y + chip.height / 2))).toBeLessThan(4);
  expect(chip.width).toBeLessThanOrEqual(30);
  expect(server.calls.filter(c => c.what === 'app_cloud_find_in').map(c => c.body.p_shelf)).toEqual(['starred']);
  expect(server.calls.find(c => c.what === 'edge' && c.action === 'status').auth).toMatch(/^Bearer /);
  expect(await noWideScroll(page)).toBe(true);
  await expect.poll(() => server.calls.filter(c => c.action === 'sync').length).toBeGreaterThan(0);

  // 원드라이브 펼치기 → 폴더 줄 높이는 PC 수준(30~32px), 폴더 아이콘, 들여쓰기는 절반(7px).
  await tree.locator('[data-fx-twist="od:"]').click();
  const folder = tree.locator('.nx-row').filter({ has: page.locator('[data-fx-go="od"][data-fx-id="OD!1"]') });
  await expect(folder.locator('.nx-ico')).toBeVisible();
  // 나무는 하위 폴더를 읽을 때마다 다시 그려지므로(줄이 바뀜) 잴 때마다 다시 찾는다.
  await expect.poll(async () => { const b = await folder.boundingBox().catch(() => null); return b ? b.height >= 29 && b.height <= 33 : null; }).toBe(true);
  await expect.poll(() => folder.evaluate(el => getComputedStyle(el).paddingLeft).catch(() => '')).toBe('7px');
  // 폴더를 누르면 같은 자리에서 목록 + 위치 길(‹ 원드라이브 › 가짜 문서함).
  await tree.locator('[data-fx-go="od"][data-fx-id="OD!1"]').click();
  await expect(tree).toBeHidden();
  await expect(row(page, 'od:OD!11')).toBeVisible();
  await expect(root(page).locator('.fx-crumb-step')).toHaveText(['원드라이브']);
  await expect(root(page).locator('.fx-crumb-now')).toHaveText('가짜 문서함');
  await expect.poll(() => names(page)).toEqual(['가짜 2026', '가짜 메모.txt', '가짜 안내문.pdf', '가짜 예산표.xlsx']);
  await expect.poll(() => new URL(page.url()).searchParams.get('at')).toBe('od:OD:1');
  // 하위 폴더 → 뒤로가기 한 번 = 위 폴더(화면 그대로).
  await row(page, 'od:OD!10').click();
  await expect(root(page).locator('.fx-crumb-now')).toHaveText('가짜 2026');
  await page.goBack();
  await expect(root(page).locator('.fx-crumb-now')).toHaveText('가짜 문서함');
  await expect(page.locator('#filesView')).toBeVisible();
  // PDF 미리보기는 그 위 겹친 칸, 뒤로가기 한 번 = 닫힘.
  await row(page, 'od:OD!11').click();
  const prev = root(page).locator('[data-fx-prev]');
  await expect(prev).toBeVisible();
  await expect(prev.locator('.fx-pv-nm')).toHaveText('가짜 안내문.pdf');
  await expect(prev.locator('canvas.fx-page')).toHaveCount(1, { timeout: 20000 });
  expect(server.calls.find(c => c.action === 'media')?.body).toMatchObject({ source: 'od', id: 'OD!11' });
  await page.goBack();
  await expect(prev).toBeHidden();
  await expect(root(page).locator('.fx-crumb-now')).toHaveText('가짜 문서함');
  // 뒤로가기 → 원드라이브 맨 위 → 뒤로가기 → 나무(화면은 그대로 [파일]).
  await page.goBack();
  await expect(root(page).locator('.fx-crumb-now')).toHaveText('원드라이브');
  await page.goBack();
  await expect(tree).toBeVisible();
  await expect(page.locator('#filesView')).toBeVisible();
  // ★ 별표 줄 → 별표 목록, ‹ 로 나무.
  await tree.locator('[data-fx-shelf="starred"]').click();
  await expect.poll(() => names(page)).toEqual(['가짜 예산표.xlsx']);
  await root(page).locator('[data-fx-up]').click();
  await expect(tree).toBeVisible();
  // 나무에서 뒤로가기는 이전 화면(목록 자리가 남지 않음).
  await page.goBack();
  await expect(page.locator('#filesView')).toBeHidden();
  expect(errors).toEqual([]);
});

for (const width of [884, 1440]) {
  test(`${width}: 나무·목록${width >= 1200 ? '·미리보기 세 칸' : ' 두 칸'} — 폴더 들어가기·찾기(자료실 글자)·오피스 미리보기·갱신은 바뀐 줄만`, async ({ page }) => {
    test.setTimeout(90000);
    const { errors, server } = await start(page, width);
    await openFiles(page, width);
    const tree = root(page).locator('[data-fx-tree]');
    await expect(tree).toBeVisible();
    // 나무: 묶음 2개(별표·큰 파일, S50-33 최근 뺌) + 두 클라우드 뿌리. 별표 줄에는 개수.
    await expect(tree.locator('[data-fx-shelf] .nx-name')).toHaveText(['별표', '큰 파일']);
    await expect(tree.locator('[data-fx-shelf="starred"] .nx-num')).toHaveText('1개');
    // S50-20 FOLDER-나무아이콘: 별표·큰 파일은 별·문서, 저장소는 로고, 폴더는 폴더 아이콘(글자는 그대로).
    await expect(tree.locator('[data-fx-shelf] .nx-ico')).toHaveText(['\u2605', '\u{1F4C4}']);
    await expect(tree.locator('.fx-root .nx-ico svg')).toHaveCount(2);
    await expect(tree.locator('.fx-root .nx-name')).toHaveText(['원드라이브', '구글 드라이브']);
    // 첫 화면(S50-33): 켜진 첫 저장소(원드라이브) 맨 위. [최근]·탭 줄은 없다.
    await expect(tree.locator('[data-fx-go="od"][data-fx-id=""]')).toHaveAttribute('aria-current', 'true');
    await expect(root(page).locator('[data-fx-tab]')).toHaveCount(0);
    await expect(row(page, 'od:OD!1')).toBeVisible();
    await expect(tree.locator('[data-fx-go="od"][data-fx-id="OD!1"] .nx-num')).toHaveCount(0);
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
    expect(server.calls.filter(c => c.what === 'app_cloud_find_in').at(-1).body).toEqual({ p_sources: ['od', 'gd'], p_query: '협약', p_shelf: null, p_limit: 200 });
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
  // 맨 위(id 없음)와 가짜 문서함, 폴더마다 한 번씩만.
  const asked = server.calls.filter(c => c.action === 'folder').map(c => `${c.body.source}:${c.body.id ?? ''}`);
  expect(asked.filter(k => k === 'od:OD!1')).toHaveLength(1);
  expect(new Set(asked).size).toBe(asked.length);
  expect(errors).toEqual([]);
});

// S50-14 FILES-다안나옴: 처음 목록 받기가 실패하면(운영: 같은 id 두 줄 → 묶음 거절 → 매번 같은 쪽에서 실패) 위 단추가 '방금 맞춤'이 아니라 '맞추기 안 됨'.
//   이어 받을 쪽이 남으면 '맞추기…'(글줄 안 표시는 '…' 한 글자, UI-로딩맨위). 다 받으면 다시 '방금 맞춤'.
test('PC 1280: 맞추기 실패·이어 받기 남음은 \'방금 맞춤\'으로 덮지 않음', async ({ page }) => {
  const { errors, server } = await start(page, 1280);
  server.syncReply = { od: { error: 'store_unavailable', more: false, done: false } };
  await openFiles(page, 1280);
  const btn = root(page).locator('[data-fx-sync]');
  await expect(btn).toHaveText('맞추기 안 됨');
  await expect(btn).toHaveAttribute('data-fx-sync-state', 'error');
  server.syncReply = { od: { more: true, done: false } };
  await btn.click();
  await expect(btn).toHaveText('맞추기…');
  server.syncReply = { od: { more: false, done: true } };
  await expect(btn).toHaveText('방금 맞춤', { timeout: 10000 });
  expect(errors).toEqual([]);
});
