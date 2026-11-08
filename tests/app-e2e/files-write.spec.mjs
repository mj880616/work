import { test, expect } from '@playwright/test';
import { start, openFiles, treeGo } from './helpers/files-server.mjs';
// S48-45 FILES-클라우드탐색기 ⑤·⑦ 쓰기(명진 결정 F1 원드라이브 자체 휴지통, F8 클라우드 사이 1개·200MB).
// 이름 바꾸기·새 폴더·여러 개 고르기·휴지통(확인 창)·잘라 붙이기·끌어 놓기·클라우드 사이 옮기기. 서버는 흉내(파일 이름은 모두 가짜).
const root = page => page.locator('#filesRoot');
const row = (page, key) => root(page).locator(`[data-fx-row="${key}"]`);
const names = page => root(page).locator('[data-fx-list] [data-fx-row] :is(.fx-name, .ft-name)').allTextContents();
const ask = page => page.locator('.kptu-ask');
const bar = page => root(page).locator('[data-fx-bar]');
const edgeCalls = (server, action) => server.calls.filter(c => c.what === 'edge' && c.action === action);

async function intoDocs(page, width) {
  await openFiles(page, width);
  await treeGo(page, 'od', '');
  await row(page, 'od:OD!1').click();
  await expect.poll(() => names(page)).toEqual(['가짜 2026', '가짜 메모.txt', '가짜 안내문.pdf', '가짜 예산표.xlsx']);
}

test('PC 1440: 이름 바꾸기(확장자 그대로)·새 폴더·여러 개 선택해 휴지통(확인 창 · 원드라이브 휴지통 안내)·F2·Esc', async ({ page }) => {
  test.setTimeout(90000);
  const { errors, server } = await start(page, 1440);
  await intoDocs(page, 1440);
  // 미리보기 [이름] → 작은 입력창에는 확장자 없는 이름만, 저장은 확장자 붙여서.
  await row(page, 'od:OD!13').click();
  await root(page).locator('[data-fx-prev] [data-fx-rename-one]').click();
  await expect(ask(page).locator('.kptu-ask-field')).toHaveValue('가짜 메모');
  await ask(page).locator('.kptu-ask-field').fill('가짜 메모 고침');
  await ask(page).getByRole('button', { name: '바꾸기' }).click();
  await expect(row(page, 'od:OD!13').locator(':is(.fx-name, .ft-name)')).toHaveText('가짜 메모 고침.txt');
  expect(edgeCalls(server, 'rename')[0].body).toEqual({ action: 'rename', source: 'od', id: 'OD!13', name: '가짜 메모 고침.txt', confirm: true });
  await expect(root(page).locator('[data-fx-prev] .fx-pv-nm')).toHaveText('가짜 메모 고침.txt');
  // 못 쓰는 글자는 보내기 전에 막는다.
  await row(page, 'od:OD!13').focus();
  await page.keyboard.press('F2');
  await ask(page).locator('.kptu-ask-field').fill('a/b');
  await ask(page).getByRole('button', { name: '바꾸기' }).click();
  await expect(page.getByText('는 쓸 수 없어요').first()).toBeVisible();
  expect(edgeCalls(server, 'rename')).toHaveLength(1);
  // 새 폴더(지금 폴더 안).
  await root(page).locator('[data-fx-mkdir]').click();
  await ask(page).locator('.kptu-ask-field').fill('가짜 새 폴더');
  await ask(page).getByRole('button', { name: '만들기' }).click();
  await expect(row(page, 'od:OD!90')).toBeVisible();
  expect(edgeCalls(server, 'mkdir')[0].body).toEqual({ action: 'mkdir', source: 'od', parent: 'OD!1', name: '가짜 새 폴더', confirm: true });
  // Ctrl 누르고 두 개 고르기 → 막대 '2개 · [복사][옮기기]…'(시안 ③) → Esc로 풀기 → 다시 골라 휴지통.
  await row(page, 'od:OD!11').click({ modifiers: ['Control'] });
  await row(page, 'od:OD!12').click({ modifiers: ['Control'] });
  await expect(bar(page).locator('.fx-bar-t')).toHaveText('2개');
  await expect(bar(page).locator('button')).toHaveText(['복사', '옮기기', '자료실로', '☆ 별표', '휴지통', '✕']);
  await page.keyboard.press('Escape');
  await expect(bar(page)).toBeHidden();
  await row(page, 'od:OD!11').click({ modifiers: ['Control'] });
  await row(page, 'od:OD!12').click({ modifiers: ['Control'] });
  await bar(page).locator('[data-fx-trash]').click();
  await expect(ask(page)).toContainText('2개를 휴지통으로 보낼까요?');
  await expect(ask(page).locator('.kptu-ask-note')).toHaveText('되돌리기는 원드라이브 휴지통에서 합니다');
  // 취소하면 아무것도 보내지 않는다.
  await ask(page).getByRole('button', { name: '취소' }).click();
  expect(edgeCalls(server, 'trash')).toHaveLength(0);
  await bar(page).locator('[data-fx-trash]').click();
  await ask(page).getByRole('button', { name: '휴지통으로' }).click();
  await expect.poll(() => names(page)).toEqual(['가짜 2026', '가짜 새 폴더', '가짜 메모 고침.txt']);
  expect(edgeCalls(server, 'trash')[0].body).toEqual({ action: 'trash', source: 'od', ids: ['OD!11', 'OD!12'], confirm: true });
  await expect(bar(page)).toBeHidden();
  expect(errors).toEqual([]);
});

test('PC 1440: 잘라 붙이기·끌어 놓기로 옮기기, 다른 클라우드로는 확인 한 번 뒤 차례로', async ({ page }) => {
  test.setTimeout(90000);
  const { errors, server } = await start(page, 1440);
  await intoDocs(page, 1440);
  // Ctrl+X → 하위 폴더 열기 → [여기로 옮기기].
  await row(page, 'od:OD!13').click({ modifiers: ['Control'] });
  await page.keyboard.press('Control+x');
  await expect(bar(page)).toContainText('1개 옮기는 중');
  await expect(row(page, 'od:OD!13')).toHaveClass(/fx-cut/);
  await row(page, 'od:OD!10').click();
  await expect(root(page).locator(':is(.fx-crumb-now, .ft-focus-name)')).toHaveText('가짜 2026');
  await bar(page).locator('[data-fx-paste]').click();
  await expect.poll(() => names(page)).toEqual(['가짜 계획안.hwpx', '가짜 메모.txt']);
  expect(edgeCalls(server, 'move')[0].body).toEqual({ action: 'move', source: 'od', ids: ['OD!13'], to: 'OD!10', confirm: true });
  await expect(bar(page)).toBeHidden();
  // 끌어 놓기: 줄을 나무의 원드라이브 맨 위로.
  const tree = root(page).locator('[data-fx-tree]');
  await row(page, 'od:OD!14').dragTo(tree.locator('[data-fx-box="od"] .ft-box-head') /* S51-25: 저장소 맨 위 = 상자 머리에 놓기 */);
  await expect.poll(() => names(page)).toEqual(['가짜 메모.txt']);
  expect(edgeCalls(server, 'move')[1].body).toMatchObject({ source: 'od', ids: ['OD!14'], to: null });
  // 다른 클라우드: 원드라이브 파일을 잘라(Ctrl+X) 구글 드라이브 폴더에 붙이기 → 확인 창 → 서버 작업표(job_add kind move, S49-28).
  await row(page, 'od:OD!13').click({ modifiers: ['Control'] });
  await page.keyboard.press('Control+x');
  await treeGo(page, 'gd', '');
  await row(page, 'gd:gdFolder1').click();
  await expect(root(page).locator(':is(.fx-crumb-now, .ft-focus-name)')).toHaveText('가짜 업무 공간');
  await bar(page).locator('[data-fx-paste]').click();
  await expect(ask(page)).toContainText('구글 드라이브로 옮길까요?');
  await expect(ask(page).locator('.kptu-ask-note')).toContainText('원본은 원드라이브 휴지통으로');
  await ask(page).getByRole('button', { name: '옮기기' }).click();
  await expect(row(page, 'gd:gdJob01')).toBeVisible({ timeout: 15000 });
  expect(edgeCalls(server, 'job_add')[0].body).toEqual({ action: 'job_add', confirm: true, kind: 'move', to_source: 'gd', to: 'gdFolder1', items: [{ source: 'od', id: 'OD!13' }] });
  expect(edgeCalls(server, 'across')).toHaveLength(0);
  // 다른 클라우드로 여러 개도 확인 한 번 → 한 번에 작업표로, 서버가 차례로.
  await row(page, 'gd:gdDoc1').click({ modifiers: ['Control'] });
  await row(page, 'gd:gdJob01').click({ modifiers: ['Control'] });
  await page.keyboard.press('Control+x');
  await treeGo(page, 'od', '');
  await bar(page).locator('[data-fx-paste]').click();
  await expect(ask(page)).toContainText('2개를 원드라이브로 옮길까요?');
  await ask(page).getByRole('button', { name: '옮기기' }).click();
  await expect.poll(() => edgeCalls(server, 'job_add').length).toBe(2);
  expect(edgeCalls(server, 'job_add')[1].body.items.map(i => i.id)).toEqual(['gdDoc1', 'gdJob01']);
  await expect(page.locator('body')).toContainText('2개 보냄', { timeout: 15000 });
  expect(errors).toEqual([]);
});

test('폰 412: 꾹 눌러 선택 → 막대에서 휴지통, 미리보기에서 이름 바꾸기, 가로 넘침 없음', async ({ page }) => {
  test.setTimeout(90000);
  const { errors, server } = await start(page, 412);
  await intoDocs(page, 412);
  await row(page, 'od:OD!11').dispatchEvent('contextmenu');
  await expect(bar(page).locator('.fx-bar-t')).toHaveText('1개');
  // 고르는 중에는 누르면 고르기(미리보기 아님).
  await row(page, 'od:OD!12').click();
  await expect(bar(page).locator('.fx-bar-t')).toHaveText('2개');
  await expect(root(page).locator('[data-fx-prev]')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await bar(page).locator('[data-fx-trash]').click();
  await ask(page).getByRole('button', { name: '휴지통으로' }).click();
  await expect.poll(() => names(page)).toEqual(['가짜 2026', '가짜 메모.txt']);
  expect(edgeCalls(server, 'trash')[0].body.ids).toEqual(['OD!11', 'OD!12']);
  await row(page, 'od:OD!13').click();
  await root(page).locator('[data-fx-prev] [data-fx-rename-one]').click();
  await ask(page).locator('.kptu-ask-field').fill('가짜 폰 메모');
  await ask(page).getByRole('button', { name: '바꾸기' }).click();
  await expect(root(page).locator('[data-fx-prev] .fx-pv-nm')).toHaveText('가짜 폰 메모.txt');
  expect(errors).toEqual([]);
});

test('PC 1440: 같은 파일 보기(같은 해시) — 미리보기 아래 작은 줄, 누르면 그 폴더로', async ({ page }) => {
  test.setTimeout(60000);
  const { errors, server } = await start(page, 1440);
  for (const i of server.items) if (i.item_id === 'OD!13' || i.item_id === 'OD!20') i.hash = 'sha1:' + 'a'.repeat(40);
  await intoDocs(page, 1440);
  await row(page, 'od:OD!13').click();
  const twins = root(page).locator('[data-fx-prev] [data-fx-twins]');
  await expect(twins).toContainText('같은 파일 1');
  await expect(twins.locator('.fx-twin')).toHaveText(['가짜 현장.jpg']);
  expect(server.calls.find(c => c.what === 'app_cloud_items').auth).toMatch(/^Bearer /);
  await twins.locator('.fx-twin').click();
  await expect(root(page).locator(':is(.fx-crumb-now, .ft-focus-name)')).toHaveText('가짜 사진함');
  // 해시가 없는 파일은 읽지 않는다.
  const n = server.calls.filter(c => c.what === 'app_cloud_items').length;
  await row(page, 'od:OD!20').click();
  await expect(root(page).locator('[data-fx-prev] [data-fx-twins] .fx-twin')).toHaveText(['가짜 메모.txt']);
  await treeGo(page, 'od', '');
  await row(page, 'od:OD!1').click();
  await row(page, 'od:OD!11').click();
  await expect(root(page).locator('[data-fx-prev] .fx-pv-nm')).toHaveText('가짜 안내문.pdf');
  expect(server.calls.filter(c => c.what === 'app_cloud_items').length).toBe(n + 1);
  expect(errors).toEqual([]);
});
