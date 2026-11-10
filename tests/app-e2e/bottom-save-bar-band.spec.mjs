import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { openHome } from './helpers/home-entry.mjs';
import { noteAction } from './helpers/basket-more.mjs';
import { noteMenuAction } from './helpers/note-menu.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
// UI-아래저장줄흰띠(S56-39, 명진 11/10 18:21 "여기 흰 배경 이것도 이상"): 노트·업데이트·일기 고치기 칸 아래에 붙는
// 공용 저장 줄(.save-row-sticky)이 흰색(--kptu-surface)이라 베이지 화면 바탕 위에서 흰 띠로 떠 보였다.
// 지금: 줄 바탕 = 그 줄이 놓인 곳 바탕(감싼 칸이 칠한 바탕, 없으면 화면 바탕). 위 가는 선·아래 탭 위에 붙는 자리는 그대로.
// 밝은·어두운 테마, 폰 412·PC 1280에서 화면 사진의 점 색으로도 확인한다. 서버는 흉내(이름·글은 모두 가짜).
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const SHOTS = process.env.UI_BOTTOM_BAR_SHOTS || '';
const FILE = { 노트: 'note', 업데이트: 'update', 일기: 'diary', 프로필: 'profile' };
const AT = '2026-10-05T01:00:00Z';
const long = Array.from({ length: 40 }, (_, i) => `${i + 1}번째 줄 가짜 글을 길게 적어 봅니다`).join('\n');
const rows = () => [
  { id: 'u1', workspace_id: 'w', kind: 'basket', title: null, raw_text: long, occurred_at: AT, created_at: AT, updated_at: AT, archived_at: null, ai_export_allowed: true, attachments: [], metadata: {} },
  { id: 'n1', workspace_id: 'w', kind: 'note', title: '가짜 노트', raw_text: long, occurred_at: AT, created_at: AT, updated_at: AT, archived_at: null, ai_export_allowed: true, attachments: [], metadata: {} },
];

async function setup(page, width, dark) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.setViewportSize({ width, height: 800 });
  await openHome(page);
  if (dark) await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  const data = rows();
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', r => {
    const req = r.request(), q = new URL(req.url()).searchParams;
    if (req.method() !== 'GET') return r.fulfill({ json: [] });
    if (q.get('metadata')) return r.fulfill({ json: [] });
    return r.fulfill({ json: data.filter(row => (!q.get('kind') || 'eq.' + row.kind === q.get('kind')) && (!q.get('id') || 'eq.' + row.id === q.get('id'))) });
  });
  return errors;
}

const SCREENS = {
  async 노트(page) {
    await page.evaluate(() => window.KPTURouter.go('basket'));
    await chooseBasketKind(page, 'note');
    await page.locator('[data-note-host] [data-note-row]').filter({ hasText: '가짜 노트' }).click();
    await noteMenuAction(page, 'data-note-edit');
    return page.locator('[data-note-edit-actions]');
  },
  async 업데이트(page) {
    await page.evaluate(() => window.KPTURouter.go('basket'));
    await page.locator('[data-basket-row="u1"]').click();
    await noteAction(page, '[data-basket-edit]');
    return page.locator('[data-basket-detail] [data-basket-edit-actions]');
  },
  async 프로필(page) {
    await page.evaluate(() => window.KPTURouter.go('profile'));
    await expect(page.locator('#profileView')).toBeVisible();
    return page.locator('#profileView .ps-actions');
  },
  async 일기(page) {
    await page.evaluate(() => window.KPTURouter.go('diary'));
    await expect(page.locator('#diaryView')).toBeVisible();
    await page.locator('#diaryRoot [data-diary-new]').click();
    return page.locator('#diaryRoot [data-diary-editor] .diary-actions');
  },
};

// 줄 뒤에 실제로 보이는 바탕: 줄의 부모부터 올라가며 처음 칠해진(투명 아님) 바탕. 없으면 화면 바탕(body·html).
const behind = bar => bar.evaluate(el => {
  for (let n = el.parentElement; n; n = n.parentElement) {
    const bg = getComputedStyle(n).backgroundColor;
    if (bg && bg !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(bg)) return { bg, who: n.id || n.className || n.tagName };
  }
  return { bg: getComputedStyle(document.body).backgroundColor, who: 'body' };
});
// 화면 사진에서 점 하나(1×1)를 잘라 PNG를 풀어 RGB를 읽는다(필터 0·8비트, Chromium 화면 사진 그대로).
async function pixel(page, x, y) {
  const png = await page.screenshot({ clip: { x: Math.round(x), y: Math.round(y), width: 1, height: 1 }, animations: 'disabled', caret: 'hide' });
  const chunks = [];
  for (let i = 8; i < png.length;) { const len = png.readUInt32BE(i), type = png.toString('ascii', i + 4, i + 8); if (type === 'IDAT') chunks.push(png.subarray(i + 8, i + 8 + len)); i += 12 + len; }
  const raw = inflateSync(Buffer.concat(chunks));
  return [raw[1], raw[2], raw[3]];
}
const rgb = text => text.match(/\d+/g).slice(0, 3).map(Number);

for (const width of [412, 884, 1280]) for (const dark of [false, true]) for (const name of Object.keys(SCREENS)) {
  test(`${width} ${dark ? '어두운' : '밝은'} ${name} 고치기: 아래 저장 줄은 흰 띠가 아니다(놓인 곳 바탕과 한 색)`, async ({ page }) => {
    test.setTimeout(60000);
    const errors = await setup(page, width, dark);
    const bar = await SCREENS[name](page);
    await expect(bar).toBeVisible();
    const style = await bar.evaluate(el => { const cs = getComputedStyle(el); return { bg: cs.backgroundColor, pos: cs.position, line: cs.borderTopWidth }; });
    expect(style.pos).toBe('sticky');
    expect(style.line).toBe('1px');
    const under = await behind(bar);
    expect(style.bg, `뒤 바탕(${under.who})`).toBe(under.bg);
    // 화면 사진으로도: 줄 안 빈 자리(버튼 사이 가장 넓은 틈, 버튼이 오른쪽에만 있으면 그 왼쪽) 색 = 줄 뒤 바탕 색.
    const b = await bar.boundingBox();
    const xs = (await bar.locator('button:visible').evaluateAll(list => list.map(el => { const r = el.getBoundingClientRect(); return [r.left, r.right]; }))).sort((p, q) => p[0] - q[0]);
    let gap = [b.x, xs[0][0]];
    for (let i = 1; i < xs.length; i++) if (xs[i][0] - xs[i - 1][1] > gap[1] - gap[0]) gap = [xs[i - 1][1], xs[i][0]];
    const got = await pixel(page, (gap[0] + gap[1]) / 2, b.y + b.height / 2), want = rgb(under.bg);
    for (let i = 0; i < 3; i++) expect(Math.abs(got[i] - want[i]), `화면 사진 점 ${got} = 뒤 바탕 ${want}`).toBeLessThanOrEqual(2);
    if (SHOTS) {
      mkdirSync(SHOTS, { recursive: true });
      const top = Math.max(0, Math.round(b.y + b.height) - 300);
      await page.screenshot({ path: `${SHOTS}/${FILE[name]}-${width}-${dark ? 'dark' : 'light'}.png`, clip: { x: 0, y: top, width, height: Math.min(800 - top, 340) } });
    }
    expect(errors).toEqual([]);
  });
}
