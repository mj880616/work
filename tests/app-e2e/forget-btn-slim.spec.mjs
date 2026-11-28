// S71-FORGET-단추줄이기(사용자 결정 2026-11-27 09:21): 잊지 말기 줄의 처리 단추를 줄인다.
// (1) AI 제안 줄의 [수정해서 할 일로]는 [할 일로]와 합쳤다 — [할 일로]를 누르면 텔레그램 줄처럼 고쳐 쓰는 할 일 창이 열린다.
// (2) AI 제안 줄의 [이미 할 일에 있음]은 없앴다(쳐내기는 [이미 함]).
// 하지 않는 것: ×([무시])와 [이미 함]은 합치지 않는다 — AI 할 일 찾기 학습이 둘을 따로 받는다(dismissed·done).
// 서버는 흉내, 글·이름은 모두 지어낸 것. 화면 사진: S71_FORGET_SHOTS=<before|after>일 때만 docs/design/screens/s71-forget-btn/ 에 찍는다.
import {test, expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {pressRowAct} from './helpers/nbx-act.mjs';

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const cid = n => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const fid = n => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const cand = (n, over = {}) => ({id: cid(n), kind: 'request', summary: `가짜 요청 ${n}`, due: null, source_kind: 'basket', source_id: fid(n), source_day: '2026-10-06', evidence: '근거',
  project_id: null, organization_id: null, status: 'open', task_id: null, task_due: null, created_at: `2026-10-06T0${n}:00:00Z`, decided_at: null, ...over});

// 1번 = AI 제안 줄(챙길 것), 2번 = 텔레그램 줄.
async function fixture(page, width) {
  await page.setViewportSize({width, height: 900});
  const cands = [cand(1, {summary: '가상 지부에 자료 보내기'}), cand(2, {source_kind: 'telegram', summary: '가상 방 요청 확인하기'})];
  const patches = [], feedback = [];
  await openHome(page, {beforeLoad: async () => {
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/rpc/app_my_features', r => r.fulfill({json: ['telegram']}));
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_todo_candidates', async r => {
      const req = r.request(), q = new URL(req.url()).searchParams;
      if (req.method() === 'PATCH') {
        const id = q.get('id').replace(/^eq\./, ''), from = q.get('status').replace(/^eq\./, ''), body = req.postDataJSON(), row = cands.find(c => c.id === id && c.status === from);
        patches.push({id, from, body}); if (!row) return r.fulfill({json: []});
        Object.assign(row, body); return r.fulfill({json: [{id, status: row.status, task_id: row.task_id, decided_at: row.decided_at}]});
      }
      const st = q.get('status');
      return r.fulfill({json: st === 'eq.open' ? cands.filter(c => c.status === 'open') : st?.startsWith('in.') ? cands.filter(c => c.status !== 'open') : cands});
    });
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_todo_feedback', r => {
      const req = r.request(), m = req.method();
      if (m === 'POST') { feedback.push(req.postDataJSON()); return r.fulfill({status: 201, json: [{id: `e0000000-0000-4000-8000-00000000000${feedback.length}`}]}); }
      if (m === 'DELETE') return r.fulfill({status: 204, body: ''});
      return r.fulfill({json: []});
    });
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_feed_items', r => r.fulfill({json: [{id: fid(2), room_key: 'room-a', room_label: '가상 지부방'}]}));
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', r => r.fulfill({json: []}));
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_record_links', r => r.fulfill({json: []}));
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_journal_memorable', r => r.fulfill({json: []}));
    await page.route(u => u.origin === SB && u.pathname === '/functions/v1/ai-assist', r => {
      let body = null; try { body = r.request().postDataJSON(); } catch { body = null; }
      if (body?.kind === 'journal_memorable') return r.fulfill({json: {ok: true, kind: 'journal_memorable', day: body.day, skipped: 'fresh'}});
      return r.fallback();
    });
  }});
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await expect(page.locator('#basketView [data-forget-section]')).toBeVisible();
  await expect(line(page, `c:${cid(1)}`)).toBeVisible();
  return {patches, feedback};
}
const line = (page, key) => page.locator(`#basketView [data-nbx-row="${key}"]`);
const menu = page => page.locator('#forgetRowMenu');
const undoBox = page => page.locator('[data-undo-notice]');
const SHOTS = process.env.S71_FORGET_SHOTS || '';

for (const width of [1280, 412]) {
  test(`${width}px: AI 제안 줄 ⋯ 메뉴에 [수정해서 할 일로]·[이미 할 일에 있음]이 없다(나머지는 그대로)`, async ({page}) => {
    await fixture(page, width);
    await line(page, `c:${cid(1)}`).locator('.nbx-more').click();
    await expect(menu(page)).toBeVisible();
    if (SHOTS) await page.screenshot({path: `docs/design/screens/s71-forget-btn/${SHOTS}/menu-${width}.png`});
    await expect(menu(page).getByRole('button', {name: '수정해서 할 일로'})).toHaveCount(0);
    await expect(menu(page).getByRole('button', {name: '이미 할 일에 있음'})).toHaveCount(0);
    await expect(menu(page).getByRole('button', {name: '내 일 아님', exact: true})).toHaveCount(1);
    await expect(menu(page).getByRole('button', {name: '무시', exact: true})).toHaveCount(1);
    // 줄 단추 이름([할 일로]·[이미 함])은 그대로.
    await expect(line(page, `c:${cid(1)}`).locator('[data-nbx-act="task"]')).toHaveCount(1);
    await expect(line(page, `c:${cid(1)}`).locator('[data-nbx-act="done"]')).toHaveCount(1);
    await expect(page.locator('#basketView [data-forget-link]')).toHaveCount(0);
  });

  test(`${width}px: AI 제안 줄 [할 일로] → 바로 만들지 않고 고쳐 쓰는 할 일 창이 열린다(제목이 채워짐)`, async ({page}) => {
    const f = await fixture(page, width);
    if (SHOTS) await page.screenshot({path: `docs/design/screens/s71-forget-btn/${SHOTS}/forget-${width}.png`});
    await pressRowAct(page, line(page, `c:${cid(1)}`), 'task');
    await expect(page.locator('#gtTaskModal:not(.hidden)')).toHaveCount(1);
    await expect(page.locator('#gtEditTitle')).toHaveValue('가상 지부에 자료 보내기');
    // 창을 연 것만으로는 줄이 빠지지 않고 기록도 없다.
    await expect(line(page, `c:${cid(1)}`)).toBeVisible();
    expect(f.patches).toEqual([]);
    expect(f.feedback).toEqual([]);
  });
}

test('[이미 함]·[무시]는 따로 기록된다(done·dismissed) — 합치지 않음', async ({page}) => {
  const f = await fixture(page, 1280);
  await pressRowAct(page, line(page, `c:${cid(1)}`), 'done');
  await expect(line(page, `c:${cid(1)}`)).toHaveCount(0);
  await expect.poll(() => f.feedback.length).toBe(1);
  expect(f.feedback[0]).toMatchObject({candidate_id: cid(1), outcome: 'done'});
  expect(f.patches[0]).toMatchObject({id: cid(1), from: 'open', body: {status: 'done'}});
  await expect(undoBox(page).locator('[data-undo-action]')).toHaveText('되돌리기');
  await pressRowAct(page, line(page, `c:${cid(2)}`), 'dismissed');
  await expect(line(page, `c:${cid(2)}`)).toHaveCount(0);
  await expect.poll(() => f.feedback.length).toBe(2);
  expect(f.feedback[1]).toMatchObject({candidate_id: cid(2), outcome: 'dismissed'});
  expect(f.patches[1]).toMatchObject({id: cid(2), from: 'open', body: {status: 'dismissed'}});
});
