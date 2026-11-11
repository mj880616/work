import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { start, openFiles, treeGo, enterRow } from './helpers/files-server.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
// S49-30 FILES-통합 2-③ 두 칸(명진 결정 H-2, S50-33부터 폴드 기본은 한 칸 — 켜 둔 값만 두 칸, 시안 docs/design/files-unified-mockup.html ⑥ 폴드 884 · ⑧ PC 1440).
// 칸마다 따로 위치·목록·정렬·고르기, 고르기 막대 '→ 오른쪽에 복사 / → 옮기기'(받을 곳 = 반대 칸), 칸 사이 끌어 놓기 → '복사 · 옮기기' 고르기, PC F5·F6·Tab.
// 서버는 흉내(파일 이름은 모두 가짜). 두 칸 켬은 서버 view_prefs.files_two(기기 종류별 · 폭 종류별).
const root = page => page.locator('#filesRoot');
const pane = (page, i) => root(page).locator(`[data-fx-pane-i="${i}"]`);
const prow = (page, i, key) => pane(page, i).locator(`[data-fx-row="${key}"]`);
const bar = page => root(page).locator('[data-fx-bar]');
const edgeCalls = (server, action) => server.calls.filter(c => c.what === 'edge' && c.action === action);
const SHOTS = process.env.FILES_TWO_SHOTS || '';
const shot = async (page, name) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/${name}.png` }); } };
async function begin(page, width, value) {
  const { errors, server } = await start(page, width);
  const prefs = await installViewPrefsServer(page, value || null);
  await page.reload();
  return { errors, server, prefs };
}

test('폴드 884: 두 칸을 켜 둔 기기 — 칸마다 따로 위치(▾ 나무)·정렬, 지금 칸 밑선, 선택 막대 → 오른쪽에 복사(받을 곳 창 없이 서버 작업표)', async ({ page }) => {
  test.setTimeout(90000);
  // S50-33: 폴드 기본은 PC처럼 한 칸. 두 칸을 켜 둔 값(서버 files_two.pc.fold)이 있으면 두 칸.
  const { errors, server, prefs } = await begin(page, 884, { files_two: { pc: { fold: true } } });
  await openFiles(page, 884, { two: true });
  await expect(root(page)).toHaveAttribute('data-fx-two', 'fold');
  await expect(root(page).locator('[data-fx-two]')).toHaveText('한 칸 보기');
  await expect(pane(page, 1)).toBeVisible();
  // 폴드 두 칸은 왼쪽 나무 대신 칸 위 ▾. 왼쪽 = 첫 저장소 맨 위(원드라이브), 오른쪽 = 다른 저장소 맨 위(구글 드라이브).
  await expect(root(page).locator('[data-fx-tree]')).toBeHidden();
  await expect(pane(page, 0).locator('.fx-ptop .fx-psrc-name')).toHaveText('원드라이브');
  await expect(pane(page, 1).locator('.fx-ptop .fx-psrc-name')).toHaveText('구글 드라이브');
  await expect(pane(page, 0)).toHaveClass(/fx-cur/);
  // 왼쪽 칸 ▾ → 그 칸 위로 나무 → 구글 드라이브 › 가짜 업무 공간.
  await pane(page, 0).locator('[data-fx-pdrop]').click();
  const ptree = pane(page, 0).locator('[data-fx-ptree]');
  await expect(ptree).toBeVisible();
  await ptree.locator('[data-fx-go="gd"][data-fx-id="gdFolder1"]').click();
  await expect(ptree).toBeHidden();
  await expect(pane(page, 0).locator('.fx-ptop .fx-crumb-now')).toHaveText('가짜 업무 공간');
  await expect(prow(page, 0, 'gd:gdDoc1')).toBeVisible();
  // 오른쪽 칸 ▾ → 원드라이브 맨 위 → 가짜 문서함(왼쪽은 그대로). 누른 칸이 지금 칸.
  await pane(page, 1).locator('[data-fx-pdrop]').click();
  await pane(page, 1).locator('[data-fx-ptree] [data-fx-go="od"][data-fx-id=""]').click();
  await enterRow(page, prow(page, 1, 'od:OD!1'));
  await expect(pane(page, 1)).toHaveClass(/fx-cur/);
  await expect(pane(page, 0)).not.toHaveClass(/fx-cur/);
  await expect(pane(page, 1).locator('.fx-ptop .fx-crumb-now')).toHaveText('가짜 문서함');
  await expect(pane(page, 0).locator('.fx-ptop .fx-crumb-now')).toHaveText('가짜 업무 공간');
  // 정렬은 칸마다: 오른쪽만 크기 순.
  await pane(page, 1).locator('[data-fx-sort]').selectOption('size');
  await expect(pane(page, 1).locator('[data-fx-row]:not(.fx-folder)').first()).toHaveAttribute('data-fx-row', 'od:OD!11');
  await expect(pane(page, 0).locator('[data-fx-sort]')).toHaveValue('name');
  // 왼쪽에서 고르기(Ctrl) → 막대 '1개 (왼쪽) · [→ 오른쪽에 복사] [→ 옮기기] …'
  await prow(page, 0, 'gd:gdDoc1').click({ modifiers: ['Control'] });
  await expect(pane(page, 0)).toHaveClass(/fx-cur/);
  await expect(bar(page).locator('.fx-bar-t')).toHaveText('1개 (왼쪽)');
  await expect(bar(page).locator('[data-fx-send="copy"]')).toHaveText('→ 오른쪽에 복사');
  await expect(bar(page).locator('[data-fx-send="move"]')).toHaveText('→ 옮기기');
  await shot(page, 'files-two-884');
  server.jobsHold = true;
  await bar(page).locator('[data-fx-send="copy"]').click();
  await expect(root(page).locator('[data-fx-dest]')).toBeHidden(); // 받을 곳 창 없이
  await expect.poll(() => edgeCalls(server, 'job_add').length).toBe(1);
  expect(edgeCalls(server, 'job_add')[0].body).toEqual({ action: 'job_add', confirm: true, kind: 'copy', to_source: 'od', to: 'OD!1', items: [{ source: 'gd', id: 'gdDoc1' }] });
  await expect(root(page).locator('[data-fx-xfer] b')).toHaveText('1/1 보내는 중');
  server.jobsHold = false;
  // 두 칸 끄기 → 한 칸(오른쪽 칸 자리는 없어지고 나무가 돌아옴), 서버에 이 기기·이 폭 칸으로 기억.
  await root(page).locator('[data-fx-two]').click();
  await expect(pane(page, 1)).toHaveCount(0);
  await expect(root(page).locator('[data-fx-tree]')).toBeVisible();
  await expect.poll(() => prefs.value?.files_two).toEqual({ pc: { fold: false } });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('PC 1440: 기본은 한 칸 → [두 칸] 켜기(서버 기억) · 나무는 지금 칸 · Tab 칸 바꾸기 · F5 반대 칸에 복사 · F6 옮기기 · 칸 사이 끌어 놓기 선택', async ({ page }) => {
  test.setTimeout(120000);
  const { errors, server, prefs } = await begin(page, 1440);
  await openFiles(page, 1440);
  await expect(root(page).locator('[data-fx-two]')).toHaveText('두 칸 보기');
  await expect(pane(page, 1)).toHaveCount(0);
  await root(page).locator('[data-fx-two]').click();
  await expect(root(page)).toHaveAttribute('data-fx-two', 'wide');
  await expect.poll(() => prefs.value?.files_two).toEqual({ pc: { wide: true } });
  // S52-41 ③ FILES-두칸나무접기(명진 결정 (가)): 두 칸이면 나무는 접혀 있고 맨 위 ◫로 연다(서버 files_tree에 기억).
  await expect(root(page).locator('[data-fx-tree]')).toBeHidden();
  const tog = root(page).locator('[data-fx-tree-tog]');
  await expect(tog).toHaveAttribute('aria-pressed', 'false');
  await tog.click();
  await expect(tog).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => prefs.value?.files_tree).toEqual({ pc: { wide: true } });
  await expect(root(page).locator('[data-fx-tree]')).toBeVisible();
  // 왼쪽(지금 칸): 나무에서 원드라이브 › 가짜 문서함.
  await treeGo(page, 'od', '');
  await enterRow(page, prow(page, 0, 'od:OD!1'));
  await expect(pane(page, 0).locator('.fx-ptop .fx-crumb-now')).toHaveText('가짜 문서함');
  // Tab → 오른쪽이 지금 칸. 나무로 구글 드라이브 › 가짜 업무 공간을 오른쪽 칸에 연다.
  await prow(page, 0, 'od:OD!11').focus();
  await page.keyboard.press('Tab');
  await expect(pane(page, 1)).toHaveClass(/fx-cur/);
  await treeGo(page, 'gd', '');
  await enterRow(page, prow(page, 1, 'gd:gdFolder1'));
  await expect(pane(page, 1).locator('.fx-ptop .fx-crumb-now')).toHaveText('가짜 업무 공간');
  await expect(pane(page, 0).locator('.fx-ptop .fx-crumb-now')).toHaveText('가짜 문서함');
  // 오른쪽 줄 하나 골라 F5 → 왼쪽(원드라이브 › 가짜 문서함)에 복사(서버 작업표).
  server.jobsHold = true;
  await prow(page, 1, 'gd:gdDoc1').click({ modifiers: ['Control'] });
  await expect(bar(page).locator('.fx-bar-t')).toHaveText('1개 (오른쪽)');
  await expect(bar(page).locator('[data-fx-send="copy"]')).toHaveText('← 왼쪽에 복사 (F5)');
  await page.keyboard.press('F5');
  await expect.poll(() => edgeCalls(server, 'job_add').length).toBe(1);
  expect(edgeCalls(server, 'job_add')[0].body).toEqual({ action: 'job_add', confirm: true, kind: 'copy', to_source: 'od', to: 'OD!1', items: [{ source: 'gd', id: 'gdDoc1' }] });
  expect(new URL(page.url()).searchParams.get('view')).toBe('files'); // F5가 새로고침하지 않음
  server.jobsHold = false;
  await expect(root(page).locator('[data-fx-xfer]')).toBeHidden({ timeout: 15000 });
  // 오른쪽 칸을 원드라이브 › 가짜 2026으로 바꾸고, 왼쪽에서 고른 2개를 F6(같은 저장소 옮기기 = move 한 번).
  await treeGo(page, 'od', 'OD!10');
  await expect(pane(page, 1).locator('.fx-ptop .fx-crumb-now')).toHaveText('가짜 2026');
  await prow(page, 0, 'od:OD!12').click({ modifiers: ['Control'] });
  await prow(page, 0, 'od:OD!13').click({ modifiers: ['Control'] });
  await expect(bar(page).locator('.fx-bar-t')).toHaveText('2개 (왼쪽)');
  await page.keyboard.press('F6');
  await expect.poll(() => edgeCalls(server, 'move').length).toBe(1);
  expect(edgeCalls(server, 'move')[0].body).toEqual({ action: 'move', source: 'od', ids: ['OD!12', 'OD!13'], to: 'OD!10', confirm: true });
  // 두 칸 모두 서버 결과로 고쳐진다: 왼쪽에서 빠지고 오른쪽에 들어옴.
  await expect(prow(page, 0, 'od:OD!12')).toHaveCount(0);
  await expect(prow(page, 1, 'od:OD!12')).toBeVisible();
  // 칸 사이 끌어 놓기: 오른쪽 줄을 왼쪽 칸에 놓으면 '복사 · 옮기기' 작은 고르기.
  await prow(page, 1, 'od:OD!14').dragTo(prow(page, 0, 'od:OD!11'));
  const ask = root(page).locator('[data-fx-dropask]');
  await expect(ask).toBeVisible();
  await expect(ask).toContainText('여기에 놓으면 → 가짜 문서함');
  await expect(ask.locator('[data-fx-drop-go]')).toHaveText(['복사', '옮기기']);
  await shot(page, 'files-two-drop-1440');
  await ask.locator('[data-fx-drop-go="copy"]').click();
  await expect(ask).toBeHidden();
  await expect.poll(() => edgeCalls(server, 'job_add').length).toBe(2);
  expect(edgeCalls(server, 'job_add')[1].body).toEqual({ action: 'job_add', confirm: true, kind: 'copy', to_source: 'od', to: 'OD!1', items: [{ source: 'od', id: 'OD!14' }] });
  await expect(root(page).locator('[data-fx-xfer]')).toBeHidden({ timeout: 15000 });
  await shot(page, 'files-two-1440');
  // 입력 칸 안에서는 Tab·F5가 두 칸 키로 쓰이지 않는다.
  await root(page).locator('[data-fx-search]').focus();
  const cur = await root(page).locator('.fx-cur').getAttribute('data-fx-pane-i');
  await page.keyboard.press('Tab');
  await expect(root(page).locator('.fx-cur')).toHaveAttribute('data-fx-pane-i', cur);
  // 다시 열어도 두 칸(서버 기억).
  await page.reload();
  await openFiles(page, 1440);
  await expect(pane(page, 1)).toBeVisible();
  expect(errors).toEqual([]);
});

test('폰 412: 기본은 한 칸(폴드·PC 칸 값은 폰에 쓰지 않음) — [두 칸 보기] 단추만 보인다', async ({ page }) => {
  const { errors } = await begin(page, 412, { files_two: { phone: { fold: true, wide: true } } });
  await openFiles(page, 412);
  await expect(root(page).locator('[data-fx-tree]')).toBeVisible(); // S50-33: 폰 첫 화면은 나무
  await expect(root(page).locator('[data-fx-two]')).toHaveText('두 칸 보기');
  await expect(pane(page, 1)).toHaveCount(0);
  await expect(root(page)).not.toHaveAttribute('data-fx-two', /.+/);
  await shot(page, 'files-one-412');
  expect(errors).toEqual([]);
});

// S51-20 FILES-폰보기끌기 ②(시안 files-phone-grid-two-drag.html ②): 폰 [두 칸 보기] = 위·아래 두 칸, 칸마다 ▾ 출처·폴더, 누른 칸이 지금 칸(옅은 보라),
// 고르기 막대 '↓ 아래에 복사', 켬은 서버 files_two.<기기>.narrow. [한 칸 보기]로 돌아오면 폰 한 칸(목록 ‹ → 나무).
test('폰 412: [두 칸 보기] → 위·아래 두 칸 · 칸마다 ▾ · 지금 칸 · ↓ 아래에 복사 · 서버 기억 · [한 칸 보기]', async ({ page }) => {
  test.setTimeout(90000);
  const { errors, server, prefs } = await begin(page, 412);
  await openFiles(page, 412);
  await expect(root(page).locator('[data-fx-tree]')).toBeVisible();
  await root(page).locator('[data-fx-two]').click();
  await expect(root(page)).toHaveAttribute('data-fx-two', 'phone');
  await expect(root(page).locator('[data-fx-two]')).toHaveText('한 칸 보기');
  await expect.poll(() => prefs.value?.files_two?.phone).toEqual({ narrow: true });
  // 위 칸 = 첫 저장소 맨 위(원드라이브), 아래 칸 = 다른 저장소 맨 위(구글 드라이브). 위아래로 쌓이고 폭은 화면 가득.
  await expect(pane(page, 0).locator('.fx-ptop .fx-psrc-name')).toHaveText('원드라이브');
  await expect(pane(page, 1).locator('.fx-ptop .fx-psrc-name')).toHaveText('구글 드라이브');
  const a = await pane(page, 0).boundingBox(), b = await pane(page, 1).boundingBox();
  expect(b.y).toBeGreaterThanOrEqual(a.y + a.height - 2);
  expect(Math.abs(a.width - b.width)).toBeLessThan(2);
  expect(a.width).toBeGreaterThan(380);
  await expect(root(page).locator('[data-fx-tree]')).toBeHidden();
  await expect(pane(page, 0)).toHaveClass(/fx-cur/);
  // 아래 칸 ▾ → 원드라이브 맨 위 → 가짜 문서함. 누른 칸이 지금 칸(옅은 보라 바탕).
  await pane(page, 1).locator('[data-fx-pdrop]').click();
  await pane(page, 1).locator('[data-fx-ptree] [data-fx-go="od"][data-fx-id=""]').click();
  await enterRow(page, prow(page, 1, 'od:OD!1'));
  await expect(pane(page, 1)).toHaveClass(/fx-cur/);
  await expect(pane(page, 1).locator('.fx-ptop .fx-crumb-now')).toHaveText('가짜 문서함');
  expect(await pane(page, 1).evaluate(e => getComputedStyle(e).backgroundColor)).not.toBe(await pane(page, 0).evaluate(e => getComputedStyle(e).backgroundColor));
  // 위 칸 ▾ → 구글 드라이브 › 가짜 업무 공간, 꾹 눌러(contextmenu) 고르기 → '1개 (위) · [↓ 아래에 복사] [↓ 옮기기]'
  await pane(page, 0).locator('[data-fx-pdrop]').click();
  const ptree = pane(page, 0).locator('[data-fx-ptree]');
  await ptree.locator('[data-fx-go="gd"][data-fx-id="gdFolder1"]').click();
  await expect(prow(page, 0, 'gd:gdDoc1')).toBeVisible();
  await prow(page, 0, 'gd:gdDoc1').dispatchEvent('contextmenu');
  await expect(bar(page).locator('.fx-bar-t')).toHaveText('1개 (위)');
  await expect(bar(page).locator('[data-fx-send="copy"]')).toHaveText('↓ 아래에 복사');
  await expect(bar(page).locator('[data-fx-send="move"]')).toHaveText('↓ 옮기기');
  await shot(page, 'files-two-412');
  server.jobsHold = true;
  await bar(page).locator('[data-fx-send="copy"]').click();
  await expect.poll(() => edgeCalls(server, 'job_add').length).toBe(1);
  expect(edgeCalls(server, 'job_add')[0].body).toEqual({ action: 'job_add', confirm: true, kind: 'copy', to_source: 'od', to: 'OD!1', items: [{ source: 'gd', id: 'gdDoc1' }] });
  server.jobsHold = false;
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // [한 칸 보기] → 폰 한 칸: 지금 칸(위)의 폴더 목록, ‹ 한 번에 나무.
  await root(page).locator('[data-fx-two]').click();
  await expect(pane(page, 1)).toHaveCount(0);
  await expect.poll(() => prefs.value?.files_two?.phone).toEqual({ narrow: false });
  await expect(root(page)).toHaveAttribute('data-fx-pane', 'list');
  // S51-24: 폰 한 칸 목록의 ‹ 는 어느 단계에서든 한 번에 나무로.
  await root(page).locator('[data-fx-list] [data-fx-up]').click();
  await expect(root(page)).toHaveAttribute('data-fx-pane', 'tree');
  expect(errors).toEqual([]);
});

test('폰 412: 두 칸을 켜 둔 기기는 다시 열어도 위·아래 두 칸', async ({ page }) => {
  test.setTimeout(60000);
  const { errors } = await begin(page, 412, { files_two: { phone: { narrow: true } } });
  await openFiles(page, 412);
  await expect(root(page)).toHaveAttribute('data-fx-two', 'phone');
  await expect(pane(page, 0).locator('[data-fx-row]').first()).toBeVisible();
  await expect(pane(page, 1).locator('[data-fx-row]').first()).toBeVisible();
  expect(errors).toEqual([]);
});
