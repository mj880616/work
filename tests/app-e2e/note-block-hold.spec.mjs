// NOTE-블록꾹눌러잡기(S71-66, standard-interactions P6, 사용자 결정 2026-11-26): 폰은 블록 손잡이 대신 '꾹 눌러 잡기'. 합성 데이터만.
// - 폰(폭 760px 이하·손가락): 블록 왼쪽 끝 손잡이 ⠿가 아예 없다(갤럭시 왼쪽 끝 밀기 = 뒤로가기와 겹침). 블록 편집을 켜도 왼쪽 여백이 생기지 않는다.
// - 글자가 없는 자리(블록 여백·줄 끝 오른쪽·사진·표 바깥 테두리)를 0.5초 꾹 누르면 그 블록이 살짝 들리고 블록 메뉴(손잡이 메뉴와 같은 항목)가
//   손가락에 가리지 않는 자리에 뜬다. 손을 떼지 않고 끌면 블록을 위아래로 옮긴다(↶ 한 번에 되돌림).
// - 글자 위 꾹 누르기는 브라우저 글 고르기 그대로(블록 메뉴·끌기 없음). 표 칸 안도 그대로.
// - 도구 줄 ⠿ = '블록 메뉴': 커서 블록의 같은 메뉴를 연다(다시 누르면 닫힘). 표 왼쪽 위 작은 네모는 폰에 없다([표 선택]은 표 줄에 그대로).
// - PC 1280은 그대로: 마우스를 올리면 왼쪽 손잡이, 도구 줄 ⠿ = [블록 모드] 켜기·끄기, 마우스로 오래 눌러도 블록 메뉴가 뜨지 않음, 표 모서리 네모 있음.
import {test, expect} from '@playwright/test';
import {appOrigin} from './helpers/test-origin.mjs';
import {openHome} from './helpers/home-entry.mjs';
import {noteMenuAction} from './helpers/note-menu.mjs';
import {chooseBasketKind} from './helpers/basket-kind.mjs';
import {noteField} from './helpers/note-editor.mjs';

const url = `${appOrigin}/tests/app-e2e/ed-editor-fixture.html`;
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const p = text => ({type: 'paragraph', attrs: {style: 'body2'}, content: [{type: 'text', text}]});
const ed1 = (...content) => ({v: 'ed1', doc: {type: 'doc', content}});
const THREE = ed1(p('첫째'), p('둘째'), p('셋째'));
const table = (rows, cols) => ({type: 'table', content: Array.from({length: rows}, (_, r) => ({type: 'table_row',
  content: Array.from({length: cols}, (_, c) => ({type: r ? 'table_cell' : 'table_header', content: [p(`${r}${c}`)]}))}))});
const MENU_ITEMS = ['복제', '삭제', '본문', '제목 1', '제목 2', '제목 3', '글머리 목록', '번호 목록', '할 일 체크', '인용', '접기 블록', '코드'];
const texts = page => page.evaluate(() => window.ed.getValue().doc.content.map(n => n.content?.[0]?.text ?? null).filter(Boolean));
async function open(page, query, doc = THREE) {
  await page.goto(`${url}?${query}&doc=${encodeURIComponent(JSON.stringify(doc))}`);
  await expect(page.locator('body')).toHaveAttribute('data-ready', '1');
}
// The spot right of a block's last letter (no letters there), and the middle of its first letter.
const marginOf = loc => loc.evaluate(el => { const r = el.getBoundingClientRect(); return {x: Math.round(r.right - 12), y: Math.round(r.top + r.height / 2)}; });
const letterOf = loc => loc.evaluate(el => {
  const t = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode(), rg = document.createRange(); rg.setStart(t, 0); rg.setEnd(t, 1);
  const r = rg.getBoundingClientRect(); return {x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2)};
});
// A finger held at (x, y) for ms, then (optionally) moved to toY and let go — pointer events the editor gets from a real finger.
async function hold(page, {x, y}, {ms = 650, toY = null, pointerType = 'touch', release = true} = {}) {
  await page.evaluate(async ([x, y, ms, toY, pointerType, release]) => {
    const target = document.elementFromPoint(x, y);
    const ev = (type, cx, cy, el = target) => el.dispatchEvent(new PointerEvent(type, {bubbles: true, cancelable: true, composed: true, pointerId: 9, pointerType, isPrimary: true, clientX: cx, clientY: cy, button: 0, buttons: type === 'pointerup' ? 0 : 1}));
    ev('pointerdown', x, y);
    await new Promise(res => setTimeout(res, ms));
    let cy = y;
    if (toY != null) for (let i = 1; i <= 6; i++) { cy = y + (toY - y) * i / 6; ev('pointermove', x, cy, document.elementFromPoint(x, cy) || target); await new Promise(res => setTimeout(res, 16)); }
    if (release) ev('pointerup', x, cy, document.elementFromPoint(x, cy) || target);
  }, [x, y, ms, toY, pointerType, release]);
}

test.describe('P6 폰 390', () => {
  test.use({viewport: {width: 390, height: 844}, hasTouch: true, isMobile: true});

  test('P6 손잡이 없음 · 왼쪽 여백 없음 · 도구 줄 ⠿ = 블록 메뉴(커서 블록, 다시 누르면 닫힘)', async ({page}) => {
    await open(page, 'blocks=on');
    const box = page.locator('.ed-input');
    await expect(page.locator('.ed-editor')).toHaveClass(/ed-blocks-touch/);
    await box.locator('p').nth(1).tap();
    await expect(page.locator('.ed-grip')).toHaveCount(0);
    expect(parseFloat(await box.evaluate(el => getComputedStyle(el).paddingLeft))).toBeLessThan(20);
    const btn = page.locator('.ed-bar .ed-tools > [data-ed-cmd="blocks"]');
    await expect(btn).toHaveAccessibleName('블록 메뉴');
    await expect(btn).toHaveAttribute('aria-haspopup', 'menu');
    expect(await btn.getAttribute('aria-pressed')).toBe(null);
    await expect.poll(() => page.evaluate(() => window.ed.view.state.selection.$head.index(0))).toBe(1);
    await btn.tap();
    const menu = page.getByRole('menu', {name: '블록 메뉴'});
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute('data-ed-for', '1');
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
    await expect(menu.getByRole('menuitem')).toHaveText(MENU_ITEMS);
    // 메뉴는 화면 안·하단 막대 자리 위.
    const m = await menu.boundingBox();
    expect(m.y + m.height).toBeLessThanOrEqual(844 - 60);
    expect(m.x).toBeGreaterThanOrEqual(0); expect(m.x + m.width).toBeLessThanOrEqual(390);
    await btn.tap();
    await expect(menu).toBeHidden();
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    // 다시 열어 '제목 1'로 바꾸면 커서가 있던 둘째가 제목이 된다.
    await btn.tap();
    await menu.getByRole('menuitem', {name: '제목 1'}).tap();
    await expect(box.locator('h2.ed-h1')).toHaveText('둘째');
    expect(await page.evaluate(() => window.blockToggles)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test('P6 블록 여백 꾹 누르기 → 들리고 메뉴(손가락에 안 가림) · 메뉴로 바꾸기·복제', async ({page}) => {
    await open(page, 'blocks=off'); // 블록 모드가 꺼져 있어도 폰은 꾹 눌러 잡는다(모드 단추가 없다)
    const box = page.locator('.ed-input'), menu = page.getByRole('menu', {name: '블록 메뉴'});
    const at = await marginOf(box.locator('p').nth(2));
    await hold(page, at);
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute('data-ed-for', '2');
    await expect(page.locator('.ed-block-lift')).toBeVisible();
    await expect(menu.getByRole('menuitem')).toHaveText(MENU_ITEMS);
    const m = await menu.boundingBox();
    // 손가락(누른 자리 위아래 24px)과 겹치지 않는다.
    expect(m.y + m.height <= at.y - 24 || m.y >= at.y + 24).toBe(true);
    await menu.getByRole('menuitem', {name: '인용'}).tap();
    await expect(menu).toBeHidden();
    await expect(page.locator('.ed-block-lift')).toBeHidden();
    await expect(box.locator('blockquote')).toHaveText('셋째');
    // 첫째 줄 끝 → 복제.
    await hold(page, await marginOf(box.locator('p').first()));
    await menu.getByRole('menuitem', {name: '복제'}).tap();
    await expect.poll(() => texts(page)).toEqual(['첫째', '첫째', '둘째']);
    // 메뉴 바깥을 누르면 닫히기만 한다.
    await hold(page, await marginOf(box.locator('p').nth(1)));
    await expect(menu).toBeVisible();
    await page.touchscreen.tap(195, 700);
    await expect(menu).toBeHidden();
  });

  test('P6 꾹 눌러 그대로 끌면 블록을 옮긴다(↶ 한 번에 되돌림) · 조각과 놓을 줄', async ({page}) => {
    await open(page, 'blocks=on');
    const box = page.locator('.ed-input');
    const from = await marginOf(box.locator('p').nth(2)), top = (await box.locator('p').first().boundingBox()).y + 2;
    await hold(page, from, {toY: top, release: false});
    await expect(page.locator('.ed-drag-ghost')).toBeVisible();
    await expect(page.locator('.ed-drop-line')).toBeVisible();
    await expect(page.getByRole('menu', {name: '블록 메뉴'})).toBeHidden(); // 끌기 시작하면 메뉴는 닫힌다
    await page.evaluate(([x, y]) => document.elementFromPoint(x, y).dispatchEvent(new PointerEvent('pointerup', {bubbles: true, pointerId: 9, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y})), [from.x, top]);
    await expect.poll(() => texts(page)).toEqual(['셋째', '첫째', '둘째']);
    await expect(page.locator('.ed-drag-ghost')).toHaveCount(0);
    await expect(page.locator('.ed-drop-line')).toBeHidden();
    await page.locator('.ed-tools').getByRole('button', {name: '되돌리기', exact: true}).tap();
    await expect.poll(() => texts(page)).toEqual(['첫째', '둘째', '셋째']);
  });

  test('P6 글자 위 꾹 누르기는 글 고르기 그대로(블록 메뉴·끌기 없음) · 짧게 누르기·밀기도 그대로', async ({page}) => {
    await open(page, 'blocks=on');
    const box = page.locator('.ed-input'), menu = page.getByRole('menu', {name: '블록 메뉴'});
    const letter = await letterOf(box.locator('p').nth(1));
    let prevented = null;
    await page.exposeFunction('reportPrevented', v => { prevented = v; });
    await page.evaluate(() => document.addEventListener('pointerdown', e => setTimeout(() => window.reportPrevented(e.defaultPrevented), 0)));
    await hold(page, letter, {ms: 800});
    await expect(menu).toBeHidden();
    await expect(page.locator('.ed-block-lift')).toBeHidden();
    await expect(page.locator('.ed-editor')).not.toHaveClass(/ed-dragging/);
    expect(prevented).toBe(false); // 브라우저 기본 동작(글 고르기)을 막지 않는다
    // 글자 위 꾹 눌러 끌어도 블록은 그대로.
    await hold(page, letter, {ms: 700, toY: letter.y + 120});
    await expect.poll(() => texts(page)).toEqual(['첫째', '둘째', '셋째']);
    // 여백을 짧게 누르거나(0.2초) 누르자마자 움직이면(화면 밀기) 잡지 않는다.
    const at = await marginOf(box.locator('p').nth(1));
    await hold(page, at, {ms: 200});
    await expect(menu).toBeHidden();
    await hold(page, at, {ms: 0, toY: at.y + 80});
    await page.waitForTimeout(600);
    await expect(menu).toBeHidden();
    await expect.poll(() => texts(page)).toEqual(['첫째', '둘째', '셋째']);
  });

  test('P6 표: 모서리 작은 네모 없음 · 표 바깥 테두리 꾹 누르기 → 표 블록 메뉴 · 칸 안 꾹 누르기는 그대로', async ({page}) => {
    await open(page, 'blocks=on', ed1(p('앞'), table(2, 2), p('뒤')));
    const box = page.locator('.ed-input'), menu = page.getByRole('menu', {name: '블록 메뉴'});
    await expect(box.locator('.ed-table-wrap')).toHaveCount(1);
    await expect(box.locator('.ed-table-grip')).toHaveCount(0);
    // [표 선택]은 표 줄에 그대로.
    await box.locator('td').first().tap();
    await expect(page.getByRole('button', {name: '표 전체 선택'})).toBeVisible();
    // 칸 안(글자 없는 자리) 꾹 누르기: 블록 메뉴 없음.
    const cell = await marginOf(box.locator('td').first());
    await hold(page, cell);
    await expect(menu).toBeHidden();
    // 표 위쪽 바깥 테두리(표 둘레 여백).
    const edge = await box.locator('.ed-table-wrap').evaluate(el => { const w = el.getBoundingClientRect(), t = el.querySelector('table').getBoundingClientRect(); return {x: Math.round(t.left + 20), y: Math.round((w.top + t.top) / 2)}; });
    await hold(page, edge);
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute('data-ed-for', '1');
    await expect(menu.getByRole('menuitem', {name: '복제'})).toBeEnabled();
    await expect(menu.getByRole('menuitem', {name: '제목 1'})).toBeDisabled();
    await menu.getByRole('menuitem', {name: '복제'}).tap();
    await expect(box.locator('table')).toHaveCount(2);
  });
});

test.describe('P6 PC 1280 회귀', () => {
  test.use({viewport: {width: 1280, height: 800}});
  test('P6 PC: 손잡이 그대로 · ⠿ = 블록 모드 켜기·끄기 · 마우스 오래 누르기는 블록 메뉴 아님 · 표 모서리 네모 있음', async ({page}) => {
    await open(page, 'blocks=off', ed1(p('첫째'), p('둘째'), table(2, 2)));
    const box = page.locator('.ed-input'), menu = page.getByRole('menu', {name: '블록 메뉴'});
    await expect(page.locator('.ed-editor')).not.toHaveClass(/ed-blocks-touch/);
    const btn = page.locator('.ed-bar .ed-tools > [data-ed-cmd="blocks"]');
    await expect(btn).toHaveAccessibleName('블록 모드');
    await expect(btn).toHaveAttribute('aria-pressed', 'false');
    await btn.click();
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
    await expect(menu).toBeHidden();
    expect(parseFloat(await box.evaluate(el => getComputedStyle(el).paddingLeft))).toBeGreaterThanOrEqual(30);
    await box.locator('p').nth(1).click(); await box.locator('p').nth(1).hover();
    await expect(page.locator('.ed-grip')).toBeVisible();
    await expect(page.locator('.ed-grip')).toHaveAttribute('data-ed-block', '1');
    await hold(page, await marginOf(box.locator('p').first()), {pointerType: 'mouse'});
    await expect(menu).toBeHidden();
    await page.locator('.ed-grip').click();
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem')).toHaveText(MENU_ITEMS);
    await page.keyboard.press('Escape');
    await expect(box.locator('.ed-table-grip')).toHaveCount(1);
  });
});

// 노트 화면(폰 390): 손잡이·블록 모드 단추 없이 꾹 눌러 끌어 순서를 바꾸고, 저장 뒤 다시 불러와도 그 순서.
test.describe('P6 노트 화면 폰 390', () => {
  test.use({viewport: {width: 390, height: 900}, hasTouch: true, isMobile: true});
  test('P6 노트에서 꾹 눌러 끌어 순서 바꾸기 → 저장 → 다시 불러와도 그 순서', async ({page}) => {
    test.setTimeout(60000);
    const at = '2026-11-20T01:00:00Z';
    const rows = [{id: 'nb1', workspace_id: 'w', kind: 'note', title: '블록 노트', raw_text: '첫째\n\n둘째\n\n셋째', doc: THREE, occurred_at: at, created_at: at, updated_at: at, archived_at: null, ai_export_allowed: true, attachments: [], metadata: {}}];
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await openHome(page);
    await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', async r => {
      const req = r.request(), q = new URL(req.url()).searchParams;
      const pick = row => (!q.get('kind') || 'eq.' + row.kind === q.get('kind')) && (!q.get('id') || 'eq.' + row.id === q.get('id')) && (!q.get('updated_at') || 'eq.' + row.updated_at === q.get('updated_at'));
      if (req.method() === 'GET') { if (q.get('metadata')) return r.fulfill({json: []}); return r.fulfill({json: rows.filter(pick).map(x => structuredClone(x))}); }
      if (req.method() === 'PATCH') { const body = req.postDataJSON(); const hit = rows.filter(pick); for (const row of hit) Object.assign(row, body); return r.fulfill({json: hit.map(x => structuredClone(x))}); }
      return r.fulfill({status: 500, json: {}});
    });
    await page.route(SB + '/rest/v1/app_record_links?**', r => new URL(r.request().url()).searchParams.has('note_id') ? r.fulfill({json: []}) : r.fallback());
    const openNote = async () => {
      await page.evaluate(() => window.KPTURouter.go('basket'));
      await chooseBasketKind(page, 'note');
      await page.locator('[data-note-host] [data-note-row="nb1"]').first().tap();
    };
    await openNote();
    await noteMenuAction(page, 'data-note-edit', {width: 390});
    const field = noteField(page);
    await expect(field).toBeVisible();
    const scope = page.locator('[data-note-body-field]');
    await expect(scope.locator('.ed-grip')).toHaveCount(0);
    await expect(scope.locator('.ed-bar .ed-tools > [data-ed-cmd="blocks"]')).toHaveAccessibleName('블록 메뉴');
    const third = field.locator('p').nth(2);
    await third.scrollIntoViewIfNeeded();
    const from = await marginOf(third), top = (await field.locator('p').first().boundingBox()).y + 2;
    await hold(page, from, {toY: top});
    await expect(field.locator('p')).toHaveText(['셋째', '첫째', '둘째']);
    await page.locator('[data-note-detail] [data-note-save]').tap();
    await expect(page.locator('#toast')).toContainText('노트를 저장했습니다.');
    expect(rows[0].doc.doc.content.map(n => n.content?.[0]?.text)).toEqual(['셋째', '첫째', '둘째']);
    await page.reload();
    await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, {timeout: 20000});
    await openNote();
    await expect(page.locator('[data-note-detail] [data-basket-read-text] p')).toHaveText(['셋째', '첫째', '둘째']);
    expect(errors).toEqual([]);
  });
});
