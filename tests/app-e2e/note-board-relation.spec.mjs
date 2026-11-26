import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';

// S71-53 B7 노트 보드 관계선(사용자 결정 2026-11-26 19:58 "굉장히 광범위한 생각지도 … 서로의 관계성을 잇고",
// 21:10~21:11 "텍스트, 첨부한 사진, 심지어는 첨부한 파일 도 다 뻗을 수 있었으면 / 표도 넣을 수 있고 모든 것에서 / 관계망 형성이 되어야해").
// - 만들기: PC 연결점 Alt+끌기(사진 카드 → 글자), 우클릭 [관계 잇기] → 다른 칸 누르기(도형 → 파일 카드), 폰 막대 [더 보기] [관계 잇기] → 누르기·[찾기].
// - 관계선 = 연결선 표 kind 'relation'(점선·곡선·방향 없음), 가지 나무에 끼지 않음. 이름(두 번 누르기 · 자주 쓴 이름 고르기), 관계 목록 → 상대 칸으로 이동·강조,
//   멀리 보기(0.5배 미만) 흐림 · 고른 칸 관계선만 진함, 접힌 가지 끝으로 모임, 칸 지우기 = 관계선도 · [되돌리기] = 함께, 다시 열어도 그대로.
// - 관계선 칸(kind)이 없는 서버(적용 전): [관계 잇기] 없음 · Alt 끌기는 '준비 중' 한 줄 · 서버에 안 보냄(일반 선으로 저장하지 않음).
// PC 1280·폰 390. 이름·글은 지어낸 것.
test.describe.configure({ timeout: 60000 });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const BID = 'brel0001';
const DEF = { parent_id: null, parent_note: null, ord: 0, side: null, kind: 'topic', color: null, shape: 'round', font: 2, w: null, collapsed: false, h: null, pinned: false,
  z: 0, stroke: null, stroke_w: null, dash: false, alpha: null, bold: false, align: null, ink: null };
const LDEF = { from_note: null, to_note: null, from_text: null, to_text: null, from_side: null, to_side: null, shape: 'line', dash: 'solid', ends: 'end', label: null, bend_x: null, bend_y: null,
  from_x: null, from_y: null, to_x: null, to_y: null, color: null, width: null, kind: 'line' };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const NOTE = '20000000-0000-4000-8000-000000000001', PHOTO = '20000000-0000-4000-8000-000000000002', FILE = '20000000-0000-4000-8000-000000000003';
const BASE_SEED = [
  { id: 'lab', board_id: BID, body: '글자 칸', x: 620, y: 160, kind: 'label', shape: 'plain', z: 1 },
  { id: 'sh', board_id: BID, body: '도형 칸', x: 620, y: 420, kind: 'shape', shape: 'rect', w: 120, h: 60, z: 2 },
];
async function fixture(page, width, { old = false, seed = BASE_SEED, links = [], compact = false } = {}) {
  clockAt = Date.parse('2026-10-06T01:00:00Z');
  await page.setViewportSize({ width, height: width > 600 ? 1000 : 860 });
  const errors = [], linkCalls = [], textRows = seed.map(t => ({ ...DEF, ...t })), linkRows = links.map(l => ({ ...LDEF, ...l }));
  page.on('pageerror', e => errors.push(e.message));
  await installViewPrefsServer(page, { note_boards: [{ id: BID, name: '관계 보드' }], note_board: BID });
  await openHome(page);
  const row = (id, title, board, extra = {}) => ({ id, workspace_id: 'w', kind: 'note', title, raw_text: title + '\n본문', occurred_at: '2026-10-10T01:00:00Z', created_at: '2026-10-10T01:00:00Z', updated_at: '2026-10-10T01:00:00Z', archived_at: null, ai_export_allowed: true, attachments: [], metadata: { boards: { [BID]: board } }, ...extra });
  const at = compact ? [{ x: 20, y: 120 }, { x: 20, y: 300, w: 120, h: 90 }, { x: 200, y: 480 }] : [{ x: 60, y: 160 }, { x: 60, y: 420, w: 160, h: 120 }, { x: 300, y: 640 }];
  const rows = [row(NOTE, '가 노트', { ...at[0], r: 1, z: 0 }),
    row(PHOTO, '칠판 사진', { ...at[1], r: 1, z: 1 }, { raw_text: '', attachments: [{ drive_file_id: 'pf1', mime_type: 'image/png', file_name: 'p.png', size_bytes: 3 }] }),
    row(FILE, '회의 자료 파일', { ...at[2], r: 1, z: 2 }, { attachments: [{ drive_file_id: 'df1', mime_type: 'application/pdf', file_name: 'a.pdf', size_bytes: 30 }] })];
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams;
    const pick = x => (!q.get('kind') || 'eq.' + x.kind === q.get('kind')) && (!q.get('id') || 'eq.' + x.id === q.get('id'));
    if (req.method() === 'GET') return r.fulfill({ json: rows.filter(pick).slice(Number(q.get('offset') || 0)).map(x => structuredClone(x)) });
    if (req.method() === 'PATCH') { const body = req.postDataJSON(); const hit = rows.filter(pick); hit.forEach(x => Object.assign(x, structuredClone(body))); return r.fulfill({ json: hit.map(x => structuredClone(x)) }); }
    return r.fulfill({ status: 500, json: {} });
  });
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_folders', r => r.fulfill({ json: [] }));
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  await page.route(u => u.origin === SB && u.pathname === '/functions/v1/basket-files', r => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, body: '' });
    return r.fulfill({ status: 200, contentType: 'image/png', body: PNG });
  });
  let seq = 0;
  // 서버 흉내: old면 kind 칸을 물으면 42703(적용 전). 같은 보드·같은 방향 두 끝은 한 줄(unique).
  const asksKind = (q, body) => /(^|,)kind(,|$)/.test(q.get('select') || '') || (body && 'kind' in body);
  const strip = l => (old ? Object.fromEntries(Object.entries(l).filter(([k]) => k !== 'kind')) : l);
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_board_links', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams, method = req.method(), body = method === 'GET' || method === 'DELETE' ? null : req.postDataJSON();
    linkCalls.push({ method, query: Object.fromEntries(q), body });
    if (old && asksKind(q, body)) return r.fulfill({ status: 400, json: { code: '42703', message: 'column app_note_board_links.kind does not exist' } });
    if (method === 'GET') return r.fulfill({ json: linkRows.map(l => structuredClone(strip(l))) });
    if (method === 'POST') { const saved = { ...LDEF, id: `L${++seq}`, ...body }; delete saved.workspace_id; linkRows.push(saved); return r.fulfill({ status: 201, json: [structuredClone(strip(saved))] }); }
    if (method === 'PATCH') { const hit = linkRows.find(l => 'eq.' + l.id === q.get('id')); Object.assign(hit, body); return r.fulfill({ json: [structuredClone(strip(hit))] }); }
    if (method === 'DELETE') { const id = q.get('id')?.slice(3); for (let i = linkRows.length - 1; i >= 0; i--) if (linkRows[i].id === id) linkRows.splice(i, 1); return r.fulfill({ json: [] }); }
    return r.fulfill({ status: 500, json: {} });
  });
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_board_texts', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams, method = req.method(), body = method === 'GET' || method === 'DELETE' ? null : req.postDataJSON();
    if (method === 'GET') return r.fulfill({ json: textRows.map(t => structuredClone(t)) });
    if (method === 'POST') { const saved = { ...DEF, id: `T${++seq}`, ...body }; delete saved.workspace_id; textRows.push(saved); return r.fulfill({ status: 201, json: [structuredClone(saved)] }); }
    if (method === 'PATCH') { const hit = textRows.find(t => 'eq.' + t.id === q.get('id')); Object.assign(hit, body); return r.fulfill({ json: [structuredClone(hit)] }); }
    if (method === 'DELETE') { // 서버 cascade와 같게: 아래 가지·붙은 선(관계선 포함)도 지운다
      const gone = new Set([q.get('id')?.slice(3)]);
      let grew = true; while (grew) { grew = false; for (const t of textRows) if (t.parent_id && gone.has(t.parent_id) && !gone.has(t.id)) { gone.add(t.id); grew = true; } }
      for (let i = textRows.length - 1; i >= 0; i--) if (gone.has(textRows[i].id)) textRows.splice(i, 1);
      for (let i = linkRows.length - 1; i >= 0; i--) if (gone.has(linkRows[i].from_text) || gone.has(linkRows[i].to_text)) linkRows.splice(i, 1);
      return r.fulfill({ json: [] });
    }
    return r.fulfill({ status: 500, json: {} });
  });
  await openBoard(page);
  return { errors, linkCalls, linkRows, textRows, rows };
}
async function openBoard(page) {
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  await page.locator('.nv-switch [data-note-view="board"]').click();
  await expect(page.locator('[data-note-board] [data-nb-card]')).toHaveCount(3);
}
const card = (page, id) => page.locator(`[data-note-board] [data-nb-card="${id}"]`);
const cell = (page, id) => page.locator(`[data-nb-texts] [data-nb-text="${id}"]`);
const relLines = page => page.locator('[data-nb-lines] g.nb-rel');
const menu = page => page.locator('#rowMenu');
const item = (page, name) => menu(page).locator('button').filter({ hasText: new RegExp(`^${name.replace(/[+]/g, '\\+')}$`) }).first();
const posts = calls => calls.filter(c => c.method === 'POST');
async function box(l) { for (let i = 0; i < 20; i++) { const b = await l.boundingBox({ timeout: 2000 }).catch(() => null); if (b) return b; await new Promise(r => setTimeout(r, 50)); } return null; }
async function center(l) { const b = await box(l); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }
// 선 위 한 점(화면 좌표): t = 0(시작)~1(끝).
const pointOn = (page, id, t) => page.locator(`[data-nb-line="${id}"] .nb-hit`).evaluate((p, t) => { const L = p.getTotalLength(), pt = p.getPointAtLength(L * t), m = p.getScreenCTM(); return { x: m.a * pt.x + m.c * pt.y + m.e, y: m.b * pt.x + m.d * pt.y + m.f }; }, t);
// PC: 칸에 마우스를 올려 연결점(오른쪽 동그라미)을 보이고, Alt를 누른 채 끌어 다른 칸에 놓는다.
async function altDrag(page, from, to) {
  const c = await center(from); await page.mouse.move(c.x, c.y);
  const h = from.locator('[data-nb-handle="right"]'); await expect(h).toBeVisible();
  const s = await center(h), e = await center(to);
  await page.keyboard.down('Alt');
  await page.mouse.move(s.x, s.y); await page.mouse.down(); await page.mouse.move(e.x, e.y, { steps: 12 }); await page.mouse.up();
  await page.keyboard.up('Alt');
}
// openHome이 시계를 멈춰 두므로(setFixedTime) '끌기 바로 뒤 0.4초'·'두 번 누르기 0.45초' 판정을 넘기려면 시계를 앞으로 옮긴다.
let clockAt = Date.parse('2026-10-06T01:00:00Z');
async function later(page, ms = 600) { clockAt += ms; await page.clock.setFixedTime(new Date(clockAt)); }
const inView = l => l.evaluate(el => { const r = el.getBoundingClientRect(), s = el.closest('[data-nb-scroll]').getBoundingClientRect(); return r.width > 0 && r.left >= s.left - 1 && r.right <= s.right + 1 && r.top >= s.top - 1 && r.bottom <= s.bottom + 1; });

test('B7 PC: 사진 카드 → 글자 Alt 끌기 · 도형 우클릭 [관계 잇기] → 파일 카드 = 관계선(점선·곡선·방향 없음, 가지 아님) · 다시 열어도 그대로 (1280)', async ({ page, browser }) => {
  const { errors, linkCalls, linkRows, textRows } = await fixture(page, 1280);
  await altDrag(page, card(page, PHOTO), cell(page, 'lab'));
  await expect.poll(() => posts(linkCalls).length).toBe(1);
  await later(page); // 선 긋기 바로 뒤 우클릭은 끌기 끝으로 본다(지금 규칙) — 시험 시계는 멈춰 있으므로 0.5초 앞으로
  expect(posts(linkCalls)[0].body).toMatchObject({ board_id: BID, from_note: PHOTO, to_text: 'lab', kind: 'relation', dash: 'dashed', shape: 'curve', ends: 'none' });
  await expect(relLines(page)).toHaveCount(1);
  // 가지가 아니다: 상자 표의 부모 칸은 그대로.
  expect(textRows.find(t => t.id === 'lab')).toMatchObject({ parent_id: null, parent_note: null });
  await expect(page.locator('[data-nb-branches] path')).toHaveCount(0);
  // 도형 우클릭 [관계 잇기] → 파일 카드 누르기(카드가 열리지 않는다).
  const s = await center(cell(page, 'sh'));
  await page.mouse.click(s.x, s.y, { button: 'right' });
  await item(page, '관계 잇기').click();
  await expect(page.locator('[data-nb-relbar]')).toBeVisible();
  await expect(page.locator('[data-nb-relbar]')).toContainText('이을 칸을 누르세요');
  await card(page, FILE).locator('.nb-open').click();
  await expect.poll(() => posts(linkCalls).length).toBe(2);
  expect(posts(linkCalls)[1].body).toMatchObject({ from_text: 'sh', to_note: FILE, kind: 'relation' });
  await expect(page.locator('[data-nb-relbar]')).toBeHidden();
  await expect(page.locator('[data-note-board] [data-nb-card]')).toHaveCount(3); // 노트 화면으로 가지 않음
  await later(page); // 선 긋기 바로 뒤 우클릭은 끌기 끝으로 본다(지금 규칙) — 시험 시계는 멈춰 있으므로 0.5초 앞으로
  await expect(relLines(page)).toHaveCount(2);
  // 이미 이어진 두 칸(반대 방향 포함)은 한 줄.
  await page.mouse.click(s.x, s.y, { button: 'right' }); await item(page, '관계 잇기').click();
  await card(page, FILE).locator('.nb-open').click();
  await expect(page.getByText('이미 이어져 있어요.')).toBeVisible();
  expect(posts(linkCalls)).toHaveLength(2);
  // 다시 열어도(새로 읽어도) 관계선 그대로.
  expect(linkRows.filter(l => l.kind === 'relation')).toHaveLength(2);
  // 새로 연 화면(같은 서버 줄을 처음부터 읽음).
  const ctx = await browser.newContext({ hasTouch: false }), again = await ctx.newPage();
  const second = await fixture(again, 1280, { links: linkRows.map(l => structuredClone(l)) });
  await expect(relLines(again)).toHaveCount(2);
  await expect(again.locator('[data-nb-lines] g.nb-rel .nb-line').first()).toHaveCSS('stroke-dasharray', /6(px)?,? 5/);
  expect(second.errors).toEqual([]);
  await ctx.close();
  expect(errors).toEqual([]);
});

test('B7 PC: 관계선 두 번 누르기 = 이름(처음엔 직접 쓰기, 다음엔 자주 쓴 이름 고르기) · 선 메뉴 방향 [→] (1280)', async ({ page }) => {
  const links = [{ id: 'R1', board_id: BID, from_note: NOTE, to_text: 'lab', kind: 'relation', shape: 'curve', dash: 'dashed', ends: 'none' },
    { id: 'R2', board_id: BID, from_note: PHOTO, to_text: 'sh', kind: 'relation', shape: 'curve', dash: 'dashed', ends: 'none' }];
  const { errors, linkCalls, linkRows } = await fixture(page, 1280, { links });
  await expect(relLines(page)).toHaveCount(2);
  let p = await pointOn(page, 'R1', 0.5);
  await page.mouse.dblclick(p.x, p.y);
  const ask = page.locator('.kptu-ask input');
  await expect(ask).toBeVisible();
  await ask.fill('원인'); await ask.press('Enter');
  await expect.poll(() => linkRows.find(l => l.id === 'R1').label).toBe('원인');
  await expect(page.locator('[data-nb-line="R1"] .nb-label')).toHaveText('원인');
  p = await pointOn(page, 'R2', 0.5);
  await page.mouse.dblclick(p.x, p.y);
  await expect(menu(page)).toBeVisible();
  await expect(item(page, '직접 쓰기')).toBeVisible();
  await item(page, '원인').click();
  await expect.poll(() => linkRows.find(l => l.id === 'R2').label).toBe('원인');
  // 한 번 누르기 = 관계선 메뉴(방향·이름·가기·삭제).
  p = await pointOn(page, 'R2', 0.5);
  await page.mouse.click(p.x, p.y);
  const lm = page.locator('.nb-link-menu');
  await expect(lm).toBeVisible(); await expect(lm).toHaveAttribute('aria-label', '관계선');
  await lm.getByRole('button', { name: '방향 한쪽' }).click();
  await expect.poll(() => linkRows.find(l => l.id === 'R2').ends).toBe('end');
  await expect(lm.getByRole('button', { name: /이름: 원인/ })).toBeVisible();
  expect(linkCalls.filter(c => c.method === 'PATCH').every(c => !('kind' in c.body))).toBe(true);
  expect(errors).toEqual([]);
});

test('B7 PC: 카드 ⋯ [관계 n개] 목록에서 고르면 멀리 있는 상대 칸으로 이동·강조 · 끝 근처 누르기도 · 멀리 보기 흐림, 고르면 진함 (1280)', async ({ page }) => {
  const seed = [...BASE_SEED, { id: 'far', board_id: BID, body: '아주 먼 생각', x: 9000, y: 6000, z: 3 }];
  const links = [{ id: 'R1', board_id: BID, from_note: NOTE, to_text: 'far', kind: 'relation', shape: 'curve', dash: 'dashed', ends: 'none', label: '같은 사람' },
    { id: 'R2', board_id: BID, from_text: 'sh', to_note: FILE, kind: 'relation', shape: 'curve', dash: 'dashed', ends: 'none' }];
  const { errors } = await fixture(page, 1280, { seed, links });
  await page.locator('[data-nb-fit]').click();
  const c = await center(card(page, NOTE));
  await page.mouse.click(c.x, c.y, { button: 'right' });
  await expect(page.locator('#noteDocMenu')).toBeVisible();
  await page.locator('#noteDocMenu [data-nbb-relations]').click();
  await expect(menu(page)).toBeVisible();
  await menu(page).locator('button').filter({ hasText: '아주 먼 생각' }).click();
  await expect(cell(page, 'far')).toBeVisible();
  await expect.poll(() => inView(cell(page, 'far'))).toBe(true);
  await expect(cell(page, 'far')).toHaveClass(/nb-sel/);
  await expect(cell(page, 'far').locator('.nb-tx')).toBeFocused();
  // 끝 근처 누르기: 이 칸 쪽 끝을 누르면 반대쪽(노트 카드)으로.
  await later(page);
  const p = await pointOn(page, 'R1', 0.97);
  await page.mouse.click(p.x, p.y);
  await expect.poll(() => inView(card(page, NOTE))).toBe(true);
  await expect(card(page, NOTE)).toHaveClass(/nb-sel/);
  // 멀리 보기(0.5배 미만): 관계선은 흐리게, 고른 칸에 붙은 관계선만 진하게.
  const nb = page.locator('[data-note-board]');
  for (let i = 0; i < 8 && !(await nb.getAttribute('data-nb-small').then(v => v !== null)); i++) await page.locator('[data-nb-zoom="-1"]').click();
  await expect(nb).toHaveAttribute('data-nb-small', '');
  await page.mouse.click(5, 5); // 고르기 풀기(판 밖)
  await page.keyboard.press('Escape');
  const opacity = id => page.locator(`[data-nb-line="${id}"]`).evaluate(el => Number(getComputedStyle(el).opacity));
  await page.locator('[data-nb-scroll]').evaluate(() => {}); // 판 그대로
  const blank = await page.locator('[data-nb-scroll]').boundingBox();
  await page.mouse.click(blank.x + blank.width - 30, blank.y + blank.height - 30);
  await expect.poll(() => opacity('R2')).toBeLessThan(0.5);
  await cell(page, 'sh').locator('.nb-tx').focus();
  await expect.poll(() => opacity('R2')).toBe(1);
  await expect(page.locator('[data-nb-line="R2"]')).toHaveClass(/nb-rel-on/);
  expect(errors).toEqual([]);
});

test('B7 PC: 접힌 가지 안 칸의 관계선은 접힌 칸 끝으로 모임 · 칸 지우기 = 관계선도 · [되돌리기] = 함께 돌아옴(관계선 그대로) (1280)', async ({ page }) => {
  const seed = [...BASE_SEED, { id: 'r', board_id: BID, body: '뿌리', x: 900, y: 200, z: 4 },
    { id: 'm', board_id: BID, body: '가운데', parent_id: 'r', ord: 0, side: 1 }, { id: 'k', board_id: BID, body: '안쪽 칸', parent_id: 'm', ord: 0, side: 1 }];
  const links = [{ id: 'R1', board_id: BID, from_note: NOTE, to_text: 'k', kind: 'relation', shape: 'curve', dash: 'dashed', ends: 'none' },
    { id: 'R2', board_id: BID, from_note: PHOTO, to_text: 'lab', kind: 'relation', shape: 'curve', dash: 'dashed', ends: 'none' }];
  const { errors, linkCalls, linkRows, textRows } = await fixture(page, 1280, { seed, links });
  await expect(relLines(page)).toHaveCount(2);
  await expect(page.locator('[data-nb-line="R1"]')).not.toHaveClass(/nb-rel-gather/);
  await cell(page, 'm').locator('[data-nb-fold]').click({ force: true });
  await expect.poll(() => textRows.find(t => t.id === 'm').collapsed).toBe(true);
  await expect(cell(page, 'k')).toHaveCount(0);
  await expect(page.locator('[data-nb-line="R1"]')).toHaveClass(/nb-rel-gather/);
  // 모인 끝 = 접힌 칸('가운데') 근처.
  const end = await pointOn(page, 'R1', 1), mb = await box(cell(page, 'm'));
  expect(end.x).toBeGreaterThan(mb.x - 30); expect(end.x).toBeLessThan(mb.x + mb.width + 30);
  expect(end.y).toBeGreaterThan(mb.y - 30); expect(end.y).toBeLessThan(mb.y + mb.height + 30);
  // 글자 칸 지우기 → 그 관계선도 지워짐 → [되돌리기] → 칸과 관계선이 함께(관계선 그대로).
  await cell(page, 'lab').locator('.nb-tx').click();
  await page.keyboard.press('Delete');
  await expect(cell(page, 'lab')).toHaveCount(0);
  await expect(page.locator('[data-nb-line="R2"]')).toHaveCount(0);
  await expect.poll(() => linkRows.some(l => l.id === 'R2')).toBe(false);
  await page.getByRole('button', { name: '되돌리기' }).click();
  await expect(page.locator('[data-nb-texts] [data-nb-text]').filter({ hasText: '글자 칸' })).toHaveCount(1);
  await expect.poll(() => posts(linkCalls).at(-1)?.body).toMatchObject({ from_note: PHOTO, kind: 'relation', dash: 'dashed' });
  await expect(relLines(page)).toHaveCount(2);
  expect(errors).toEqual([]);
});

test.describe('폰', () => {
test.use({ hasTouch: true });
test('B7 폰: 도형 막대 [더 보기] [관계 잇기] → 사진 카드 누르기 · 글자 막대 [관계 잇기] → [찾기]로 파일 카드 고르기 · [관계 1개] → 그 칸으로 · 가로 넘침 없음 (390)', async ({ page }) => {
  const seed = [{ id: 'lab', board_id: BID, body: '글자 칸', x: 220, y: 120, kind: 'label', shape: 'plain', z: 1 },
    { id: 'sh', board_id: BID, body: '도형 칸', x: 220, y: 300, kind: 'shape', shape: 'rect', w: 100, h: 50, z: 2 }];
  const { errors, linkCalls } = await fixture(page, 390, { seed, compact: true });
  await cell(page, 'sh').tap();
  await page.locator('[data-nb-bar] [data-nb-bar-open="more"]').tap();
  await page.locator('[data-nb-bar] [data-nb-relate]').tap();
  await expect(page.locator('[data-nb-relbar]')).toBeVisible();
  await card(page, PHOTO).locator('.nb-open').tap();
  await expect.poll(() => posts(linkCalls).length).toBe(1);
  expect(posts(linkCalls)[0].body).toMatchObject({ from_text: 'sh', to_note: PHOTO, kind: 'relation' });
  await expect(page.locator('[data-nb-relbar]')).toBeHidden();
  await expect(page.locator('.photo-view, [data-photo-view]')).toHaveCount(0); // 사진 크게 보기로 가지 않음
  await later(page);
  await cell(page, 'lab').tap();
  await page.locator('[data-nb-bar] [data-nb-bar-open="more"]').tap();
  await page.locator('[data-nb-bar] [data-nb-relate]').tap();
  await page.locator('[data-nb-relbar] [data-nb-rel-find]').tap();
  const ask = page.locator('.kptu-ask input');
  await expect(ask).toBeVisible();
  await ask.fill('자료'); await ask.press('Enter');
  await expect(menu(page)).toBeVisible();
  await item(page, '회의 자료 파일').tap();
  await expect.poll(() => posts(linkCalls).length).toBe(2);
  expect(posts(linkCalls)[1].body).toMatchObject({ from_text: 'lab', to_note: FILE, kind: 'relation' });
  // 관계 목록: 막대 [관계 1개] → 상대 칸으로(고르기·강조).
  await later(page);
  await cell(page, 'lab').tap();
  await page.locator('[data-nb-bar] [data-nb-bar-open="more"]').tap();
  const rels = page.locator('[data-nb-bar] [data-nb-relations]');
  await expect(rels).toHaveText('관계 1개');
  await rels.tap();
  await item(page, '— 회의 자료 파일').tap();
  await expect(card(page, FILE)).toHaveClass(/nb-sel/);
  await expect.poll(() => inView(card(page, FILE))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(errors).toEqual([]);
});
});

test('B7 적용 전 서버(kind 칸 없음): 선은 그대로 보이고, [관계 잇기] 없음 · Alt 끌기는 준비 중 한 줄 · 서버에 안 보냄 (1280)', async ({ page }) => {
  const links = [{ id: 'O1', board_id: BID, from_note: NOTE, to_text: 'lab' }];
  const { errors, linkCalls } = await fixture(page, 1280, { old: true, links });
  await expect(page.locator('[data-nb-lines] g')).toHaveCount(1);
  await expect(relLines(page)).toHaveCount(0);
  const s = await center(cell(page, 'sh'));
  await page.mouse.click(s.x, s.y, { button: 'right' });
  await expect(menu(page)).toBeVisible();
  await expect(item(page, '관계 잇기')).toHaveCount(0);
  await page.keyboard.press('Escape');
  const before = linkCalls.filter(c => c.method !== 'GET').length;
  await altDrag(page, card(page, PHOTO), cell(page, 'sh'));
  await expect(page.getByText('관계선은 아직 서버에 저장할 수 없어요(준비 중).')).toBeVisible();
  expect(linkCalls.filter(c => c.method !== 'GET').length).toBe(before);
  expect(errors).toEqual([]);
});
