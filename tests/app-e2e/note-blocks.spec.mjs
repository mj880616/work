// NOTE-노션편집 ①(나) (명진 11/24 21:41, 11/25 03:19): 노트 블록 편집. 합성 데이터만.
// - 끈 상태가 기본(손잡이 없음, 글쓰기 그대로). 서식 줄 [블록]으로 켜면 손잡이 ⋮⋮가 보이고, 끄면 사라진다.
// - 손잡이를 끌어 블록 순서를 바꾸고(PC는 마우스 끌기, 폰은 꾹 누른 뒤 끌기), 저장 뒤 다시 불러와도 그 순서다.
// - 손잡이를 누르면 블록 메뉴(위로·아래로·복제·지우기·바꾸기).
// - '/' 목록으로 제목·접기 블록을 넣는다(블록 편집을 꺼도 쓸 수 있다). 접기는 접힘 상태가 저장되고, 게시(받는 화면) 글에서도 보인다.
import {test, expect} from '@playwright/test';
import {appOrigin} from './helpers/test-origin.mjs';
import {openHome} from './helpers/home-entry.mjs';
import {noteMenuAction} from './helpers/note-menu.mjs';
import {chooseBasketKind} from './helpers/basket-kind.mjs';
import {noteField} from './helpers/note-editor.mjs';
import {edPress} from './helpers/ed-tools.mjs';

const url = `${appOrigin}/tests/app-e2e/ed-editor-fixture.html`;
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const p = text => ({type: 'paragraph', attrs: {style: 'body2'}, content: [{type: 'text', text}]});
const ed1 = (...content) => ({v: 'ed1', doc: {type: 'doc', content}});
const THREE = ed1(p('첫째'), p('둘째'), p('셋째'));
const texts = page => page.evaluate(() => window.ed.getValue().doc.content.map(n => n.content?.[0]?.text ?? n.content?.[0]?.content?.[0]?.text ?? null).filter(Boolean));
async function open(page, query, doc = THREE) {
  await page.goto(`${url}?${query}&doc=${encodeURIComponent(JSON.stringify(doc))}`);
  await expect(page.locator('body')).toHaveAttribute('data-ready', '1');
}
// A synthetic touch drag on the handle: hold (the long press) then move to y and let go.
async function touchDrag(page, toY, scope = '') {
  await page.evaluate(async ([y, scope]) => {
    const g = [...document.querySelectorAll(`${scope} .ed-grip`)].find(el => !el.hidden), r = g.getBoundingClientRect(), x = r.left + r.width / 2, y0 = r.top + r.height / 2;
    const ev = (type, cy) => g.dispatchEvent(new PointerEvent(type, {bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: cy, button: 0}));
    ev('pointerdown', y0);
    await new Promise(res => setTimeout(res, 450));
    for (let i = 1; i <= 5; i++) { ev('pointermove', y0 + (y - y0) * i / 5); await new Promise(res => setTimeout(res, 16)); }
    ev('pointerup', y);
  }, [toY, scope]);
}

for (const [label, viewport, touch] of [['PC 1280', {width: 1280, height: 800}, false], ['폰 390', {width: 390, height: 844}, true]]) {
  test.describe(label, () => {
    test.use({viewport, hasTouch: touch, isMobile: touch});
    const press = l => (touch ? l.tap() : l.click());
    // Shows the handle beside a block: a mouse hovers it, a phone puts the cursor in it.
    const reach = async (page, block) => {
      if (touch) await block.tap(); else { await block.click(); await block.hover(); }
      await expect(page.locator('.ed-grip')).toBeVisible();
    };

    test('끈 상태가 기본: 손잡이 없음 · [블록]으로 켜면 손잡이 보임 · 끄면 사라짐', async ({page}) => {
      await open(page, 'blocks=off');
      // [블록 모드]는 편집 막대 위 작은 아이콘 단추(↶ 앞, 폰·PC 같은 자리). NOTE-블록모드찾기: [문단 ▾] 안이 아니다.
      const box = page.locator('.ed-input'), toggle = page.locator('.ed-bar').getByRole('button', {name: '블록 모드', exact: true, includeHidden: true});
      await expect(toggle).toHaveAttribute('data-ed-cmd', 'blocks');
      expect(await toggle.evaluate(el => el.closest('[data-ed-panel]')?.dataset.edPanel ?? null)).toBe(null);
      await expect(toggle).toBeVisible();
      expect(await toggle.evaluate(el => el.nextElementSibling?.dataset.edCmd)).toBe('undo');
      await expect(toggle).toHaveAttribute('aria-pressed', 'false');
      await expect(page.locator('.ed-editor')).not.toHaveClass(/ed-blocks-on/);
      const pad = await box.evaluate(el => getComputedStyle(el).paddingLeft);
      await press(box.locator('p').nth(1));
      if (!touch) await box.locator('p').nth(1).hover();
      await expect(page.locator('.ed-grip')).toBeHidden();
      // 켜면 손잡이 자리만큼 왼쪽 여백이 생기고, 끄면 글쓰기 모양 그대로.
      await edPress(page, '블록 모드', {tap: touch});
      await expect(toggle).toHaveAttribute('aria-pressed', 'true');
      expect(await page.evaluate(() => window.blockToggles)).toEqual([true]);
      expect(parseFloat(await box.evaluate(el => getComputedStyle(el).paddingLeft))).toBeGreaterThan(parseFloat(pad));
      await reach(page, box.locator('p').nth(1));
      await edPress(page, '블록 모드', {tap: touch});
      await expect(toggle).toHaveAttribute('aria-pressed', 'false');
      await expect(page.locator('.ed-grip')).toBeHidden();
      expect(await page.evaluate(() => window.blockToggles)).toEqual([true, false]);
      expect(await box.evaluate(el => getComputedStyle(el).paddingLeft)).toBe(pad);
    });

    test('손잡이를 끌어 순서 바꾸기(↶ 한 번에 되돌림) · 누르면 블록 메뉴(위로·복제·지우기·바꾸기)', async ({page}) => {
      await open(page, 'blocks=on');
      const box = page.locator('.ed-input');
      await reach(page, box.locator('p').nth(2));
      const top = (await box.locator('p').nth(0).boundingBox()).y + 2;
      if (touch) await touchDrag(page, top);
      else {
        const g = await page.locator('.ed-grip').boundingBox();
        await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2); await page.mouse.down();
        await page.mouse.move(g.x + g.width / 2, g.y - 8, {steps: 3});
        await expect(page.locator('.ed-drop-line')).toBeVisible();
        // D1: 반투명 조각이 따라온다.
        await expect(page.locator('.ed-drag-ghost')).toBeVisible();
        expect(+(await page.locator('.ed-drag-ghost').evaluate(el => getComputedStyle(el).opacity))).toBeLessThan(1);
        await page.mouse.move(g.x + g.width / 2, top, {steps: 6}); await page.mouse.up();
      }
      await expect.poll(() => texts(page)).toEqual(['셋째', '첫째', '둘째']);
      await expect(page.locator('.ed-drop-line')).toBeHidden();
      await press(page.locator('.ed-tools').getByRole('button', {name: '되돌리기', exact: true}));
      await expect.poll(() => texts(page)).toEqual(['첫째', '둘째', '셋째']);
      // 블록 메뉴: 둘째를 위로 → 복제 → 제목 2로 바꾸기 → 지우기.
      await reach(page, box.locator('p').nth(1));
      await press(page.locator('.ed-grip'));
      const menu = page.getByRole('menu', {name: '블록 메뉴'});
      await expect(menu).toBeVisible();
      await expect(menu.getByRole('menuitem')).toHaveText(['위로', '아래로', '복제', '삭제', '본문', '제목 1', '제목 2', '제목 3', '글머리 목록', '번호 목록', '할 일 체크', '인용', '접기 블록', '코드']);
      await press(menu.getByRole('menuitem', {name: '위로'}));
      await expect.poll(() => texts(page)).toEqual(['둘째', '첫째', '셋째']);
      await reach(page, box.locator('p').first());
      await press(page.locator('.ed-grip'));
      await press(menu.getByRole('menuitem', {name: '제목 2'}));
      await expect(box.locator('h3.ed-h2')).toHaveText('둘째');
      await reach(page, box.locator('h3.ed-h2'));
      await press(page.locator('.ed-grip'));
      await press(menu.getByRole('menuitem', {name: '복제'}));
      await expect(box.locator('h3.ed-h2')).toHaveCount(2);
      await reach(page, box.locator('h3.ed-h2').first());
      await press(page.locator('.ed-grip'));
      await press(menu.getByRole('menuitem', {name: '삭제'}));
      await expect(box.locator('h3.ed-h2')).toHaveCount(1);
      await expect(menu).toBeHidden();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });

    test("'/' 목록으로 제목·접기 넣기(블록 편집을 꺼도) · 접힘 저장 · 읽기 화면에서도 접기", async ({page}) => {
      await open(page, 'blocks=off', ed1(p('맨 위')));
      const box = page.locator('.ed-input');
      await press(box.locator('p').first());
      await page.keyboard.press('End'); await page.keyboard.press('Enter');
      await page.keyboard.type('/');
      const list = page.getByRole('listbox', {name: '넣을 블록'});
      await expect(list).toBeVisible();
      await expect(list.getByRole('option')).toHaveText(['제목 1', '제목 2', '제목 3', '글머리 목록', '번호 목록', '할 일 체크', '인용', '구분선', '표', '접기 블록', '코드']);
      await page.keyboard.type('h2');
      await expect(list.getByRole('option')).toHaveText(['제목 2']);
      await page.keyboard.press('Enter');
      await expect(list).toBeHidden();
      await page.keyboard.type('회의 안건');
      await expect(box.locator('h3.ed-h2')).toHaveText('회의 안건');
      await page.keyboard.press('Enter');
      await page.keyboard.type('/접기');
      await expect(list.getByRole('option')).toHaveText(['접기 블록']);
      await page.keyboard.press('Enter');
      await page.keyboard.type('세부');
      await page.keyboard.press('Enter');
      await page.keyboard.type('안쪽 내용');
      await expect(box.locator('.ed-toggle .ed-toggle-body > p')).toHaveText(['세부', '안쪽 내용']);
      // Esc closes the list and leaves the letters.
      await page.keyboard.press('Enter'); await page.keyboard.type('/표');
      await expect(list).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(list).toBeHidden();
      await expect(box.locator('.ed-toggle p').last()).toHaveText('/표');
      // [▸] folds: the inside is hidden, open:false saved; Enter at the end of the folded line goes on after the fold.
      await press(box.locator('.ed-toggle-btn'));
      await expect(box.locator('.ed-toggle')).toHaveClass(/is-closed/);
      await expect(box.locator('.ed-toggle .ed-toggle-body > p').nth(1)).toBeHidden();
      const saved = await page.evaluate(() => window.ed.getValue().doc.content);
      const toggle = saved.find(n => n.type === 'toggle');
      expect(toggle.attrs).toEqual({open: false});
      expect(toggle.content.map(n => n.content?.[0]?.text)).toEqual(['세부', '안쪽 내용', '/표']);
      // Read view (the same drawing the share page uses): a closed <details> with its ▸ line; opening it shows the inside.
      await page.evaluate(() => window.renderOut());
      const out = page.locator('#out');
      await expect(out.locator('details.ed-toggle > summary')).toHaveText('세부');
      await expect(out.locator('details.ed-toggle')).not.toHaveAttribute('open', '');
      await press(out.locator('details.ed-toggle > summary'));
      await expect(out.locator('details.ed-toggle .ed-toggle-body p').first()).toHaveText('안쪽 내용');
    });

    test('할 일 체크: / 로 넣고, 네모를 누르면 체크(↶로 되돌림), 읽기 화면은 ☑', async ({page}) => {
      await open(page, 'slash=1', ed1(p('')));
      const box = page.locator('.ed-input');
      await press(box.locator('p').first());
      await page.keyboard.type('/할 일');
      await page.keyboard.press('Enter');
      await page.keyboard.type('보고서 보내기');
      const item = box.locator('ul.ed-ul-check > li').first();
      await expect(item).toHaveText('보고서 보내기');
      const r = await item.boundingBox();
      if (touch) await page.touchscreen.tap(r.x - 12, r.y + r.height / 2); else await page.mouse.click(r.x - 12, r.y + r.height / 2);
      await expect(item).toHaveAttribute('data-checked', 'true');
      const list = (await page.evaluate(() => window.ed.getValue().doc.content))[0];
      expect(list).toEqual({type: 'bullet_list', attrs: {marker: 'check'}, content: [{type: 'list_item', attrs: {checked: true}, content: [p('보고서 보내기')]}]});
      await page.evaluate(() => window.renderOut());
      await expect(page.locator('#out ul.ed-ul-check > li[data-checked="true"]')).toHaveText('보고서 보내기');
    });
  });
}

// D4: 끄는 중 Esc = 취소(제자리, 바뀐 것 없음).
test('끄는 중 Esc는 끌기 취소: 순서 그대로, 조각·줄 사라짐 (PC 1280)', async ({page}) => {
  await page.setViewportSize({width: 1280, height: 800});
  await open(page, 'blocks=on');
  const box = page.locator('.ed-input'), third = box.locator('p').nth(2);
  await third.click(); await third.hover();
  const g = await page.locator('.ed-grip').boundingBox(), top = (await box.locator('p').first().boundingBox()).y + 2;
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2); await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2, top, {steps: 6});
  await expect(page.locator('.ed-drag-ghost')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.ed-drag-ghost, .ed-drop-line:visible')).toHaveCount(0);
  await page.mouse.up();
  expect(await texts(page)).toEqual(['첫째', '둘째', '셋째']);
  expect(await page.evaluate(() => window.changes)).toBe(0);
});

test('옛 글은 그대로 열린다: 블록 편집을 켜도 저장 모양은 바뀌지 않는다', async ({page}) => {
  const old = ed1(p('가'), {type: 'heading', attrs: {level: 2}, content: [{type: 'text', text: '나'}]}, {type: 'bullet_list', content: [{type: 'list_item', content: [p('다')]}]}, p('라'));
  await open(page, 'blocks=on', old);
  expect(await page.evaluate(() => window.ed.getValue())).toEqual(old);
});

// 노트 화면: 끈 상태로 열리고, [블록]을 켜면 이 노트·내 기본값을 서버에 기억하며, 끌어 바꾼 순서는 저장 뒤 다시 불러와도 그대로.
test.describe('노트 화면', () => {
test.use({hasTouch: true});
for (const width of [1280, 390]) test(`노트에서 블록 편집 켜기 → 끌어 순서 바꾸기 → 저장 → 다시 불러와도 그 순서 ${width}`, async ({page}) => {
  test.setTimeout(60000);
  const touch = width < 761;
  await page.setViewportSize({width, height: 900});
  const at = '2026-11-20T01:00:00Z';
  const rows = [{id: 'nb1', workspace_id: 'w', kind: 'note', title: '블록 노트', raw_text: '첫째\n\n둘째\n\n셋째', doc: THREE, occurred_at: at, created_at: at, updated_at: at, archived_at: null, ai_export_allowed: true, attachments: [], metadata: {}}];
  const writes = [], errors = [];
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
  const openNote = async () => {
    await page.evaluate(() => window.KPTURouter.go('basket'));
    await chooseBasketKind(page, 'note');
    const row = page.locator('[data-note-host] [data-note-row="nb1"]').first();
    if (touch) await row.tap(); else await row.click();
  };
  await openNote();
  await noteMenuAction(page, 'data-note-edit', {width});
  const field = noteField(page), editor = page.locator('[data-note-body-field] .ed-editor');
  await expect(field).toBeVisible();
  const toggle = page.locator('[data-note-body-field] .ed-bar').getByRole('button', {name: '블록 모드', exact: true, includeHidden: true});
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(editor).not.toHaveClass(/ed-blocks-on/);
  await edPress(page.locator('[data-note-body-field]'), '블록 모드', {tap: touch});
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  // 이 노트 값(metadata.block_edit)은 고치기가 아니라 updated_at을 건드리지 않는다.
  await expect.poll(() => rows[0].metadata.block_edit).toBe(true);
  expect(writes.find(w => w.metadata)?.updated_at).toBeUndefined();
  const third = field.locator('p').nth(2);
  if (touch) await third.tap(); else { await third.click(); await third.hover(); }
  await expect(page.locator('[data-note-body-field] .ed-grip')).toBeVisible();
  const top = (await field.locator('p').first().boundingBox()).y + 2;
  // 손잡이는 누른 셋째 문단 옆에 선다(첫 문단 옆에 남으면 끌어도 순서가 그대로다).
  // NOTE-블록모드찾기: [블록 모드]가 막대 위 단추라 켜자마자 커서가 있던 첫 문단 옆에 손잡이가 먼저 보인다. 셋째 문단 옆으로 옮겨 설 때까지 본다.
  const thirdAt = await third.boundingBox();
  await expect.poll(async () => { const g = await page.locator('[data-note-body-field] .ed-grip').boundingBox(); return g ? Math.abs((g.y + g.height / 2) - (thirdAt.y + thirdAt.height / 2)) : Infinity; }).toBeLessThan(thirdAt.height);
  if (touch) await touchDrag(page, top, '[data-note-body-field]');
  else {
    const g = await page.locator('[data-note-body-field] .ed-grip').boundingBox();
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2); await page.mouse.down();
    await page.mouse.move(g.x + g.width / 2, g.y - 8, {steps: 3}); await page.mouse.move(g.x + g.width / 2, top, {steps: 6}); await page.mouse.up();
  }
  await expect(field.locator('p')).toHaveText(['셋째', '첫째', '둘째']);
  const save = page.locator('[data-note-detail] [data-note-save]');
  if (touch) await save.tap(); else await save.click();
  await expect(page.locator('#toast')).toContainText('노트를 저장했습니다.');
  expect(rows[0].doc.doc.content.map(n => n.content?.[0]?.text)).toEqual(['셋째', '첫째', '둘째']);
  // 다시 불러오기: 읽기 화면도, 다시 연 편집기도 그 순서 — 이 노트는 블록 편집이 켜진 채 열린다.
  await page.reload();
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, {timeout: 20000});
  await openNote();
  await expect(page.locator('[data-note-detail] [data-basket-read-text] p')).toHaveText(['셋째', '첫째', '둘째']);
  await noteMenuAction(page, 'data-note-edit', {width});
  await expect(noteField(page)).toBeVisible();
  await expect(page.locator('[data-note-body-field] .ed-editor')).toHaveClass(/ed-blocks-on/);
  expect(errors).toEqual([]);
});
});

// 게시(받는 화면, share/): 노트 글의 접기·할 일 체크가 깨지지 않고 보인다. 접어 저장한 접기는 닫힌 채, 누르면 열린다(스크립트 없이 <details>).
test.describe('게시 받는 화면', () => {
test.use({hasTouch: true});
test('게시 받는 화면: 접기 블록(닫힌 채 · 누르면 열림)과 할 일 체크가 보인다', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  const READ = SB + '/functions/v1/share-page-read', errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const doc = ed1(p('게시한 노트'), {type: 'toggle', attrs: {open: false}, content: [p('회의 안건'), p('세부 내용')]},
    {type: 'bullet_list', attrs: {marker: 'check'}, content: [{type: 'list_item', attrs: {checked: true}, content: [p('한 일')]}, {type: 'list_item', content: [p('할 일')]}]});
  await page.route(SB + '/**', route => route.request().url() === READ
    ? route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({ok: true, page: {title: '블록 노트', blocks: [{type: 'doc', doc}]}})})
    : route.abort());
  await page.goto(appOrigin + '/share/#t=' + 'e'.repeat(64));
  const box = page.locator('.sr-doc .ed-doc');
  const fold = box.locator('details.ed-toggle');
  await expect(fold.locator('summary')).toHaveText('회의 안건');
  await expect(fold).not.toHaveAttribute('open', '');
  await expect(fold.locator('.ed-toggle-body p')).toBeHidden();
  await fold.locator('summary').tap();
  await expect(fold.locator('.ed-toggle-body p')).toHaveText('세부 내용');
  await expect(box.locator('ul.ed-ul-check > li')).toHaveText(['한 일', '할 일']);
  await expect(box.locator('ul.ed-ul-check > li[data-checked="true"]')).toHaveText('한 일');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});
});
