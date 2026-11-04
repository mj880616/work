import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { start, openFiles } from './helpers/files-server.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
// S49-27 FILES-통합 2-① 복사(명진 결정 H-3 같은 이름 한 번 묻기·번호 붙여 둘 다, H-4 200MB 넘으면 묻기, H-5 폴더째는 같은 저장소 안만).
// 시안 docs/design/files-unified-mockup.html ③ 고르기 막대 · ④ 받을 곳 창(하단바 위, 최근 보낸 곳 칩) · ⑤ 아래 전송 줄. 서버는 흉내(파일 이름은 모두 가짜).
const root = page => page.locator('#filesRoot');
const row = (page, key) => root(page).locator(`[data-fx-row="${key}"]`);
const bar = page => root(page).locator('[data-fx-bar]');
const sheet = page => root(page).locator('[data-fx-dest]');
const pick = (page, key) => sheet(page).locator(`[data-fx-dest-pick="${key}"]`).first();
const edgeCalls = (server, action) => server.calls.filter(c => c.what === 'edge' && c.action === action);
const SHOTS = process.env.FILES_COPY_SHOTS || '';
const shot = async (page, name) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/${name}.png` }); } };
const fake = o => ({ parent_id: null, is_folder: false, mime: null, size_bytes: 1000, modified_at: '2026-10-01T01:00:00Z', hash: null, trashed: false, starred: false, library_doc_id: null, ...o });

async function intoDocs(page, width) {
  await openFiles(page, width);
  if (width < 761) await root(page).locator('[data-fx-tab="folders"]').click();
  await root(page).locator('[data-fx-tree] [data-fx-go="od"][data-fx-id=""]').click();
  await row(page, 'od:OD!1').click();
  await expect(root(page).locator('.fx-crumb-now')).toHaveText('가짜 문서함');
}
async function begin(page, width) {
  const { errors, server } = await start(page, width);
  const prefs = await installViewPrefsServer(page);
  await page.reload();
  return { errors, server, prefs };
}

test('PC 1440: 고르기 막대 [복사] → 받을 곳 창 → 같은 이름 한 번 묻기(그래도 하기 = 번호) → 차례로 복사, 최근 보낸 곳 칩(서버)', async ({ page }) => {
  test.setTimeout(90000);
  const { errors, server, prefs } = await begin(page, 1440);
  server.items.push(fake({ source: 'gd', item_id: 'gdSame1', parent_id: 'gdFolder1', name: '가짜 안내문.pdf' }));
  await intoDocs(page, 1440);
  await row(page, 'od:OD!11').click({ modifiers: ['Control'] });
  await row(page, 'od:OD!13').click({ modifiers: ['Control'] });
  await expect(bar(page).locator('.fx-bar-t')).toHaveText('2개');
  await bar(page).locator('[data-fx-copy]').click();
  await expect(sheet(page)).toBeVisible();
  await expect(sheet(page).locator('#fxDestTitle')).toHaveText('2개 복사할 곳');
  // 처음 받을 곳 = 지금 폴더. 구글 드라이브 나무를 펼쳐 폴더를 고른다.
  await expect(sheet(page).locator('.fx-dest-at')).toContainText('가짜 문서함');
  await pick(page, 'gd:').click();
  await expect(pick(page, 'gd:gdFolder1')).toBeVisible();
  await pick(page, 'gd:gdFolder1').click();
  await expect(sheet(page).locator('.fx-dest-at')).toHaveText('구글 드라이브 › 가짜 업무 공간');
  await expect(sheet(page).locator('[data-fx-dest-go]')).toHaveText('여기에 복사');
  await sheet(page).locator('[data-fx-dest-go]').click();
  const askBox = sheet(page).locator('.fx-ask');
  await expect(askBox).toContainText('가짜 안내문.pdf — 같은 이름이 있어요. 그래도 복사할까요?');
  await expect(askBox.locator('button')).toHaveText(['그래도 하기', '건너뛰기']);
  await expect(askBox.locator('[data-fx-ask-all]')).toHaveCount(0); // 같은 이름은 하나뿐 → '남은 것도 모두 같게' 없음
  await shot(page, 'files-copy-same-name-1440');
  expect(edgeCalls(server, 'copy')).toHaveLength(0);
  await askBox.getByRole('button', { name: '그래도 하기' }).click();
  await expect(sheet(page)).toBeHidden();
  await expect.poll(() => edgeCalls(server, 'copy').length).toBe(2);
  expect(edgeCalls(server, 'copy').map(c => c.body)).toEqual([
    { action: 'copy', source: 'od', id: 'OD!11', to_source: 'gd', to: 'gdFolder1', confirm: true },
    { action: 'copy', source: 'od', id: 'OD!13', to_source: 'gd', to: 'gdFolder1', confirm: true }]);
  await expect(page.locator('body')).toContainText('2개 복사함');
  expect(server.items.filter(i => i.parent_id === 'gdFolder1').map(i => i.name).sort()).toEqual(['가짜 결과 정리.pdf', '가짜 메모.txt', '가짜 안내문 (2).pdf', '가짜 안내문.pdf'].sort());
  expect(server.items.filter(i => i.item_id === 'OD!11' || i.item_id === 'OD!13').every(i => !i.trashed)).toBe(true); // 원본 그대로
  // 최근 보낸 곳: 서버(view_prefs.files_dest_recent)에 저장, 다음 창 맨 위 칩.
  await expect.poll(() => prefs.patches.at(-1)?.files_dest_recent).toEqual([{ source: 'gd', id: 'gdFolder1', name: '가짜 업무 공간' }]);
  // 같은 파일을 다시 → 이번엔 [건너뛰기]: 아무것도 보내지 않는다.
  await row(page, 'od:OD!13').click({ modifiers: ['Control'] });
  await bar(page).locator('[data-fx-copy]').click();
  await expect(sheet(page).locator('.fx-dest-chip')).toHaveText(['가짜 업무 공간']);
  await sheet(page).locator('.fx-dest-chip').click();
  await expect(sheet(page).locator('.fx-dest-chip')).toHaveClass(/on/);
  await shot(page, 'files-copy-sheet-1440');
  await sheet(page).locator('[data-fx-dest-go]').click();
  await sheet(page).locator('.fx-ask').getByRole('button', { name: '건너뛰기' }).click();
  await expect(page.locator('body')).toContainText('1개 건너뜀');
  expect(edgeCalls(server, 'copy')).toHaveLength(2);
  // 폴더를 다른 저장소로는 막고 안내(H-5), 보내지 않음.
  await row(page, 'od:OD!10').click({ modifiers: ['Control'] });
  await bar(page).locator('[data-fx-copy]').click();
  await pick(page, 'gd:').click();
  await sheet(page).locator('[data-fx-dest-go]').click();
  await expect(page.locator('body')).toContainText('폴더는 같은 저장소 안에서만 통째로 복사돼요');
  expect(edgeCalls(server, 'copy')).toHaveLength(2);
  // 같은 저장소 안 폴더째 복사는 된다(같은 곳이면 이름 (2)).
  await pick(page, 'od:OD!1').click();
  await sheet(page).locator('[data-fx-dest-go]').click();
  await expect(sheet(page).locator('.fx-ask')).toContainText('가짜 2026 — 같은 이름이 있어요. 그래도 복사할까요?');
  await sheet(page).locator('.fx-ask').getByRole('button', { name: '그래도 하기' }).click();
  await expect.poll(() => edgeCalls(server, 'copy').length).toBe(3);
  expect(edgeCalls(server, 'copy')[2].body).toEqual({ action: 'copy', source: 'od', id: 'OD!10', to_source: 'od', to: 'OD!1', confirm: true });
  await expect(root(page).locator('[data-fx-list] .fx-name').filter({ hasText: '가짜 2026 (2)' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('폰 412: 꾹 눌러 고르기 → [복사] → 하단바 위 받을 곳 창, 200MB 넘는 파일은 묻고 다음 판 안내, 전송 줄 2/2', async ({ page }) => {
  test.setTimeout(90000);
  const { errors, server } = await begin(page, 412);
  server.items.push(fake({ source: 'od', item_id: 'OD!30', parent_id: 'OD!1', name: '가짜 영상.mp4', mime: 'video/mp4', size_bytes: Math.round(1.2 * 1024 ** 3) }));
  await intoDocs(page, 412);
  await row(page, 'od:OD!30').dispatchEvent('contextmenu');
  await row(page, 'od:OD!11').click();
  await row(page, 'od:OD!12').click();
  await expect(bar(page).locator('.fx-bar-t')).toHaveText('3개');
  await expect(bar(page).locator('button')).toHaveText(['복사', '옮기기', '휴지통', '✕']);
  await shot(page, 'files-copy-bar-412');
  await bar(page).locator('[data-fx-copy]').click();
  await expect(sheet(page)).toBeVisible();
  // 하단바 위로 열린다(가리지 않음), 가로 넘침 없음.
  const tab = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--kptu-mobile-tab-height')) || 0);
  const box = await sheet(page).boundingBox();
  expect(box.y + box.height).toBeLessThanOrEqual(900 - tab + 1);
  expect(tab).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await pick(page, 'gd:').click();
  await expect(pick(page, 'gd:gdFolder1')).toBeVisible();
  await pick(page, 'gd:gdFolder1').click();
  await shot(page, 'files-copy-sheet-412');
  server.copyDelayMs = 1500;
  await sheet(page).locator('[data-fx-dest-go]').click();
  // 200MB 넘는 클라우드 사이 파일: 묻는 창 + 옮기는 방식 한 줄. [그래도 보내기]도 이 판에서는 다음 판 안내로 멈춤.
  const askBox = sheet(page).locator('.fx-ask');
  await expect(askBox).toContainText('가짜 영상.mp4 — 200MB가 넘어요(1.2GB). 그래도 보낼까요?');
  await expect(askBox.locator('.fx-ask-note')).toHaveText('서버가 10MB씩 나눠 이어 보내요. 폰 데이터는 쓰지 않아요. 끊겨도 끊긴 곳부터 다시.');
  await shot(page, 'files-copy-big-412');
  await askBox.getByRole('button', { name: '그래도 보내기' }).click();
  await expect(page.locator('body')).toContainText('200MB가 넘는 파일은 다음 판에서 보낼 수 있어요');
  // 나머지 둘은 차례로: 하단바 위 얇은 전송 줄.
  const strip = root(page).locator('[data-fx-xfer]');
  await expect(strip).toBeVisible();
  await expect(strip.locator('b')).toHaveText('1/2 보내는 중');
  const sb = await strip.boundingBox();
  expect(sb.y + sb.height).toBeLessThanOrEqual(900 - tab + 1);
  await shot(page, 'files-copy-strip-412');
  await expect(strip.locator('b')).toHaveText('2/2 보내는 중');
  await expect(strip).toBeHidden({ timeout: 10000 });
  expect(edgeCalls(server, 'copy').map(c => c.body.id)).toEqual(['OD!11', 'OD!12']);
  await expect(page.locator('body')).toContainText('2개 복사함 · 1개 건너뜀');
  // 뒤로가기 한 번 = 받을 곳 창 닫힘.
  await row(page, 'od:OD!13').dispatchEvent('contextmenu');
  await bar(page).locator('[data-fx-copy]').click();
  await expect(sheet(page)).toBeVisible();
  await page.goBack();
  await expect(sheet(page)).toBeHidden();
  await expect(root(page).locator('.fx-crumb-now')).toHaveText('가짜 문서함');
  expect(errors).toEqual([]);
});

test('폴드 884: [옮기기] → 받을 곳 창, 같은 이름이 둘이면 한 번 묻고 남은 것도 모두 같게 → numbered 옮기기', async ({ page }) => {
  test.setTimeout(90000);
  const { errors, server } = await begin(page, 884);
  server.items.push(fake({ source: 'od', item_id: 'OD!15', parent_id: 'OD!10', name: '가짜 메모.txt' }),
    fake({ source: 'od', item_id: 'OD!16', parent_id: 'OD!10', name: '가짜 안내문.pdf' }));
  await intoDocs(page, 884);
  await row(page, 'od:OD!10').click();
  await expect(root(page).locator('.fx-crumb-now')).toHaveText('가짜 2026');
  for (const k of ['od:OD!14', 'od:OD!15', 'od:OD!16']) await row(page, k).click({ modifiers: ['Control'] });
  await bar(page).locator('[data-fx-cut]').click();
  await expect(sheet(page).locator('#fxDestTitle')).toHaveText('3개 옮길 곳');
  await pick(page, 'od:OD!1').click();
  await expect(sheet(page).locator('[data-fx-dest-go]')).toHaveText('여기에 옮기기');
  await sheet(page).locator('[data-fx-dest-go]').click();
  const askBox = sheet(page).locator('.fx-ask');
  await expect(askBox).toContainText('가짜 메모.txt — 같은 이름이 있어요. 그래도 옮길까요?');
  await askBox.locator('[data-fx-ask-all]').check();
  await shot(page, 'files-move-same-name-884');
  await askBox.getByRole('button', { name: '그래도 하기' }).click();
  await expect.poll(() => edgeCalls(server, 'move').length).toBe(1);
  expect(edgeCalls(server, 'move')[0].body).toEqual({ action: 'move', source: 'od', ids: ['OD!14', 'OD!15', 'OD!16'], to: 'OD!1', numbered: true, confirm: true });
  await expect(page.locator('body')).toContainText('3개 옮김');
  expect(server.items.filter(i => i.parent_id === 'OD!1' && !i.trashed).map(i => i.name).sort())
    .toEqual(['가짜 2026', '가짜 계획안.hwpx', '가짜 메모 (2).txt', '가짜 메모.txt', '가짜 안내문 (2).pdf', '가짜 안내문.pdf', '가짜 예산표.xlsx'].sort());
  // 미리보기 [복사] 단추도 같은 창.
  await root(page).locator('[data-fx-tree] [data-fx-go="od"][data-fx-id="OD!1"]').click();
  await row(page, 'od:OD!12').click();
  await root(page).locator('[data-fx-prev] [data-fx-copy-one]').click();
  await expect(sheet(page).locator('#fxDestTitle')).toHaveText('1개 복사할 곳');
  await shot(page, 'files-copy-sheet-884');
  await sheet(page).locator('[data-fx-dest-close]').click();
  await expect(sheet(page)).toBeHidden();
  expect(errors).toEqual([]);
});
