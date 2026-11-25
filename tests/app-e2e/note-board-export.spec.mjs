import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
import { readFileSync } from 'node:fs';

// S70-32 ③ 노트 › 보드 내보내기(명진 2026-11-25 "보드 PDF·HTML 내보내기"): 보드 칸 메뉴 [PDF로 내보내기]·[HTML로 내보내기].
// - 보드 전체(맞추기 범위) 그대로 — 내보낸 HTML의 카드·상자·사진 수 = 보드와 같다, 손잡이·⋯ 단추는 빠진다.
// - PDF는 쪽 1 이상인 파일. 기기에서 내려받기만(서버에 새 요청 없음). 이름은 지어낸 것.
test.use({ hasTouch: true });
test.describe.configure({ timeout: 60000 });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const BID = 'bimage01';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function fixture(page, width, { seed = [], texts = [], lines = [] } = {}) {
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
  const TDEF = { parent_id: null, ord: 0, side: null, kind: 'topic', color: null, shape: 'round', font: 2, w: null, collapsed: false, h: null, pinned: false, z: 0 };
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_board_texts', r => r.fulfill({ json: r.request().method() === 'GET' ? texts.map(t => ({ ...TDEF, board_id: BID, ...t })) : [] }));
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_board_links', r => r.fulfill({ json: r.request().method() === 'GET' ? lines.map(l => ({ board_id: BID, from_note: null, to_note: null, from_text: null, to_text: null, from_side: null, to_side: null, shape: 'line', ends: 'end', dash: 'solid', ...l })) : [] }));
  await openBoard(page, 1 + seed.length);
  const requests = []; page.on('request', q => { if (q.method() !== 'GET' && q.url().startsWith(SB)) requests.push(q.method() + ' ' + new URL(q.url()).pathname); });
  return { errors, uploads, photoGets, created, deleted, rows, others, requests };
}
async function openBoard(page, count) {
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  await page.locator('.nv-switch [data-note-view="board"]').click();
  await expect(page.locator('[data-note-board] [data-nb-card]')).toHaveCount(count);
}

const MINE = { id: '40000000-0000-4000-8000-0000000000aa', title: '칠판 사진', raw_text: '', attachments: [{ drive_file_id: 'pm1', mime_type: 'image/png', file_name: 'b.png', size_bytes: 3 }], metadata: { boards: { [BID]: { x: 420, y: 120, r: 0, z: 2, w: 160, h: 120 } } } };
const TEXTS = [{ id: 't1', body: '가운데 주제', x: 200, y: 360 }, { id: 't2', body: '배경 없는 글', kind: 'label', shape: 'plain', x: 520, y: 420 }, { id: 't3', body: '', kind: 'shape', shape: 'ellipse', x: 700, y: 200, w: 120, h: 80 }];
const LINES = [{ id: 'L1', from_note: 'n1', to_text: 't1' }];
async function openExport(page, kind) {
  await page.locator('[data-nbb-board]').first().click({ button: 'right' });
  const item = page.locator(`[data-nbb-menu] [data-nbb-export="${kind}"]`);
  await expect(item).toBeVisible();
  const dl = page.waitForEvent('download');
  await item.click();
  const d = await dl;
  return { name: d.suggestedFilename(), bytes: readFileSync(await d.path()) };
}
for (const width of [1280, 390]) {
  test(`보드 칸 메뉴 [HTML로 내보내기]: 카드·상자·사진·선 수가 보드와 같고 손잡이·메뉴 단추는 없음, 서버에 새 요청 없음 (${width})`, async ({ page }) => {
    const { errors, requests } = await fixture(page, width, { seed: [MINE], texts: TEXTS, lines: LINES });
    await expect(page.locator('[data-nb-card].nb-card-photo img.nb-photo-img')).toBeVisible();
    await expect(page.locator('[data-nb-texts] [data-nb-text]')).toHaveCount(3);
    const before = requests.length;
    const { name, bytes } = await openExport(page, 'html');
    expect(name).toMatch(/^사진 보드 \d{4}-\d\d-\d\d\.html$/);
    const html = bytes.toString('utf8');
    // 보드에 보이는 것과 같은 수(맞추기 = 전체).
    const count = re => (html.match(re) || []).length;
    expect(count(/data-nb-card="/g)).toBe(await page.locator('[data-nb-cards] > [data-nb-card]').count());
    expect(count(/data-nb-card="/g)).toBe(2);
    expect(count(/data-nb-text="/g)).toBe(3);
    expect(count(/<img /g)).toBe(1);
    expect(html).toMatch(/<img [^>]*src="data:image\/png;base64,/);
    expect(html).toContain('가운데 주제'); expect(html).toContain('배경 없는 글'); expect(html).toContain('가 노트');
    expect(count(/class="nb-line[ "]/g)).toBe(await page.locator('[data-nb-lines] path.nb-line').count());
    expect(count(/class="nb-line[ "]/g)).toBe(1);
    expect(html).not.toContain('data-nb-resize'); expect(html).not.toContain('data-note-row-more');
    expect(html).not.toMatch(/blob:/);
    // 내보낸 파일을 열면 그 모양 그대로 보인다(카드 2·상자 3·사진 1).
    const view = await page.context().newPage();
    await view.setContent(html);
    await expect(view.locator('[data-nb-export] [data-nb-card]')).toHaveCount(2);
    await expect(view.locator('[data-nb-export] [data-nb-text]')).toHaveCount(3);
    expect(await view.locator('[data-nb-export] img').evaluate(i => i.complete && i.naturalWidth > 0)).toBe(true);
    await view.close();
    expect(requests.slice(before).filter(r => /app_note|basket-files|share|storage|library|drive/.test(r))).toEqual([]); // 서버에 사본·공개 주소를 만들지 않음(앱의 다른 화면 배경 요청은 상관없음)
    expect(errors).toEqual([]);
  });
}

test('보드 칸 메뉴 [PDF로 내보내기]: 쪽 1 이상인 PDF 파일, 빈 곳 우클릭 메뉴에도 같은 항목 (1280)', async ({ page }) => {
  const { errors, requests } = await fixture(page, 1280, { seed: [MINE], texts: TEXTS, lines: LINES });
  await expect(page.locator('[data-nb-card].nb-card-photo img.nb-photo-img')).toBeVisible();
  const before = requests.length;
  const { name, bytes } = await openExport(page, 'pdf');
  expect(name).toMatch(/\.pdf$/);
  const text = bytes.toString('latin1');
  expect(text.startsWith('%PDF-')).toBe(true);
  expect((text.match(/\/Type\s*\/Page(?!s)/g) || []).length).toBeGreaterThanOrEqual(1);
  expect(text).toContain('/Filter /DCTDecode');
  expect(bytes.length).toBeGreaterThan(2000);
  expect(requests.slice(before).filter(r => /app_note|basket-files|share|storage|library|drive/.test(r))).toEqual([]);
  // 보드 빈 곳 오른쪽 클릭 메뉴에도 [PDF로 내보내기]·[HTML로 내보내기].
  await page.locator('[data-note-board]').click({ button: 'right', position: { x: 600, y: 520 } });
  await expect(page.locator('#noteDocMenu [data-nbb-export-pdf]')).toBeVisible();
  await expect(page.locator('#noteDocMenu [data-nbb-export-html]')).toBeVisible();
  const dl = page.waitForEvent('download');
  await page.locator('#noteDocMenu [data-nbb-export-html]').click();
  expect((await dl).suggestedFilename()).toMatch(/\.html$/);
  expect(errors).toEqual([]);
});
