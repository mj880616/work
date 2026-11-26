import { test, expect } from '@playwright/test';
import { start, openFiles, enterRow } from './helpers/files-server.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
// FILES-빈폴더줄(S70-70, 명진 11/26 08:46 PC [파일] 사진 "이 빈폴더 왜 나오는거? 그리고 여백도 없고 의미도 잘 모르겠음"):
// ① 칸이 기억한 하위 폴더(서버 view_prefs.files_last)로 다시 열면 나무 저장소 상자 머리에 지금 위치('› … › 지금 폴더', '…'는 한 단계 위·전체 경로는 title)가 보인다.
// ② 나무 저장소 맨 위도 클라우드에서 바로 한 번 읽는다 — 색인이 아직 비어 있어도 '빈 폴더'로 굳지 않는다(전에는 [맨 위]를 눌러야 다시 보였다).
// ③ 빈 폴더 안내는 '이 폴더는 비어 있어요', 다른 줄 이름과 같은 왼쪽 자리. 못 읽음('불러오지 못했어요 [다시]')·읽는 중(뼈대 줄)은 각기 다른 줄.
// 서버·클라우드는 흉내(폴더 이름은 모두 가짜).
const EMPTY_TEXT = '이 폴더는 비어 있어요';
const root = page => page.locator('#filesRoot');
const tree = page => root(page).locator('[data-fx-tree]');
const box = (page, s) => tree(page).locator(`[data-fx-box="${s}"]`);
const pane = (page, i) => root(page).locator(`[data-fx-pane-i="${i}"]`);
const folder = (o) => ({ source: 'gd', parent_id: null, is_folder: true, mime: null, size_bytes: null, modified_at: '2026-10-01T01:00:00Z', hash: null, trashed: false, starred: false, library_doc_id: null, ...o });
const SUB = () => folder({ source: 'od', item_id: 'OD!19', parent_id: 'OD!1', name: '가짜 빈 하위' });
// 빈 폴더 글자의 왼쪽 끝과 같은 상자 휴지통 줄 이름의 왼쪽 끝(같은 깊이 줄의 이름 자리).
const lefts = (page, s) => box(page, s).evaluate(b => {
  const t = b.querySelector('.ft-empty-row .wait-empty'), n = b.querySelector('.ft-trash .ft-name');
  const range = document.createRange(); range.selectNodeContents(t);
  return { text: Math.round(range.getBoundingClientRect().left), name: Math.round(n.getBoundingClientRect().left), font: getComputedStyle(t).fontSize };
});
// 기억한 하위 폴더(od:OD!19)로 여는 PC 화면. two면 두 칸(왼쪽 칸이 기억한 곳).
async function begin(page, width, { two = false } = {}) {
  const { errors, server } = await start(page, width);
  server.items.push(SUB());
  const prefs = { files_last: [{ od: 'OD!19' }], ...(two ? { files_two: { pc: { wide: true } } } : {}) };
  await installViewPrefsServer(page, prefs);
  await page.reload();
  await openFiles(page, width, { two });
  return { errors, server };
}

for (const two of [false, true]) test(`PC 1440${two ? ' 두 칸' : ''}: 기억한 하위 폴더로 다시 열면 상자 머리에 위치, 맨 위 폴더도 그대로 · 단계 누르면 그 폴더`, async ({ page }) => {
  test.setTimeout(90000);
  const { errors } = await begin(page, 1440, { two });
  const list = pane(page, 0).locator('[data-fx-list]');
  await expect(list).toContainText(EMPTY_TEXT); // 기억한 빈 하위 폴더
  const path = box(page, 'od').locator('[data-fx-box-path="od"]');
  // 두 칸은 왼쪽 나무가 접힌 채 시작한다(칸 머리에 위치 줄) — 나무를 펼쳐 같은 상자 머리를 본다.
  if (two) { await root(page).locator('[data-fx-tree-tog]').click(); await expect(tree(page)).toBeVisible(); }
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/pc-${two ? 'two' : 'one'}.png` });
  await expect(path).toBeVisible();
  await expect(path.locator('.fx-box-step')).toHaveText(['…', '가짜 빈 하위']);
  await expect(path.locator('.fx-box-step').last()).toHaveAttribute('aria-current', 'location');
  await expect(path.locator('.fx-box-step').first()).toHaveAttribute('title', '원드라이브 › 가짜 문서함 › 가짜 빈 하위');
  // 나무 상자 안은 맨 위 폴더부터(연결이 끊긴 것처럼 '빈 폴더'만 남지 않음). [맨 위]는 누를 수 있는 모양.
  await expect(box(page, 'od').locator('[data-fx-fold="od:OD!2"]')).toBeVisible();
  await expect(box(page, 'od').locator('.ft-box-body > .ft-empty-row')).toHaveCount(0);
  const top = box(page, 'od').locator('.fx-box-top');
  await expect(top).not.toHaveAttribute('aria-current', 'true');
  // 머리 한 줄 안에 들어간다(넘침 없음).
  expect(await box(page, 'od').locator('.ft-box-head').evaluate(h => h.scrollWidth <= h.clientWidth + 1)).toBe(true);
  await expect(path.locator('.fx-box-step').first()).toHaveAttribute('aria-label', '위 폴더 가짜 문서함');
  // '…'(위 단계)를 누르면 한 단계 위 폴더.
  await path.locator('.fx-box-step').first().click();
  await expect(pane(page, 0).locator('[data-fx-row="od:OD!11"]')).toBeVisible();
  await expect(path.locator('.fx-box-step')).toHaveText(['가짜 문서함']);
  // [맨 위] → 위치가 사라지고 [맨 위]는 흐린 '여기'.
  await top.click();
  await expect(pane(page, 0).locator('[data-fx-row="od:OD!1"]')).toBeVisible();
  await expect(path).toHaveCount(0);
  await expect(top).toHaveAttribute('aria-current', 'true');
  expect(errors).toEqual([]);
});

test('PC 1440: 맨 위 색인이 아직 비었어도 나무가 클라우드를 바로 읽어 폴더를 보인다(빈 폴더로 굳지 않음)', async ({ page }) => {
  test.setTimeout(90000);
  const { errors, server } = await start(page, 1440);
  // 구글 드라이브 맨 위 폴더는 색인에 없고 클라우드 바로 읽기에만 있다. 칸은 원드라이브를 연다(구글 맨 위를 칸이 읽지 않음).
  const gdTop = server.items.filter(i => i.source === 'gd' && !i.parent_id);
  server.items = server.items.filter(i => !gdTop.includes(i));
  server.directItems.push(...gdTop);
  await openFiles(page, 1440);
  await expect(pane(page, 0).locator('[data-fx-row="od:OD!1"]')).toBeVisible();
  await expect(box(page, 'gd').locator('[data-fx-fold="gd:gdFolder1"]')).toBeVisible();
  await expect(box(page, 'gd').locator('.ft-box-body')).not.toContainText(EMPTY_TEXT);
  expect(server.calls.some(c => c.what === 'edge' && c.action === 'folder' && c.body?.source === 'gd' && !c.body?.id)).toBe(true);
  expect(errors).toEqual([]);
});

for (const width of [1440, 390]) test(`${width}: 저장소 맨 위 — 못 읽음 · 읽는 중 · 빈 폴더가 각기 다른 줄, 빈 폴더 줄은 다른 줄 이름과 같은 자리`, async ({ page }) => {
  test.setTimeout(90000);
  const { errors, server } = await start(page, width);
  // 구글 드라이브 맨 위 목록: 처음엔 실패, 다음엔 붙잡아 두기(읽는 중), 풀면 빈 목록.
  server.items = server.items.filter(i => i.source !== 'gd');
  let mode = 'fail', release = null;
  const held = new Promise(r => { release = r; });
  await page.route('**/rest/v1/rpc/app_cloud_list', async route => {
    const b = route.request().postDataJSON?.() || {};
    if (b.p_source !== 'gd' || b.p_parent_id) return route.fallback();
    if (mode === 'fail') return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'XX000', message: 'fake failure' }) });
    if (mode === 'hold') await held;
    return route.fallback();
  });
  await openFiles(page, width);
  const gd = box(page, 'gd');
  // 못 읽음: 빨간 '불러오지 못했어요' + [다시], 빈 폴더 글자·휴지통 줄 없음.
  await expect(gd.locator('.ft-fail-row [data-wait-fail]')).toContainText('불러오지 못했어요');
  await expect(gd).not.toContainText(EMPTY_TEXT);
  await expect(gd.locator('.ft-trash')).toHaveCount(0);
  // [다시] → 읽는 중: 뼈대 줄(빈 폴더·실패 글자 없음).
  mode = 'hold';
  await gd.locator('.ft-fail-row [data-fx-tree-retry]').click();
  await expect(gd.locator('.ft-box-body kptu-wait')).toHaveCount(1);
  await expect(gd).not.toContainText(EMPTY_TEXT);
  await expect(gd.locator('[data-wait-fail]')).toHaveCount(0);
  // 다 읽었는데 비었음: '이 폴더는 비어 있어요' + 휴지통 줄. 글자 왼쪽 끝 = 휴지통 이름 왼쪽 끝, 글자 크기는 작은 회색 글자.
  release();
  await expect(gd.locator('.ft-empty-row')).toHaveText(EMPTY_TEXT);
  await expect(gd.locator('.ft-trash')).toHaveCount(1);
  const l = await lefts(page, 'gd');
  expect(Math.abs(l.text - l.name)).toBeLessThanOrEqual(1);
  expect(l.font).toBe('12px');
  expect(errors).toEqual([]);
});

test('폰 390: 펼친 하위 폴더 — 읽는 중은 뼈대 줄, 빈 폴더는 안내 줄(같은 깊이 이름 자리)', async ({ page }) => {
  test.setTimeout(90000);
  const { errors, server } = await start(page, 390);
  server.items.push(folder({ source: 'od', item_id: 'OD!19', parent_id: 'OD!1', name: '가짜 빈 폴더' }));
  let release = null;
  const held = new Promise(r => { release = r; });
  await page.route('**/rest/v1/rpc/app_cloud_list', async route => {
    const b = route.request().postDataJSON?.() || {};
    if (b.p_parent_id === 'OD!19') await held;
    return route.fallback();
  });
  await openFiles(page, 390);
  const t = tree(page);
  await t.locator('[data-fx-tog="od:OD!1"]').click();
  await t.locator('[data-fx-tog="od:OD!19"]').click();
  await expect(t.locator('.ft-wait-row[data-ft-parent="od:OD!19"] kptu-wait')).toHaveCount(1);
  await expect(t.locator('.ft-empty-row:not(.ft-wait-row)[data-ft-parent="od:OD!19"]')).toHaveCount(0);
  release();
  const empty = t.locator('.ft-empty-row[data-ft-parent="od:OD!19"]');
  await expect(empty).toHaveText(EMPTY_TEXT);
  await expect(t.locator('.ft-wait-row')).toHaveCount(0);
  // 빈 폴더 줄 글자 = 그 폴더 안 한 단계(폴더 이름 자리 + 들여쓰기 한 칸) — 안에 든 줄 이름이 놓일 자리.
  const m = await t.evaluate(el => {
    const txt = el.querySelector('.ft-empty-row[data-ft-parent="od:OD!19"] .wait-empty'), r = document.createRange(); r.selectNodeContents(txt);
    const name = el.querySelector('[data-fx-fold="od:OD!19"] .ft-name');
    return { text: r.getBoundingClientRect().left, name: name.getBoundingClientRect().left, indent: parseFloat(getComputedStyle(el).getPropertyValue('--ft-indent')) };
  });
  expect(Math.abs(m.text - (m.name + m.indent))).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});
