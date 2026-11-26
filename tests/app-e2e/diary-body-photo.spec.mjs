import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { edCmd } from './helpers/ed-tools.mjs';
// S67-20 하루 기록 본문 사진(요청함 11/20 07:58): 하루 기록 글 칸에도 노트와 같은 [넣기 ▾] › [사진]. 사진은 그 일기에 올린 사본
// (basket-files 올리기, note_id = 그 일기, Drive "노트 첨부")이고 글에는 drive:<id>만 남는다. 보기는 본인 전용 사진 보기(?action=photo)뿐.
// 글 안 사진은 글 안에만: 그날 사진 칸·달력 칸·[사진 n/20]에는 세지 않는다(metadata.body_photos). 글에서 지우고 저장하면 일기에서도 빠진다.
// 하루 기록 PIN 잠금이 켜져 있으면 풀기 전에는 일기도 사진도 읽지 않는다. 합성 데이터, 폰 412·폴드 884·PC 1280.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const at = '2026-10-05T01:00:00Z';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const DAY = '2026-10-05';
const SHOTS = 'docs/design/screens/s67-20';

function lockRoutes(s) {
  return async page => {
    await page.route(u => u.origin === SB && u.pathname.startsWith('/rest/v1/rpc/app_lock_'), async route => {
      const name = new URL(route.request().url()).pathname.split('/').pop(), body = route.request().postDataJSON() || {};
      const json = v => route.fulfill({ contentType: 'application/json', body: JSON.stringify(v) });
      if (name === 'app_lock_read') return json({ has_pin: true, features: ['diary'], relock: '5m', left: 5, blocked_until: null });
      if (name === 'app_lock_check') return json(body.p_pin === s.pin ? { ok: true, left: 5, blocked_until: null } : { ok: false, left: 4, blocked_until: null });
      return route.fulfill({ status: 404, body: '' });
    });
  };
}

// 하루 기록 요청이 글을 담을 수 있는 칸을 고르는지(select 없음 = 모든 칸). 별칭(a:b)은 원래 칸(b)으로, json 경로(metadata->x)는 그 길 그대로 본다.
function readsText(url) {
  const select = new URL(url).searchParams.get('select');
  if (!select) return true;
  return select.split(',').some(c => { const col = c.split(':').pop().trim(); return col === '*' || ['raw_text', 'doc', 'title', 'metadata'].includes(col); });
}

async function fixture(page, { width = 412, lock = null } = {}) {
  await page.setViewportSize({ width, height: width >= 1000 ? 900 : 915 });
  const rows = [{ id: 'd5', workspace_id: 'w', kind: 'diary', journal_day: DAY, raw_text: '합성 하루 첫 줄', doc: null, title: null, occurred_at: at, created_at: at, updated_at: '2026-10-05T02:00:00Z', archived_at: null,
    attachments: [{ drive_file_id: 'day1', file_name: 'IMG_day.jpg', mime_type: 'image/jpeg', size_bytes: 100 }], metadata: {} }];
  const errors = [], uploads = [], photoReads = [], prunes = [], writes = [];
  let stamp = 10, n = 0, diaryReads = 0, pic = PNG;
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(m.text()); });
  // S67-69: 세는 '읽기'는 하루 기록 글을 담은 읽기다. 홈 '오늘 사진'은 하루 기록이 잠겨 있어도 그날 넣은 사진 정보만 읽는다
  // (select=id,journal_day,attachments,body_photos:metadata->body_photos, 2026-11-21 사용자 "사진을 안잠그면 홈에서 사진 보여주는거").
  // 그 요청은 세지 않되, select가 없거나(*) 글·제목·doc·metadata 통째를 고르면 여전히 센다 — 잠긴 동안 글을 읽으면 실패한다.
  page.on('request', req => { const u = req.url(); if (u.startsWith(SB + '/rest/v1/app_notes') && /kind=eq\.diary/.test(u) && readsText(u)) diaryReads++; });
  const install = async () => {
    if (lock) await lockRoutes(lock)(page);
    const match = (row, q) => [...q.entries()].every(([k, v]) => { if (['select', 'order', 'limit', 'offset'].includes(k)) return true; const [op, ...rest] = v.split('.'), val = rest.join('.'), cell = k === 'attachments' ? JSON.stringify(row.attachments) : row[k]; return op === 'eq' ? String(cell) === val : op === 'gte' ? String(cell) >= val : op === 'lte' ? String(cell) <= val : true; });
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', async r => {
      const req = r.request(), q = new URL(req.url()).searchParams, method = req.method();
      if (method === 'GET') { if (q.get('metadata')) return r.fulfill({ json: [] }); return r.fulfill({ json: rows.filter(row => match(row, q)).map(x => structuredClone(x)) }); }
      if (method === 'PATCH') { const body = req.postDataJSON(); writes.push({ query: Object.fromEntries(q), body }); const hit = rows.filter(row => match(row, q)); for (const row of hit) Object.assign(row, body, { updated_at: `2026-10-05T03:00:${String(stamp++).padStart(2, '0')}Z` }); return r.fulfill({ json: hit.map(x => structuredClone(x)) }); }
      if (method === 'POST') { const body = req.postDataJSON(); const row = { id: 'd-new-' + (++n), title: null, occurred_at: at, created_at: at, updated_at: '2026-10-05T02:30:00Z', archived_at: null, attachments: [], metadata: {}, doc: null, ...body }; rows.push(row); return r.fulfill({ status: 201, json: [structuredClone(row)] }); }
      return r.fulfill({ status: 500, json: {} });
    });
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_record_links', r => r.fulfill({ json: [] }));
    await page.route(u => u.origin === SB && u.pathname === '/functions/v1/basket-files', async r => {
      const req = r.request(), url = new URL(req.url()), action = url.searchParams.get('action');
      if (action === 'photo') { photoReads.push(url.searchParams.get('file_id')); return r.fulfill({ status: 200, contentType: 'image/png', body: pic }); }
      if (action === 'photo-prune') { const body = req.postDataJSON(); prunes.push(body.file_ids); return r.fulfill({ json: { action: 'photo-prune', ok: true, trashed: body.file_ids.length, kept: 0, failed: 0, unknown: 0 } }); }
      if (req.method() !== 'POST') return r.fulfill({ status: 404, json: {} });
      const raw = req.postDataBuffer()?.toString('latin1') || '';
      const noteId = raw.match(/name="note_id"\r\n\r\n([^\r]+)/)?.[1], name = Buffer.from(raw.match(/filename="([^"]*)"/)?.[1] || '', 'latin1').toString('utf8');
      uploads.push({ noteId, name });
      const row = rows.find(x => x.id === noteId);
      if (!row) return r.fulfill({ status: 404, json: { code: 'note_not_found' } });
      row.attachments = [...row.attachments, { drive_file_id: 'body' + uploads.length, file_name: name, mime_type: 'image/jpeg', size_bytes: PNG.length }];
      row.updated_at = `2026-10-05T04:00:${String(stamp++).padStart(2, '0')}Z`;
      return r.fulfill({ json: { ok: true, note_id: row.id, attachments: row.attachments } });
    });
  };
  await openHome(page, { beforeLoad: install });
  // 캡처용 합성 그림(무늬만, 실제 사진 아님): 사진 보기가 이 그림을 돌려준다.
  pic = Buffer.from((await page.evaluate(() => { const k = document.createElement('canvas'); k.width = 480; k.height = 320; const x = k.getContext('2d'); const g = x.createLinearGradient(0, 0, 480, 320); g.addColorStop(0, '#9fb8a8'); g.addColorStop(1, '#d9c7a4'); x.fillStyle = g; x.fillRect(0, 0, 480, 320); x.fillStyle = '#6f8f7c'; x.beginPath(); x.moveTo(0, 320); x.lineTo(170, 150); x.lineTo(300, 260); x.lineTo(380, 190); x.lineTo(480, 320); x.fill(); x.fillStyle = '#f3e3b5'; x.beginPath(); x.arc(380, 80, 36, 0, 7); x.fill(); return k.toDataURL('image/png'); })).split(',')[1], 'base64');
  return { rows, uploads, photoReads, prunes, writes, errors, reads: () => diaryReads };
}
const cell = page => page.locator(`#diaryRoot [data-diary-day="${DAY}"]`);
const editorOf = page => page.locator('#diaryRoot [data-diary-editor]');
const field = ed => ed.locator('[data-diary-text] .ProseMirror');
async function insertPhoto(page, ed, width, name = '현장.png') {
  const box = ed.locator('[data-diary-text]');
  await field(ed).click(); await page.keyboard.press('Control+End');
  const chooser = page.waitForEvent('filechooser');
  await edCmd(box, 'photo');
  await (await chooser).setFiles([{ name, mimeType: 'image/png', buffer: PNG }]);
}
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png` });

for (const width of [412, 884, 1280]) {
  test(`[넣기] › [사진] → 저장 → 다시 열기: 글 안에만 보이고 그날 사진 칸·[사진 n/20]에는 없다 (${width})`, async ({ page }) => {
    const f = await fixture(page, { width });
    await page.evaluate(() => window.KPTURouter.go('diary'));
    await expect(page.locator('#diaryView')).toBeVisible();
    await cell(page).click();
    await page.locator('#diaryRoot [data-diary-edit]').click();
    const ed = editorOf(page);
    await expect(field(ed)).toBeVisible();
    await expect(ed.locator('[data-diary-count]')).toHaveText('1/20');
    await insertPhoto(page, ed, width);
    await expect(field(ed).locator('img.ed-photo-img')).toHaveCount(1);
    expect(f.uploads).toEqual([{ noteId: 'd5', name: '현장.jpg' }]); // 그날 사진과 같이 줄인 사본(JPEG)이 올라간다
    // 그날 사진 칸에는 들어가지 않는다(있던 1장 그대로).
    await expect(ed.locator('.diary-thumb')).toHaveCount(1);
    await expect(ed.locator('[data-diary-count]')).toHaveText('1/20');
    await page.keyboard.press('Control+End'); await page.keyboard.insertText('사진 아래 합성 글');
    await shot(page, `edit-${width}`);
    await ed.locator('[data-diary-save]').click();
    await expect(ed).toBeHidden();
    const row = f.rows[0];
    expect(row.attachments.map(a => a.drive_file_id)).toEqual(['day1', 'body1']);
    expect(row.metadata.body_photos).toEqual(['body1']);
    const saved = JSON.stringify(row.doc);
    expect(saved).toContain('"src":"drive:body1"'); expect(saved).not.toMatch(/https?:|blob:/);
    expect(row.raw_text).toContain('[사진]');
    // 읽기 화면: 글 안에 사진, 그날 사진 격자에는 있던 1장만, 달력 칸은 '사진 1장'.
    const detail = page.locator('#diaryRoot [data-diary-detail]');
    await expect(detail.locator('[data-diary-text-view] img.ed-photo-img')).toHaveCount(1);
    await expect(detail.locator('[data-diary-photos] [data-diary-photo]')).toHaveCount(1);
    await expect(detail.locator('[data-diary-photos] [data-diary-photo="body1"]')).toHaveCount(0);
    await expect(cell(page)).toHaveAttribute('aria-label', /사진 1장/);
    await shot(page, `read-${width}`);
    // 다시 열기: 글 칸 안에 그 사진이 그대로 보인다.
    await detail.locator('[data-diary-edit]').click();
    await expect(field(ed).locator('img.ed-photo-img')).toHaveCount(1);
    await expect(ed.locator('.diary-thumb')).toHaveCount(1);
    expect(f.photoReads.every(id => ['day1', 'body1'].includes(id))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(f.errors).toEqual([]);
  });
}

test('잠금 켬: 풀기 전에는 하루 기록·사진을 읽지 않고, PIN을 넣으면 글 안 사진이 보인다 (412)', async ({ page }) => {
  const f = await fixture(page, { width: 412, lock: { pin: '2580' } });
  f.rows[0].doc = { v: 'ed1', doc: { type: 'doc', content: [{ type: 'paragraph', attrs: { style: 'body2' }, content: [{ type: 'text', text: '합성 하루 첫 줄' }] }, { type: 'image', attrs: { src: 'drive:body9', alt: '' } }] } };
  f.rows[0].raw_text = '합성 하루 첫 줄\n\n[사진]';
  f.rows[0].attachments.push({ drive_file_id: 'body9', file_name: '본문.jpg', mime_type: 'image/jpeg', size_bytes: 100 });
  f.rows[0].metadata = { body_photos: ['body9'] };
  const before = f.reads(), photosBefore = f.photoReads.length;
  await page.evaluate(() => window.KPTURouter.go('diary', { source: 'delegated' }));
  const pad = page.locator('#lockView .lk-pad');
  await expect(pad.locator('.lk-title')).toHaveText('하루 기록 잠김');
  await expect(page.locator('#diaryView')).toBeHidden();
  expect(f.reads()).toBe(before);
  expect(f.photoReads.length).toBe(photosBefore);
  await shot(page, 'locked-412');
  for (const d of '2580') await page.locator(`#lockView [data-lk-key="${d}"]`).click();
  await expect(page.locator('#diaryView')).toBeVisible();
  await cell(page).click();
  const detail = page.locator('#diaryRoot [data-diary-detail]');
  await expect(detail.locator('[data-diary-text-view] img.ed-photo-img')).toHaveCount(1);
  await expect(detail.locator('[data-diary-photos] [data-diary-photo]')).toHaveCount(1);
  await expect(cell(page)).toHaveAttribute('aria-label', /사진 1장/);
  expect(f.photoReads).toContain('body9');
  expect(f.errors).toEqual([]);
});

test('글에서 사진을 지우고 저장하면 그 사진은 하루 기록에서도 빠지고 Drive 휴지통으로 간다(그날 사진으로 남지 않음)', async ({ page }) => {
  const f = await fixture(page, { width: 1280 });
  await page.evaluate(() => window.KPTURouter.go('diary'));
  await cell(page).click();
  await page.locator('#diaryRoot [data-diary-edit]').click();
  const ed = editorOf(page);
  await expect(field(ed)).toBeVisible();
  await insertPhoto(page, ed, 1280);
  await expect(field(ed).locator('img.ed-photo-img')).toHaveCount(1);
  await ed.locator('[data-diary-save]').click();
  await expect(ed).toBeHidden();
  expect(f.rows[0].metadata.body_photos).toEqual(['body1']);
  await page.locator('#diaryRoot [data-diary-detail] [data-diary-edit]').click();
  await expect(field(ed).locator('img.ed-photo-img')).toHaveCount(1);
  // 사진을 눌러 고르고 지운다.
  await field(ed).locator('.ed-photo').click();
  await page.keyboard.press('Delete');
  await expect(field(ed).locator('.ed-photo')).toHaveCount(0);
  await ed.locator('[data-diary-save]').click();
  await expect(ed).toBeHidden();
  const row = f.rows[0];
  expect(row.attachments.map(a => a.drive_file_id)).toEqual(['day1']);
  expect(row.metadata.body_photos).toBeUndefined();
  expect(f.prunes).toEqual([['body1']]);
  await expect(page.locator('#diaryRoot [data-diary-detail] [data-diary-photos] [data-diary-photo]')).toHaveCount(1);
  expect(f.errors).toEqual([]);
});

test('저장하지 않고 닫으면 글에 넣은 사진도 다시 뺀다(하루 기록은 그대로)', async ({ page }) => {
  const f = await fixture(page, { width: 412 });
  await page.evaluate(() => window.KPTURouter.go('diary'));
  await cell(page).click();
  await page.locator('#diaryRoot [data-diary-edit]').click();
  const ed = editorOf(page);
  await expect(field(ed)).toBeVisible();
  await insertPhoto(page, ed, 412);
  await expect(field(ed).locator('img.ed-photo-img')).toHaveCount(1);
  await ed.locator('.diary-actions [data-diary-editor-close]').click();
  const ask = page.getByRole('button', { name: '닫기', exact: true });
  if (await ask.isVisible().catch(() => false)) await ask.click();
  await expect(ed).toBeHidden();
  await expect.poll(() => f.rows[0].attachments.map(a => a.drive_file_id)).toEqual(['day1']);
  await expect.poll(() => f.prunes).toEqual([['body1']]);
  expect(f.rows[0].raw_text).toBe('합성 하루 첫 줄');
  expect(f.errors).toEqual([]);
});
