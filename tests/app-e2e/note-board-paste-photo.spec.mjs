import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';

// S71-49 NOTE-보드사진·붙여넣기(사용자 결정 2026-11-26):
// [가] PC: 보드 빈 곳을 왼쪽 클릭한 뒤 Ctrl+V → 사진은 누른 자리에 사진 카드, 글자는 누른 자리에 배경 없는 글자 칸(줄바꿈 그대로, 300자까지).
//      누른 자리가 없으면 보이는 판 가운데. 글 쓰는 칸 편집 중이면 그 칸 몫(보드에 넣지 않음). 알림 [되돌리기] 한 번에 빠짐. 폰 손가락은 사진만(그대로).
// [나] 사진 카드 한 번 누름 = 고르기(노트 화면으로 안 감), PC 두 번 누름·폰 고른 사진 한 번 더 누름 = 보드 위 크게 보기, Esc·×로 닫으면 보드 그대로.
// [다] 보드 사진을 올릴 때 화면은 place=board만 보낸다(폴더 id 없음 — 폴더는 서버가 찾는다, 서버 쪽은 tests/security/basket-files-board-photo.test.mjs).
// 붙여넣기는 paste 이벤트 흉내. 이름·글은 지어낸 것.
test.use({ hasTouch: true });
test.describe.configure({ timeout: 60000 });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const BID = 'bpaste01';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const TDEF = { parent_id: null, ord: 0, side: null, kind: 'topic', color: null, shape: 'round', font: 2, w: null, collapsed: false, h: null, pinned: false,
  z: 0, stroke: null, stroke_w: null, dash: false, alpha: null, bold: false, align: null, ink: null };
const PHOTO_NOTE = '30000000-0000-4000-8000-000000000011';
const photoSeed = [{ id: PHOTO_NOTE, title: '칠판 사진', raw_text: '', attachments: [{ drive_file_id: 'pfseed1', mime_type: 'image/png', file_name: 'p.png', size_bytes: 3 }],
  metadata: { boards: { [BID]: { x: 420, y: 160, r: 0, z: 1, w: 200, h: 150 } } } }];

async function fixture(page, width, { seed = [] } = {}) {
  await page.setViewportSize({ width, height: 860 });
  const errors = [], uploads = [], photoGets = [], created = [], deleted = [], textCalls = [], textRows = [];
  page.on('pageerror', e => errors.push(e.message));
  await installViewPrefsServer(page, { note_boards: [{ id: BID, name: '붙여넣기 보드' }], note_board: BID });
  await openHome(page);
  const row = (id, title, extra = {}) => ({ id, workspace_id: 'w', kind: 'note', title, raw_text: title + '\n본문', occurred_at: '2026-10-10T01:00:00Z', created_at: '2026-10-10T01:00:00Z', updated_at: '2026-10-10T01:00:00Z', archived_at: null, ai_export_allowed: true, attachments: [], metadata: { boards: { [BID]: { x: 40, y: 600, r: 1, z: 0 } } }, ...extra });
  const rows = [row('n1', '가 노트'), ...seed.map(s => row(s.id, s.title, s))];
  // 서버 흉내: 남의 작업공간 노트(other) — RLS 때문에 내 목록에는 오지 않지만, 사진 보기 요청이 와도 404.
  const others = [{ id: '30000000-0000-4000-8000-000000000003', workspace_id: 'other', attachments: [{ drive_file_id: 'ox1', mime_type: 'image/png', file_name: 'o.png', size_bytes: 3 }] }];
  let n = 0;
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams;
    const pick = x => (!q.get('kind') || 'eq.' + x.kind === q.get('kind')) && (!q.get('id') || 'eq.' + x.id === q.get('id'));
    if (req.method() === 'GET') return r.fulfill({ json: rows.filter(pick).slice(Number(q.get('offset') || 0)).map(x => structuredClone(x)) });
    if (req.method() === 'PATCH') { const body = req.postDataJSON(); const hit = rows.filter(pick); hit.forEach(x => Object.assign(x, structuredClone(body))); return r.fulfill({ json: hit.map(x => structuredClone(x)) }); }
    if (req.method() === 'POST') {
      const body = req.postDataJSON(); created.push(body);
      const saved = { ...row(`40000000-0000-4000-8000-00000000000${++n}`, body.title), raw_text: body.raw_text, metadata: body.metadata || {} };
      rows.push(saved); return r.fulfill({ status: 201, json: [structuredClone(saved)] });
    }
    if (req.method() === 'DELETE') { deleted.push(q.get('id')); return r.fulfill({ json: [] }); }
    return r.fulfill({ status: 500, json: {} });
  });
  await page.route(u => u.origin === SB && u.pathname === '/functions/v1/basket-files', async r => {
    const req = r.request(), u = new URL(req.url());
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, body: '' });
    if (req.method() === 'GET' && u.searchParams.get('action') === 'photo') {
      const nid = u.searchParams.get('note_id'), fid = u.searchParams.get('file_id'); photoGets.push(`${nid}:${fid}`);
      // owner RLS 흉내: 내 작업공간(w) 노트의 첨부 사진만.
      const ok = rows.some(x => x.id === nid && x.workspace_id === 'w' && x.attachments.some(a => a.drive_file_id === fid && /^image\//.test(a.mime_type)));
      return ok ? r.fulfill({ status: 200, contentType: 'image/png', body: PNG }) : r.fulfill({ status: 404, json: { code: 'note_not_found' } });
    }
    if (req.method() === 'POST') {
      const buf = req.postDataBuffer() || Buffer.alloc(0), text = buf.toString('latin1');
      const nid = /name="note_id"\r\n\r\n([0-9a-f-]+)/.exec(text)?.[1], mime = /Content-Type: (image\/[a-z]+)/.exec(text)?.[1] || 'application/octet-stream';
      uploads.push({ nid, mime, bytes: buf, place: /name="place"\r\n\r\n([a-z]+)/.exec(text)?.[1] || null, folderField: /name="(folder_id|parent|parents)"/.test(text) });
      const hit = rows.find(x => x.id === nid);
      if (!hit) return r.fulfill({ status: 404, json: { code: 'note_not_found' } });
      hit.attachments = [{ drive_file_id: `pf${uploads.length}`, file_name: 'p', mime_type: mime, size_bytes: buf.length }];
      return r.fulfill({ json: { ok: true, note_id: nid, attachments: hit.attachments } });
    }
    return r.fulfill({ status: 500, json: {} });
  });
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_folders', r => r.fulfill({ json: [] }));
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_board_links', r => r.fulfill({ json: [] }));
  // 보드 상자 표 흉내(글자 붙여넣기): POST 저장·DELETE 지우기.
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_board_texts', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams, method = req.method(), body = method === 'GET' || method === 'DELETE' ? null : req.postDataJSON();
    textCalls.push({ method, body });
    if (method === 'GET') return r.fulfill({ json: structuredClone(textRows) });
    if (method === 'POST') { const saved = { ...TDEF, id: `T${textCalls.length}`, ...body }; delete saved.workspace_id; textRows.push(saved); return r.fulfill({ status: 201, json: [structuredClone(saved)] }); }
    if (method === 'PATCH') { const hit = textRows.find(t => 'eq.' + t.id === q.get('id')); if (hit) Object.assign(hit, body); return r.fulfill({ json: hit ? [structuredClone(hit)] : [] }); }
    if (method === 'DELETE') { const id = q.get('id')?.slice(3); for (let i = textRows.length - 1; i >= 0; i--) if (textRows[i].id === id) { textRows.splice(i, 1); } return r.fulfill({ json: [] }); }
    return r.fulfill({ status: 500, json: {} });
  });
  await openBoard(page, 1 + seed.length);
  return { errors, uploads, photoGets, created, deleted, rows, others, textCalls, textRows };
}
async function openBoard(page, count) {
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  await page.locator('.nv-switch [data-note-view="board"]').click();
  await expect(page.locator('[data-note-board] [data-nb-card]')).toHaveCount(count);
}
// 기기에서 만든 사진(지어낸 그림): JPEG에 위치가 든 EXIF(APP1)를 끼운 파일, 또는 깨끗한 PNG.
const MAKE = `(async ({ type, gps, w, h }) => {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); x.fillStyle = '#7aa'; x.fillRect(0, 0, w, h); x.fillStyle = '#333'; x.fillRect(4, 4, w / 2, h / 2);
  const blob = await new Promise(r => c.toBlob(r, type, 0.9));
  let bytes = new Uint8Array(await blob.arrayBuffer());
  if (gps && type === 'image/jpeg') {
    const body = [...'Exif'].map(ch => ch.charCodeAt(0)).concat([0, 0], [...'MM GPSLatitude 37.5665 GPSLongitude 126.9780'].map(ch => ch.charCodeAt(0)));
    const len = body.length + 2, seg = [0xff, 0xe1, len >> 8, len & 255, ...body];
    bytes = new Uint8Array([bytes[0], bytes[1], ...seg, ...bytes.slice(2)]);
  }
  return new File([bytes], type === 'image/jpeg' ? '회의 칠판.jpg' : 'image.png', { type });
})`;
async function dropFile(page, spec, at) {
  await page.evaluate(async ({ make, spec, at }) => {
    const file = await (0, eval)(make)(spec);
    const dt = new DataTransfer(); dt.items.add(file);
    const el = document.querySelector('[data-nb-scroll]'), r = el.getBoundingClientRect();
    const init = { dataTransfer: dt, clientX: r.left + at.x, clientY: r.top + at.y, bubbles: true, cancelable: true };
    el.dispatchEvent(new DragEvent('dragover', init)); el.dispatchEvent(new DragEvent('drop', init));
  }, { make: MAKE, spec, at });
}
async function pasteFile(page, spec) {
  await page.evaluate(async ({ make, spec }) => {
    const file = await (0, eval)(make)(spec);
    const dt = new DataTransfer(); dt.items.add(file);
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, { make: MAKE, spec });
}
const photoCards = page => page.locator('[data-nb-card].nb-card-photo');
async function box(l) { for (let i = 0; i < 20; i++) { const b = await l.boundingBox({ timeout: 2000 }).catch(() => null); if (b) return b; await new Promise(r => setTimeout(r, 50)); } return null; }
async function center(l) { const b = await box(l); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }
async function drag(page, from, to, steps = 10) { await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps }); await page.mouse.up(); }
const placeOf = (rows, id) => rows.find(r => r.id === id)?.metadata?.boards?.[BID];
const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

async function pasteText(page, text, target = 'body') {
  await page.evaluate(({ text, target }) => {
    const dt = new DataTransfer(); dt.setData('text/plain', text);
    const el = target === 'active' ? document.activeElement : document.body;
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, { text, target });
}
// 판 빈 곳(카드·상자·도구 줄에서 먼 곳) 화면 좌표. 판 안 (fx, fy) 비율 근처에서 찾는다.
const blankAt = (page, fx, fy) => page.locator('[data-nb-scroll]').evaluate((el, { fx, fy }) => {
  const r = el.getBoundingClientRect(), x0 = r.left + r.width * fx, y0 = r.top + r.height * fy;
  for (let d = 0; d < 200; d += 10) for (const [dx, dy] of [[d, 0], [-d, 0], [0, d], [0, -d]]) {
    const x = x0 + dx, y = y0 + dy, hit = document.elementFromPoint(x, y);
    if (!hit || !el.contains(hit) || hit.closest('[data-nb-card],[data-nb-text],.nb-tools,[data-nb-hit],.nb-node-bar,.nb-selbar')) continue;
    const near = [...el.querySelectorAll('[data-nb-card],[data-nb-text]')].some(n => { const b = n.getBoundingClientRect(); return x > b.left - 40 && x < b.right + 40 && y > b.top - 40 && y < b.bottom + 40; });
    if (!near) return { x, y };
  }
  return null;
}, { fx, fy });
const labelBy = (page, body) => page.locator('[data-nb-texts] [data-nb-text][data-kind="label"]').filter({ hasText: body.split('\n')[0] });
const undoBtn = page => page.locator('.kptu-notice-undo').filter({ hasText: '되돌리기' });
const near = (a, b, d = 8) => Math.abs(a - b) <= d;

test('[가] PC: 빈 곳 클릭 → Ctrl+V 사진 = 누른 자리에 사진 카드(place=board, 폴더 id 안 보냄), 되돌리기 한 번에 빠짐 (1280)', async ({ page }) => {
  const { errors, uploads, deleted } = await fixture(page, 1280);
  const p = await blankAt(page, 0.55, 0.55);
  expect(p).toBeTruthy();
  await page.mouse.click(p.x, p.y);
  await pasteFile(page, { type: 'image/png', w: 200, h: 200 });
  await expect(photoCards(page)).toHaveCount(1);
  expect(uploads[0].place).toBe('board');
  expect(uploads[0].folderField).toBe(false);
  const c = await center(photoCards(page));
  expect(near(c.x, p.x, 6) && near(c.y, p.y, 6)).toBe(true);
  // 되돌리기 한 번 = 보드에서 빠지고 그 사진 노트는 지우기(휴지통) 요청.
  await undoBtn(page).click();
  await expect(photoCards(page)).toHaveCount(0);
  await expect.poll(() => deleted.length).toBe(1);
  expect(errors).toEqual([]);
});

test('[가] PC: 빈 곳 클릭 → Ctrl+V 글자 = 누른 자리에 배경 없는 글자 칸(줄바꿈 그대로), 되돌리기 한 번에 빠짐 · 누른 자리 없으면 판 가운데 · 긴 글은 300자까지 (1280)', async ({ page }) => {
  const { errors, textRows, textCalls } = await fixture(page, 1280);
  const p = await blankAt(page, 0.6, 0.45);
  await page.mouse.click(p.x, p.y);
  await pasteText(page, '첫 줄 메모\r\n둘째 줄');
  await expect.poll(() => textRows.length).toBe(1);
  expect(textRows[0]).toMatchObject({ kind: 'label', body: '첫 줄 메모\n둘째 줄' });
  const label = labelBy(page, '첫 줄 메모');
  await expect(label).toBeVisible();
  const b = await box(label);
  expect(near(b.x, p.x, 10) && near(b.y, p.y, 10)).toBe(true);
  await expect(label.locator('.nb-tx')).toContainText('둘째 줄');
  await undoBtn(page).click();
  await expect.poll(() => textRows.length).toBe(0);
  await expect(label).toHaveCount(0);
  // 새로 불러온 판(누른 자리 없음) → 보이는 판 가운데, 긴 글은 300자까지.
  await page.reload();
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, { timeout: 20000 });
  await page.waitForFunction(() => window.KPTURouter?.go);
  await openBoard(page, 1);
  await pasteText(page, '가'.repeat(400));
  await expect.poll(() => textRows.length).toBe(1);
  expect([...textRows[0].body].length).toBe(300);
  await expect(page.locator('.kptu-notice-text')).toContainText('300자');
  const sc = await box(page.locator('[data-nb-scroll]')), lb = await box(page.locator('[data-nb-texts] [data-nb-text][data-kind="label"]'));
  expect(lb.x).toBeGreaterThan(sc.x + sc.width * 0.25); expect(lb.x).toBeLessThan(sc.x + sc.width * 0.75);
  expect(textCalls.filter(c => c.method === 'POST')).toHaveLength(2);
  expect(errors).toEqual([]);
});

test('[가] 글 쓰는 칸 편집 중 붙여넣기는 그 칸 몫(보드에 새 칸 없음) (1280)', async ({ page }) => {
  const { errors, textRows, uploads } = await fixture(page, 1280);
  await page.locator('[data-nb-add-text]').click();
  await expect(page.locator('[data-nb-text-edit]')).toBeFocused();
  await pasteText(page, '칸 안 글', 'active');
  await page.waitForTimeout(300);
  expect(textRows).toHaveLength(0); expect(uploads).toHaveLength(0);
  expect(errors).toEqual([]);
});

test('[나] PC: 사진 카드 한 번 누름 = 고르기(노트 화면 안 감), 두 번 누름 = 보드 위 크게 보기, Esc로 닫으면 보드 그대로 (1280)', async ({ page }) => {
  const { errors } = await fixture(page, 1280, { seed: photoSeed });
  const card = photoCards(page);
  await expect(card.locator('img.nb-photo-img')).toBeVisible();
  const c = await center(card);
  await page.mouse.click(c.x, c.y);
  await expect(card).toHaveClass(/nb-sel/);
  await page.waitForTimeout(300);
  await expect(page.locator('[data-note-detail]')).toBeHidden();
  await expect(page.locator('[data-basket-photo-view]')).toHaveCount(0);
  await page.mouse.dblclick(c.x, c.y);
  const viewer = page.locator('[data-basket-photo-view]');
  await expect(viewer).toBeVisible();
  await expect(viewer.locator('img')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);
  await expect(page.locator('[data-note-board]')).toBeVisible();
  await expect(page.locator('[data-note-detail]')).toBeHidden();
  await expect(card).toBeVisible();
  expect(errors).toEqual([]);
});

test('[나] 폰: 사진 카드 한 번 누름 = 고르기, 한 번 더 = 크게 보기, ×로 닫으면 보드 그대로 · 손가락 뒤 글자 붙여넣기는 그대로(안 넣음) (390)', async ({ page }) => {
  const { errors, textRows } = await fixture(page, 390, { seed: photoSeed });
  const card = photoCards(page);
  await card.scrollIntoViewIfNeeded();
  await expect(card.locator('img.nb-photo-img')).toBeVisible();
  let c = await center(card);
  await page.touchscreen.tap(c.x, c.y);
  await expect(card).toHaveClass(/nb-sel/);
  await page.waitForTimeout(400);
  await expect(page.locator('[data-note-detail]')).toBeHidden();
  await expect(page.locator('[data-basket-photo-view]')).toHaveCount(0);
  c = await center(card);
  await page.touchscreen.tap(c.x, c.y);
  const viewer = page.locator('[data-basket-photo-view]');
  await expect(viewer).toBeVisible();
  await viewer.locator('[data-basket-photo-close]').click();
  await expect(viewer).toHaveCount(0);
  await expect(page.locator('[data-note-board]')).toBeVisible();
  await expect(page.locator('[data-note-detail]')).toBeHidden();
  await pasteText(page, '폰 글');
  await page.waitForTimeout(300);
  expect(textRows).toHaveLength(0);
  expect(await noOverflow(page)).toBe(true);
  expect(errors).toEqual([]);
});
