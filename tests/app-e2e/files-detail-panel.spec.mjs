import { test, expect } from '@playwright/test';
import { start, openFiles, treeGo, enterRow } from './helpers/files-server.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
// S70-72 FILES-상세칸정리(명진 11/26 08:50 "이렇게 우클릭하면 메뉴가 나오기 때문에 난 이 화면에서는 굳이 오른쪽 상세화면에서 메뉴가 불필요한거같아
// 그리고 오른쪽 상세화면은 펼쳤다 닫았다할 수있게해줘"):
// - PC 넓은 폭 [파일] 오른쪽 상세 칸 = 정보만(이름·★·보기·위치·크기·바뀐 날·종류). 아래 동작 줄 두 줄은 그리지 않는다.
// - 상세 칸에만 있던 [열기](새 창)·[받기]·[공유]는 줄 우클릭 메뉴로 옮겨 빠지는 동작이 없다.
// - 칸 머리 [›]로 접으면 얇은 띠 + [‹], 목록이 넓어진다. 접힘은 서버 view_prefs.files_prev_shut — 새로 열어도 접힌 채, [‹]로 펼침.
// - 폰 390은 그대로(상세 칸 아래 동작 줄 있음, 접기 단추 없음).
// 서버는 흉내(파일·폴더 이름은 모두 가짜).
const root = page => page.locator('#filesRoot');
const row = (page, key) => root(page).locator(`[data-fx-row="${key}"]`);
const prev = page => root(page).locator('[data-fx-prev]');
const menu = page => page.locator('#rowMenu');
const edgeCalls = (server, action) => server.calls.filter(c => c.what === 'edge' && c.action === action);

async function intoDocs(page, width) {
  await openFiles(page, width);
  await treeGo(page, 'od', '');
  await enterRow(page, row(page, 'od:OD!1'));
  await expect(row(page, 'od:OD!11')).toBeVisible();
}
async function begin(page, width, prefs = null) {
  const { errors, server } = await start(page, width);
  const store = await installViewPrefsServer(page, prefs);
  // 공유 창(navigator.share)이 있는 PC 브라우저 흉내 — 보낸 파일 이름만 화면 메모리에 남긴다.
  await page.addInitScript(() => {
    window.__shared = [];
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    Object.defineProperty(navigator, 'share', { configurable: true, value: async d => { window.__shared.push(d?.files?.[0]?.name || ''); } });
  });
  await page.reload();
  return { errors, server, prefs: store };
}

test('PC 1280: 상세 칸에 동작 단추 없음 · 줄 우클릭으로 열기·새 창·받기·공유·자료실·복사·옮기기·이름·별표·휴지통 · 접기 → 목록 넓어짐 → 새로 열어도 접힘(서버) → 펼치기', async ({ page, context }) => {
  test.setTimeout(120000);
  const { errors, server, prefs } = await begin(page, 1280);
  await intoDocs(page, 1280);
  const file = row(page, 'od:OD!11');
  await file.click();
  await expect(prev(page)).toBeVisible();
  await expect(prev(page).locator('.fx-pv-nm')).toHaveText('가짜 안내문.pdf');
  await expect(prev(page).locator('.fx-pv-meta')).toContainText('위치');
  // ① 동작 줄이 없다(숨김이 아니라 그리지 않음).
  await expect(prev(page).locator('.fx-pv-acts')).toHaveCount(0);
  await expect(prev(page).locator('[data-fx-down], [data-fx-share], [data-fx-open], [data-fx-tolib-one], [data-fx-rename-one], [data-fx-copy-one], [data-fx-cut-one], [data-fx-trash-one]')).toHaveCount(0);
  await expect(prev(page).locator('button:visible')).toHaveCount(2); // ★ · 접기
  const fold = prev(page).locator('[data-fx-pv-fold]');
  await expect(fold).toHaveAttribute('aria-label', '상세 칸 접기');
  await expect(fold).toHaveAttribute('aria-expanded', 'true');
  // 접기 단추는 머리줄 작은 단추 크기(콤팩트).
  const fb = await fold.boundingBox();
  expect(fb.height).toBeLessThanOrEqual(26);

  // ② 줄 우클릭 메뉴에 상세 칸에 있던 동작이 모두 있다.
  await file.click({ button: 'right' });
  await expect(menu(page)).toBeVisible();
  const names = await menu(page).locator('button').allTextContents();
  for (const n of ['열기', '새 창에서 열기', '받기', '공유', '자료실로 보내기', '복사', '옮기기', '이름 바꾸기', '별표', '휴지통']) expect(names, n).toContain(n);
  expect(names.slice(0, 5)).toEqual(['선택', '열기', '새 창에서 열기', '받기', '공유']);
  // [받기] = 내려받기.
  const dl = page.waitForEvent('download');
  await menu(page).getByRole('button', { name: '받기', exact: true }).click();
  expect((await dl).url()).toMatch(/^blob:/); // 상세 칸 [받기]와 같은 download 함수(a.download = 파일 이름)
  expect(edgeCalls(server, 'media').some(c => c.body.id === 'OD!11')).toBe(true);
  // [공유] = 공유 창에 그 파일.
  await file.click({ button: 'right' });
  await menu(page).getByRole('button', { name: '공유', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__shared)).toEqual(['가짜 안내문.pdf']);
  // [새 창에서 열기] = 클라우드 보기 주소를 새 창으로(상세 칸 [열기]와 같은 길).
  await context.route('https://example.org/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>가짜</p>' }));
  const popup = context.waitForEvent('page');
  await file.click({ button: 'right' });
  await menu(page).getByRole('button', { name: '새 창에서 열기', exact: true }).click();
  await expect.poll(async () => (await popup).url()).toBe('https://example.org/fake-open');
  expect(edgeCalls(server, 'open-url').at(-1).body).toEqual({ action: 'open-url', source: 'od', id: 'OD!11' });
  // [이름 바꾸기]·[자료실로 보내기]는 같은 메뉴 그대로(별도 시험). 메뉴를 닫는다.
  await file.click({ button: 'right' });
  await page.keyboard.press('Escape');
  await expect(menu(page)).toBeHidden();

  // ③ 접기 → 얇은 띠 + [‹], 목록이 넓어짐, 서버에 기억.
  const listCol = root(page).locator('[data-fx-pane-i="0"]');
  const wide0 = (await listCol.boundingBox()).width;
  await fold.click();
  await expect(root(page)).toHaveAttribute('data-fx-prev-shut', '1');
  const unfold = prev(page).locator('[data-fx-pv-fold]');
  await expect(unfold).toHaveAttribute('aria-label', '상세 칸 펼치기');
  await expect(unfold).toHaveAttribute('aria-expanded', 'false');
  await expect(prev(page).locator('.fx-pv-meta')).toHaveCount(0);
  expect((await prev(page).boundingBox()).width).toBeLessThanOrEqual(32);
  await expect.poll(async () => (await listCol.boundingBox()).width).toBeGreaterThan(wide0 + 200);
  await expect.poll(() => prefs.value?.files_prev_shut).toBe(true);

  // ④ 새로 열어도 접힌 채(서버 기억).
  await page.reload();
  await intoDocs(page, 1280);
  await row(page, 'od:OD!12').click();
  await expect(root(page)).toHaveAttribute('data-fx-prev-shut', '1');
  await expect(prev(page).locator('[data-fx-pv-fold]')).toHaveAttribute('aria-expanded', 'false');
  await expect(prev(page).locator('.fx-pv-meta')).toHaveCount(0);

  // ⑤ 펼치기 → 정보 칸이 다시, 서버 기억은 지움(기본 = 펼침).
  await prev(page).locator('[data-fx-pv-fold]').click();
  await expect(root(page)).not.toHaveAttribute('data-fx-prev-shut', /.*/);
  await expect(prev(page).locator('.fx-pv-nm')).toHaveText('가짜 예산표.xlsx');
  await expect(prev(page).locator('.fx-pv-meta')).toBeVisible();
  await expect(prev(page).locator('.fx-pv-acts')).toHaveCount(0);
  await expect(prev(page).locator('[data-fx-pv-fold]')).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(() => prefs.value?.files_prev_shut).toBeUndefined();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('PC 1280: DB 적용 전(서버가 files_prev_shut을 모름)이면 이번 접속만 접히고 오류 없이 그대로', async ({ page }) => {
  test.setTimeout(90000);
  const { errors } = await start(page, 1280);
  await installViewPrefsServer(page, null, { denyKeys: ['files_prev_shut'] });
  await page.reload();
  await intoDocs(page, 1280);
  await row(page, 'od:OD!11').click();
  await prev(page).locator('[data-fx-pv-fold]').click();
  await expect(root(page)).toHaveAttribute('data-fx-prev-shut', '1');
  await page.waitForTimeout(400);
  await prev(page).locator('[data-fx-pv-fold]').click();
  await expect(prev(page).locator('.fx-pv-meta')).toBeVisible();
  expect(errors).toEqual([]);
});

test('폰 390: 상세 칸은 그대로 — 아래 동작 줄 있음, 접기 단추 없음', async ({ page }) => {
  test.setTimeout(90000);
  const { errors } = await begin(page, 390);
  await openFiles(page, 390);
  await treeGo(page, 'od', 'OD!1');
  await row(page, 'od:OD!11').click();
  await expect(prev(page)).toBeVisible();
  const acts = prev(page).locator('.fx-pv-acts button');
  await expect(acts.filter({ hasText: '받기' })).toHaveCount(1);
  await expect(acts.filter({ hasText: '공유' })).toHaveCount(1);
  await expect(acts.filter({ hasText: '자료실로 보내기' })).toHaveCount(1);
  await expect(prev(page).locator('[data-fx-pv-fold]')).toHaveCount(0);
  await expect(root(page)).not.toHaveAttribute('data-fx-prev-shut', /.*/);
  expect(errors).toEqual([]);
});
