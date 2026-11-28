import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
// FIX-노트폴드목록(사용자 신고 2026-11-28 12:28, 갤럭시 폴드 펼침 "노트 폴더 클릭했더니.. 난리 났네 / 노트 좌로 스와이프시 가관"):
// 두 칸 화면(왼쪽 폴더 나무 | 오른쪽 노트 목록)에서
//  ① 폴더를 누른 뒤 오른쪽 목록의 제목 칸이 최소 폭(--ds-col-title-min = max(120px, 표 폭 35%))을 갖고, 머리 글자(제목·폴더)가 서로 겹치지 않는다.
//     (고치기 전: 폴더·태그·수정일·첨부 칸이 고정 폭이라 제목 칸만 줄어 690px에서 0px, 740px에서 30px)
//  ② 줄을 왼쪽으로 밀면(손가락 밀기는 760px 이하) 밀린 줄이 자기 목록 칸 안에서만 보이고 왼쪽 폴더 나무를 덮지 않는다.
//  ③ 저장한 이상한 칸 폭(아주 넓은 태그·폴더 칸)이 있어도 제목 칸이 살아 있다.
// 이름·내용은 모두 가짜. 서버는 흉내 낸다(기기 저장 없음).
test.use({ hasTouch: true });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TITLE_MIN = 120;
const settle = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

async function openFolder(page, width, prefs = {}) {
  await page.setViewportSize({ width, height: 800 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await installViewPrefsServer(page, { note_view: 'folder', ...prefs });
  await openHome(page);
  const at = i => `2026-11-2${i}T01:00:00Z`;
  const rows = [1, 2, 3, 4, 5].map(i => ({ id: 'n' + i, workspace_id: 'w', kind: 'note', title: `가짜 노트 제목 ${i}번입니다`, raw_text: `본문 ${i} #가짜 #준비`,
    occurred_at: at(i), created_at: at(i), updated_at: at(i), archived_at: null, ai_export_allowed: true, attachments: i === 2 ? [{ id: 'a1', name: '가짜.pdf' }] : [], metadata: { folder_id: U(1) } }));
  const folders = [
    { id: U(1), workspace_id: 'w', parent_id: null, name: '01. 가짜 메모', sort_order: 1024, created_at: '2026-10-01T00:00:00Z' },
    { id: U(2), workspace_id: 'w', parent_id: U(1), name: '가짜 하위', sort_order: 1024, created_at: '2026-10-02T00:00:00Z' },
  ];
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', r => r.request().method() === 'GET' ? r.fulfill({ json: structuredClone(rows) }) : r.fulfill({ status: 500, json: {} }));
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_folders', r => r.request().method() === 'GET' ? r.fulfill({ json: structuredClone(folders) }) : r.fulfill({ status: 500, json: {} }));
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  await expect(page.locator('[data-nx-count]')).toHaveText('노트 · 5');
  const tree = page.locator('[data-nx-tree]');
  await expect(tree).toBeVisible();
  await tree.locator(`[data-nx-folder="${U(1)}"]`).first().click();
  await expect(page.locator('#noteRows .nx-note.nl-cols')).toHaveCount(5);
  await settle(page);
  return { errors, tree };
}

// 머리 칸·노트 줄 칸의 폭과 머리 글자가 제 칸에 들어가는지.
const measure = page => page.evaluate(() => {
  const box = document.querySelector('#noteRows'), head = box.querySelector('[data-nl-head]');
  const cells = [...head.querySelectorAll('[role="columnheader"]')].map(c => {
    const r = c.getBoundingClientRect(), btn = c.querySelector('.hs-btn') || c;
    const range = document.createRange(); range.selectNodeContents(btn); const t = range.getBoundingClientRect();
    return { key: c.dataset.nlCol, left: r.left, right: r.right, width: r.width, textLeft: t.left, textRight: t.right };
  });
  const title = box.querySelector('.nx-note.nl-cols .note-row .basket-title').getBoundingClientRect();
  const pane = box.getBoundingClientRect();
  return { cells, title: { left: title.left, width: title.width }, pane: { left: pane.left, right: pane.right } };
});

function expectColumnsOk(m) {
  const title = m.cells.find(c => c.key === 'title');
  expect(title.width).toBeGreaterThanOrEqual(TITLE_MIN - 1);
  expect(m.title.width).toBeGreaterThanOrEqual(TITLE_MIN - 1);
  // 머리 글자는 다음 칸 시작 전에 끝난다(제목·폴더 글자가 겹치지 않음).
  for (let i = 0; i < m.cells.length - 1; i++) expect(m.cells[i].textRight, `${m.cells[i].key} 머리 글자`).toBeLessThanOrEqual(m.cells[i + 1].textLeft + 0.5);
  // 표가 목록 칸 밖으로 넘치지 않는다(기본 칸 넷).
  expect(m.cells.at(-1).right).toBeLessThanOrEqual(m.pane.right + 0.5);
}

for (const width of [690, 740, 884, 904, 1280]) {
  test(`${width} 두 칸: 폴더를 누른 뒤 제목 칸이 최소 폭을 갖고 머리 글자가 겹치지 않음`, async ({ page }) => {
    const s = await openFolder(page, width);
    expectColumnsOk(await measure(page));
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    expect(s.errors).toEqual([]);
  });
  test(`${width} 두 칸: 저장한 아주 넓은 태그·폴더 칸이 있어도 제목 칸이 살아 있음`, async ({ page }) => {
    const sfx = width >= 1200 ? '' : '_f';
    const s = await openFolder(page, width, { col_widths: { notes: { ['tags' + sfx]: 600, ['folder' + sfx]: 400 } } });
    const m = await measure(page);
    const title = m.cells.find(c => c.key === 'title');
    expect(title.width).toBeGreaterThanOrEqual(TITLE_MIN - 1);
    expect(m.title.width).toBeGreaterThanOrEqual(TITLE_MIN - 1);
    expect(m.cells[0].textRight).toBeLessThanOrEqual(m.cells[1].textLeft + 0.5);
    expect(s.errors).toEqual([]);
  });
}

// 손가락 줄 밀기는 760px 이하에서만 켜진다 — 폴드 펼침 두 칸(600~760px).
for (const width of [690, 740]) test(`${width} 두 칸: 노트 줄을 왼쪽으로 밀어도 줄이 목록 칸 왼쪽 경계를 넘어 폴더 나무를 덮지 않음`, async ({ page }) => {
  const s = await openFolder(page, width);
  const row = page.locator('#noteRows [data-nx-note="n5"]');
  const cell = page.locator('#noteRows [data-row-swipe-act="end"]').first();
  await expect(async () => {
    await row.evaluate(el => {
      const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      const fire = (type, cx) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: cx, clientY: y }));
      fire('pointerdown', x); for (let i = 1; i <= 12; i++) fire('pointermove', x - (r.width + 40) * i / 12); fire('pointerup', x - r.width - 40);
    });
    await expect(cell).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15000 });
  await page.waitForTimeout(300); // 칸이 열리는 움직임(.18s)이 끝난 뒤 본다
  const hit = await row.evaluate(el => {
    const r = el.getBoundingClientRect(), pane = document.querySelector('#noteRows').getBoundingClientRect(), tree = document.querySelector('[data-nx-tree]').getBoundingClientRect();
    const y = r.top + r.height / 2;
    // 밀린 줄은 화면 그리기에서 목록 칸 왼쪽 끝에서 잘린다: 목록 칸 바로 왼쪽(칸 사이)과 나무 오른쪽 안쪽 점에 줄이 보이지 않는다.
    const at = x => { const e = document.elementFromPoint(x, y); return !!e && el.contains(e); };
    return { moved: r.left < pane.left, gap: at(pane.left - 2), tree: at(tree.right - 12), treeMid: at(tree.left + tree.width / 2) };
  });
  expect(hit.moved).toBe(true); // 줄은 정말로 밀렸다(시험이 헛돌지 않음)
  expect(hit).toEqual({ moved: true, gap: false, tree: false, treeMid: false });
  // 나무의 폴더 줄은 그대로 눌린다(덮이지 않음).
  const folderRow = s.tree.locator(`[data-nx-folder="${U(1)}"]`).first();
  const fb = await folderRow.boundingBox();
  expect(await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[data-nx-tree]'), { x: fb.x + fb.width / 2, y: fb.y + fb.height / 2 })).toBe(true);
  expect(s.errors).toEqual([]);
});
