import { test, expect } from '@playwright/test';
import { start, openFiles } from './helpers/files-server.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
// FILES-폴드나무목록(S51-18, 요청함 11/06 01:13 · 명진 01:14 'ㅇ', 시안 docs/design/mockups/files-fold-tree-list.html):
// 펼친 갤럭시 Z 폴드는 CSS 폭이 약 673~884px(폰 앱 WebView·삼성 인터넷 기본 배율). 옛 판정(760px 이하 = 폰)은 이 폭을 폰으로 잡아
// 나무만 화면 가득 → 폴더를 누르면 목록만 나왔다. 공용 판정(app/screen-width.mjs, 600px~)으로 고친 뒤:
// 파일·노트가 폴드 폭(700·768·884)과 PC(1280)에서 '왼쪽 나무 | 오른쪽 목록', 폴더를 옮겨 다녀도 나무가 남고, 경계선 끌기는 서버(view_prefs.split_ratio)에 기억.
// 폰 412는 그대로 한 칸. 노트 보기 전환 줄은 폴드(폰 틀)·폰 모두 아래 가운데(UI-폴드보기탭가운데 S68-44), PC 위. 이름은 모두 지어낸 것이다.
const root = page => page.locator('#filesRoot');
const settle = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
const box = async l => l.boundingBox();

for (const width of [700, 768, 884, 1280]) test(`파일 ${width}: 왼쪽 나무 | 오른쪽 목록, 폴더를 옮겨 다녀도 나무가 남는다`, async ({ page }) => {
  test.setTimeout(90000);
  const { errors } = await start(page, width);
  await openFiles(page, width);
  const tree = root(page).locator('[data-fx-tree]'), list = root(page).locator('[data-fx-list]');
  await expect(tree).toBeVisible();
  await expect(list.locator('[data-fx-row]').first()).toBeVisible();
  // 나란히: 나무가 왼쪽, 목록이 오른쪽, 위아래로 겹쳐 쌓이지 않는다. 나무는 좁은 쪽.
  let t = await box(tree), l = await box(list);
  expect(l.x).toBeGreaterThanOrEqual(t.x + t.width - 1);
  expect(Math.abs(l.y - t.y)).toBeLessThan(80);
  expect(t.width).toBeLessThan(l.width);
  // 저장소마다 둥근 상자(S51-25, 자료실 모양) — 상자 사이가 한눈에 갈린다.
  const rootBox = tree.locator('[data-fx-box="od"]');
  expect(await rootBox.evaluate(e => parseFloat(getComputedStyle(e).borderTopLeftRadius))).toBeGreaterThan(0);
  // S69-38 UI-탐색기나무누르기(명진 11/24): 나무에서 폴더 이름을 누르면(하위 폴더가 있어도) 오른쪽이 그 폴더 + 나무에서 펼침 — 두 번 옮겨 다녀도 나무가 그대로.
  // ⋯·우클릭 [이 폴더로 들어가기]도 같은 곳.
  const go = tree.locator('[data-fx-go][data-fx-id]:not([data-fx-id=""])');
  const crumb = root(page).locator('[data-fx-crumb] .fx-crumb-now');
  const enterVia = async btn => { await btn.locator('xpath=..').locator('[data-fx-tmenu]').click(); await page.locator('#rowMenu').getByRole('button', { name: '이 폴더로 들어가기' }).click(); };
  const name0 = await go.first().locator('.ft-name').textContent();
  await go.first().click();
  await expect(tree).toBeVisible();
  await expect(crumb).toHaveText(name0);
  await expect(go.first().locator('xpath=..')).toHaveClass(/ft-current/);
  await expect(go.first().locator('xpath=..').locator(':scope > .ft-tog')).toHaveAttribute('aria-expanded', 'true');
  const name1 = await go.nth(1).locator('.ft-name').textContent();
  await go.nth(1).click();
  await expect(crumb).toHaveText(name1);
  await expect(tree).toBeVisible();
  await enterVia(go.first());
  await expect(crumb).toHaveText(name0);
  await enterVia(go.nth(1));
  await expect(tree).toBeVisible();
  await expect(crumb).toHaveText(name1);
  t = await box(tree); l = await box(list);
  expect(l.x).toBeGreaterThanOrEqual(t.x + t.width - 1);
  // 나무 | 목록 경계선이 있다(끌어 폭 조절).
  await expect(root(page).locator('[data-fx-cols]>.split-resize-handle')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: `test-results/files-fold-${width}.png` });
  expect(errors).toEqual([]);
});

for (const width of [700, 884]) test(`파일 폴드 ${width}: 경계선을 끌면 나무 폭이 바뀌고 서버(split_ratio.files)에 기억, 다시 열어도 같다`, async ({ page }) => {
  test.setTimeout(90000);
  const server = await installViewPrefsServer(page);
  const { errors } = await start(page, width);
  await openFiles(page, width);
  const tree = root(page).locator('[data-fx-tree]'), handle = root(page).locator('[data-fx-cols]>.split-resize-handle');
  await expect(handle).toBeVisible();
  const w0 = (await box(tree)).width, h = await box(handle), y = h.y + Math.min(h.height / 2, 60);
  await page.mouse.move(h.x + h.width / 2, y); await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2 + 60, y, { steps: 4 }); await page.mouse.move(h.x + h.width / 2 + 120, y, { steps: 4 }); await page.mouse.up();
  await settle(page);
  const w1 = (await box(tree)).width;
  expect(w1).toBeGreaterThan(w0 + 60);
  await expect.poll(() => Number(server.value?.split_ratio?.files || 0)).toBeGreaterThan(0.3);
  await page.reload();
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, { timeout: 20000 });
  await openFiles(page, width);
  await expect(root(page).locator('[data-fx-list] [data-fx-row]').first()).toBeVisible();
  await settle(page);
  expect(Math.abs((await box(tree)).width - w1)).toBeLessThan(8);
  expect(errors).toEqual([]);
});

test('파일 폰 412: 그대로 한 칸(나무 화면 · 경계선 없음, 두 칸은 [두 칸 보기]로만)', async ({ page }) => {
  test.setTimeout(90000);
  const { errors } = await start(page, 412);
  await openFiles(page, 412);
  await expect(root(page)).toHaveAttribute('data-fx-pane', 'tree');
  await expect(root(page).locator('[data-fx-cols]>.split-resize-handle')).toBeHidden();
  await expect(root(page).locator('[data-fx-two]')).toHaveAttribute('aria-pressed', 'false');
  await expect(root(page).locator('[data-fx-pane-i="1"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

// 노트: 폴더 나무 | 노트 목록은 같은 공용 판정. 폴드(폰 틀)에서도 폴더를 눌러 옮겨 다녀도 나무가 남는다. 보기 전환 줄 자리는 01:25 규칙.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const note = (id, title, t, metadata = {}) => ({ id, workspace_id: 'w', kind: 'note', title, raw_text: title + ' 본문', occurred_at: t, created_at: t, updated_at: t, archived_at: null, ai_export_allowed: true, attachments: [], metadata });
async function notes(page, width) {
  await page.setViewportSize({ width, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await openHome(page);
  const folders = [
    { id: U(1), workspace_id: 'w', parent_id: null, name: '가상 메모', sort_order: 1024, created_at: '2026-10-01T00:00:00Z' },
    { id: U(2), workspace_id: 'w', parent_id: null, name: '가상 개발', sort_order: 2048, created_at: '2026-10-01T00:00:00Z' },
  ];
  const rows = [note('a1', '가상 노트 1', '2026-10-02T01:00:00Z', { folder_id: U(1), folder: '가상 메모' }), note('a2', '가상 노트 2', '2026-10-03T01:00:00Z', { folder_id: U(1), folder: '가상 메모' }), note('b1', '가상 개발 노트', '2026-10-04T01:00:00Z', { folder_id: U(2), folder: '가상 개발' })];
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', r => r.request().method() === 'GET' ? r.fulfill({ json: structuredClone(rows) }) : r.fulfill({ status: 500, json: {} }));
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_folders', r => r.request().method() === 'GET' ? r.fulfill({ json: structuredClone(folders) }) : r.fulfill({ status: 500, json: {} }));
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  await expect(page.locator('[data-nx-count]')).toHaveText('노트 · 3');
  return { errors };
}
for (const width of [700, 884]) test(`노트 폴드 ${width}: 왼쪽 폴더 나무 | 오른쪽 노트 목록, 폴더를 옮겨 다녀도 나무가 남는다`, async ({ page }) => {
  const { errors } = await notes(page, width);
  const tree = page.locator('[data-nx-tree]');
  await expect(tree).toBeVisible();
  // UI-폴더누르기한규칙(S57-5): 나무 폴더 누르기 = 펼침만(오른쪽 노트 그대로), 들어가기 = ⋯ [이 폴더로 들어가기].
  // OPS-빠진일2차 1(S59-17): 하위 폴더가 없는 폴더는 한 번 누르면 그 폴더를 연다(펼칠 것이 없으므로).
  const enterNote = async id => { await tree.locator(`[data-nx-folder-more="${id}"]`).click(); await page.locator('#noteDocMenu [data-nx-enter]').click(); };
  // S69-27: 나무에 폴더 바로 아래 노트 줄도 보이므로 노트가 든 폴더는 누르면 그 자리에서 펼친다(폰 나무와 같은 규칙). 오른쪽은 ⋯ [이 폴더로 들어가기].
  await tree.locator(`[data-nx-folder="${U(1)}"] .ft-main`).click();
  await expect(tree.locator('[data-nx-note="a1"]')).toBeVisible(); await expect(tree.locator('[data-nx-note="a2"]')).toBeVisible();
  await enterNote(U(1));
  await expect(page.locator('[data-nx-here]')).toHaveText('가상 메모 · 2');
  if (process.env.S57_5_SHOTS) await page.screenshot({ path: `${process.env.S57_5_SHOTS}/notes-${width}-2-entered.png` });
  await expect(page.locator('#noteRows [data-note-row]')).toHaveCount(2);
  await expect(tree).toBeVisible();
  await enterNote(U(2));
  await expect(page.locator('[data-nx-here]')).toHaveText('가상 개발 · 1');
  await expect(tree).toBeVisible();
  const t = await box(tree), l = await box(page.locator('[data-nx-body]>.nx-pane'));
  expect(l.x).toBeGreaterThanOrEqual(t.x + t.width - 1);
  await expect(page.locator('[data-nx-body]>.split-resize-handle')).toBeVisible();
  expect(errors).toEqual([]);
});

// UI-폴드보기탭가운데(S68-44, 명진 11/23 11:43 '노트 폴드펼침 화면 폴더 목록 보드 태그 댓글 달력 가운데 정렬'): 펼친 폴드(폰 틀 673~760)도 아래 가운데.
test('노트 보기 전환 줄 자리: 폴드(폰 틀)·폰 아래 가운데 · PC 위', async ({ page }) => {
  const sw = () => page.locator('[data-note-list] .nv-switch');
  await notes(page, 700);
  for (const vw of [673, 700, 707, 760, 412, 390]) {
    await page.setViewportSize({ width: vw, height: 900 }); await settle(page);
    const s = await box(sw()), tabs = await box(page.locator('.mobile-tabs'));
    expect(await sw().evaluate(e => getComputedStyle(e).position)).toBe('fixed');
    expect(Math.abs(s.x + s.width / 2 - vw / 2), `${vw} 가운데`).toBeLessThan(4);
    expect(s.y + s.height).toBeLessThanOrEqual(tabs.y + 1);
  }
  for (const vw of [884, 1280]) {
    await page.setViewportSize({ width: vw, height: 900 }); await settle(page);
    expect(await sw().evaluate(e => getComputedStyle(e).position)).not.toBe('fixed');
    expect((await box(sw())).y).toBeLessThan(400);
  }
});

// S69-38 UI-탐색기나무누르기(명진 11/24, UI-폴더누르기한규칙을 탐색기 나무에서 바꿈): 폴더 이름 누르기 = 오른쪽이 그 폴더 + 펼침(다시 눌러도 접지 않음),
// 펼침 아이콘·←/→ = 펼치기·접기만(오른쪽 그대로). ⋯ [이 폴더로 들어가기]도 같은 곳.
test('파일 1280: 폴더 이름 누르기 = 그 폴더 열기 + 펼침, 아이콘·←/→ = 펼침·접힘만, ⋯ 메뉴로도 들어가기', async ({ page }) => {
  test.setTimeout(90000);
  const { errors } = await start(page, 1280);
  await openFiles(page, 1280);
  const tree = root(page).locator('[data-fx-tree]');
  await expect(tree).toBeVisible();
  // 하위 폴더가 있는 폴더(아이콘 단추가 있는 줄)
  const row = tree.locator('.ft-row.ft-has-tog:has(> button.ft-tog):has([data-fx-go][data-fx-id]:not([data-fx-id=""]))').first();
  const id = await row.locator('[data-fx-go]').getAttribute('data-fx-id');
  const main = tree.locator(`[data-fx-go][data-fx-id="${id}"]`), tog = tree.locator(`.ft-row:has([data-fx-id="${id}"]) > button.ft-tog`);
  const name = await main.locator('.ft-name').textContent();
  const crumb = root(page).locator('[data-fx-crumb] .fx-crumb-now');
  // TREE-펼치기먼저(S70-81): 첫 누르기 = 펼치기만(위치 그대로), 두 번째 = 그 폴더 열기.
  const crumb0 = await crumb.textContent();
  await main.click();
  await expect(tog).toHaveAttribute('aria-expanded', 'true');
  await expect(crumb).toHaveText(crumb0);
  await main.click();
  await expect(crumb).toHaveText(name);
  await expect(tog).toHaveAttribute('aria-expanded', 'true');
  await expect(main).toBeFocused();
  await main.click(); // 지금 폴더 이름을 또 눌러도 접지 않는다(접기는 아이콘·←)
  await expect(tog).toHaveAttribute('aria-expanded', 'true');
  await expect(crumb).toHaveText(name);
  let open = true;
  const flip = async () => { open = !open; await expect(tog).toHaveAttribute('aria-expanded', String(open)); await expect(crumb).toHaveText(name); };
  await tog.click(); await flip();
  await tog.click(); await flip();
  await main.focus(); await page.keyboard.press(open ? 'ArrowLeft' : 'ArrowRight'); await flip();
  await page.keyboard.press(open ? 'ArrowLeft' : 'ArrowRight'); await flip();
  if (process.env.S57_5_SHOTS) await page.screenshot({ path: `${process.env.S57_5_SHOTS}/files-pc-1280-1-press.png` });
  // 들어가기 = 그 줄 ⋯ 메뉴
  await row.locator('[data-fx-tmenu]').click();
  await page.locator('#rowMenu').getByRole('button', { name: '이 폴더로 들어가기' }).click();
  await expect(crumb).toHaveText(name);
  if (process.env.S57_5_SHOTS) await page.screenshot({ path: `${process.env.S57_5_SHOTS}/files-pc-1280-2-entered.png` });
  expect(errors).toEqual([]);
});
