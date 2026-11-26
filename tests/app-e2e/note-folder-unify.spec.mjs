// NOTE-폴더디자인통일(S70-82, 사용자 2026-11-26 09:27 "모든 폴더를 사용하는 곳 디자인 통일하기로 했는데 노트쪽이 아직 파일 메뉴쪽 디자인을 안쓰는듯" /
// "노트메뉴 안에 보드쪽, 폴더쪽 디자인이살짝 달라 이걸 통일해야함. 파일쪽에 맞춰서"):
// 노트 [폴더] 왼쪽 나무 · [보드] 왼쪽 '노트 목록' · 폰 보드 [+ 노트 붙이기] 창 · [파일] 나무가 같은 공용 줄(folder-tree-ui.mjs .ft-*)·같은 상자(.ft-box)인지,
// 계산된 줄 높이·글자 크기·폴더 그림 폭·개수 자리(이름 바로 뒤)가 같은지 본다. 잠긴 폴더는 큰 [풀기] 단추 없이 같은 높이 줄 + '잠김',
// 폴더 색·특별 줄('최근'·'폴더 없음'·밑줄·메모·휴지통)은 그대로. [폴더] 오른쪽 목록은 [목록]·[파일]과 같은 머리 줄(누르면 정렬, 서버 기억).
// 이름·글은 모두 지어낸 것(가짜 서버, 쓰기는 화면 기억만).
import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
import { start as startFiles, openFiles } from './helpers/files-server.mjs';

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const F1 = U(1), F2 = U(2), F3 = U(3), B = 'b8200001';

async function notesServer(page, width) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const folders = [
    { id: F1, workspace_id: 'w', parent_id: null, name: '가상 잠금', sort_order: 1024, created_at: '2026-10-01T00:00:00Z' },
    { id: F2, workspace_id: 'w', parent_id: F3, name: '가상 안쪽', sort_order: 1024, created_at: '2026-10-01T00:00:00Z' },
    { id: F3, workspace_id: 'w', parent_id: null, name: '가상 보통', sort_order: 2048, color: 3, created_at: '2026-10-01T00:00:00Z' },
  ];
  const row = (id, title, at, metadata = {}) => ({ id, workspace_id: 'w', kind: 'note', title, raw_text: title + ' 본문', occurred_at: at, created_at: at, updated_at: at, archived_at: null, ai_export_allowed: true, attachments: [], metadata });
  const notes = [
    row('n1', '나중 노트', '2026-10-05T01:00:00Z', { folder_id: F3, folder: '가상 보통' }),
    row('n2', '가나 노트', '2026-10-04T01:00:00Z', { folder_id: F3, folder: '가상 보통' }),
    row('n3', '잠긴 노트', '2026-10-03T01:00:00Z', { folder_id: F1, folder: '가상 잠금' }),
    row('n4', '바깥 노트', '2026-10-02T01:00:00Z', {}),
  ];
  await page.setViewportSize({ width, height: 900 });
  const prefs = await installViewPrefsServer(page, { note_boards: [{ id: B, name: '가상 보드' }], note_board: B });
  await openHome(page, { beforeLoad: async () => {
    await page.route(u => u.origin === SB && u.pathname.startsWith('/rest/v1/rpc/app_lock_'), async route => {
      const name = new URL(route.request().url()).pathname.split('/').pop();
      const json = v => route.fulfill({ contentType: 'application/json', body: JSON.stringify(v) });
      if (name === 'app_lock_read') return json({ has_pin: true, features: [], relock: '5m', left: 5, blocked_until: null });
      if (name === 'app_lock_note_folders') return json({ folders: [F1], covered: [F1], top_names: ['가상 잠금'] });
      return route.fulfill({ status: 404, body: '' });
    });
  } });
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', r => r.request().method() === 'GET' ? r.fulfill({ json: structuredClone(notes) }) : r.fulfill({ status: 500, json: {} }));
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_folders', r => r.request().method() === 'GET' ? r.fulfill({ json: structuredClone(folders) }) : r.fulfill({ status: 500, json: {} }));
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  await expect(page.locator('[data-nx-count]')).toHaveText('노트 · 4');
  return { errors, prefs };
}
const view = (page, name) => page.locator(`.nv-switch [data-note-view="${name}"]`).click();

// 폴더 줄 하나의 계산된 모양: 줄 단추 높이·이름 글자 크기·폴더 그림 폭·이름과 개수 사이(개수는 이름 바로 뒤)·상자 안인지.
const look = row => row.evaluate(el => {
  const main = el.querySelector('.ft-main'), name = el.querySelector('.ft-name'), ico = el.querySelector('.ft-ico'), num = el.querySelector('.ft-num');
  const r = x => x.getBoundingClientRect();
  return { cls: ['ft-row', 'ft-folder'].every(c => el.classList.contains(c)), h: Math.round(r(main).height), font: getComputedStyle(name).fontSize,
    weight: getComputedStyle(name).fontWeight, ico: Math.round(r(ico).width), gap: num ? Math.round(r(num).left - r(name).right) : null, boxed: !!el.closest('.ft-box') };
});

// [파일] 화면 줄 값은 따로 연 창(새 브라우저 칸)에서 잰다 — 가짜 서버가 칸마다 따로라서.
async function filesLook(browser, width, pick) {
  const ctx = await browser.newContext(), fp = await ctx.newPage();
  const { errors } = await startFiles(fp, width);
  await openFiles(fp, width);
  const row = pick(fp);
  await expect(row).toBeVisible();
  await expect.poll(() => row.evaluate(el => el.querySelector('.ft-main').getBoundingClientRect().height)).toBeGreaterThan(20);
  const out = await look(row);
  expect(errors).toEqual([]);
  await ctx.close();
  return out;
}

test('PC 1280: 노트 [폴더] 나무·[보드] 왼쪽 목록 폴더 줄 = [파일] 나무 폴더 줄(같은 부품·높이·글자·그림·개수 자리·상자)', async ({ page: page2, browser }) => {
  const files = await filesLook(browser, 1280, p => p.locator('#filesRoot [data-fx-tree] .ft-row.ft-folder.ft-has-tog').first());
  expect(files.cls && files.boxed).toBe(true);
  const { errors } = await notesServer(page2, 1280);
  // [폴더] 왼쪽 나무: 상자 셋('최근' · 폴더 · 밑줄·메모·휴지통), 줄은 공용 줄.
  const tree = page2.locator('[data-nx-tree]');
  await expect(tree.locator(':scope > .ft-box')).toHaveCount(3);
  await expect(tree.locator('[data-nx-box="recent"] [data-nx-recent-item]')).toHaveCount(1);
  await expect(tree.locator('[data-nx-box="folders"] [data-nx-outside]')).toHaveCount(1);
  await expect(tree.locator('[data-nx-box="more"] [data-nx-news-item]').first()).toBeVisible();
  await expect(tree.locator('[data-nx-box="more"] [data-nx-memo-item]')).toHaveCount(1);
  const folderTab = await look(tree.locator(`[data-nx-folder="${F3}"]`));
  // 폴더 색 그대로(색을 고른 폴더 그림).
  await expect(tree.locator(`[data-nx-folder="${F3}"] .ft-ico[data-fc="3"]`)).toHaveCount(1);
  for (const k of ['cls', 'h', 'font', 'weight', 'ico', 'boxed']) expect(folderTab[k], `[폴더] 나무 ${k}`).toBe(files[k]);
  expect(Math.abs(folderTab.gap - 6) <= 6, `개수는 이름 바로 뒤(${folderTab.gap}px)`).toBe(true);

  // [보드] 왼쪽 '노트 목록': 같은 상자·같은 줄. 노트 전용 줄(.nbb-folder·.nbb-note)·큰 [풀기] 단추 없음.
  await view(page2, 'board');
  const side = page2.locator('[data-nbb-side]');
  await expect(side.locator('.ft-box .ft-box-head')).toHaveText('노트 목록');
  await expect(side.locator('.nbb-folder, .nbb-note, .lk-open, .nbb-side-head')).toHaveCount(0);
  const board = await look(side.locator('.ft-row', { has: page2.locator(`[data-nbb-folder="${F3}"]`) }));
  for (const k of ['cls', 'h', 'font', 'weight', 'ico', 'boxed']) expect(board[k], `[보드] 목록 ${k}`).toBe(files[k]);
  expect(Math.abs(board.gap - folderTab.gap)).toBeLessThanOrEqual(1);
  await expect(side.locator(`[data-nbb-folder="${F3}"] .ft-ico[data-fc="3"]`)).toHaveCount(1);
  // 잠긴 폴더: 같은 높이 한 줄 + 개수 자리에 '잠김', 펼치기·끌어 놓기 없음, 안쪽 노트 제목 없음.
  const locked = side.locator(`[data-nbb-locked="${F1}"]`);
  await expect(locked.locator('.ft-num')).toHaveText('잠김');
  await expect(locked.locator('.ft-num')).toBeVisible();
  expect(Math.round((await locked.boundingBox()).height)).toBe(board.h);
  await expect(side).not.toContainText('잠긴 노트');
  await expect(side.locator(`[data-nbb-folder="${F1}"]`)).toHaveCount(0);

  // 노트 줄(폴더를 펼친 안): [보드] 목록과 [폴더] 나무가 같은 높이·같은 제목 시작 자리.
  await side.locator(`[data-nbb-folder="${F3}"]`).click();
  const boardNote = side.locator('[data-nbb-note="n2"]');
  await expect(boardNote.locator('.ft-name')).toHaveText('가나 노트');
  const bn = await boardNote.evaluate(el => { const n = el.querySelector('.ft-name').getBoundingClientRect(), f = el.closest('[data-nbb-side]').querySelector('[data-nbb-folder] .ft-name').getBoundingClientRect(); return { h: Math.round(el.getBoundingClientRect().height), font: getComputedStyle(el.querySelector('.ft-name')).fontSize, indent: Math.round(n.left - f.left) }; });
  await view(page2, 'folder');
  await tree.locator(`[data-nx-tog="${F3}"]`).click();
  const treeNote = tree.locator('[data-nx-note="n2"] .note-row');
  await expect(treeNote).toBeVisible();
  const tn = await treeNote.evaluate(el => ({ h: Math.round(el.getBoundingClientRect().height), font: getComputedStyle(el.querySelector('.basket-title')).fontSize }));
  expect(tn.h, '노트 줄 높이 같음').toBe(bn.h);
  expect(tn.font, '노트 줄 글자 같음').toBe(bn.font);
  expect(bn.indent, '하위 줄 들여쓰기 = 공용 단(22px)').toBe(22);
  expect(errors).toEqual([]);
});

test('PC 1280: [폴더] 오른쪽 목록 = [목록]·[파일]과 같은 머리 줄 — 누르면 정렬·서버 기억, 폴더 줄은 위', async ({ page }) => {
  const { errors, prefs } = await notesServer(page, 1280);
  const tree = page.locator('[data-nx-tree]');
  await tree.locator(`[data-nx-folder="${F3}"] [data-nx-open]`).click();
  const rows = page.locator('#noteRows');
  const head = rows.locator('[data-nl-head]');
  await expect(head).toBeVisible();
  await expect(head.locator('[role="columnheader"]').first()).toHaveText(/제목/);
  await expect(head.locator('[data-head-sort="changed"]')).toBeVisible();
  // 머리 줄 단추는 [파일] 머리처럼 테두리 없는 글자.
  expect(await head.locator('[data-head-sort="title"]').evaluate(el => getComputedStyle(el).borderTopWidth)).toBe('0px');
  // 하위 폴더 줄이 노트 줄 위.
  const order = async () => rows.locator('[data-nx-folder], [data-nx-note]').evaluateAll(list => list.map(el => el.dataset.nxFolder || el.dataset.nxNote));
  await expect.poll(order).toEqual([F2, 'n1', 'n2']); // 기본 = 수정일 내림
  await head.locator('[data-head-sort="title"]').click();
  await expect.poll(order).toEqual([F2, 'n2', 'n1']); // 제목 오름(가나 → 나중)
  await expect.poll(() => prefs.value?.note_list_sort).toEqual({ key: 'title', dir: 'asc' });
  // 칸 줄은 머리와 같은 grid(제목 · 폴더 · 태그 · 수정일 · 첨부).
  await expect(rows.locator('[data-nx-note="n1"].nl-cols [data-nl-cell="day"]')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('폰 390: 보드 [+ 노트 붙이기] 창 폴더 줄 = [파일] 폰 폴더 줄(같은 높이·글자·그림), 잠긴 폴더는 같은 줄 + 잠김', async ({ page: page2, browser }) => {
  const files = await filesLook(browser, 390, p => p.locator('#filesRoot [data-fx-box="od"] .ft-row.ft-folder').first());
  const { errors } = await notesServer(page2, 390);
  await view(page2, 'board');
  await page2.locator('[data-nbb] [data-nbb-pick]').click();
  const dlg = page2.locator('dialog.nbb-pick');
  const pick = await look(dlg.locator('.ft-row', { has: page2.locator(`[data-nbb-pf="${F3}"]`) }));
  for (const k of ['cls', 'h', 'font', 'weight', 'ico']) expect(pick[k], `고르기 창 ${k}`).toBe(files[k]);
  await expect(dlg.locator(`[data-nbb-pl="${F1}"] .ft-num`)).toHaveText('잠김');
  await expect(dlg.locator('.lk-open, .nbb-check')).toHaveCount(0);
  // 노트 고르기: 고른 줄은 [파일] 고른 줄과 같은 표시(옅은 바탕), 체크칸 없음.
  await dlg.locator(`[data-nbb-pf="${F3}"]`).click();
  await dlg.locator('[data-nbb-pn="n1"]').click();
  await expect(dlg.locator('[data-nbb-pn="n1"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(dlg.locator('[data-nbb-pick-ok]')).toHaveText('붙이기 1');
  expect(errors).toEqual([]);
});
