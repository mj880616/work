import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { routeMemos } from './helpers/memo-server.mjs';
import { revealLibraryRow } from './helpers/library-tree.mjs';
import { installTgServer, telegramRows, T } from './helpers/tg-room-day-server.mjs';

// S69-95 NOTE-메모넓히기(명진 11/25 03:16~03:17 "또 메모 남길만한 거 뭐가 있을까 워크온+ 내에" → 자료실 파일·사업 관리 회의 기록·조직 관리 담당조직 기록·
// 텔레그램 소식 / "중요한 건 메모를 모아두는 화면에서는 메모도 보이지만 그 메모를 남긴 원문 기록으로 연결 도 되어야한다는 거야"):
// - 네 곳 모두 노트·저장한 글과 같은 메모 칸(memo-thread.js)에서 [메모 남기기] → 서버 메모 표 한 줄(대상 종류·대상 id·원문 제목 사본).
//   자료실 자료: ⋯ [메모] → 자료 창 아래 / 사업 보고: 보고 창 맨 아래 / 담당조직 기록: 기록 ⋯ [메모] → 기록 창 아래 / 텔레그램 소식: 펼친 원문 아래.
// - 노트 › [메모] 모아 보기에 출처 꼬리표(자료실·사업 보고·담당조직·텔레그램)·원문 제목이 보이고, 누르면 그 원문 기록이 열려 그 메모로 내려가 칠해진다.
// - 원문이 지워졌으면 메모는 남고 '원래 기록이 없어요'(링크만 꺼짐).
// 공유로 메모가 남에게 가지 않는 것은 서버 규칙이라 DB 시험(tests/auth-handoff/memos-more-targets-db.test.mjs)이 본다. 폰 390·PC 1280. 이름·글은 지어낸 것.
test.use({ hasTouch: true });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const DOC = 'f1000000-0000-4000-8000-000000000001', DOC_GONE = 'f1000000-0000-4000-8000-000000000009';
const MEET = 'f2000000-0000-4000-8000-000000000001';
const ORG = 'f3000000-0000-4000-8000-000000000001', REC = 'f4000000-0000-4000-8000-000000000001';
const OLD = n => `f5000000-0000-4000-8000-00000000000${n}`;
const memo = (n, type, id, body, at, title) => ({ id: OLD(n), workspace_id: 'w', target_type: type, target_id: id, target_title: title, body, quote: null, kind: null, created_at: at, updated_at: at });

async function fixture(page, width) {
  await page.setViewportSize({ width, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const doc = { id: DOC, workspace_id: 'w', project_id: null, organization_id: null, meeting_id: null, title: '가상 교섭 요구안', category: '교섭', source: null, document_date: '2026-10-02',
    description: '가상 요구안 설명 한 줄.', tags: [], file_id: 'driveFileA', file_name: '요구안.hwpx', mime_type: 'application/x-hwp', file_size: 2048, drive_url: 'https://drive.google.com/file/d/driveFileA/view',
    created_at: '2026-10-02T00:00:00Z', updated_at: '2026-10-02T00:00:00Z', extraction_status: 'ready', previous_files: [] };
  const meeting = { id: MEET, workspace_id: 'w', project_id: null, title: '가상 정례 회의', series_name: '가상 정례 회의', round_no: 3, meeting_at: '2026-10-05T01:00:00Z', notes: '', decisions: '', location: '',
    attendee_count: 1, transcript_text: '가상 회의 결과 첫 줄', created_by: 'home-test', deleted_at: null };
  const rec = { id: REC, organization_id: ORG, raw_text: '가상 조직 첫 기록', detail_text: null, occurred_at: '2026-10-04T03:00:00Z', created_by: 'home-test', one_line: null, doc: null, end_day: null, source_kind: null, source_id: null };
  const items = telegramRows();
  await openHome(page, { beforeLoad: async () => {
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_documents', r => {
      const q = new URL(r.request().url()).searchParams, id = (q.get('id') || '').replace(/^eq\./, '');
      if (r.request().method() !== 'GET' || /주간보고/.test(decodeURIComponent(q.get('category') || ''))) return r.fallback();
      if (q.get('meeting_id') || q.get('organization_id') || q.get('project_id')) return r.fulfill({ json: [] });
      return r.fulfill({ json: [doc].filter(d => !id || d.id === id) });
    });
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_meetings', r => r.request().method() === 'GET' ? r.fulfill({ json: [meeting] }) : r.fallback());
    for (const t of ['app_tg_senders', 'app_tg_day_senders']) await page.route(u => u.origin === SB && u.pathname === '/rest/v1/' + t, r => r.fulfill({ json: [] }));
    await installTgServer(page, { items });
    // 텔레그램 흉내 서버도 조직 표를 답하므로 그 뒤에 둔다(나중에 둔 길이 이긴다).
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_suborganizations', r => r.fulfill({ json: [{ id: ORG, workspace_id: 'w', name: '가상 지회', active: true, aliases: [], created_by: 'home-test', updated_at: '2026-10-01T00:00:00Z' }] }));
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_suborganization_assignees', r => r.fulfill({ json: [{ organization_id: ORG, user_id: 'home-test' }] }));
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_suborganization_updates', r => {
      const q = new URL(r.request().url()).searchParams, id = (q.get('id') || '').replace(/^eq\./, '');
      return r.request().method() === 'GET' ? r.fulfill({ json: [rec].filter(x => !id || x.id === id) }) : r.fallback();
    });
  } });
  const memos = await routeMemos(page, { gone: [DOC_GONE], memos: [memo(1, 'document', DOC_GONE, '지운 자료에 단 메모', '2026-10-01T01:00:00Z', '지운 가상 자료')] });
  return { errors, memos };
}
const tap = async (page, l, width) => { await expect(l).toBeVisible(); if (width < 761) await l.tap(); else await l.click(); };
const sheet = page => page.locator('#kptuRecordSheet');
async function leave(page, box, text, width) {
  await expect(box.locator('[data-cm-count]')).toHaveText('메모 0');
  await box.locator('[data-cm-text]').fill(text);
  await tap(page, box.getByRole('button', { name: '메모 남기기', exact: true }), width);
  await expect(box.locator('[data-cm-count]')).toHaveText('메모 1');
  await expect(box.locator('[data-cm-row]')).toHaveText(new RegExp(text));
}
// 노트 › [메모] 보기에서 그 메모 줄(출처 꼬리표·원문 제목)을 누른다.
async function fromCollection(page, width, { src, title, body }) {
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  await tap(page, page.locator('.nv-switch [data-note-view="comment"]'), width);
  const line = page.locator('#noteRows [data-memo-line]').filter({ hasText: body });
  await expect(line.locator('[data-memo-src]')).toHaveText(src);
  await expect(line.locator('.memo-title')).toContainText(title);
  await tap(page, line.locator('[data-memo-open]'), width);
}
const flashed = (box, body) => box.locator('[data-cm-row].memo-th-flash').filter({ hasText: body });

for (const width of [390, 1280]) {
  test(`자료실 자료 ⋯ [메모] → 자료 창 아래 메모 → 노트 [메모]에 '자료실' → 누르면 자료실에서 그 자료 창이 열리고 그 메모로, 지운 자료는 링크만 꺼짐 (${width})`, async ({ page }) => {
    const { errors, memos } = await fixture(page, width);
    await page.evaluate(() => window.KPTURouter.go('library'));
    await revealLibraryRow(page, DOC);
    await tap(page, page.locator(`#documentList [data-lu-menu="${DOC}"]`).first(), width);
    await tap(page, page.locator('[data-lu-memo]'), width);
    await expect(sheet(page)).toBeVisible();
    await expect(sheet(page).locator('[data-record-sheet-title]')).toHaveText('가상 교섭 요구안');
    await expect(sheet(page).locator('[data-record-sheet-text]')).toHaveText('가상 요구안 설명 한 줄.');
    await expect(sheet(page).locator('[data-record-sheet-full]')).toHaveText('파일 열기');
    const box = sheet(page).locator('[data-record-sheet-memos]');
    await leave(page, box, '자료에 남긴 메모', width);
    expect(memos.posts).toEqual([{ workspace_id: 'w', target_type: 'document', target_id: DOC, target_title: '가상 교섭 요구안', body: '자료에 남긴 메모' }]);
    await sheet(page).locator('[data-record-sheet-close]').click();
    await expect(sheet(page)).toBeHidden();
    // 다시 ⋯를 열면 [메모 1].
    await tap(page, page.locator(`#documentList [data-lu-menu="${DOC}"]`).first(), width);
    await expect(page.locator('[data-lu-memo]')).toHaveText('메모 1');
    await page.keyboard.press('Escape');

    await fromCollection(page, width, { src: '자료실', title: '가상 교섭 요구안', body: '자료에 남긴 메모' });
    await expect(page.locator('#libraryView')).toBeVisible();
    await expect(sheet(page)).toBeVisible();
    await expect(flashed(sheet(page).locator('[data-record-sheet-memos]'), '자료에 남긴 메모')).toHaveCount(1);
    await sheet(page).locator('[data-record-sheet-close]').click();
    // 지운 자료에 단 메모: 남아 있고 링크만 꺼짐.
    await page.evaluate(() => window.KPTURouter.go('basket'));
    await chooseBasketKind(page, 'note');
    await tap(page, page.locator('.nv-switch [data-note-view="comment"]'), width);
    const gone = page.locator('#noteRows [data-memo-line]').filter({ hasText: '지운 자료에 단 메모' });
    await expect(gone.locator('[data-memo-gone]')).toHaveText('원래 기록이 없어요');
    await expect(gone.locator('[data-memo-open]')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });

  test(`사업 보고 창 맨 아래 메모 → 노트 [메모]에 '사업 보고' → 누르면 그 보고 창이 열리고 그 메모로 (${width})`, async ({ page }) => {
    const { errors, memos } = await fixture(page, width);
    await page.evaluate(id => import('./report-open.js').then(m => m.openReport(id)), MEET);
    const modal = page.locator('#meetingRoundDetailModal');
    await expect(modal.locator('#mrdTitle')).toBeVisible();
    const box = modal.locator('#mrdMemos');
    await box.scrollIntoViewIfNeeded();
    await leave(page, box, '보고에 남긴 메모', width);
    expect(memos.posts).toHaveLength(1);
    expect(memos.posts[0]).toMatchObject({ target_type: 'meeting', target_id: MEET, body: '보고에 남긴 메모' });
    expect(memos.posts[0].target_title).toMatch(/^가상 정례 회의 · /);
    await modal.locator('#mrdClose').click();
    await expect(modal).toBeHidden();

    await fromCollection(page, width, { src: '사업 보고', title: '가상 정례 회의', body: '보고에 남긴 메모' });
    await expect(modal).toBeVisible();
    await expect(flashed(modal.locator('#mrdMemos'), '보고에 남긴 메모')).toHaveCount(1);
    await expect(modal.locator('#mrdMemos [data-cm-row]').filter({ hasText: '보고에 남긴 메모' })).toBeInViewport();
    expect(errors).toEqual([]);
  });

  test(`담당조직 기록 ⋯ [메모] → 기록 창 아래 메모 → 노트 [메모]에 '담당조직' → 누르면 그 조직이 열리고 그 기록 창이 그 메모로 (${width})`, async ({ page }) => {
    const { errors, memos } = await fixture(page, width);
    await page.evaluate(() => window.KPTURouter.go('team'));
    await page.waitForFunction(() => window.KPTUWorkplace?.open);
    await page.evaluate(async id => { if (!window.KPTUWorkplace?.openMemo) await window.KPTUWorkplace?.load?.(); await window.KPTUWorkplace.open(id); }, ORG);
    const row = page.locator(`#wdUpdates [data-wd-up="${REC}"]`);
    await tap(page, row.locator('[data-wd-up-menu]'), width);
    await tap(page, page.locator('#wdUpMenu').getByRole('button', { name: '메모', exact: true }), width);
    await expect(sheet(page)).toBeVisible();
    await expect(sheet(page).locator('[data-record-sheet-text]')).toHaveText('가상 조직 첫 기록');
    await expect(sheet(page).locator('[data-record-sheet-meta]')).toContainText('가상 지회');
    const box = sheet(page).locator('[data-record-sheet-memos]');
    await leave(page, box, '기록에 남긴 메모', width);
    expect(memos.posts).toEqual([{ workspace_id: 'w', target_type: 'org_record', target_id: REC, target_title: '가상 지회 · 가상 조직 첫 기록', body: '기록에 남긴 메모' }]);
    await sheet(page).locator('[data-record-sheet-close]').click();
    await tap(page, row.locator('[data-wd-up-menu]'), width);
    await expect(page.locator('#wdUpMenu').getByRole('button', { name: '메모 1', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.evaluate(() => document.querySelector('#wdModal [data-wd-close="wdModal"]')?.click());
    // 조직 창은 닫을 때 뒤로가기 한 걸음(popstate)을 따로 받는다. 그 걸음이 끝나기 전에 노트로 가면 늦게 온 걸음이 새 화면 앞뒤를 건드려
    // 노트 화면이 열리지 않을 수 있다(간헐 실패). 창이 닫히고 기록(history)에 창 표시가 없어진 것을 기다린 뒤 이동한다.
    await expect(page.locator('#wdModal')).toBeHidden();
    await page.waitForFunction(() => !history.state?.kptuOverlay && !history.state?.kptuMobileMenu);

    await fromCollection(page, width, { src: '담당조직', title: '가상 지회 · 가상 조직 첫 기록', body: '기록에 남긴 메모' });
    await expect(page.locator('#teamView')).toBeVisible();
    await expect(page.locator('#wdTitle')).toHaveText('가상 지회');
    await expect(sheet(page)).toBeVisible();
    await expect(flashed(sheet(page).locator('[data-record-sheet-memos]'), '기록에 남긴 메모')).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test(`텔레그램 소식 원문 아래 메모 → 노트 [메모]에 '텔레그램' → 누르면 그 방·날·소식 원문이 열리고 그 메모로 (${width})`, async ({ page }) => {
    const { errors, memos } = await fixture(page, width);
    await page.evaluate(id => import('./source-open.js').then(m => m.openTelegramItem(id)), T.a1);
    await expect(page.locator('#telegramView')).toBeVisible();
    const box = page.locator(`#tgDetail [data-memo-host="telegram:${T.a1}"]`);
    await expect(box).toBeVisible();
    await leave(page, box, '소식에 남긴 메모', width);
    expect(memos.posts).toEqual([{ workspace_id: 'w', target_type: 'telegram', target_id: T.a1, target_title: '가상지부 단톡 · 가상 교섭 다음 주 화요일로 미뤄짐. 서면 회신 월요일까지.', body: '소식에 남긴 메모' }]);
    // 소식을 접으면 메모 칸도 접히고, 다시 펼치면 같은 메모가 그대로.
    await tap(page, page.locator(`#tgDetail [data-tg-open="${T.a1}"]`), width);
    await expect(box).toHaveCount(0);
    await tap(page, page.locator(`#tgDetail [data-tg-open="${T.a1}"]`), width);
    await expect(page.locator(`#tgDetail [data-memo-host="telegram:${T.a1}"] [data-cm-count]`)).toHaveText('메모 1');

    await fromCollection(page, width, { src: '텔레그램', title: '가상지부 단톡', body: '소식에 남긴 메모' });
    await expect(page.locator('#telegramView')).toBeVisible();
    await expect(flashed(page.locator(`#tgDetail [data-memo-host="telegram:${T.a1}"]`), '소식에 남긴 메모')).toHaveCount(1);
    expect(errors).toEqual([]);
  });
}
