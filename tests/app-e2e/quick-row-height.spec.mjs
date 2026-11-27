import { test, expect } from '@playwright/test';
import { openHome, pickQuickMode } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { pickInSheet } from './helpers/folder-sheet.mjs';

// NOTE-입력줄높이(S71-67, 2026-11-26 사용자 결정 — 시안 B 변형 'B인데 위로 화살표는 추가로'):
// 빠른 입력 줄(home-quick.js 한 부품)은 한 줄 = [입력칸(안 왼쪽 클립 = 첨부, 안 오른쪽 ⤢)] [폴더 아이콘](노트만) [추가](글자 단추).
// 세 칸은 폰 390·폴드 884·PC 1280 모두 같은 높이(±1px). 따로 있던 [📎 첨부] 단추는 없고 클립은 입력칸 안에 있다.
// 같은 부품을 쓰는 홈·잊지 말기·[할 일] 입력 줄도 같은 높이(공용 규칙 한 곳, ui-standard.css 'NOTE-입력줄높이').
test.use({ hasTouch: true });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const WIDTHS = [390, 884, 1280];
const press = (l, width) => width < 761 ? l.tap() : l.click();

async function noteFixture(page, width) {
  await page.setViewportSize({ width, height: 900 });
  const errors = [], posts = [];
  page.on('pageerror', e => errors.push(e.message));
  await openHome(page);
  const rows = [];
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', async r => {
    const req = r.request();
    if (req.method() === 'POST') {
      const body = req.postDataJSON(); posts.push(body);
      const x = { id: 'n-new', workspace_id: 'w', kind: 'note', title: body.title, raw_text: body.raw_text, occurred_at: '2026-10-20T01:00:00Z', created_at: '2026-10-20T01:00:00Z', updated_at: '2026-10-20T01:00:00Z', archived_at: null, ai_export_allowed: true, attachments: [], metadata: body.metadata || {} };
      rows.unshift(x); return r.fulfill({ status: 201, json: [structuredClone(x)] });
    }
    if (req.method() === 'GET') return r.fulfill({ json: structuredClone(rows) });
    if (req.method() === 'PATCH') { const body = req.postDataJSON(); posts.push({ patch: body }); rows.forEach(x => Object.assign(x, structuredClone(body))); return r.fulfill({ json: structuredClone(rows) }); }
    return r.fulfill({ json: [] });
  });
  const folders = [{ id: U(1), workspace_id: 'w', parent_id: null, name: '가상 회의 기록 모음', sort_order: 1024, color: 3, created_at: '2026-10-01T00:00:00Z' }];
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_folders', r => r.fulfill({ json: structuredClone(folders) }));
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  await expect(page.locator('[data-note-list] [data-quick-input]')).toBeVisible();
  return { errors, posts };
}

// 한 줄 칸들의 높이·자리: 입력칸, 칸 밖 단추들(폴더·추가·종류), 칸 안 클립.
const rowBoxes = (page, root) => page.locator(root).first().evaluate(box => {
  const r = el => { if (!el || el.hidden) return null; const b = el.getBoundingClientRect(); return b.width ? { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom } : null; };
  const entry = box.querySelector('.home-quick-entry');
  return {
    input: r(entry.querySelector('[data-quick-input]')),
    save: r(entry.querySelector('[data-quick-save]')),
    folder: r(entry.querySelector('[data-quick-folder]')),
    kind: r(entry.querySelector('[data-quick-kind]')),
    clip: r(box.querySelector('[data-basket-clip]')),
    clipInsideInput: !!box.querySelector('.home-quick-input-wrap [data-basket-clip]'),
    outsideClip: !!entry.querySelector(':scope > [data-quick-file-picker]'),
  };
});
const sameHeight = (boxes, keys) => {
  const hs = keys.map(k => boxes[k]?.h).filter(Boolean);
  expect(hs.length).toBe(keys.length);
  expect(Math.max(...hs) - Math.min(...hs)).toBeLessThanOrEqual(1);
};
const inside = (inner, outer) => inner.x >= outer.x - 0.5 && inner.r <= outer.r + 0.5 && inner.y >= outer.y - 0.5 && inner.b <= outer.b + 0.5;

for (const width of WIDTHS) test(`노트 입력 줄: 입력칸·폴더 아이콘·[추가] 같은 높이, 클립은 칸 안 ${width}`, async ({ page }) => {
  const f = await noteFixture(page, width);
  const root = '[data-note-list] .home-quick';
  const folder = page.locator(`${root} [data-quick-folder]`), save = page.locator(`${root} [data-quick-save]`), input = page.locator(`${root} [data-quick-input]`);
  // 폴더 없음: 글자 없는 정사각 폴더 아이콘, 이름은 aria-label로.
  await expect(folder).toHaveAccessibleName('폴더: 폴더 없음');
  await expect(folder).toHaveText('');
  await expect(folder.locator('svg')).toHaveCount(1);
  await expect(save).toHaveText('추가');
  let b = await rowBoxes(page, root);
  sameHeight(b, ['input', 'folder', 'save']);
  expect(b.input.h).toBeGreaterThanOrEqual(39); expect(b.input.h).toBeLessThanOrEqual(41);
  expect(Math.abs(b.folder.w - b.folder.h)).toBeLessThanOrEqual(1); // 정사각
  // 한 줄: 세 칸의 위쪽이 같다, 차례는 입력칸 → 폴더 → 추가.
  expect(Math.abs(b.input.y - b.folder.y)).toBeLessThanOrEqual(1); expect(Math.abs(b.input.y - b.save.y)).toBeLessThanOrEqual(1);
  expect(b.input.r).toBeLessThanOrEqual(b.folder.x); expect(b.folder.r).toBeLessThanOrEqual(b.save.x);
  // 첨부: 따로 있던 단추 없이 입력칸 안 왼쪽 클립.
  expect(b.outsideClip).toBe(false); expect(b.clipInsideInput).toBe(true);
  expect(inside(b.clip, b.input)).toBe(true);
  expect(b.clip.x - b.input.x).toBeLessThanOrEqual(2);
  // 클립으로 파일을 고르면 이 입력 줄의 파일 줄에 올라온다(기능 그대로).
  const chooser = page.waitForEvent('filechooser');
  await press(page.locator(`${root} [data-basket-clip]`), width);
  await (await chooser).setFiles({ name: 'memo.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(page.locator(`${root} [data-quick-files]`)).toContainText('memo.txt');
  await page.locator(`${root} [data-basket-remove]`).first().click();
  // 폴더 고르기 → 아이콘 옆 작은 이름(넘치면 '…'), 그 폴더 색, aria-label은 이름.
  await press(folder, width);
  await pickInSheet(page, ['가상 회의 기록 모음']);
  await expect(folder).toHaveAccessibleName('폴더: 가상 회의 기록 모음');
  await expect(folder.locator('.home-quick-folder-name')).toHaveText('가상 회의 기록 모음');
  await expect(folder.locator('.home-quick-folder-ico')).toHaveAttribute('data-fc', '3');
  b = await rowBoxes(page, root);
  sameHeight(b, ['input', 'folder', 'save']);
  expect(b.folder.r).toBeLessThanOrEqual(b.save.x);
  expect(b.save.r).toBeLessThanOrEqual(width + 0.5);
  const cut = await folder.locator('.home-quick-folder-name').evaluate(n => n.getBoundingClientRect().right <= n.closest('button').getBoundingClientRect().right + 0.5);
  expect(cut).toBe(true);
  // [추가] 글자 단추로 노트가 만들어진다(그 폴더로).
  await input.fill('가상 노트 한 줄');
  await press(save, width);
  await expect.poll(() => f.posts.filter(p => !p.patch).length).toBe(1);
  expect(f.posts[0].title).toBe('가상 노트 한 줄');
  // 고른 폴더로 넣는다(새 노트 저장 뒤 폴더 기록 — 기존 길 그대로).
  await expect.poll(() => JSON.stringify(f.posts)).toContain(U(1));
  await expect(input).toHaveValue('');
  expect(f.errors).toEqual([]);
});

// 같은 부품을 쓰는 다른 입력 줄: 칸 밖 단추와 입력칸이 같은 높이, 클립은 칸 안.
for (const width of WIDTHS) test(`같은 입력 줄(홈·잊지 말기·[할 일])도 같은 높이 ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await openHome(page);
  // 홈: 글을 쓰면 [추가]가 보인다(폰은 [종류 ▾]도 같은 줄).
  const home = '#homeView [data-home-quick]';
  await page.locator(`${home} [data-quick-input]`).fill('가상 메모');
  let b = await rowBoxes(page, home);
  sameHeight(b, width < 761 ? ['input', 'save', 'kind'] : ['input', 'save']);
  expect(b.outsideClip).toBe(false); expect(inside(b.clip, b.input)).toBe(true);
  await page.locator(`${home} [data-quick-input]`).fill('');
  // 홈 [할 일] 모드.
  await pickQuickMode(page, 'task');
  await page.locator(`${home} [data-quick-input]`).fill('가상 할 일');
  b = await rowBoxes(page, home);
  sameHeight(b, ['input', 'save']);
  await page.locator(`${home} [data-quick-input]`).fill('');
  // 잊지 말기.
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'memo');
  const forget = '#basketView .home-quick[data-home-quick]';
  await expect(page.locator(`${forget} [data-quick-input]`).first()).toBeVisible();
  b = await rowBoxes(page, forget);
  sameHeight(b, ['input', 'save']);
  expect(b.outsideClip).toBe(false); expect(inside(b.clip, b.input)).toBe(true);
  // [할 일] 화면.
  await page.evaluate(() => window.KPTURouter.go('tasks'));
  const tasks = '#tasksView .home-quick[data-home-quick]';
  await expect(page.locator(`${tasks} [data-quick-input]`)).toBeVisible();
  await expect(page.locator(`${tasks} [data-quick-file-picker]`)).toBeVisible();
  b = await rowBoxes(page, tasks);
  sameHeight(b, ['input', 'save']);
  expect(b.outsideClip).toBe(false); expect(inside(b.clip, b.input)).toBe(true);
  expect(errors).toEqual([]);
});
