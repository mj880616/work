// NOTE-블록모드찾기 (명진 11/25 13:24 "블록모드 어디서 켜 ?", 13:25 "안나오는데"): 합성 데이터만.
// - [블록 모드]는 [문단 ▾] 묶음 안이 아니라 편집 막대 위에 바로 보이는 작은 아이콘 단추다(눌린 상태 표시, 폰 막대도 같은 자리).
// - 노트 상세 고치기·그 큰 창(크게 쓰기)·새 노트 입력칸의 ⤢ 큰 창 모두에 있다. 누르면 손잡이 ⋮⋮가 생기고, 다시 누르면 사라진다.
// - 새 노트는 저장 전에는 내 기본값(view_prefs.note_blocks)으로 켜고 끄고, 저장하면 그 노트에 기억한다(metadata.block_edit).
// - [문단 ▾] 펼침 목록은 항목 수만큼 펼쳐 스크롤 막대 없이 모든 항목이 보인다(화면을 넘을 때만 스크롤).
import {test, expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {noteMenuAction} from './helpers/note-menu.mjs';
import {chooseBasketKind} from './helpers/basket-kind.mjs';
import {noteField} from './helpers/note-editor.mjs';
import {installViewPrefsServer} from './helpers/view-prefs-server.mjs';

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const p = text => ({type: 'paragraph', attrs: {style: 'body2'}, content: [{type: 'text', text}]});
const THREE = {v: 'ed1', doc: {type: 'doc', content: [p('첫째'), p('둘째'), p('셋째')]}};
const at = '2026-11-20T01:00:00Z';

async function setup(page, width) {
  await page.setViewportSize({width, height: 900});
  const rows = [{id: 'nb1', workspace_id: 'w', kind: 'note', title: '블록 노트', raw_text: '첫째\n\n둘째\n\n셋째', doc: THREE, occurred_at: at, created_at: at, updated_at: at, archived_at: null, ai_export_allowed: true, attachments: [], metadata: {}}];
  const posts = [], errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await openHome(page);
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams;
    const pick = row => (!q.get('kind') || 'eq.' + row.kind === q.get('kind')) && (!q.get('id') || 'eq.' + row.id === q.get('id')) && (!q.get('updated_at') || 'eq.' + row.updated_at === q.get('updated_at'));
    if (req.method() === 'GET') { if (q.get('metadata')) return r.fulfill({json: []}); return r.fulfill({json: rows.filter(pick).map(x => structuredClone(x))}); }
    if (req.method() === 'PATCH') { const body = req.postDataJSON(); const hit = rows.filter(pick); for (const row of hit) Object.assign(row, body); return r.fulfill({json: hit.map(x => structuredClone(x))}); }
    if (req.method() === 'POST') {
      const body = req.postDataJSON(); posts.push(body);
      const row = {id: 'nb-new', kind: 'note', occurred_at: at, created_at: at, updated_at: at, archived_at: null, ai_export_allowed: true, attachments: [], metadata: {}, ...body};
      rows.unshift(row);
      return r.fulfill({status: 201, json: [structuredClone(row)]});
    }
    return r.fulfill({status: 500, json: {}});
  });
  await page.route(SB + '/rest/v1/app_record_links?**', r => new URL(r.request().url()).searchParams.has('note_id') ? r.fulfill({json: []}) : r.fallback());
  await page.route(SB + '/functions/v1/note-ai-title', r => r.fulfill({json: {ok: true}}));
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  return {rows, posts, errors};
}

// The editor's bar: the [블록 모드] button stands on the row itself (not inside a group list), and pressing it shows/hides the handle.
async function checkBar(page, scope, {touch}) {
  const press = l => (touch ? l.tap() : l.click());
  const bar = scope.locator('.ed-bar').first();
  const toggle = bar.locator('.ed-tools > [data-ed-cmd="blocks"]');
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAccessibleName('블록 모드');
  // 작은 아이콘 단추: 막대의 다른 단추(↶)와 같은 높이, 글자 없이 아이콘만.
  const box = await toggle.boundingBox(), undo = await bar.locator('.ed-tools > [data-ed-cmd="undo"]').boundingBox();
  expect(Math.abs(box.height - undo.height)).toBeLessThanOrEqual(1);
  expect(box.width).toBeLessThanOrEqual(Math.max(36, undo.width + 16));
  await expect(toggle.locator('svg')).toBeVisible();
  expect(await toggle.locator('.ed-tool-word').isVisible()).toBe(false);
  // 막대 안에 다 들어온다(폰 막대에서 잘리지 않음).
  const barBox = await bar.locator('.ed-tools').boundingBox();
  expect(box.x + box.width).toBeLessThanOrEqual(barBox.x + barBox.width + 1);
  expect(await toggle.evaluate(el => !!el.closest('[data-ed-panel]'))).toBe(false);
  const before = await toggle.getAttribute('aria-pressed');
  const editor = scope.locator('.ed-editor').first();
  await press(toggle);
  const on = before !== 'true';
  await expect(toggle).toHaveAttribute('aria-pressed', String(on));
  if (on) await expect(editor).toHaveClass(/ed-blocks-on/); else await expect(editor).not.toHaveClass(/ed-blocks-on/);
  // 손잡이: 켠 상태에서 문단을 누르면(PC는 올리면) 그 옆에 보인다.
  if (!on) { await press(toggle); await expect(toggle).toHaveAttribute('aria-pressed', 'true'); }
  const para = scope.locator('.ProseMirror p').first();
  if (touch) await para.tap(); else { await para.click(); await para.hover(); }
  await expect(scope.locator('.ed-grip')).toBeVisible();
  await press(toggle);
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(editor).not.toHaveClass(/ed-blocks-on/);
  await expect(scope.locator('.ed-grip')).toBeHidden();
}

// [문단 ▾]: the list shows every item, no scroll bar.
async function checkParaList(page, scope, {touch}) {
  const press = l => (touch ? l.tap() : l.click());
  const group = scope.locator('.ed-bar .ed-tools [data-ed-cmd="gPara"]').first();
  await expect(group).toBeVisible();
  await press(group);
  const list = scope.locator('.ed-bar [data-ed-panel="gPara"]').first();
  await expect(list).toBeVisible();
  const m = await list.evaluate(el => ({scroll: el.scrollHeight, client: el.clientHeight, items: [...el.children].filter(c => !c.hidden).map(c => c.getBoundingClientRect()), box: el.getBoundingClientRect(), keys: [...el.children].map(c => c.dataset.edCmd)}));
  expect(m.keys).not.toContain('blocks');
  expect(m.scroll).toBeLessThanOrEqual(m.client + 1);
  for (const r of m.items) { expect(r.top).toBeGreaterThanOrEqual(m.box.top - 1); expect(r.bottom).toBeLessThanOrEqual(m.box.bottom + 1); }
  await page.keyboard.press('Escape');
  await expect(list).toBeHidden();
}

for (const width of [1280, 390]) test.describe(`폭 ${width}`, () => {
  const touch = width < 761;
  test.use({hasTouch: touch});

  test(`노트 상세 고치기 · 크게 쓰기: [블록 모드] 단추가 막대에 바로 보이고 누르면 손잡이 생김/사라짐 · [문단 ▾] 스크롤 없음 ${width}`, async ({page}) => {
    test.setTimeout(60000);
    const {errors} = await setup(page, width);
    const row = page.locator('[data-note-host] [data-note-row="nb1"]').first();
    if (touch) await row.tap(); else await row.click();
    await noteMenuAction(page, 'data-note-edit', {width});
    await expect(noteField(page)).toBeVisible();
    const detail = page.locator('[data-note-body-field]');
    await checkBar(page, detail, {touch});
    await checkParaList(page, detail, {touch});
    // 크게 쓰기(큰 창에서 수정).
    const big = page.locator('[data-note-detail] [data-note-big-write]');
    if (touch) await big.tap(); else await big.click();
    const win = page.locator('#edWindow');
    await expect(win.locator('.ProseMirror')).toBeVisible();
    await checkBar(page, win, {touch});
    await checkParaList(page, win, {touch});
    expect(errors).toEqual([]);
  });

  test(`새 노트 입력칸 ⤢: [블록 모드] 단추 · 저장 전엔 내 기본값으로, 저장하면 그 노트에 기억 · [문단 ▾] 스크롤 없음 ${width}`, async ({page}) => {
    test.setTimeout(60000);
    const {posts, errors} = await setup(page, width);
    const prefs = await installViewPrefsServer(page);
    const bigBtn = page.locator('[data-note-list] [data-quick-big]');
    if (touch) await bigBtn.tap(); else await bigBtn.click();
    const win = page.locator('#edWindow');
    await expect(win.locator('.ProseMirror')).toBeVisible();
    await checkParaList(page, win, {touch});
    await checkBar(page, win, {touch});
    // 다시 켜서 저장: 새 노트에 block_edit=true로 기억, 내 기본값도 켬.
    const toggle = win.locator('.ed-bar .ed-tools > [data-ed-cmd="blocks"]');
    if (touch) await toggle.tap(); else await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => prefs.value?.note_blocks).toBe(true);
    const text = win.locator('.ProseMirror');
    if (touch) await text.tap(); else await text.click();
    await page.keyboard.insertText('새 블록 노트');
    const save = win.getByRole('button', {name: '새 노트로 저장'});
    if (touch) await save.tap(); else await save.click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0].metadata?.block_edit).toBe(true);
    // 다음 새 노트 창은 내 기본값(켬)으로 열린다.
    await expect(win).toBeHidden();
    expect(errors).toEqual([]);
  });
});
