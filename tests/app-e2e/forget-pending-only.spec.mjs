// S71-58 FORGET-처리전만(사용자 결정 2026-11-26: 잊지 말기는 들어온 것을 쳐내는 곳 — 기록 관리는 중요하지 않다).
// - 걸러 보기 단추([처리 전 ▾] — 처리 상태 5가지·출처 6가지 메뉴)는 없다. 목록은 늘 처리 전 줄만(출처 구분 없이 한 목록).
// - 처리(이미 함·무시·일정으로 등)하면 그 줄은 바로 빠지고, 아래 공용 되돌리기 알림 하나. [되돌리기]를 누르면 그 줄이 돌아온다.
// - 처리한 것을 다시 모아 보는 화면·메뉴는 없다(처리한 가짜 자료는 보이지 않는다).
// 서버는 흉내, 글·이름은 모두 지어낸 것.
import {test, expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {pressRowAct} from './helpers/nbx-act.mjs';

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const cid = n => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const fid = n => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const nid = n => `b0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const cand = (n, over = {}) => ({id: cid(n), kind: 'request', summary: `가짜 요청 ${n}`, due: null, source_kind: 'basket', source_id: fid(n), source_day: '2026-10-06', evidence: '근거',
  project_id: null, organization_id: null, status: 'open', task_id: null, task_due: null, created_at: `2026-10-06T0${n}:00:00Z`, decided_at: null, ...over});
const base = {workspace_id: 'w', kind: 'basket', title: null, created_at: '2026-10-06T00:00:00Z', updated_at: '2026-10-06T00:00:00Z', archived_at: null, ai_export_allowed: true, metadata: {}, attachments: []};
const news = (n, over = {}) => ({id: nid(n), day: '2026-10-06', source: 'telegram', feed_item_id: fid(n), org_name: null, line: `가상 소식 ${n}`, status: 'suggested', final_line: null,
  picked_at: `2026-10-06T0${n}:10:00Z`, decided_at: null, ...over});

async function fixture(page, width) {
  await page.setViewportSize({width, height: 900});
  // 처리 전 둘(1·3)과 이미 처리한 셋(5 보냄·6 이미 함·7 무시). 업데이트는 처리 전 하나·보류(처리한 것) 하나. 소식은 처리 전 하나·처리함 하나.
  const cands = [cand(1), cand(3, {summary: '지어낸 챙길 것'}), cand(5, {status: 'tasked', decided_at: '2026-10-06T06:00:00Z', summary: '처리한 요청 보냄'}),
    cand(6, {status: 'done', decided_at: '2026-10-06T06:00:00Z', summary: '처리한 요청 이미 함'}), cand(7, {status: 'dismissed', decided_at: '2026-10-06T06:00:00Z', summary: '처리한 요청 무시'})];
  const notes = [{...base, id: uid(1), raw_text: '지어낸 업데이트 하나', occurred_at: '2026-10-06T04:00:00Z'},
    {...base, id: uid(2), raw_text: '처리한 보류 업데이트', occurred_at: '2026-10-06T00:30:00Z', archived_at: '2026-10-06T01:00:00Z'}];
  const memorable = [news(2), news(4, {status: 'kept', decided_at: '2026-10-06T07:00:00Z', line: '처리한 소식'})];
  const patches = [], notePatches = [], newsPatches = [];
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
      const m = r.request().method();
      if (m === 'POST') return r.fulfill({status: 201, json: [{id: 'e0000000-0000-4000-8000-000000000001'}]});
      if (m === 'DELETE') return r.fulfill({status: 204, body: ''});
      return r.fulfill({json: []});
    });
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_feed_items', r => r.fulfill({json: []}));
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', r => {
      const req = r.request(), q = new URL(req.url()).searchParams;
      const pick = row => (!q.get('kind') || 'eq.' + row.kind === q.get('kind')) && (!q.get('id') || 'eq.' + row.id === q.get('id'));
      if (req.method() === 'GET') return r.fulfill({json: q.get('metadata') ? [] : notes.filter(pick)});
      if (req.method() === 'PATCH') { const body = req.postDataJSON(); notePatches.push({id: q.get('id'), body}); const hit = notes.filter(pick); hit.forEach(row => Object.assign(row, body)); return r.fulfill({json: hit}); }
      return r.fulfill({status: 500, json: {}});
    });
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_record_links', r => r.fulfill({json: []}));
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_journal_memorable', r => {
      const req = r.request(), q = new URL(req.url()).searchParams;
      if (req.method() === 'PATCH') { const id = q.get('id').replace(/^eq\./, ''), body = req.postDataJSON(), row = memorable.find(x => x.id === id); newsPatches.push({id, body}); if (!row) return r.fulfill({json: []}); Object.assign(row, body); return r.fulfill({json: [{id, status: row.status}]}); }
      return r.fulfill({json: memorable});
    });
    await page.route(u => u.origin === SB && u.pathname === '/functions/v1/ai-assist', r => {
      let body = null; try { body = r.request().postDataJSON(); } catch { body = null; }
      if (body?.kind === 'journal_memorable') return r.fulfill({json: {ok: true, kind: 'journal_memorable', day: body.day, skipped: 'fresh'}});
      return r.fallback();
    });
  }});
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await expect(page.locator('#basketView [data-forget-section]')).toBeVisible();
  await expect(line(page, `c:${cid(1)}`)).toBeVisible();
  return {cands, patches, notePatches, newsPatches};
}
const list = page => page.locator('#basketView [data-forget-section] .nbx-list');
const line = (page, key) => page.locator(`#basketView [data-nbx-row="${key}"]`);
const undoBox = page => page.locator('[data-undo-notice]');
// 일정 창은 흉내: 열면 바로 저장된 것처럼 onCreated를 부른다(일정 창 자체는 이 시험 대상이 아니다).
const fakeEvent = page => page.evaluate(() => { window.KPTUEventCreate = {open: o => setTimeout(() => o.onCreated?.({id: 'ev1'}), 0)}; });

for (const width of [1280, 390, ...(process.env.S71_58_SHOTS ? [412] : [])]) {
  test(`${width}px: 걸러 보기 단추 없음 · 처리 전만 보임(처리한 가짜 자료는 안 보임)`, async ({page}) => {
    await fixture(page, width);
    // 화면 사진(docs/design/screens/s71-58/): S71_58_SHOTS=<before|after>일 때만 찍는다(가짜 자료).
    if (process.env.S71_58_SHOTS) await page.screenshot({path: `docs/design/screens/s71-58/${process.env.S71_58_SHOTS}/forget-${width}.png`});
    await expect(page.locator('[data-forget-view-open]')).toHaveCount(0);
    await expect(page.locator('#forgetViewMenu')).toHaveCount(0);
    await expect(page.getByRole('button', {name: /처리 전/})).toHaveCount(0);
    // 최신화(↻)는 그대로.
    await expect(page.locator('[data-sf-tools="forget"] [data-inbox-find]')).toBeVisible();
    for (const key of [`c:${cid(1)}`, `c:${cid(3)}`, `u:${uid(1)}`, `n:${nid(2)}`]) await expect(line(page, key)).toBeVisible();
    for (const key of [`c:${cid(5)}`, `c:${cid(6)}`, `c:${cid(7)}`, `u:${uid(2)}`, `n:${nid(4)}`]) await expect(line(page, key)).toHaveCount(0);
    await expect(list(page)).not.toContainText('처리한');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test(`${width}px: 처리하면 바로 사라짐 · 되돌리기 알림으로 돌아옴(이미 함·일정으로·무시·업데이트 일정으로)`, async ({page}) => {
    const f = await fixture(page, width);
    await fakeEvent(page);
    // 후보 [이미 함] → 바로 빠짐 → [되돌리기] → 돌아옴.
    await pressRowAct(page, line(page, `c:${cid(1)}`), 'done');
    await expect(line(page, `c:${cid(1)}`)).toHaveCount(0);
    await expect(undoBox(page).locator('[data-undo-action]')).toHaveText('되돌리기');
    await undoBox(page).locator('[data-undo-action]').click();
    await expect(line(page, `c:${cid(1)}`)).toBeVisible();
    expect(f.patches.map(p => [p.from, p.body.status])).toEqual([['open', 'done'], ['done', 'open']]);
    await expect(undoBox(page)).toHaveCount(0, {timeout: 10000});

    // 후보 [일정으로](일정을 만든 뒤) → 빠짐 → 되돌리기 알림(만든 일정은 그대로).
    await pressRowAct(page, line(page, `c:${cid(3)}`), 'event');
    await expect(line(page, `c:${cid(3)}`)).toHaveCount(0);
    await undoBox(page).locator('[data-undo-action]').click();
    await expect(line(page, `c:${cid(3)}`)).toBeVisible();
    await expect(undoBox(page)).toContainText('만든 일정은 그대로예요');
    await expect(undoBox(page)).toHaveCount(0, {timeout: 10000});

    // 소식 [×](무시) → 빠짐 → 되돌리기.
    await pressRowAct(page, line(page, `n:${nid(2)}`), 'dismissed');
    await expect(line(page, `n:${nid(2)}`)).toHaveCount(0);
    await undoBox(page).locator('[data-undo-action]').click();
    await expect(line(page, `n:${nid(2)}`)).toBeVisible();
    expect(f.newsPatches.map(p => p.body.status)).toEqual(['dropped', 'suggested']);
    await expect(undoBox(page)).toHaveCount(0, {timeout: 10000});

    // 업데이트 [일정으로] → 일정을 만들면 그 업데이트도 처리한 것(보류) → 빠짐 → 되돌리기(보류 해제).
    await pressRowAct(page, line(page, `u:${uid(1)}`), 'event');
    await expect(line(page, `u:${uid(1)}`)).toHaveCount(0);
    await undoBox(page).locator('[data-undo-action]').click();
    await expect(line(page, `u:${uid(1)}`)).toBeVisible();
    expect(f.notePatches.map(p => !!p.body.archived_at)).toEqual([true, false]);
  });
}
