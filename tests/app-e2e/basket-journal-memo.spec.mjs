import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { testOrigin } from './helpers/test-origin.mjs';

// BASKET-일지로남기기: an update that fits no organization or project can be kept as a work-journal memo from its list row ⋯ or
// its detail ⋯ ([업무일지에 남기기]). The mark is metadata.journal_at on the same row (no copy of the text, no new column): the
// update leaves 미분류 (분류 완료 · [업무일지]), and the work journal's day card shows it under "기타 메모" on its own day; the
// [주간보고 초안 복사] text has the same "기타 메모" rows. [업무일지에서 빼기] (or the 5-second [되돌리기]) puts it back in 미분류.
// An update already sent to an organization or a project is not offered the item. Phone 390 and PC 1280. Synthetic data only.
test.use({ hasTouch: true });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co', stamp = '2026-10-06T00:00:00.123456Z';
const A = '20000000-0000-4000-8000-0000000000a1', B = '20000000-0000-4000-8000-0000000000b2', C = '20000000-0000-4000-8000-0000000000c3';
const SHOT_DIR = process.env.JOURNAL_MEMO_SHOTS || '';

async function fixture(page, width) {
  await page.setViewportSize({ width, height: 900 });
  const errors = [], writes = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await openHome(page);
  const base = { workspace_id: 'w', kind: 'basket', title: null, journal_day: null, created_at: stamp, updated_at: stamp, archived_at: null, ai_export_allowed: true, attachments: [] };
  const rows = [
    { ...base, id: A, raw_text: '합성 기타 메모 하나\n둘째 줄', occurred_at: '2026-10-06T02:00:00Z', metadata: { tasks: [], other: 'keep' } },
    { ...base, id: B, raw_text: '합성 미분류 업데이트', occurred_at: '2026-10-06T01:30:00Z', metadata: {} },
    { ...base, id: C, raw_text: '합성 조직 업데이트', occurred_at: '2026-10-06T01:00:00Z', metadata: {} },
  ];
  const links = [{ id: 'l1', workspace_id: 'w', note_id: C, status: 'confirmed', organization_id: 'o', project_id: null, meeting_id: null, document_id: null, summary: null, organization: { name: '테스트 조직' } }];
  // PostgREST filters this screen sends: eq on columns and metadata->>key (eq / is.null), in.(…) on note_id.
  const cell = (row, key) => { const m = /^metadata->>(\w+)$/.exec(key); if (m) { const v = row.metadata?.[m[1]]; return v == null ? null : typeof v === 'string' ? v : JSON.stringify(v); } return row[key]; };
  const holds = (row, q) => [...q.entries()].every(([k, v]) => {
    if (['select', 'order', 'limit', 'offset'].includes(k) || k.startsWith('metadata->') && !k.startsWith('metadata->>')) return true;
    if (k === 'metadata') return false;
    const [op, ...rest] = v.split('.'), val = rest.join('.'), got = cell(row, k);
    if (op === 'is') return got == null;
    if (op === 'eq') return String(got) === val;
    return true;
  });
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams;
    if (req.method() === 'GET') { if (q.get('metadata')) return r.fulfill({ json: [] }); return r.fulfill({ json: rows.filter(row => holds(row, q)).slice(Number(q.get('offset') || 0)) }); }
    if (req.method() === 'PATCH') { const body = req.postDataJSON(); writes.push({ query: Object.fromEntries(q), body }); const hit = rows.filter(row => holds(row, q)); hit.forEach(row => Object.assign(row, body)); return r.fulfill({ json: hit }); }
    return r.fulfill({ status: 500, json: {} });
  });
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; if (q.has('google_task_id')) return r.fulfill({ json: [] }); if (!q.has('note_id')) return r.fallback(); const ids = (q.get('note_id').match(/^in\.\((.*)\)$/)?.[1] || '').split(',').map(decodeURIComponent); return r.fulfill({ json: links.filter(l => ids.includes(l.note_id)) }); });
  for (const t of ['app_documents', 'app_suborganization_updates', 'app_project_progress_updates', 'app_share_pages']) await page.route(SB + '/rest/v1/' + t + '?**', r => r.fulfill({ json: [] }));
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: testOrigin });
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await expect(page.locator(`[data-basket-row="${A}"]`)).toBeVisible();
  return { rows, writes, errors };
}
const press = async (page, l, width) => { await expect(l).toBeVisible(); if (width < 761) await l.tap(); else await l.click(); };
const rowMenu = page => page.locator('#basketRowMenu');
const rowMore = (page, id) => page.locator(`[data-basket-row-more="${id}"]`);
const row = (page, id) => page.locator(`[data-basket-row="${id}"]`);
const notice = page => page.locator('[data-undo-notice]');
async function openJournal(page, width) {
  if (width <= 760) {
    await page.locator('.mobile-tabs [data-mobile-schedule-tab]').click();
    await expect(page.locator('#calendarView')).toBeVisible();
    await page.locator('#calendarView .schedule-switch [data-view="journal"]').click();
  } else await page.locator('.app-nav [data-view="journal"]').click();
  await expect(page.locator('#journalView')).toBeVisible();
  await expect(page.locator('#journalRoot [data-journal-title]')).toHaveText('10월 5일 ~ 11일');
}
const group = (page, key) => page.locator(`#journalRoot [data-journal-group="${key}"]`);

for (const width of [390, 1280]) {
  test(`[업무일지에 남기기] from the row ⋯: leaves 미분류, shows under 기타 메모 and in the weekly draft, [업무일지에서 빼기] brings it back ${width}`, async ({ page }, info) => {
    const f = await fixture(page, width);
    // A plain update offers the item before 삭제; it leaves 미분류 at once and the 5-second undo notice appears.
    await press(page, rowMore(page, A), width);
    await expect(rowMenu(page).locator('button')).toHaveText([...(width < 761 ? ['복사'] : []), '수정', '연결하기', '할 일 만들기', '노트로 옮기기', '업무일지에 남기기', '삭제']);
    await press(page, rowMenu(page).getByRole('button', { name: '업무일지에 남기기', exact: true }), width);
    await expect(row(page, A)).toHaveCount(0);
    await expect(row(page, B)).toBeVisible();
    await expect(notice(page)).toContainText('업무일지에 남겼어요.');
    await expect(notice(page).getByRole('button', { name: '되돌리기' })).toBeVisible();
    // One metadata-only write, every other key kept, guarded by the version read; the text and updated_at are untouched.
    expect(f.writes).toHaveLength(1);
    expect(Object.keys(f.writes[0].body)).toEqual(['metadata']);
    expect(f.writes[0].body.metadata).toEqual({ tasks: [], other: 'keep', journal_at: '2026-10-06T01:00:00.000Z' });
    expect(f.writes[0].query).toMatchObject({ id: 'eq.' + A, kind: 'eq.basket', updated_at: 'eq.' + stamp, 'metadata->>journal_at': 'is.null' });
    expect(f.rows.find(r => r.id === A).updated_at).toBe(stamp);
    // 분류 완료 · [업무일지] holds it, stated as 업무일지 메모. An update sent to an organization is not offered the item.
    await press(page, page.locator('[data-basket-filter="classified"]'), width);
    await expect(row(page, A)).toContainText('업무일지 메모');
    await press(page, page.locator('[data-basket-place-filter]').getByRole('radio', { name: '업무일지' }), width);
    await expect(page.locator('[data-basket-rows] [data-basket-row]')).toHaveCount(1);
    await expect(row(page, A)).toBeVisible();
    await press(page, page.locator('[data-basket-place-filter]').getByRole('radio', { name: '전체' }), width);
    await press(page, rowMore(page, C), width);
    await expect(rowMenu(page).locator('button')).toHaveText([...(width < 761 ? ['복사'] : []), '수정', '연결하기', '할 일 만들기', '노트로 옮기기', '삭제']);
    await page.keyboard.press('Escape'); await expect(rowMenu(page)).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (SHOT_DIR && width === 390) await page.screenshot({ path: `${SHOT_DIR}/journal-memo-basket-390.png` });
    await page.screenshot({ path: info.outputPath(`journal-memo-basket-${width}.png`) });
    // The work journal: 기타 메모 holds the update's first line on its day; it is no longer under 조직 소식 · 미분류.
    await openJournal(page, width);
    await expect(group(page, 'memos').locator('h4')).toHaveText('기타 메모');
    await expect(group(page, 'memos').locator('li')).toHaveText(['합성 기타 메모 하나']);
    await expect(group(page, 'orgs').locator('[data-journal-org="미분류"] li')).toHaveText(['합성 미분류 업데이트']);
    await expect(page.locator('#journalRoot [data-journal-empty]')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (SHOT_DIR && width === 390) { await group(page, 'memos').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${SHOT_DIR}/journal-memo-journal-390.png` }); }
    await page.screenshot({ path: info.outputPath(`journal-memo-journal-${width}.png`), fullPage: true });
    // [주간보고 초안 복사] (양식 순서, 2026-10-21): 기타 메모는 참고에 그 날짜로, 미분류는 4. 산하 조직 현황에.
    await press(page, page.locator('#journalRoot [data-journal-copy]'), width);
    const lines = (await page.evaluate(() => navigator.clipboard.readText())).split('\n');
    const memo = lines.indexOf('◦ 기타 메모'), unsorted = lines.indexOf('◦ 미분류');
    expect(memo).toBeGreaterThan(lines.indexOf('참고'));
    expect(lines[memo + 1]).toBe('- 10월 6일(화) 합성 기타 메모 하나');
    expect(unsorted).toBeGreaterThan(lines.indexOf('4. 산하 조직 현황'));
    expect(lines[unsorted + 1]).toBe('- 10월 6일(화) 합성 미분류 업데이트');
    expect(lines.filter(l => l.includes('합성 기타 메모 하나'))).toHaveLength(1);
    // [업무일지에서 빼기] from the row ⋯ removes only the mark: back in 미분류, and the journal has no 기타 메모 box.
    await page.evaluate(() => window.KPTURouter.go('basket'));
    await expect(row(page, B)).toBeVisible(); await expect(row(page, A)).toHaveCount(0);
    await press(page, page.locator('[data-basket-filter="classified"]'), width);
    await press(page, rowMore(page, A), width);
    await expect(rowMenu(page).locator('button')).toHaveText([...(width < 761 ? ['복사'] : []), '수정', '연결하기', '할 일 만들기', '노트로 옮기기', '업무일지에서 빼기', '삭제']);
    await press(page, rowMenu(page).getByRole('button', { name: '업무일지에서 빼기', exact: true }), width);
    await expect(row(page, A)).toHaveCount(0);
    await expect(notice(page)).toContainText('업무일지에서 뺐어요.');
    expect(f.writes.at(-1).body.metadata).toEqual({ tasks: [], other: 'keep' });
    expect(f.writes.at(-1).query['metadata->>journal_at']).toBe('eq.2026-10-06T01:00:00.000Z');
    await press(page, page.locator('[data-basket-filter="unclassified"]'), width);
    await expect(row(page, A)).toBeVisible();
    // The schedule tab remembers the journal on a phone, so the second visit goes straight there.
    await page.evaluate(() => window.KPTURouter.go('journal'));
    await expect(page.locator('#journalView')).toBeVisible();
    await expect(group(page, 'orgs').locator('[data-journal-org="미분류"] li')).toHaveText(['합성 미분류 업데이트', '합성 기타 메모 하나']);
    await expect(group(page, 'memos')).toHaveCount(0);
    expect(f.errors).toEqual([]);
  });

  test(`[업무일지에 남기기] from the update detail ⋯, then [되돌리기] within 5 seconds ${width}`, async ({ page }) => {
    const f = await fixture(page, width);
    await press(page, row(page, B), width);
    const detail = page.locator('[data-basket-detail]'), more = detail.locator('[data-basket-note-more]'), menu = detail.locator('#basketNoteMenu');
    await expect(detail.locator('[data-basket-state]')).toHaveText('미분류');
    await press(page, more, width);
    await expect(menu.getByRole('button')).toHaveText(['수정', '보관', '업무일지에 남기기', '삭제']);
    await press(page, menu.getByRole('button', { name: '업무일지에 남기기', exact: true }), width);
    await expect(detail.locator('[data-basket-state]')).toHaveText('업무일지 메모');
    await expect(more).toBeFocused();
    await press(page, more, width);
    await expect(menu.getByRole('button')).toHaveText(['수정', '보관', '업무일지에서 빼기', '삭제']);
    await page.keyboard.press('Escape');
    // [되돌리기] removes the mark again (one more guarded write); the update is 미분류 again.
    await press(page, notice(page).getByRole('button', { name: '되돌리기' }), width);
    await expect(notice(page)).toContainText('업무일지에서 다시 뺐어요.');
    await expect(detail.locator('[data-basket-state]')).toHaveText('미분류');
    expect(f.writes.map(w => w.body.metadata)).toEqual([{ journal_at: '2026-10-06T01:00:00.000Z' }, {}]);
    // An update sent to an organization: its detail ⋯ has no journal item.
    await press(page, detail.locator('[data-basket-close]'), width);
    await press(page, page.locator('[data-basket-filter="classified"]'), width);
    await press(page, row(page, C), width);
    await press(page, more, width);
    await expect(menu.getByRole('button')).toHaveText(['수정', '보관', '삭제']);
    expect(f.errors).toEqual([]);
  });
}
