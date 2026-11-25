import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';

// S70-32 ② 노트 › 보드 이미지(명진 2026-11-25 "보드에 이미지 넣기"): 사진 파일을 끌어 놓기·붙여넣기·[이미지] 단추로 넣는다.
// - 넣은 사진 = 사진 한 장뿐인 노트(제목만, 첨부 사진 1장 — 노트 첨부 basket-files, owner만). 보드에서는 그 카드가 사진으로 보인다.
// - 올리기 전 사진 정보(EXIF 위치)를 지운다 — 서버에 간 바이트에 위치 글자가 없다.
// - 새로 불러와도 보이고, 카드 손잡이로 크기 조절·끌어 옮기기, 남의 작업공간 노트 사진(서버 404)은 보이지 않는다. 이름은 지어낸 것.
test.use({ hasTouch: true });
test.describe.configure({ timeout: 60000 });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const BID = 'bimage01';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function fixture(page, width, { seed = [] } = {}) {
  await page.setViewportSize({ width, height: 860 });
  const errors = [], uploads = [], photoGets = [], created = [], deleted = [];
  page.on('pageerror', e => errors.push(e.message));
  await installViewPrefsServer(page, { note_boards: [{ id: BID, name: '사진 보드' }], note_board: BID });
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
      uploads.push({ nid, mime, bytes: buf });
      const hit = rows.find(x => x.id === nid);
      if (!hit) return r.fulfill({ status: 404, json: { code: 'note_not_found' } });
      hit.attachments = [{ drive_file_id: `pf${uploads.length}`, file_name: 'p', mime_type: mime, size_bytes: buf.length }];
      return r.fulfill({ json: { ok: true, note_id: nid, attachments: hit.attachments } });
    }
    return r.fulfill({ status: 500, json: {} });
  });
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_folders', r => r.fulfill({ json: [] }));
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  await page.route(u => u.origin === SB && ['/rest/v1/app_note_board_links', '/rest/v1/app_note_board_texts'].includes(u.pathname), r => r.fulfill({ json: [] }));
  await openBoard(page, 1 + seed.length);
  return { errors, uploads, photoGets, created, deleted, rows, others };
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

test('PC: 위치 정보가 든 JPEG를 끌어 놓기 → 정보 지우고 사진 노트로 올림 → 사진 칸, 새로고침 뒤에도, 크기 조절·옮기기 (1280)', async ({ page }) => {
  const { errors, uploads, created, rows } = await fixture(page, 1280);
  await dropFile(page, { type: 'image/jpeg', gps: true, w: 400, h: 300 }, { x: 420, y: 260 });
  await expect(photoCards(page)).toHaveCount(1);
  await expect(photoCards(page).locator('img.nb-photo-img')).toBeVisible();
  // 제목만 있는 노트(본문 없음)를 먼저 만들고, 그 노트 첨부로 사진을 올렸다.
  expect(created).toHaveLength(1);
  expect(created[0]).toMatchObject({ kind: 'note', title: '회의 칠판', raw_text: '' });
  expect(uploads).toHaveLength(1);
  const sent = uploads[0].bytes.toString('latin1');
  expect(sent).not.toContain('GPSLatitude');
  expect(sent).not.toContain('Exif');
  expect(uploads[0].mime).toBe('image/jpeg');
  // 보드 자리: 놓은 곳 근처, 사진 비율(4:3) 크기.
  const id = uploads[0].nid;
  await expect.poll(() => placeOf(rows, id)?.w).toBe(240);
  expect(placeOf(rows, id)).toMatchObject({ w: 240, h: 180, r: 0 });
  // 새로 불러와도 사진 칸.
  await page.reload();
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, { timeout: 20000 });
  await page.waitForFunction(() => window.KPTURouter?.go);
  await openBoard(page, 2);
  await expect(photoCards(page).locator('img.nb-photo-img')).toBeVisible();
  // 고르고(초점 = 고르기) 오른쪽 아래 손잡이로 키우기 → 저장(크기 바꾸기는 노트 열기가 아님).
  const card = photoCards(page);
  await card.locator('.nb-open').focus();
  await expect(card).toHaveClass(/nb-sel/);
  await expect(card.locator('[data-nb-resize]:visible')).toHaveCount(8);
  const se = await center(card.locator('[data-nb-resize="se"]'));
  await drag(page, se, { x: se.x + 60, y: se.y + 45 }, 6);
  await expect.poll(() => placeOf(rows, id)?.w).toBeGreaterThan(260);
  expect(placeOf(rows, id).h).toBeGreaterThan(190);
  await expect(page.locator('[data-note-detail]')).toBeHidden();
  // 끌어 옮기기 → 자리 저장.
  const before = placeOf(rows, id), c = await center(card);
  await drag(page, c, { x: c.x + 120, y: c.y + 40 }, 10);
  await expect.poll(() => placeOf(rows, id)?.x).toBeGreaterThan(before.x + 60);
  expect(errors).toEqual([]);
});

test('PC: 붙여넣기(Ctrl+V)로 PNG 사진 넣기 — 판 가운데, 이름이 image면 날짜 제목 (1280)', async ({ page }) => {
  const { errors, uploads, created } = await fixture(page, 1280);
  await pasteFile(page, { type: 'image/png', w: 200, h: 200 });
  await expect(photoCards(page)).toHaveCount(1);
  await expect(photoCards(page).locator('img.nb-photo-img')).toBeVisible();
  expect(uploads[0].mime).toBe('image/png');
  expect(created[0].title).toMatch(/^보드 사진 \d+월 \d+일 \d\d:\d\d$/);
  // 글 쓰는 칸에서 붙여넣으면 보드에 넣지 않는다.
  await page.locator('[data-nb-add-text]').click();
  await expect(page.locator('[data-nb-text-edit]')).toBeFocused();
  await page.evaluate(async make => {
    const file = await (0, eval)(make)({ type: 'image/png', w: 20, h: 20 });
    const dt = new DataTransfer(); dt.items.add(file);
    document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, MAKE);
  await page.waitForTimeout(300);
  expect(uploads).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('폰: 도구 줄 [이미지] → 사진 고르기 → 사진 칸, 가로 넘침 없음 (390)', async ({ page }) => {
  const { errors, uploads } = await fixture(page, 390);
  const btn = page.locator('[data-nb-add-image]');
  await expect(btn).toBeVisible();
  const file = await page.evaluate(async make => {
    const f = await (0, eval)(make)({ type: 'image/jpeg', gps: true, w: 300, h: 400 });
    return { name: f.name, mimeType: f.type, b64: btoa(String.fromCharCode(...new Uint8Array(await f.arrayBuffer()))) };
  }, MAKE);
  const chooser = page.waitForEvent('filechooser');
  await btn.click();
  await (await chooser).setFiles({ name: file.name, mimeType: file.mimeType, buffer: Buffer.from(file.b64, 'base64') });
  await expect(photoCards(page)).toHaveCount(1);
  await expect(photoCards(page).locator('img.nb-photo-img')).toBeVisible();
  expect(uploads[0].bytes.toString('latin1')).not.toContain('GPSLatitude');
  expect(await noOverflow(page)).toBe(true);
  expect(errors).toEqual([]);
});

test('남의 작업공간 노트의 사진은 보이지 않는다(서버 owner 확인 404 → 빈 칸·↻), 사진 아닌 파일은 넣지 않음 (1280)', async ({ page }) => {
  // 보드에 남의 노트 사진을 가리키는 카드가 있어도(지어낸 상황) 서버가 404를 주면 그림은 뜨지 않는다.
  const seed = [{ id: '30000000-0000-4000-8000-000000000003', title: '남의 사진', raw_text: '', workspace_id: 'other', attachments: [{ drive_file_id: 'ox1', mime_type: 'image/png', file_name: 'o.png', size_bytes: 3 }] }];
  const { photoGets, uploads, created } = await fixture(page, 1280, { seed });
  const card = photoCards(page);
  await expect(card).toHaveCount(1);
  await expect.poll(() => photoGets.length).toBeGreaterThan(0);
  await expect(card.locator('[data-nb-photo]')).toHaveAttribute('data-img-state', 'failed');
  await expect(card.locator('img.nb-photo-img')).toHaveCount(0);
  // 사진이 아닌 파일을 끌어 놓으면 올리지 않는다.
  await page.evaluate(() => {
    const dt = new DataTransfer(); dt.items.add(new File(['%PDF-1.4'], 'a.pdf', { type: 'application/pdf' }));
    const el = document.querySelector('[data-nb-scroll]'), r = el.getBoundingClientRect();
    const init = { dataTransfer: dt, clientX: r.left + 300, clientY: r.top + 200, bubbles: true, cancelable: true };
    el.dispatchEvent(new DragEvent('dragover', init)); el.dispatchEvent(new DragEvent('drop', init));
  });
  await page.waitForTimeout(300);
  expect(uploads).toHaveLength(0); expect(created).toHaveLength(0);
});
