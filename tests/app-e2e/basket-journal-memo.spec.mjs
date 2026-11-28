import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { testOrigin } from './helpers/test-origin.mjs';
import { openBasketUpdate } from './helpers/forget-view.mjs';

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
  let hold = null, release = () => {};
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
    if (req.method() === 'GET') { if (writes.length && hold) await hold; if (q.get('metadata')) return r.fulfill({ json: [] }); return r.fulfill({ json: rows.filter(row => holds(row, q)).slice(Number(q.get('offset') || 0)) }); }
    if (req.method() === 'PATCH') { const body = req.postDataJSON(); writes.push({ query: Object.fromEntries(q), body }); const hit = rows.filter(row => holds(row, q)); hit.forEach(row => Object.assign(row, body)); return r.fulfill({ json: hit }); }
    return r.fulfill({ status: 500, json: {} });
  });
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; if (q.has('google_task_id')) return r.fulfill({ json: [] }); if (!q.has('note_id')) return r.fallback(); const ids = (q.get('note_id').match(/^in\.\((.*)\)$/)?.[1] || '').split(',').map(decodeURIComponent); return r.fulfill({ json: links.filter(l => ids.includes(l.note_id)) }); });
  // 주간 보고 바탕(자료실 '주간보고' 분류) 찾기는 기본 도우미(home-entry.mjs, 바탕 있는 계정)로 넘긴다 — 바탕 없는 새 계정은 [주간 보고]가 백지다(S62-23).
  for (const t of ['app_documents', 'app_suborganization_updates', 'app_project_progress_updates', 'app_share_pages']) await page.route(SB + '/rest/v1/' + t + '?**', r => (t === 'app_documents' && /주간보고/.test(decodeURIComponent(new URL(r.request().url()).searchParams.get('category') ?? '')) ? r.fallback() : r.fulfill({ json: [] })));
  // 주간 정리는 바탕 한글 파일을 document-actions(hwp-open)로 연다. 가짜로 막지 않으면 진짜 네트워크 실패가 임의 시각에 도착해 '파일을 열지 못했어요'
  // 줄이 눌러 보는 도중 끼어든다(#3278). 바로 거절로 답하고 횟수를 센다 — 시험은 그 답이 화면에 그려진 뒤에 ⋯ 를 누른다.
  const hwpOpens = { n: 0 };
  await page.route(u => u.origin === SB && u.pathname === '/functions/v1/document-actions', r => { hwpOpens.n++; return r.fulfill({ status: 400, json: { ok: false, error: '시험용 거절' } }); });
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: testOrigin });
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await expect(page.locator(`[data-basket-row="${A}"]`)).toBeVisible();
  // holdRereads(): 표시를 바꾼 뒤의 읽기를 release()까지 붙잡는다(연 화면 유지로 옛 자료를 그린 채 다시 읽는 중인 상태).
  return { rows, writes, errors, hwpOpens, holdRereads: () => { hold = new Promise(ok => { release = () => { hold = null; ok(); }; }); }, release: () => release() };
}
const press = async (page, l, width) => { await expect(l).toBeVisible(); if (width < 761) await l.tap(); else await l.click(); };
// JOURNAL-주간정리다듬기 ①·WEEKLY-한흐름확정 ②: the draft is copied by [주간 정리]'s ⋯ → [글로 복사] beside [확정하고 한글 파일 받기]
// (end of 5. 주요 일정). This goes to [주간 정리], opens that ⋯, presses [글로 복사], waits for the copy notice and comes back to [하루].
// [주간 정리]를 연 뒤 바탕 파일 열기 답(위 hwp-open 거절)이 화면에 그려질 때까지 기다린다 — 그 줄이 나중에 끼어들어 ⋯ 를 닫지 않게.
const weekSettled = async (page, f) => {
  await expect.poll(() => f.hwpOpens.n).toBeGreaterThan(0);
  await expect(page.locator('#journalRoot [data-hwpx-status]')).not.toBeEmpty();
};
const copyDraft = async (page, width, f) => {
  await press(page, page.locator('#journalRoot [data-journal-mode="week"]'), width);
  await weekSettled(page, f);
  await page.locator('#journalRoot [data-journal-status]').evaluate(e => { e.textContent = ''; });
  await press(page, page.locator('#journalRoot [data-weekly-flow-confirm] details.row-more summary'), width);
  await press(page, page.locator('#journalRoot [data-weekly-flow-confirm] [data-hwpx-copy]'), width);
  await expect(page.locator('#journalRoot [data-journal-status]')).toContainText('복사');
  await press(page, page.locator('#journalRoot [data-journal-mode="day"]'), width);
  await expect(page.locator('#journalRoot [data-journal-day]')).toBeVisible();
};
const rowMenu = page => page.locator('#basketRowMenu');
const rowMore = (page, id) => page.locator(`[data-basket-row-more="${id}"]`);
const row = (page, id) => page.locator(`[data-basket-row="${id}"]`);
const notice = page => page.locator('[data-undo-notice]');
// HOME-업무일지홈: 업무일지는 홈이다 — 폰은 하단 탭 [홈], PC는 사이드바 맨 위 [홈]. 들어오면 오늘(10월 6일 화요일).
async function openJournal(page, width) {
  if (width <= 760) await page.locator('.mobile-tabs [data-view="home"]').click();
  else await page.locator('#appView>.app-nav .sidebar-brand').click();
  await expect(page.locator('#homeView')).toBeVisible();
  await expect(page.locator('#journalRoot [data-journal-title]')).toHaveText('10월 6일 화요일');
}
const group = (page, key) => page.locator(`#journalRoot [data-journal-group="${key}"]`);
// JOURNAL-그밖의기록삭제: the day card has no 그 밖의 기록 (no 기타 메모·어디에도 안 보낸 업데이트 boxes); they stay in the basket.
async function expectNoOthers(page) {
  await expect(page.locator('#journalRoot [data-journal-report]')).toBeVisible();
  await expect(page.locator('#journalRoot [data-journal-others]')).toHaveCount(0);
  await expect(group(page, 'memos')).toHaveCount(0); await expect(group(page, 'unsent')).toHaveCount(0);
}

for (const width of [390, 1280]) {
  test(`[업무일지에 남기기] from the row ⋯: leaves 미분류, shows under 기타 메모 and in the weekly draft, [업무일지에서 빼기] brings it back ${width}`, async ({ page }, info) => {
    const f = await fixture(page, width);
    // A plain update offers the item before 삭제; it leaves 미분류 at once and the 5-second undo notice appears.
    await press(page, rowMore(page, A), width);
    await expect(rowMenu(page).locator('button')).toHaveText(['복사', '수정', '연결하기', '할 일로', '일정으로', '노트로', '하루 기록으로 보내기', '조직', '사업', '사업 보고로 옮기기', '업무일지에 남기기', '보류로', '삭제']);
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
    // S71-58 FORGET-처리전만: the kept memo is handled — it leaves the 처리 전 list (no 분류 완료 view any more). Its detail states 업무일지 메모.
    await expect(row(page, A)).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (SHOT_DIR && width === 390) await page.screenshot({ path: `${SHOT_DIR}/journal-memo-basket-390.png` });
    await page.screenshot({ path: info.outputPath(`journal-memo-basket-${width}.png`) });
    // The work journal: JOURNAL-그밖의기록삭제 — neither the kept memo nor the update sent nowhere is on the day card (no '미분류' either).
    await openJournal(page, width);
    await expectNoOthers(page);
    await expect(page.locator('#journalRoot [data-journal-org="미분류"]')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (SHOT_DIR && width === 390) await page.screenshot({ path: `${SHOT_DIR}/journal-memo-journal-390.png` });
    await page.screenshot({ path: info.outputPath(`journal-memo-journal-${width}.png`), fullPage: true });
    // [주간보고 초안 복사] (양식 순서, 2026-10-21): 기타 메모는 참고에 그 날짜로, 미분류는 4. 산하 조직 현황에.
    await copyDraft(page, width, f);
    const lines = (await page.evaluate(() => navigator.clipboard.readText())).split('\n');
    const memo = lines.indexOf('◦ 기타 메모'), unsorted = lines.indexOf('◦ 미분류');
    expect(memo).toBeGreaterThan(lines.indexOf('참고'));
    expect(lines[memo + 1]).toBe('- 10월 6일(화) 합성 기타 메모 하나');
    expect(unsorted).toBeGreaterThan(lines.indexOf('4. 산하조직 현황'));
    expect(lines[unsorted + 1]).toBe('- 10월 6일(화) 합성 미분류 업데이트');
    expect(lines.filter(l => l.includes('합성 기타 메모 하나'))).toHaveLength(1);
    // [업무일지에서 빼기] from the update's detail ⋯ (S71-58: a handled update is opened by its address) removes only the mark: back in 미분류.
    await page.evaluate(() => window.KPTURouter.go('basket'));
    await expect(row(page, B)).toBeVisible(); await expect(row(page, A)).toHaveCount(0);
    await openBasketUpdate(page, A);
    const detailA = page.locator('[data-basket-detail]');
    await expect(detailA.locator('[data-basket-state]')).toHaveText('업무일지 메모');
    await press(page, detailA.locator('[data-basket-note-more]'), width);
    await press(page, detailA.locator('#basketNoteMenu').getByRole('button', { name: '업무일지에서 빼기', exact: true }), width);
    await expect(notice(page)).toContainText('업무일지에서 뺐어요.');
    expect(f.writes.at(-1).body.metadata).toEqual({ tasks: [], other: 'keep' });
    expect(f.writes.at(-1).query['metadata->>journal_at']).toBe('eq.2026-10-06T01:00:00.000Z');
    await press(page, detailA.locator('[data-basket-close]'), width);
    await expect(row(page, A)).toBeVisible();
    // HOME-업무일지홈: 두 번째 방문도 홈(업무일지).
    await page.evaluate(() => window.KPTURouter.go('home'));
    await expect(page.locator('#homeView')).toBeVisible();
    await expectNoOthers(page);
    expect(f.errors).toEqual([]);
  });

  // S67-01: 업무일지에 남긴 뒤 하루 화면이 옛 자료를 그린 채 정리함을 다시 읽는 중에 [글로 복사]를 눌러도, 다시 읽기를 기다려 기타 메모가 초안에 들어간다.
  test(`[글로 복사] while the basket is being re-read after the mark waits for it ${width}`, async ({ page }) => {
    const f = await fixture(page, width);
    await openJournal(page, width);
    await page.evaluate(() => window.KPTURouter.go('basket'));
    await expect(row(page, A)).toBeVisible();
    await press(page, rowMore(page, A), width);
    await press(page, rowMenu(page).getByRole('button', { name: '업무일지에 남기기', exact: true }), width);
    await expect(row(page, A)).toHaveCount(0);
    await expect.poll(() => f.writes.length).toBe(1);
    f.holdRereads();
    await openJournal(page, width);
    await press(page, page.locator('#journalRoot [data-journal-mode="week"]'), width);
    await weekSettled(page, f);
    await page.locator('#journalRoot [data-journal-status]').evaluate(e => { e.textContent = ''; });
    await press(page, page.locator('#journalRoot [data-weekly-flow-confirm] details.row-more summary'), width);
    await press(page, page.locator('#journalRoot [data-weekly-flow-confirm] [data-hwpx-copy]'), width);
    // 다시 읽기가 끝나기 전에는 복사하지 않는다.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(page.locator('#journalRoot [data-journal-status]')).not.toContainText('복사');
    f.release();
    await expect(page.locator('#journalRoot [data-journal-status]')).toContainText('복사');
    const lines = (await page.evaluate(() => navigator.clipboard.readText())).split('\n');
    const memo = lines.indexOf('◦ 기타 메모');
    expect(memo).toBeGreaterThan(lines.indexOf('참고'));
    expect(lines[memo + 1]).toBe('- 10월 6일(화) 합성 기타 메모 하나');
    expect(f.errors).toEqual([]);
  });
  test(`[업무일지에 남기기] from the update detail ⋯, then [되돌리기] within 5 seconds ${width}`, async ({ page }) => {
    const f = await fixture(page, width);
    await press(page, row(page, B), width);
    const detail = page.locator('[data-basket-detail]'), more = detail.locator('[data-basket-note-more]'), menu = detail.locator('#basketNoteMenu');
    await expect(detail.locator('[data-basket-state]')).toHaveText('미분류');
    await press(page, more, width);
    await expect(menu.getByRole('button')).toHaveText(['수정', '보류로', '하루 기록으로 보내기', '업무일지에 남기기', '삭제']);
    await press(page, menu.getByRole('button', { name: '업무일지에 남기기', exact: true }), width);
    await expect(detail.locator('[data-basket-state]')).toHaveText('업무일지 메모');
    await expect(more).toBeFocused();
    await press(page, more, width);
    await expect(menu.getByRole('button')).toHaveText(['수정', '보류로', '하루 기록으로 보내기', '업무일지에서 빼기', '삭제']);
    await page.keyboard.press('Escape');
    // [되돌리기] removes the mark again (one more guarded write); the update is 미분류 again.
    await press(page, notice(page).getByRole('button', { name: '되돌리기' }), width);
    await expect(notice(page)).toContainText('업무일지에서 다시 뺐어요.');
    await expect(detail.locator('[data-basket-state]')).toHaveText('미분류');
    expect(f.writes.map(w => w.body.metadata)).toEqual([{ journal_at: '2026-10-06T01:00:00.000Z' }, {}]);
    // An update sent to an organization: its detail ⋯ has no journal item.
    await press(page, detail.locator('[data-basket-close]'), width);
    await openBasketUpdate(page, C);
    await press(page, more, width);
    await expect(menu.getByRole('button')).toHaveText(['수정', '보류로', '하루 기록으로 보내기', '삭제']);
    expect(f.errors).toEqual([]);
  });
}
