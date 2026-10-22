import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { testOrigin } from './helpers/test-origin.mjs';
import { expectNoteTitle } from './helpers/note-title.mjs';

// 5-2 A: an update moved to a note ([노트로 옮기기]) keeps one mark on its row (metadata.moved_from_update_at, the other keys stay).
// The work journal then shows that note as one "노트: (제목)" line on the update's own day, without its text; pressing the line opens
// the note. A note without the mark (written as a note, or moved before the mark existed) is not shown, and the weekly draft
// does not carry the line. A failed read hides only this line. Phone 390 and PC 1280. Synthetic data only.
test.use({ hasTouch: true });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co', stamp = '2026-10-06T00:00:00.123456Z';
const A = '20000000-0000-4000-8000-0000000000a1', N1 = '20000000-0000-4000-8000-0000000000b2', N2 = '20000000-0000-4000-8000-0000000000c3';
const SECRET = '합성 본문 비밀문장';
const SHOT = process.env.JOURNAL_NOTE_SHOT || '';

async function fixture(page, width, { movedReadFails = false } = {}) {
  await page.setViewportSize({ width, height: 900 });
  const errors = [], writes = [], gets = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await openHome(page);
  const base = { workspace_id: 'w', journal_day: null, created_at: stamp, updated_at: stamp, archived_at: null, ai_export_allowed: true, attachments: [] };
  const rows = [
    { ...base, id: A, kind: 'basket', title: null, raw_text: '합성 옮길 업데이트\n둘째 줄', occurred_at: '2026-10-06T02:00:00Z', metadata: { tasks: [], other: 'keep' } },
    { ...base, id: N1, kind: 'note', title: '합성 옮긴 노트', raw_text: SECRET, occurred_at: '2026-10-06T05:00:00Z', metadata: { moved_from_update_at: '2026-10-07T00:00:00.000Z', folder: '합성폴더' } },
    { ...base, id: N2, kind: 'note', title: '처음부터 쓴 노트', raw_text: SECRET, occurred_at: '2026-10-06T06:00:00Z', metadata: {} },
  ];
  const cell = (row, key) => { const m = /^metadata->>(\w+)$/.exec(key); if (m) { const v = row.metadata?.[m[1]]; return v == null ? null : typeof v === 'string' ? v : JSON.stringify(v); } return row[key]; };
  const holds = (row, q) => [...q.entries()].every(([k, v]) => {
    if (['select', 'order', 'limit', 'offset'].includes(k) || k.startsWith('metadata->') && !k.startsWith('metadata->>')) return true;
    if (k === 'metadata') return false;
    const [op, ...rest] = v.split('.'), val = rest.join('.'), got = cell(row, k);
    if (op === 'is') return got == null;
    if (op === 'not') return val === 'is.null' ? got != null : true;
    if (op === 'eq') return String(got) === val;
    return true;
  });
  // The select decides which columns come back (PostgREST aliases like moved_at:metadata->>key are honoured), so a text read would show.
  const project = (row, select) => {
    if (!select || select === '*') return row;
    const out = {};
    for (const part of select.split(',')) {
      const alias = /^(\w+):metadata->>(\w+)$/.exec(part);
      if (alias) out[alias[1]] = row.metadata?.[alias[2]] ?? null; else if (part in row) out[part] = row[part];
    }
    return out;
  };
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams;
    if (req.method() === 'GET') {
      gets.push(Object.fromEntries(q));
      if (movedReadFails && q.get('metadata->>moved_from_update_at')) return r.fulfill({ status: 500, json: { message: 'boom' } });
      if (q.get('metadata')) return r.fulfill({ json: [] });
      return r.fulfill({ json: rows.filter(row => holds(row, q)).slice(Number(q.get('offset') || 0)).map(row => project(row, q.get('select'))) });
    }
    if (req.method() === 'PATCH') { const body = req.postDataJSON(); writes.push({ query: Object.fromEntries(q), body }); const hit = rows.filter(row => holds(row, q)); hit.forEach(row => Object.assign(row, body)); return r.fulfill({ json: hit.map(row => project(row, q.get('select'))) }); }
    return r.fulfill({ status: 500, json: {} });
  });
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; if (q.has('google_task_id')) return r.fulfill({ json: [] }); if (!q.has('note_id')) return r.fallback(); return r.fulfill({ json: [] }); });
  for (const t of ['app_documents', 'app_suborganization_updates', 'app_project_progress_updates', 'app_share_pages']) await page.route(SB + '/rest/v1/' + t + '?**', r => r.fulfill({ json: [] }));
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: testOrigin });
  return { rows, writes, gets, errors };
}
const press = async (page, l, width) => { await expect(l).toBeVisible(); if (width < 761) await l.tap(); else await l.click(); };
// JOURNAL-주간정리다듬기 ①: the top-row copy button is gone; the draft is copied by [주간 정리]'s [복사] (beside [주간보고 한글 파일 만들기]).
// This goes to [주간 정리], presses [복사], waits for the copy notice and comes back to [하루].
const copyDraft = async (page, width) => {
  await press(page, page.locator('#journalRoot [data-journal-mode="week"]'), width);
  await page.locator('#journalRoot [data-journal-status]').evaluate(e => { e.textContent = ''; });
  await press(page, page.locator('#journalRoot [data-hwpx-copy]'), width);
  await expect(page.locator('#journalRoot [data-journal-status]')).toContainText('복사');
  await press(page, page.locator('#journalRoot [data-journal-mode="day"]'), width);
  await expect(page.locator('#journalRoot [data-journal-day]')).toBeVisible();
};
async function openJournal(page, width) {
  if (width <= 760) {
    await page.locator('.mobile-tabs [data-mobile-schedule-tab]').click();
    await expect(page.locator('#calendarView')).toBeVisible();
    await page.locator('#calendarView .schedule-switch [data-view="journal"]').click();
  } else await page.locator('.app-nav [data-view="journal"]').click();
  await expect(page.locator('#journalView')).toBeVisible();
  await expect(page.locator('#journalRoot [data-journal-title]')).toHaveText('10월 5일 ~ 11일');
}
// JOURNAL-하루개편: 노트로 옮긴 것 is one part of 그 밖의 기록 (folded by default).
const moved = page => page.locator('#journalRoot [data-journal-group="movedNotes"]');
async function openOthers(page, width) {
  const box = page.locator('#journalRoot [data-journal-others]');
  if (!(await box.evaluate(e => e.open))) await press(page, box.locator('summary'), width);
  await expect(box).toHaveJSProperty('open', true);
}

for (const width of [390, 1280]) {
  test(`moving an update to a note keeps its other metadata and adds the mark; the journal shows only marked notes as one title line ${width}`, async ({ page }, info) => {
    const f = await fixture(page, width);
    await page.evaluate(() => window.KPTURouter.go('basket'));
    const rowA = page.locator(`[data-basket-row="${A}"]`);
    await expect(rowA).toBeVisible();
    page.on('dialog', d => d.accept());
    await press(page, page.locator(`[data-basket-row-more="${A}"]`), width);
    await press(page, page.locator('#basketRowMenu').getByRole('button', { name: '노트로 옮기기', exact: true }), width);
    await expect(page.locator('#toast')).toHaveText('노트로 옮겼어요.');
    // ① one guarded write: kind and title change, the mark is added, every other key stays.
    expect(f.writes).toHaveLength(1);
    expect(f.writes[0].query).toMatchObject({ id: 'eq.' + A, kind: 'eq.basket', updated_at: 'eq.' + stamp, 'metadata->>moved_from_update_at': 'is.null' });
    expect(f.writes[0].body).toMatchObject({ kind: 'note', title: '합성 옮길 업데이트' });
    expect(f.writes[0].body.metadata).toEqual({ tasks: [], other: 'keep', moved_from_update_at: '2026-10-06T01:00:00.000Z' });
    expect(f.errors).toEqual([]);
    // ②③ the journal: the day card has the moved notes (the one just moved and the marked one), not the unmarked note.
    await openJournal(page, width);
    await expect(page.locator('#journalRoot [data-journal-others-count]')).toContainText('노트로 옮긴 것 2');
    await openOthers(page, width);
    await expect(moved(page).locator('h5')).toHaveText('노트로 옮긴 것');
    await expect(moved(page).locator('li')).toHaveText(['노트: 합성 옮길 업데이트', '노트: 합성 옮긴 노트']);
    await expect(moved(page).locator('[data-record-mark="note"]')).toHaveCount(2);
    await expect(page.locator('#journalRoot')).not.toContainText('처음부터 쓴 노트');
    await expect(page.locator('#journalRoot')).not.toContainText(SECRET);
    // The read asks for the id, title, day and the mark only: no text, no other metadata.
    const read = f.gets.find(g => g['metadata->>moved_from_update_at']);
    expect(read.select).toBe('id,title,occurred_at,moved_at:metadata->>moved_from_update_at');
    expect(read.kind).toBe('eq.note');
    // Another day has no such line; the original update is no longer an update of the day (it left the basket).
    await press(page, page.locator('#journalRoot [data-journal-date="2026-10-07"]'), width);
    await expect(moved(page)).toHaveCount(0);
    await press(page, page.locator('#journalRoot [data-journal-date="2026-10-06"]'), width);
    await expect(moved(page)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (SHOT && width === 390) { await moved(page).scrollIntoViewIfNeeded(); await page.locator('#journalRoot [data-journal-day]').screenshot({ path: SHOT }); }
    await page.screenshot({ path: info.outputPath(`journal-moved-note-${width}.png`), fullPage: true });
    // The weekly draft does not carry the note line.
    await copyDraft(page, width);
    await expect(page.locator('#journalRoot [data-journal-status]')).toContainText('복사했어요');
    const draft = await page.evaluate(() => navigator.clipboard.readText());
    expect(draft).not.toContain('노트:');
    expect(draft).not.toContain('합성 옮긴 노트');
    // ④ pressing the line opens that note on the basket's [노트] side.
    await press(page, moved(page).locator('.journal-item-open', {hasText:'합성 옮긴 노트'}), width);
    await expect(page.locator('#basketView')).toBeVisible();
    await expectNoteTitle(page,'합성 옮긴 노트');
    expect(f.errors).toEqual([]);
  });

  test(`a failed moved-note read hides only that line; the rest of the journal and the draft work ${width}`, async ({ page }) => {
    const f = await fixture(page, width, { movedReadFails: true });
    await openJournal(page, width);
    await expect(page.locator('#journalRoot [data-journal-report]')).toBeVisible();
    await expect(page.locator('#journalRoot [data-journal-line]')).toBeVisible();
    await expect(moved(page)).toHaveCount(0);
    await expect(page.locator('#journalRoot [data-journal-failed]')).toHaveCount(0);
    await copyDraft(page, width);
    await expect(page.locator('#journalRoot [data-journal-status]')).toHaveText('주간보고 양식 순서로 복사했어요.');
    expect(f.errors).toEqual([]);
  });
}
