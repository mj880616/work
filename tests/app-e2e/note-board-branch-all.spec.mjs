import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';

// S71-51 B6 노트 보드 모든 칸 가지 뻗기 + 주제·도형 합치기(사용자 결정 2026-11-26 21:10~21:12 "여기서 주제는 사실 글 상자 아니야?",
// "나는 텍스트, 첨부한 사진, 심지어는 첨부한 파일 도 다 뻗을 수 있었으면 좋겠는데", "관계망 형성이 되어야해", "주제를 도형(글 상자)과 차별화 하거나/ 아니면 합쳐").
// - 도구 줄 [+ 주제] 없음, [+ 상자] 한 번에 새 상자.
// - 도형·글자·노트 카드·사진 카드에서 Tab = 하위 칸(선과 함께, 바로 글쓰기). 새 칸은 부모가 도형·글자면 같은 종류·모양, 카드면 기본 상자.
// - 상자를 노트 카드 위에 끌어 놓으면 그 카드 아래 가지(서버로는 parent_note).
// - 섞인 가지(글자 → 상자 → 도형) 접기·다시 열어도 그대로.
// - 모든 칸 가지 칸(parent_note)이 없는 서버(적용 전): 옛 주제·도형 보드는 그대로 열리고, 도형 Tab은 '준비 중' 한 줄·서버에 안 보냄.
// 폰 390·PC 1280. 이름·글은 지어낸 것.
test.use({ hasTouch: true });
test.describe.configure({ timeout: 60000 });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const BID = 'bbranch01';
const DEF = { parent_id: null, parent_note: null, ord: 0, side: null, kind: 'topic', color: null, shape: 'round', font: 2, w: null, collapsed: false, h: null, pinned: false,
  z: 0, stroke: null, stroke_w: null, dash: false, alpha: null, bold: false, align: null, ink: null };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const NOTE = '10000000-0000-4000-8000-000000000001', PHOTO = '10000000-0000-4000-8000-000000000002';
async function fixture(page, width, { old = false, seed = [], photo = false } = {}) {
  await page.setViewportSize({ width, height: width > 600 ? 1000 : 860 });
  const errors = [], textCalls = [], textRows = seed.map(t => ({ ...DEF, ...t }));
  page.on('pageerror', e => errors.push(e.message));
  await installViewPrefsServer(page, { note_boards: [{ id: BID, name: '가지 보드' }], note_board: BID });
  await openHome(page);
  const row = (id, title, board, extra = {}) => ({ id, workspace_id: 'w', kind: 'note', title, raw_text: title + '\n본문', occurred_at: '2026-10-10T01:00:00Z', created_at: '2026-10-10T01:00:00Z', updated_at: '2026-10-10T01:00:00Z', archived_at: null, ai_export_allowed: true, attachments: [], metadata: { boards: { [BID]: board } }, ...extra });
  const rows = [row(NOTE, '가 노트', { x: 60, y: 160, r: 1, z: 0 })];
  if (photo) rows.push(row(PHOTO, '칠판 사진', { x: 60, y: 420, r: 1, z: 1, w: 160, h: 120 }, { raw_text: '', attachments: [{ drive_file_id: 'pf1', mime_type: 'image/png', file_name: 'p.png', size_bytes: 3 }] }));
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
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_board_links', r => r.fulfill({ json: [] }));
  // 서버 흉내: old면 parent_note 칸을 물으면 42703(적용 전). 부모는 둘 중 하나만(서버 check와 같음).
  const asksBranch = (q, body) => /(^|,)parent_note(,|$)/.test(q.get('select') || '') || (body && 'parent_note' in body);
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_board_texts', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams, method = req.method(), body = method === 'GET' || method === 'DELETE' ? null : req.postDataJSON();
    textCalls.push({ method, query: Object.fromEntries(q), body });
    if (old && asksBranch(q, body)) return r.fulfill({ status: 400, json: { code: '42703', message: 'column app_note_board_texts.parent_note does not exist' } });
    const strip = t => (old ? Object.fromEntries(Object.entries(t).filter(([k]) => k !== 'parent_note')) : t);
    if (body && body.parent_id && body.parent_note) return r.fulfill({ status: 400, json: { code: '23514', message: 'app_note_board_texts_parent_one_check' } });
    if (method === 'GET') return r.fulfill({ json: textRows.map(t => structuredClone(strip(t))) });
    if (method === 'POST') { const saved = { ...DEF, id: `T${textCalls.length}`, ...body }; delete saved.workspace_id; textRows.push(saved); return r.fulfill({ status: 201, json: [structuredClone(strip(saved))] }); }
    if (method === 'PATCH') { const hit = textRows.find(t => 'eq.' + t.id === q.get('id')); Object.assign(hit, body); return r.fulfill({ json: [structuredClone(strip(hit))] }); }
    if (method === 'DELETE') { const id = q.get('id')?.slice(3); for (let i = textRows.length - 1; i >= 0; i--) if (textRows[i].id === id) textRows.splice(i, 1); return r.fulfill({ json: [] }); }
    return r.fulfill({ status: 500, json: {} });
  });
  await openBoard(page, rows.length);
  return { errors, textCalls, textRows, rows };
}
async function openBoard(page, cards = 1) {
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  await page.locator('.nv-switch [data-note-view="board"]').click();
  await expect(page.locator('[data-note-board] [data-nb-card]')).toHaveCount(cards);
}
const node = (page, text) => page.locator('[data-nb-texts] [data-nb-text]').filter({ has: page.locator('.nb-tx', { hasText: new RegExp(`^${text}$`) }) });
const byId = (page, id) => page.locator(`[data-nb-texts] [data-nb-text="${id}"]`);
const editor = page => page.locator('[data-nb-text-edit]');
const branches = page => page.locator('[data-nb-branches] path');
const rowBy = (rows, body) => rows.find(t => t.body === body);
async function box(l) { for (let i = 0; i < 20; i++) { const b = await l.boundingBox({ timeout: 2000 }).catch(() => null); if (b) return b; await new Promise(r => setTimeout(r, 50)); } return null; }
async function center(l) { const b = await box(l); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }
async function writeAndEnter(page, text) { await expect(editor(page)).toBeFocused(); await page.keyboard.type(text); await page.keyboard.press('Enter'); }

test('B6 PC: [+ 주제] 없음 · [+ 상자] 한 번에 새 상자 · 도형 ▾ 네모·글자에서 Tab = 같은 모양 하위 칸(가지 선) (1280)', async ({ page }) => {
  const { errors, textRows } = await fixture(page, 1280, { seed: [{ id: 'lab', board_id: BID, body: '글자 뿌리', x: 520, y: 160, kind: 'label', shape: 'plain', z: 1 }] });
  const tools = page.locator('.nb-tools');
  await expect(tools.getByRole('button', { name: '+ 주제' })).toHaveCount(0);
  await expect(page.locator('[data-nb-add-text]')).toHaveText('+ 상자');
  await expect(page.locator('[data-note-board]')).not.toContainText('주제');
  // [+ 상자] 한 번 = 바로 글쓰기 → Enter = 저장(kind topic 그대로).
  await page.locator('[data-nb-add-text]').click();
  await expect(editor(page)).toHaveAttribute('aria-label', '새 상자');
  await writeAndEnter(page, '첫 상자');
  await expect.poll(() => rowBy(textRows, '첫 상자')?.kind).toBe('topic');
  // 도형 ▾ 네모 → 고른 채 Tab = 하위 칸(네모 그대로) + 가지 선.
  await page.locator('[data-nb-insert-open="shape"]').click();
  await page.locator('[data-nb-add-shape="rect"]').click();
  await expect.poll(() => textRows.filter(t => t.kind === 'shape').length).toBe(1);
  const shape = textRows.find(t => t.kind === 'shape');
  await byId(page, shape.id).locator('.nb-tx').focus();
  await page.keyboard.press('Tab');
  await expect(editor(page)).toHaveAttribute('aria-label', '새 가지');
  await writeAndEnter(page, '네모 아래');
  await expect.poll(() => rowBy(textRows, '네모 아래')).toMatchObject({ kind: 'shape', shape: 'rect', parent_id: shape.id, parent_note: null });
  await expect(node(page, '네모 아래')).toHaveAttribute('data-kind', 'shape');
  // 글자에서 Tab = 글자 하위, Enter(고른 채) = 같은 줄 형제.
  await byId(page, 'lab').locator('.nb-tx').focus();
  await page.keyboard.press('Tab');
  await writeAndEnter(page, '글자 아래');
  await expect.poll(() => rowBy(textRows, '글자 아래')).toMatchObject({ kind: 'label', parent_id: 'lab' });
  await node(page, '글자 아래').locator('.nb-tx').focus();
  await page.keyboard.press('Enter');
  await writeAndEnter(page, '글자 형제');
  await expect.poll(() => rowBy(textRows, '글자 형제')).toMatchObject({ kind: 'label', parent_id: 'lab' });
  await expect(branches(page)).toHaveCount(3);
  // 하위 칸은 부모 오른쪽에(자동 배치).
  const p = await box(byId(page, 'lab')), c = await box(node(page, '글자 아래'));
  expect(c.x).toBeGreaterThan(p.x + p.width);
  expect(errors).toEqual([]);
});

test('B6 PC: 노트 카드·사진 카드에서 Tab = 기본 상자 하위(parent_note) · 상자를 카드 위에 끌어 놓으면 그 카드 아래 가지 · 카드를 옮기면 가지도 따라감 (1280)', async ({ page }) => {
  const { errors, textRows } = await fixture(page, 1280, { photo: true, seed: [{ id: 'free', board_id: BID, body: '떠 있는 상자', x: 360, y: 640 }] });
  // 노트 카드: 초점 + Tab.
  await page.locator(`[data-nb-card="${NOTE}"] .nb-open`).focus();
  await page.keyboard.press('Tab');
  await expect(editor(page)).toHaveAttribute('aria-label', '새 가지');
  await writeAndEnter(page, '카드 아래');
  await expect.poll(() => rowBy(textRows, '카드 아래')).toMatchObject({ kind: 'topic', parent_id: null, parent_note: NOTE });
  const card = await box(page.locator(`[data-nb-card="${NOTE}"]`)), kid = await box(node(page, '카드 아래'));
  expect(kid.x).toBeGreaterThan(card.x + card.width); // 카드 옆에 자동 배치
  await expect(branches(page)).toHaveCount(1);
  // 사진 카드: 같은 길.
  await page.locator(`[data-nb-card="${PHOTO}"] .nb-open`).focus();
  await page.keyboard.press('Tab');
  await writeAndEnter(page, '사진 설명');
  await expect.poll(() => rowBy(textRows, '사진 설명')).toMatchObject({ kind: 'topic', parent_note: PHOTO });
  await expect(branches(page)).toHaveCount(2);
  // 떠 있는 상자를 노트 카드 위에 끌어 놓기 = 그 카드 아래 가지. S71-52 ②: 상자가 오른쪽 아래 미니맵 밑에 있으므로 판을 조금 올린 뒤 잡는다.
  await page.mouse.move(640, 500); await page.mouse.wheel(0, 200);
  const from = await center(node(page, '떠 있는 상자')), to = await center(page.locator(`[data-nb-card="${NOTE}"]`));
  await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 12 }); await page.mouse.up();
  await expect.poll(() => textRows.find(t => t.id === 'free')).toMatchObject({ parent_id: null, parent_note: NOTE });
  await expect(branches(page)).toHaveCount(3);
  // 카드를 옮기면 그 아래 가지도 따라간다.
  const before = await box(node(page, '카드 아래')), c0 = await center(page.locator(`[data-nb-card="${NOTE}"] .nb-title`));
  await page.mouse.move(c0.x, c0.y); await page.mouse.down(); await page.mouse.move(c0.x, c0.y + 120, { steps: 10 }); await page.mouse.up();
  await expect.poll(async () => (await box(node(page, '카드 아래'))).y).toBeGreaterThan(before.y + 80);
  expect(errors).toEqual([]);
});

test('B6 PC: 섞인 가지(글자 → 상자 → 도형) 접기·다시 열어도 그대로·펴기 (1280)', async ({ page }) => {
  const seed = [{ id: 'L', board_id: BID, body: '글자 위', x: 520, y: 200, kind: 'label', shape: 'plain', z: 1 },
    { id: 'A', board_id: BID, body: '가운데 상자', x: 0, y: 0, parent_id: 'L', ord: 0, side: 1 },
    { id: 'S', board_id: BID, body: '맨 아래 도형', x: 0, y: 0, parent_id: 'A', ord: 0, kind: 'shape', shape: 'ellipse', w: 120, h: 60, z: 2 }];
  const { errors, textRows } = await fixture(page, 1280, { seed });
  await expect(node(page, '맨 아래 도형')).toBeVisible();
  await expect(branches(page)).toHaveCount(2);
  await byId(page, 'A').locator('[data-nb-fold]').click();
  await expect(node(page, '맨 아래 도형')).toHaveCount(0);
  await expect.poll(() => textRows.find(t => t.id === 'A').collapsed).toBe(true);
  await page.reload();
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, { timeout: 20000 });
  await page.waitForFunction(() => window.KPTURouter?.go);
  await openBoard(page);
  await expect(node(page, '가운데 상자')).toBeVisible();
  await expect(node(page, '맨 아래 도형')).toHaveCount(0);
  await expect(byId(page, 'A').locator('[data-nb-fold]')).toHaveAttribute('aria-expanded', 'false');
  await byId(page, 'A').locator('[data-nb-fold]').click();
  await expect(node(page, '맨 아래 도형')).toBeVisible();
  expect(errors).toEqual([]);
});

test('B6 폰: 도형을 누르면 막대 [+ 하위] · 사진 카드 아래 가지가 보임 · 가로 넘침 없음 (390)', async ({ page }) => {
  const seed = [{ id: 'sh', board_id: BID, body: '', x: 220, y: 200, kind: 'shape', shape: 'diamond', w: 110, h: 70, z: 1 },
    { id: 'pk', board_id: BID, body: '사진 메모', x: 0, y: 0, parent_note: PHOTO, ord: 0, side: 1 }];
  const { errors, textRows } = await fixture(page, 390, { seed, photo: true });
  await expect(node(page, '사진 메모')).toBeVisible();
  await expect(branches(page)).toHaveCount(1);
  await byId(page, 'sh').tap();
  const child = page.locator('[data-nb-bar] [data-nb-bar-child]');
  await expect(child).toBeVisible();
  await child.tap();
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type('마름모 아래'); await page.keyboard.press('Enter');
  await expect.poll(() => rowBy(textRows, '마름모 아래')).toMatchObject({ kind: 'shape', shape: 'diamond', parent_id: 'sh' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('B6 적용 전 서버(parent_note 칸 없음): 옛 주제·도형 보드는 그대로 열리고, 도형·카드 Tab은 준비 중 한 줄·서버에 안 보냄, 상자 가지는 그대로 (1280)', async ({ page }) => {
  const seed = [{ id: 'old', board_id: BID, body: '옛 주제', x: 520, y: 160, font: 3 },
    { id: 'og', board_id: BID, body: '옛 가지', x: 0, y: 0, parent_id: 'old', ord: 0, side: 1 },
    { id: 'osh', board_id: BID, body: '옛 도형', x: 520, y: 420, kind: 'shape', shape: 'rect', w: 120, h: 80 }];
  const { errors, textCalls, textRows } = await fixture(page, 1280, { old: true, seed });
  await expect(node(page, '옛 주제')).toBeVisible();
  await expect(node(page, '옛 가지')).toBeVisible();
  await expect(node(page, '옛 도형')).toBeVisible();
  await expect(byId(page, 'old').locator('.nb-tx')).toHaveAttribute('aria-roledescription', '상자'); // 옛 주제는 상자로
  const posts = () => textCalls.filter(c => c.method === 'POST').length;
  await byId(page, 'osh').locator('.nb-tx').focus();
  await page.keyboard.press('Tab');
  await expect(page.getByText('카드·글자·도형에서 가지 뻗기는 아직 서버에 저장할 수 없어요(준비 중).').first()).toBeVisible();
  await expect(editor(page)).toHaveCount(0);
  // 상자 가지는 그대로 된다(parent_note 칸 없이 보냄).
  await byId(page, 'old').locator('.nb-tx').focus();
  await page.keyboard.press('Tab');
  await writeAndEnter(page, '새 가지 글');
  await expect.poll(() => rowBy(textRows, '새 가지 글')?.parent_id).toBe('old');
  expect(textCalls.filter(c => c.method === 'POST').every(c => !('parent_note' in c.body))).toBe(true);
  expect(posts()).toBe(1);
  expect(errors).toEqual([]);
});
