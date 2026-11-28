import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
// S70-83 READ-저장한글폴더(사용자 결정 2026-11-26 — PC도 목록|글 두 칸, 저장한 글에 폴더):
// ① PC 1280·1600·폴드 펼침 690 = 왼쪽 목록 | 오른쪽 글 두 칸(경계 손잡이 있음), 폰 390 = 한 칸.
// ② 왼쪽 위 폴더 상자는 [파일]과 같은 공용 상자·줄·꺾쇠(folder-tree-ui.mjs .ft-box·.ft-row.ft-folder·.ft-tog). ＋ = 새 폴더(서버 app_reading_folders 저장).
// ③ 글을 끌어 폴더에 놓기(PC) · 글 ⋯ [폴더로 옮기기](공용 옮길 곳 창) = 서버 folder_id 한 번. '폴더 없음' = 폴더 없는 글.
//    2026-11-28 사용자 결정 "전체 줄을 둬": 맨 위 '전체' 줄이 기본 선택, 누르면 모든 글. 폴더를 다시 눌러도 전체로 돌아가지 않는다(그 폴더 그대로).
// ④ 폴더 ⋯ [이름 바꾸기]·[삭제](글은 한 단 위로, [되돌리기]). ⑤ DB 적용 전(표·칸 없음) = '전체' 한 줄만, 글 목록·글 보기는 그대로.
// ⑥ 2026-11-28 사용자 결정 "폴더 안에 폴더도 만들어": 폴더 ⋯ [새 폴더]·[옮기기…]·끌어 놓기로 폴더 안 폴더, 자기 아래로는 못 옮김, 지우면 안의 폴더는 한 단 위로.
// 서버는 흉내, 글·주소는 모두 예시.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const id = n => `a7083000-0000-4000-8000-00000000000${n}`;
const FOLDER = 'f7083000-0000-4000-8000-000000000001';
const rowsOf = () => [1, 2, 3].map(n => ({ id: id(n), workspace_id: 'w', url: `https://example.com/${n}`, title: `예시 저장 글 ${n}`, site: 'example.com',
  saved_at: `2026-11-2${5 - n}T01:00:00Z`, read_at: null, body_state: 'ok', body_at: '2026-11-22T01:00:10Z', business_area_id: null, updated_at: '2026-11-22T01:00:10Z',
  folder_id: null, body: `예시 글 ${n}의 첫 문단이에요.` }));

function errorsOf(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  return errors;
}
// before: true = DB 적용 전(폴더 표 404, folder_id 칸 400).
async function server(page, { before = false, folders = [] } = {}) {
  const s = { rows: rowsOf(), folders: folders.map(f => ({ ...f })), moves: [], folderWrites: [] };
  await page.route(SB + '/**', async route => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname, method = req.method();
    const ok = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    const table = p.startsWith('/rest/v1/') ? p.slice('/rest/v1/'.length) : '';
    if (table === 'app_reading_items') {
      const sel = u.searchParams.get('select') || '';
      if (before && sel.includes('folder_id')) return ok({ code: '42703', message: 'column app_reading_items.folder_id does not exist' }, 400);
      const idq = u.searchParams.get('id') || '';
      const ids = idq.startsWith('in.(') ? idq.slice(4, -1).split(',') : idq ? [idq.replace(/^eq\./, '')] : null;
      const pick = r => { const { workspace_id, body, ...rest } = r; const out = sel.includes('body') ? { ...rest, body } : rest; if (before) delete out.folder_id; return out; };
      if (method === 'PATCH') {
        const body = req.postDataJSON?.() || {};
        if ('folder_id' in body) s.moves.push({ ids, folder_id: body.folder_id });
        const hit = s.rows.filter(x => ids?.includes(x.id));
        for (const r of hit) Object.assign(r, body);
        return ok(hit.map(r => (sel === 'id,folder_id' ? { id: r.id, folder_id: r.folder_id } : pick(r))));
      }
      return ok((ids ? s.rows.filter(x => ids.includes(x.id)) : s.rows).map(pick));
    }
    if (table === 'app_reading_folders') {
      if (before) return ok({ code: 'PGRST205', message: "Could not find the table 'public.app_reading_folders'" }, 404);
      const fid = (u.searchParams.get('id') || '').replace(/^eq\./, '');
      const under = (id, top) => { for (let at = s.folders.find(x => x.id === top); at; at = s.folders.find(x => x.id === at.parent_id)) if (at.id === id) return true; return false; };
      if (method === 'POST') { const body = req.postDataJSON(); s.folderWrites.push(['add', body]); const f = { id: body.id || FOLDER.replace(/1$/, String(s.folders.length + 2)), parent_id: body.parent_id ?? null, name: body.name, sort_order: body.sort_order, created_at: '2026-11-26T01:00:00Z' }; s.folders.push(f); return ok([f], 201); }
      if (method === 'PATCH') {
        const body = req.postDataJSON(); s.folderWrites.push(['parent_id' in body ? 'move' : 'rename', body]);
        // 서버 트리거 흉내: 자기 자신·자기 아래로 옮기기 거절(23514 READING_FOLDER_CYCLE).
        if (body.parent_id && under(fid, body.parent_id)) return ok({ code: '23514', message: 'READING_FOLDER_CYCLE: a folder cannot be placed under itself or a folder below it' }, 400);
        const f = s.folders.find(x => x.id === fid); if (f) Object.assign(f, body); return ok(f ? [f] : []);
      }
      if (method === 'DELETE') {
        s.folderWrites.push(['delete', fid]); const f = s.folders.find(x => x.id === fid);
        // 서버 흉내: 안의 폴더는 한 단 위로(트리거), 남은 글은 칸만 비움(외래 키).
        for (const k of s.folders) if (k.parent_id === fid) k.parent_id = f?.parent_id ?? null;
        s.folders = s.folders.filter(x => x.id !== fid); for (const r of s.rows) if (r.folder_id === fid) r.folder_id = null; return ok(f ? [{ id: fid }] : []);
      }
      return ok(s.folders.map(f => ({ parent_id: null, ...f })));
    }
    if (table === 'app_news_highlights') return ok([]);
    return route.fallback();
  });
  return s;
}
async function goMenu(page, width) {
  if (width <= 760) {
    await page.locator('#mobileMenuTab').click();
    await page.locator('#mobileMenu nav button:visible', { hasText: '저장한 글' }).click();
  } else await page.locator('#appView>.app-nav').getByRole('link', { name: '저장한 글', exact: true }).click();
  await expect(page.locator('#readingView')).toBeVisible();
}
const list = page => page.locator('#readingView [data-rd-list]');
const detail = page => page.locator('#readingView [data-rd-detail]');
const box = page => page.locator('#readingView [data-rd-folders] .ft-box');
const frow = (page, key) => page.locator(`#readingView [data-rd-folders] .ft-row:has([data-rd-folder="${key}"])`);
const rows = page => list(page).locator('.rd-row');
const sideBySide = page => page.evaluate(() => {
  const a = document.querySelector('#readingView [data-rd-list]').getBoundingClientRect(), b = document.querySelector('#readingView [data-rd-detail]').getBoundingClientRect();
  return a.width > 150 && b.width > 150 && b.left >= a.right - 1 && Math.abs(a.top - b.top) < 80;
});
const noSideScroll = page => page.evaluate(() => document.documentElement.scrollWidth - innerWidth <= 1);

for (const [width, height] of [[1280, 900], [1600, 1000], [690, 830]]) {
  test(`저장한 글 ${width}: 두 칸(목록|글·경계 손잡이) · 공용 폴더 상자 · 새 폴더 → 끌어 옮기기 → 폴더 고르면 그 글만`, async ({ page }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height });
    const errors = errorsOf(page);
    await openHome(page);
    const s = await server(page);
    await goMenu(page, width);
    // ① 두 칸: 왼쪽 목록 | 오른쪽 글(맨 위 글), 가운데 경계 손잡이.
    await expect(detail(page).locator('.ds-doc-title')).toHaveText('예시 저장 글 1');
    expect(await sideBySide(page)).toBe(true);
    await expect(page.locator('#readingView .rd-wrap > .split-resize-handle')).toHaveCount(1);
    // ② 공용 폴더 상자·줄: 처음은 '전체'(기본 선택, 글 3개)·'폴더 없음' 두 줄, 머리 ＋.
    await expect(box(page)).toBeVisible();
    await expect(box(page).locator('.ft-row.ft-folder')).toHaveCount(2);
    await expect(box(page).locator('.ft-row.ft-folder').first()).toContainText('전체');
    await expect(frow(page, 'all')).toHaveClass(/ft-current/);
    await expect(frow(page, 'all').locator('.ft-num')).toHaveText('3');
    await expect(frow(page, 'out')).toContainText('폴더 없음');
    await expect(frow(page, 'out').locator('.ft-num')).toHaveText('3');
    // 새 폴더(서버 저장 한 번).
    await page.locator('[data-rd-folder-add]').click();
    await page.locator('.kptu-ask-input .kptu-ask-field').fill('교섭 자료');
    await page.locator('.kptu-ask-input button.primary').click();
    await expect(box(page).locator('.ft-row.ft-folder')).toHaveCount(3);
    expect(s.folderWrites.filter(w => w[0] === 'add').map(w => w[1].name)).toEqual(['교섭 자료']);
    const fid = s.folders[0].id;
    await expect(frow(page, fid)).toContainText('교섭 자료');
    await expect(frow(page, fid).locator('.ft-num')).toHaveText('0');
    // ③ 둘째 글을 끌어 그 폴더에 놓기(PC 마우스 끌기 — 넓은 화면만).
    if (width > 760) {
      await rows(page).filter({ hasText: '예시 저장 글 2' }).dragTo(frow(page, fid));
      await expect.poll(() => s.moves.length).toBe(1);
      expect(s.moves[0]).toEqual({ ids: [id(2)], folder_id: fid });
    } else {
      // 폴드는 손가락 기기라 ⋯ [폴더로 옮기기](공용 옮길 곳 창).
      await list(page).locator(`[data-rd-more="${id(2)}"]`).click();
      await page.locator('#rdRowMenu [data-rd-act="folder"]').click();
      const sheet = page.locator('dialog[data-fd-sheet]');
      await expect(sheet).toBeVisible();
      await sheet.locator(`[data-fx-dest-pick="${fid}"]`).click();
      await sheet.locator('[data-fx-dest-go]').click();
      await expect.poll(() => s.moves.length).toBe(1);
      expect(s.moves[0]).toEqual({ ids: [id(2)], folder_id: fid });
    }
    await expect(frow(page, fid).locator('.ft-num')).toHaveText('1');
    await expect(frow(page, 'out').locator('.ft-num')).toHaveText('2');
    // 폴더를 누르면 그 글만(주소에 ?folder=). 다시 눌러도 그 폴더 그대로(전체로 돌아가지 않음), '전체'를 누르면 모든 글.
    await frow(page, fid).locator('[data-rd-folder]').click();
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText('예시 저장 글 2');
    await expect(frow(page, fid)).toHaveClass(/ft-current/);
    await expect(frow(page, 'all')).not.toHaveClass(/ft-current/);
    expect(new URL(page.url()).searchParams.get('folder')).toBe(fid);
    await expect(detail(page).locator('.ds-doc-title')).toHaveText('예시 저장 글 2'); // 두 칸: 열린 글이 폴더 밖이면 그 폴더 맨 위 글로
    await frow(page, fid).locator('[data-rd-folder]').click({ delay: 0 });
    await page.waitForTimeout(400);
    await expect(rows(page)).toHaveCount(1);
    expect(new URL(page.url()).searchParams.get('folder')).toBe(fid);
    await frow(page, 'out').locator('[data-rd-folder]').click();
    await expect(rows(page)).toHaveCount(2);
    await frow(page, 'all').locator('[data-rd-folder]').click();
    await expect(rows(page)).toHaveCount(3);
    await expect(frow(page, 'all')).toHaveClass(/ft-current/);
    expect(new URL(page.url()).searchParams.get('folder')).toBe(null);
    expect(await noSideScroll(page)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('저장한 글 폰 390: 한 칸 그대로 · 폴더 상자 공용 줄(폰 높이) · ⋯ [폴더로 옮기기] · 폴더 고르면 그 글만', async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 390, height: 860 });
  const errors = errorsOf(page);
  await openHome(page);
  const s = await server(page, { folders: [{ id: FOLDER, name: '교섭 자료', sort_order: 1024, created_at: '2026-11-25T01:00:00Z' }] });
  await goMenu(page, 390);
  await expect(rows(page)).toHaveCount(3);
  await expect(detail(page)).toBeHidden();
  await expect(page.locator('#readingView .rd-wrap > .split-resize-handle')).toHaveCount(0);
  await expect(box(page).locator('.ft-row.ft-folder')).toHaveCount(3);
  await expect(frow(page, 'all')).toHaveClass(/ft-current/);
  // 폰 폴더 줄은 [파일]과 같은 공용 높이(표준 L1 폰 44px).
  const h = await frow(page, FOLDER).evaluate(n => Math.round(n.getBoundingClientRect().height));
  expect(h).toBeGreaterThanOrEqual(40);
  await list(page).locator(`[data-rd-more="${id(3)}"]`).click();
  await page.locator('#rdRowMenu [data-rd-act="folder"]').click();
  const sheet = page.locator('dialog[data-fd-sheet]');
  await expect(sheet).toBeVisible();
  await sheet.locator(`[data-fx-dest-pick="${FOLDER}"]`).click();
  await sheet.locator('[data-fx-dest-go]').click();
  await expect.poll(() => s.moves.length).toBe(1);
  expect(s.moves[0]).toEqual({ ids: [id(3)], folder_id: FOLDER });
  await frow(page, FOLDER).locator('[data-rd-folder]').click();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('예시 저장 글 3');
  // 한 칸: 누르면 글, 뒤로 = 목록(고른 폴더 그대로).
  await rows(page).first().click();
  await expect(detail(page).locator('.ds-doc-title')).toHaveText('예시 저장 글 3');
  await expect(list(page)).toBeHidden();
  await page.goBack();
  await expect(list(page)).toBeVisible();
  await expect(rows(page)).toHaveCount(1);
  expect(await noSideScroll(page)).toBe(true);
  expect(errors).toEqual([]);
});

test('폴더 ⋯ [이름 바꾸기]·[삭제](맨 위 폴더의 글은 폴더 없음으로, [되돌리기]로 같은 폴더·같은 글) — PC 1280', async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const errors = errorsOf(page);
  await openHome(page);
  const s = await server(page, { folders: [{ id: FOLDER, name: '교섭 자료', sort_order: 1024, created_at: '2026-11-25T01:00:00Z' }] });
  s.rows[0].folder_id = FOLDER;
  await goMenu(page, 1280);
  await expect(frow(page, FOLDER).locator('.ft-num')).toHaveText('1');
  await frow(page, FOLDER).locator('[data-rd-folder-more]').click();
  await page.locator('#rdFolderMenu [data-rd-fact="rename"]').click();
  await page.locator('.kptu-ask-input .kptu-ask-field').fill('교섭 기사');
  await page.locator('.kptu-ask-input button.primary').click();
  await expect(frow(page, FOLDER)).toContainText('교섭 기사');
  expect(s.folderWrites.at(-1)).toEqual(['rename', { name: '교섭 기사' }]);
  await frow(page, FOLDER).locator('[data-rd-folder-more]').click();
  await page.locator('#rdFolderMenu [data-rd-fact="delete"]').click();
  await expect(box(page).locator('.ft-row.ft-folder')).toHaveCount(2);
  await expect(frow(page, 'out').locator('.ft-num')).toHaveText('3');
  await page.locator('.kptu-notice-undo', { hasText: '되돌리기' }).click();
  await expect(frow(page, FOLDER)).toContainText('교섭 기사');
  await expect(frow(page, FOLDER).locator('.ft-num')).toHaveText('1');
  expect(s.folderWrites.at(-1)[0]).toBe('add');
  expect(s.folderWrites.at(-1)[1].id).toBe(FOLDER);
  expect(s.moves.at(-1)).toEqual({ ids: [id(1)], folder_id: FOLDER });
  expect(errors).toEqual([]);
});

for (const width of [1280, 390]) {
  test(`DB 적용 전 ${width}: 폴더 표·칸이 없어도 목록·글 보기 그대로, 폴더 상자는 '전체' 한 줄만(만들기·옮기기 없음)`, async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width, height: 900 });
    const errors = errorsOf(page);
    await openHome(page);
    await server(page, { before: true });
    await goMenu(page, width);
    await expect(rows(page)).toHaveCount(3);
    await expect(box(page).locator('.ft-row.ft-folder')).toHaveCount(1);
    await expect(frow(page, 'all')).toHaveClass(/ft-current/);
    await expect(frow(page, 'all').locator('.ft-num')).toHaveText('3');
    await expect(page.locator('[data-rd-folder-add]')).toHaveCount(0);
    await expect(rows(page).first()).not.toHaveAttribute('draggable', 'true');
    await list(page).locator(`[data-rd-more="${id(1)}"]`).click();
    await expect(page.locator('#rdRowMenu [data-rd-act="delete"]')).toBeVisible();
    await expect(page.locator('#rdRowMenu [data-rd-act="folder"]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    if (width > 760) await expect(detail(page).locator('.ds-doc-title')).toHaveText('예시 저장 글 1');
    expect(errors).toEqual([]);
  });
}

// ⑥ 폴더 안 폴더(2026-11-28 사용자 결정). P = 맨 위 '교섭 자료', Q = 맨 위 '홍보'. 글 1은 P 안.
const P = FOLDER, Q = 'f7083000-0000-4000-8000-000000000009';
const twoFolders = () => [{ id: P, name: '교섭 자료', sort_order: 1024, created_at: '2026-11-25T01:00:00Z' }, { id: Q, name: '홍보', sort_order: 2048, created_at: '2026-11-25T02:00:00Z' }];
const depthOf = row => row.evaluate(n => getComputedStyle(n).getPropertyValue('--ft-depth').trim());
async function newChild(page, s, parent, name, tap) {
  const more = frow(page, parent).locator('[data-rd-folder-more]');
  if (tap) await more.tap(); else await more.click();
  await page.locator('#rdFolderMenu [data-rd-fact="mkdir"]').click();
  await page.locator('.kptu-ask-input .kptu-ask-field').fill(name);
  await page.locator('.kptu-ask-input button.primary').click();
  await expect.poll(() => s.folders.filter(f => f.name === name).length).toBe(1);
  return s.folders.find(f => f.name === name).id;
}

for (const [width, height, touch] of [[1280, 900, false], [412, 915, true]]) {
  test.describe(`폴더 안 폴더 ${width}${touch ? ' 터치' : ''}`, () => {
    test.use({ hasTouch: touch, isMobile: touch });
    test(`폴더 안 폴더 ${width}: ⋯ [새 폴더] → 펼친 하위 줄 · 꺾쇠 접기·펼치기 · 하위 폴더 누르면 그 글만 · [옮기기…] 자기 아래 거절 · 다른 폴더로 옮기기 · 삭제는 한 단 위로`, async ({ page }) => {
      test.setTimeout(120000);
      await page.setViewportSize({ width, height });
      const errors = errorsOf(page);
      await openHome(page);
      const s = await server(page, { folders: twoFolders() });
      s.rows[0].folder_id = P;
      await goMenu(page, width);
      const press = loc => (touch ? loc.tap() : loc.click());
      await expect(frow(page, P)).toBeVisible();
      // 하위 폴더가 없으면 꺾쇠 없음(같은 폭 빈 자리).
      await expect(frow(page, P).locator('button.ft-tog')).toHaveCount(0);
      // P 안에 새 폴더 C: 서버에 상위 칸이 P로, P가 펼쳐져 C가 한 단 들여 보인다.
      const C = await newChild(page, s, P, '하위 자료', touch);
      expect(s.folderWrites.find(w => w[0] === 'add' && w[1].name === '하위 자료')[1].parent_id).toBe(P);
      await expect(frow(page, C)).toBeVisible();
      await expect.poll(() => depthOf(frow(page, C))).toBe('1');
      await expect(frow(page, P).locator('.ft-num')).toHaveText('폴더 1 · 글 1');
      if (!touch) {
        // PC: 꺾쇠 = 펼치기·접기만(고른 곳·주소 그대로 — 표준 T10).
        const tog = frow(page, P).locator('button.ft-tog');
        await expect(tog).toHaveAttribute('aria-expanded', 'true');
        await press(tog);
        await expect(frow(page, C)).toHaveCount(0);
        await expect(frow(page, 'all')).toHaveClass(/ft-current/);
        expect(new URL(page.url()).searchParams.get('folder')).toBe(null);
        await press(frow(page, P).locator('button.ft-tog'));
        await expect(frow(page, C)).toBeVisible();
      } else {
        // 폰: [파일]·노트 폰 나무처럼 꺾쇠 없음(T5). 이름 누르기 = 그 폴더 글 + 그 자리 펼치기, 고른 폴더를 다시 누르면 접기·펼치기만(고른 곳 그대로).
        await expect(page.locator('#readingView [data-rd-folders] button.ft-tog')).toHaveCount(0);
        await press(frow(page, P).locator('[data-rd-folder]'));
        await expect(frow(page, P)).toHaveClass(/ft-current/);
        await expect(frow(page, C)).toBeVisible();
        await expect(rows(page)).toHaveCount(1);
        await press(frow(page, P).locator('[data-rd-folder]'));
        await expect(frow(page, C)).toHaveCount(0);
        await expect(frow(page, P)).toHaveClass(/ft-current/);
        await expect(frow(page, P).locator('[data-rd-folder]')).toHaveAttribute('aria-expanded', 'false');
        await press(frow(page, P).locator('[data-rd-folder]'));
        await expect(frow(page, C)).toBeVisible();
        await press(frow(page, 'all').locator('[data-rd-folder]'));
        await expect(rows(page)).toHaveCount(3);
      }
      // C 안 C2(두 단).
      const C2 = await newChild(page, s, C, '더 아래', touch);
      await expect.poll(() => depthOf(frow(page, C2))).toBe('2');
      // 글 2를 C로(⋯ [폴더로 옮기기] — 옮길 곳 창 나무에 하위 폴더가 보임).
      await list(page).locator(`[data-rd-more="${id(2)}"]`).click();
      await page.locator('#rdRowMenu [data-rd-act="folder"]').click();
      const sheet = page.locator('dialog[data-fd-sheet]');
      await expect(sheet).toBeVisible();
      await sheet.locator(`[data-fx-dest-pick="${P}"]`).click();
      await sheet.locator(`[data-fx-dest-pick="${C}"]`).click();
      await sheet.locator('[data-fx-dest-go]').click();
      await expect.poll(() => s.moves.length).toBe(1);
      expect(s.moves[0]).toEqual({ ids: [id(2)], folder_id: C });
      // 하위 폴더를 누르면 그 폴더에 바로 든 글만, 위 폴더는 그 폴더에 바로 든 글만.
      await press(frow(page, C).locator('[data-rd-folder]'));
      await expect(rows(page)).toHaveCount(1);
      await expect(rows(page).first()).toContainText('예시 저장 글 2');
      await press(frow(page, P).locator('[data-rd-folder]'));
      await expect(rows(page)).toHaveCount(1);
      await expect(rows(page).first()).toContainText('예시 저장 글 1');
      // 새로고침해도 고른 하위 폴더 줄이 보이게 위 폴더가 펼쳐진다.
      await press(frow(page, C2).locator('[data-rd-folder]'));
      await page.reload();
      await expect(frow(page, C2)).toHaveClass(/ft-current/);
      await expect(rows(page)).toHaveCount(0);
      // P ⋯ [옮기기…]: 자기 아래(C2)를 고르면 까닭 + 단추 꺼짐, 쓰기 없음.
      const writes = s.folderWrites.length;
      await press(frow(page, P).locator('[data-rd-folder-more]'));
      await page.locator('#rdFolderMenu [data-rd-fact="move"]').click();
      await expect(sheet).toBeVisible();
      await sheet.locator(`[data-fx-dest-pick="${P}"]`).click();
      await sheet.locator(`[data-fx-dest-pick="${C}"]`).click();
      await expect(sheet.locator('[data-fx-dest-go]')).toBeDisabled();
      await expect(sheet).toContainText('자기 아래 폴더로는 옮길 수 없어요');
      await sheet.locator(`[data-fx-dest-pick="${Q}"]`).click();
      await sheet.locator('[data-fx-dest-go]').click();
      await expect.poll(() => s.folderWrites.length).toBe(writes + 1);
      expect(s.folderWrites.at(-1)).toEqual(['move', expect.objectContaining({ parent_id: Q })]);
      await expect(frow(page, Q).locator('.ft-num')).toHaveText('폴더 1');
      // 고른 C2가 Q 안으로 갔으니 그 위 폴더들은 펼쳐 보인다(T2).
      await expect(frow(page, C2)).toBeVisible();
      await expect.poll(() => depthOf(frow(page, C2))).toBe('3');
      // C 삭제: 안의 글 2는 화면이 먼저 한 단 위(P)로, 안의 폴더 C2는 서버가 한 단 위(P)로. [되돌리기]로 그대로.
      await press(frow(page, C).locator('[data-rd-folder-more]'));
      await page.locator('#rdFolderMenu [data-rd-fact="delete"]').click();
      await expect.poll(() => s.folderWrites.filter(w => w[0] === 'delete').length).toBe(1);
      expect(s.moves.at(-1)).toEqual({ ids: [id(2)], folder_id: P });
      await expect(frow(page, C)).toHaveCount(0);
      await expect.poll(() => depthOf(frow(page, C2))).toBe('2');
      await expect(page.locator('.kptu-notice')).toContainText("폴더 1개·글 1개는 '교섭 자료'로");
      await page.locator('.kptu-notice-undo', { hasText: '되돌리기' }).click();
      await expect(frow(page, C)).toBeVisible();
      await expect.poll(() => depthOf(frow(page, C2))).toBe('3');
      expect(s.folders.find(f => f.id === C2).parent_id).toBe(C);
      expect(s.rows.find(r => r.id === id(2)).folder_id).toBe(C);
      expect(await noSideScroll(page)).toBe(true);
      expect(errors).toEqual([]);
    });
  });
}

test('폴더 안 폴더 PC 1280: 폴더 줄을 끌어 다른 폴더에 놓으면 그 안으로 · 자기 아래에는 놓이지 않음 · 전체에 놓으면 맨 위로 · 키보드 → ←', async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const errors = errorsOf(page);
  await openHome(page);
  const C = 'f7083000-0000-4000-8000-000000000008';
  const s = await server(page, { folders: [...twoFolders(), { id: C, parent_id: P, name: '하위 자료', sort_order: 1024, created_at: '2026-11-25T03:00:00Z' }] });
  await goMenu(page, 1280);
  // 처음은 접힘: 꺾쇠 › , 키보드 → 펼치기 / ← 접기(공용 나무 키).
  await expect(frow(page, C)).toHaveCount(0);
  await frow(page, P).locator('[data-rd-folder]').focus();
  await page.keyboard.press('ArrowRight');
  await expect(frow(page, C)).toBeVisible();
  await expect(frow(page, P).locator('[data-rd-folder]')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(frow(page, C)).toHaveCount(0);
  await page.keyboard.press('ArrowRight');
  // P를 자기 아래 C에 끌어 놓기 = 아무 일 없음(놓을 곳 아님).
  await frow(page, P).dragTo(frow(page, C));
  await page.waitForTimeout(300);
  expect(s.folderWrites.filter(w => w[0] === 'move')).toEqual([]);
  // C를 Q에 끌어 놓기 = Q 안으로.
  await frow(page, C).dragTo(frow(page, Q));
  await expect.poll(() => s.folderWrites.filter(w => w[0] === 'move').length).toBe(1);
  expect(s.folderWrites.at(-1)[1].parent_id).toBe(Q);
  await expect(frow(page, Q).locator('button.ft-tog')).toHaveCount(1);
  await expect(frow(page, Q).locator('button.ft-tog')).toHaveAttribute('aria-expanded', 'false'); // 옮긴 곳을 저절로 펼치지 않음(T7)
  // Q를 펼쳐 C를 '전체'에 끌어 놓기 = 맨 위로.
  await frow(page, Q).locator('button.ft-tog').click();
  await frow(page, C).dragTo(frow(page, 'all'));
  await expect.poll(() => s.folderWrites.filter(w => w[0] === 'move').length).toBe(2);
  expect(s.folderWrites.at(-1)[1].parent_id).toBe(null);
  await expect.poll(() => depthOf(frow(page, C))).toBe('0');
  // 이름 두 번 누르기 = 그 폴더 + 펼치기/접기(T10).
  await frow(page, Q).locator('[data-rd-folder]').dblclick();
  await expect(frow(page, Q)).toHaveClass(/ft-current/);
  expect(errors).toEqual([]);
});
