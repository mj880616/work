// S69-97 NOTE-에버노트 ①②③ (명진 11/25 03:19~03:23 "좋아 모두 다 넣어!"). 합성 데이터만, 구글 할 일은 가짜 서버(google-tasks 함수 자리).
// ① 노트 체크칸 → [구글 할 일로] → 구글 할 일이 생기고 연결이 저장된다 → 구글에서 끝내면 노트 체크(읽기·편집)가 맞춰진다 → 노트에서 체크를 풀면 구글도 풀린다.
// ② 노트 ⋯ [알림 걸기…] → 빠른 고르기로 예약(metadata.alarm, updated_at 그대로) → 읽기 머리 줄 → 줄을 눌러 [알림 끄기].
// ③ 노트 ⋯ [서식으로 저장] → 서버 표에 저장 → 목록 ⋯ [서식으로 새 노트] → 그 서식을 골라 새 노트 창에 글·제목이 들어간다. 앱이 미리 넣은 기본 서식은 없고(S71-65), 서식 넣기는 도구 줄 [넣기 ▾] › [서식].
import {test, expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {noteMenuAction} from './helpers/note-menu.mjs';
import {chooseBasketKind} from './helpers/basket-kind.mjs';
import {noteField, edWin, edWinText} from './helpers/note-editor.mjs';
import {edCmd} from './helpers/ed-tools.mjs';

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const p = text => ({type: 'paragraph', attrs: {style: 'body2'}, content: [{type: 'text', text}]});
const ed1 = (...content) => ({v: 'ed1', doc: {type: 'doc', content}});
const CHECKS = ed1(p('오늘 할 일'), {type: 'bullet_list', attrs: {marker: 'check'}, content: [{type: 'list_item', content: [p('보고서 쓰기')]}, {type: 'list_item', content: [p('전화하기')]}]});
const at = '2026-11-20T01:00:00Z';

async function setup(page, {doc = CHECKS} = {}) {
  const rows = [{id: 'ne1', workspace_id: 'w', kind: 'note', title: '에버 노트', raw_text: '오늘 할 일\n\n보고서 쓰기\n전화하기', doc, occurred_at: at, created_at: at, updated_at: at, archived_at: null, ai_export_allowed: true, attachments: [], metadata: {}}];
  const writes = [], errors = [], google = new Map(), calls = [], templates = [];
  page.on('pageerror', e => errors.push(e.message));
  await openHome(page);
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams;
    const pick = row => (!q.get('kind') || 'eq.' + row.kind === q.get('kind')) && (!q.get('id') || 'eq.' + row.id === q.get('id')) && (!q.get('updated_at') || 'eq.' + row.updated_at === q.get('updated_at'));
    if (req.method() === 'GET') { if (q.get('metadata')) return r.fulfill({json: []}); return r.fulfill({json: rows.filter(pick).map(x => structuredClone(x))}); }
    if (req.method() === 'PATCH') { const body = req.postDataJSON(); writes.push(body); const hit = rows.filter(pick); for (const row of hit) Object.assign(row, body); return r.fulfill({json: hit.map(x => structuredClone(x))}); }
    return r.fulfill({status: 500, json: {}});
  });
  await page.route(SB + '/rest/v1/app_record_links?**', r => new URL(r.request().url()).searchParams.has('note_id') ? r.fulfill({json: []}) : r.fallback());
  // 가짜 구글 할 일(google-tasks 함수 자리): create·toggle·pick만.
  await page.route(u => u.origin === SB && u.pathname === '/functions/v1/google-tasks', async r => {
    const req = r.request(), action = new URL(req.url()).searchParams.get('action'), body = req.method() === 'POST' ? req.postDataJSON() : {};
    calls.push({action, body});
    const norm = t => ({id: t.id, title: t.title, notes: '', due: null, status: t.status, completed: null, updated: null, taskListId: '@default', taskListTitle: '내 할 일', source: 'google-task'});
    if (action === 'create') { const t = {id: 'g' + (google.size + 1), title: body.title, status: 'needsAction'}; google.set(t.id, t); return r.fulfill({json: {ok: true, task: norm(t), links: [], meeting_links: []}}); }
    if (action === 'toggle') { const t = google.get(body.task_id); if (!t) return r.fulfill({status: 400, json: {error: '없음'}}); t.status = body.completed ? 'completed' : 'needsAction'; return r.fulfill({json: {ok: true, task: norm(t)}}); }
    if (action === 'pick') return r.fulfill({json: {tasks: body.task_ids.filter(id => google.has(id)).map(id => norm(google.get(id))), gone: body.task_ids.filter(id => !google.has(id))}});
    return r.fulfill({json: {tasks: [], lists: []}});
  });
  // 서식 표(app_note_templates, 주인만): 읽기·넣기.
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_templates', async r => {
    const req = r.request();
    if (req.method() === 'GET') return r.fulfill({json: templates.map(x => structuredClone(x))});
    if (req.method() === 'POST') { const b = req.postDataJSON(); templates.push({id: 't' + (templates.length + 1), ...b, updated_at: at}); return r.fulfill({status: 201, body: ''}); }
    return r.fulfill({status: 204, body: ''});
  });
  return {rows, writes, errors, google, calls, templates};
}
const openNote = async (page, touch) => {
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  const row = page.locator('[data-note-host] [data-note-row="ne1"]').first();
  if (touch) await row.tap(); else await row.click();
  await expect(page.locator('[data-note-detail] [data-basket-read-text]')).toBeVisible();
};

test.describe('노트 에버노트 기능', () => {
test.use({hasTouch: true});
for (const width of [1280, 390]) {
  const touch = width < 761;
  const press = l => (touch ? l.tap() : l.click());

  test(`① 체크칸 → 구글 할 일 생김 → 구글에서 끝냄 → 노트 체크 반영 → 노트에서 풀면 구글도 ${width}`, async ({page}) => {
    test.setTimeout(60000);
    await page.setViewportSize({width, height: 900});
    const s = await setup(page);
    await openNote(page, touch);
    await noteMenuAction(page, 'data-note-edit', {width});
    const field = noteField(page), scope = page.locator('[data-note-body-field]');
    await expect(field).toBeVisible();
    // 기본은 끔: 체크칸이 있어도 구글로 가지 않는다.
    await expect(field.locator('li.ed-gtask')).toHaveCount(0);
    expect(s.calls.filter(c => c.action === 'create')).toEqual([]);
    await press(field.locator('li p').first());
    await edCmd(scope, 'gtask', {tap: touch});
    await expect(field.locator('li').first()).toHaveClass(/ed-gtask/);
    await expect(field.locator('li').first()).toHaveAttribute('data-gtask', 'on');
    await expect(field.locator('li').nth(1)).not.toHaveClass(/ed-gtask/);
    expect(s.calls.filter(c => c.action === 'create').map(c => c.body.title)).toEqual(['보고서 쓰기']);
    // 연결된 줄에서는 같은 단추가 '연결 풀기'.
    await expect(scope.locator('.ed-bar [data-ed-cmd="gtask"]')).toHaveAttribute('aria-pressed', 'true');
    await press(page.locator('[data-note-detail] [data-note-save]'));
    await expect(page.locator('#toast')).toContainText('노트를 저장했습니다.');
    const saved = s.rows[0].doc.doc.content[1].content;
    expect(saved[0].attrs).toEqual({gtask: 'g1'});
    expect(saved[1].attrs).toBeUndefined();
    // 구글에서 끝냄 → 노트를 다시 열면 읽기 화면이 ☑(구글이 원본, 읽기는 노트를 쓰지 않는다).
    s.google.get('g1').status = 'completed';
    await page.evaluate(() => window.KPTURouter.go('home'));
    await openNote(page, touch);
    const read = page.locator('[data-note-detail] [data-basket-read-text] li').first();
    await expect(read).toHaveAttribute('data-checked', 'true');
    // 편집기도 구글 상태로 열린다. 노트에서 체크를 풀면 구글에 되살림을 보낸다.
    await noteMenuAction(page, 'data-note-edit', {width});
    const li = noteField(page).locator('li').first();
    await expect(li).toHaveAttribute('data-checked', 'true');
    const box = await li.boundingBox();
    if (touch) await page.touchscreen.tap(box.x - 10, box.y + 8); else await page.mouse.click(box.x - 10, box.y + 8);
    await expect(li).not.toHaveAttribute('data-checked', 'true');
    await expect.poll(() => s.google.get('g1').status).toBe('needsAction');
    expect(s.calls.find(c => c.action === 'toggle').body).toMatchObject({task_id: 'g1', completed: false});
    // 구글에서 삭제한 할 일은 연결을 풀고 한 줄로 알린다.
    s.google.delete('g1');
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('kptu:google-tasks-changed')));
    await expect(noteField(page).locator('li.ed-gtask')).toHaveCount(0);
    await expect(page.locator('[data-note-body-field] .ed-note')).toContainText('구글에서 삭제한 할 일 1개');
    expect(s.errors).toEqual([]);
  });

  test(`② 노트 알림 예약 → 머리 줄 → 끄기 ${width}`, async ({page}) => {
    test.setTimeout(60000);
    await page.setViewportSize({width, height: 900});
    const s = await setup(page);
    await openNote(page, touch);
    await noteMenuAction(page, 'data-note-alarm', {width});
    const picks = page.locator('.kptu-ask .kptu-ask-pick');
    await expect(picks.filter({hasText: '내일 아침 9시'})).toBeVisible();
    await press(picks.filter({hasText: '내일 아침 9시'}));
    await expect.poll(() => s.rows[0].metadata.alarm?.at || '').toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/);
    // 알림은 고치기가 아니다: updated_at을 보내지 않는다.
    expect(s.writes.every(w => w.updated_at === undefined)).toBe(true);
    const line = page.locator('[data-note-detail] [data-note-alarm-line]');
    await expect(line).toBeVisible();
    await expect(line).toContainText(/^알림 \d{1,2}\/\d{1,2}\([일월화수목금토]\) 09:00$/);
    // 줄을 누르면 같은 고르기창, [알림 끄기]로 칸을 지운다.
    await press(line.locator('[data-note-alarm-open]'));
    await press(page.locator('.kptu-ask .kptu-ask-pick').filter({hasText: '알림 끄기'}));
    await expect.poll(() => 'alarm' in s.rows[0].metadata).toBe(false);
    await expect(line).toBeHidden();
    // 날짜·시각을 직접 고르기(달력).
    await noteMenuAction(page, 'data-note-alarm', {width});
    await press(page.locator('.kptu-ask .kptu-ask-pick').filter({hasText: '날짜·시각 선택…'}));
    const next = new Date(Date.now() + 9 * 3600000 + 3 * 86400000).toISOString().slice(0, 10);
    await page.locator('.kptu-ask input[type="date"]').fill(next);
    await page.locator('.kptu-ask input[type="time"]').fill('14:30');
    await press(page.locator('.kptu-ask .kptu-ask-actions .primary'));
    await expect.poll(() => s.rows[0].metadata.alarm?.at).toBe(new Date(Date.parse(`${next}T14:30:00.000Z`) - 9 * 3600000).toISOString());
    await expect(line).toContainText('14:30');
    expect(s.errors).toEqual([]);
  });

  test(`③ 서식으로 저장 → 서식으로 새 노트 · 넣기 ▾ › 서식(내 서식만, 기본 서식 없음) ${width}`, async ({page}) => {
    test.setTimeout(60000);
    await page.setViewportSize({width, height: 900});
    const s = await setup(page);
    await openNote(page, touch);
    await noteMenuAction(page, 'data-note-form-save', {width});
    const name = page.locator('.kptu-ask input');
    await expect(name).toHaveValue('에버 노트');
    await name.fill('내 할 일 틀');
    await press(page.locator('.kptu-ask .kptu-ask-actions .primary'));
    await expect.poll(() => s.templates.length).toBe(1);
    expect(s.templates[0].name).toBe('내 할 일 틀');
    expect(s.templates[0].workspace_id).toBeTruthy();
    expect(s.templates[0].doc.doc.content[1].attrs).toEqual({marker: 'check'});
    await expect(page.locator('#toast')).toContainText("'내 할 일 틀' 서식으로 저장했어요.");
    // 목록 ⋯ [서식으로 새 노트]: 새 노트 창이 열리고 고르기창이 바로 뜬다. 고르기창에는 내 서식만(앱이 미리 넣은 서식 없음).
    await page.evaluate(() => window.KPTURouter.go('home'));
    await page.evaluate(() => window.KPTURouter.go('basket'));
    await chooseBasketKind(page, 'note');
    await expect(page.locator('[data-note-folder-more]')).toBeVisible();
    await press(page.locator('[data-note-folder-more]'));
    await press(page.locator('#noteDocMenu [data-nx-form-new]'));
    await expect(edWin(page)).toBeVisible();
    const picks = page.locator('.kptu-ask .kptu-ask-pick');
    await expect(picks.filter({hasText: '내 할 일 틀'})).toBeVisible();
    for (const gone of ['회의록', '주간 계획', '통화 기록', '기본 서식']) await expect(page.locator('.kptu-ask')).not.toContainText(gone);
    await press(picks.filter({hasText: '내 할 일 틀'}));
    await expect(edWinText(page).locator('li')).toHaveText(['보고서 쓰기', '전화하기']);
    await expect(page.locator('#edWindow [data-edw-title]')).toHaveValue('내 할 일 틀');
    // 제목 줄에는 [서식 ▾]가 없고, 위 도구 줄 [넣기 ▾] 안 [서식]으로 한 번 더 넣으면 쓴 글 뒤에 붙는다.
    await expect(page.locator('#edWindow [data-edw-form]')).toHaveCount(0);
    await expect(page.locator('#edWindow [data-ed-panel="gInsert"] [data-ed-cmd="form"]')).toHaveText('서식');
    await edCmd(edWin(page), 'form', {tap: touch});
    await expect(picks).toHaveCount(2); // 내 서식 하나 + [내 서식 삭제…]
    await press(picks.filter({hasText: '내 할 일 틀'}));
    await expect(edWinText(page).locator('li')).toHaveText(['보고서 쓰기', '전화하기', '보고서 쓰기', '전화하기']);
    expect(s.errors).toEqual([]);
  });

  test(`④ 내 서식이 없으면 안내 한 줄(⋯ 서식으로 새 노트 · 넣기 ▾ › 서식) ${width}`, async ({page}) => {
    await page.setViewportSize({width, height: 900});
    const s = await setup(page);
    await page.evaluate(() => window.KPTURouter.go('basket'));
    await chooseBasketKind(page, 'note');
    await press(page.locator('[data-note-folder-more]'));
    await press(page.locator('#noteDocMenu [data-nx-form-new]'));
    await expect(page.locator('#toast')).toContainText('노트 ⋯ [서식으로 저장]으로 내 서식을 만들어요');
    await expect(edWin(page)).toBeHidden();
    await press(page.locator('[data-note-list] [data-quick-big]'));
    await expect(edWin(page)).toBeVisible();
    await edCmd(edWin(page), 'form', {tap: touch});
    const ask = page.locator('.kptu-ask');
    await expect(ask).toContainText('노트 ⋯ [서식으로 저장]으로 내 서식을 만들어요');
    await expect(ask.locator('.kptu-ask-pick')).toHaveCount(0);
    for (const gone of ['회의록', '주간 계획', '통화 기록']) await expect(ask).not.toContainText(gone);
    expect(s.errors).toEqual([]);
  });
}
for (const width of [344, 390, 717, 1280]) {
  test(`⑤ 새 노트 창 제목 줄: 제목 칸 + 폴더 단추만, 빈칸·글자 깨짐 없음 ${width}`, async ({page}) => {
    await page.setViewportSize({width, height: 800});
    await setup(page);
    await page.evaluate(() => window.KPTURouter.go('basket'));
    await chooseBasketKind(page, 'note');
    await page.locator('[data-note-list] [data-quick-big]').click();
    const row = page.locator('#edWindow .edw-title-row');
    await expect(row).toBeVisible();
    await expect(page.locator('#edWindow [data-edw-form]')).toHaveCount(0);
    const got = await row.evaluate(r => {
      const kids = [...r.children].filter(el => getComputedStyle(el).display !== 'none' && !el.classList.contains('a11y-only'));
      const box = r.getBoundingClientRect(), pad = parseFloat(getComputedStyle(r).paddingRight) || 0;
      const folder = r.querySelector('[data-edw-folder]'), fb = folder?.getBoundingClientRect(), lh = parseFloat(getComputedStyle(folder).lineHeight) || 20;
      return {kinds: kids.map(el => el.dataset.edwTitle !== undefined ? 'title' : el.dataset.edwFolder !== undefined ? 'folder' : el.tagName), gap: box.right - pad - fb.right, oneLine: fb.height < lh * 1.8 + 12, input: r.querySelector('[data-edw-title]').getBoundingClientRect().width};
    });
    expect(got.kinds).toEqual(['title', 'folder']);
    expect(Math.abs(got.gap)).toBeLessThan(2);
    expect(got.oneLine).toBe(true);
    expect(got.input).toBeGreaterThan(width < 400 ? 150 : 300);
  });
}
});
