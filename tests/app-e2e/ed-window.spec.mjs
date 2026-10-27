import {test, expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
// ED③-창: the new write window (app/ed-window.js), opened by the test only (no button opens it yet). The test entry is the app page
// itself: the real shell, router, bottom tabs and back handling, with the window imported and opened by a script. 390 phone and 1280 PC.
const LINES = '2026.10.21. 교섭\n- 사측 안 제시\n\n다음 주 재교섭';
const win = page => page.locator('#edWindow');
const input = page => win(page).getByRole('textbox', {name: '본문'});
const plainOf = page => page.evaluate(async () => (await import('/app/ed-text.mjs')).toPlain(window.__edw.editor.getValue()));
const saves = page => page.evaluate(() => window.__saves);
const closed = page => page.evaluate(() => window.__closed);
const sheetPick = (page, id, name) => page.locator(id).getByRole('button', {name, exact: true}).click();

async function start(page, {width, doc = null, text = '', limit = 0, textOnly = false, draft = false}) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({width, height: width < 700 ? 844 : 800});
  await openHome(page);
  await page.evaluate(async o => {
    const m = await import('/app/ed-window.js');
    window.__saves = []; window.__closed = [];
    window.__edw = m.openEdWindow({title: '시험 쓰기', doc: o.doc, text: o.text, limit: o.limit, textOnly: o.textOnly, draft: o.draft,
      save: {run: async r => { window.__saves.push(r); return {ok: true}; }}, onClose: r => { window.__closed.push(r); }});
    await window.__edw.ready;
  }, {doc, text, limit, textOnly, draft});
  await expect(win(page)).toBeVisible();
  await expect(input(page)).toBeVisible();
  return errors;
}
// A small box of the editor: the color list on PC, the 글자 group list on a phone.
const openBox = async (page, width) => {
  const name = width < 700 ? '글자 서식 고르기' : '글자색 고르기';
  await win(page).locator('.ed-tools').getByRole('button', {name, exact: true}).click();
  await expect(win(page).locator('.ed-pop:visible').first()).toBeVisible();
};
const doc = (...content) => ({v: 'ed1', doc: {type: 'doc', content}});
const para = (text) => ({type: 'paragraph', attrs: {style: 'body2'}, content: [{type: 'text', text}]});
const table = {type: 'table', content: [0, 1].map(r => ({type: 'table_row', content: [0, 1].map(c => ({type: r ? 'table_cell' : 'table_header', attrs: {}, content: [para(`${r}${c}`)]}))}))};

for (const width of [390, 1280]) {
  test.describe(`새 쓰기 창 ${width}`, () => {
    test.use({hasTouch: width < 700});

    test('열기: 옛 글자가 줄바꿈 그대로 열리고 글자를 다시 뽑아도 같음(빈 줄이 늘지 않음)', async ({page}) => {
      const errors = await start(page, {width, text: LINES});
      await expect(win(page).locator('.ed-input p')).toHaveCount(2);
      expect(await plainOf(page)).toBe(LINES);
      await expect(win(page).locator('h2')).toHaveText('시험 쓰기');
      // The head: ✕ then export at the right end; [취소][저장] are the bottom row (UI-저장자리).
      await expect(win(page).locator('.ed-window-head > button')).toHaveCount(2);
      expect(errors).toEqual([]);
    });

    test('열었다 안 고치고 닫으면 저장 콜백을 부르지 않음(× 와 저장 아이콘 모두)', async ({page}) => {
      await start(page, {width, text: LINES});
      await win(page).getByRole('button', {name: '닫기', exact: true}).click();
      await expect(win(page)).toHaveCount(0);
      expect(await saves(page)).toEqual([]);
      expect((await closed(page))[0]).toMatchObject({saved: false, changed: false, text: LINES});
      // Save icon without a change: closes, still no save.
      await page.evaluate(async o => { const m = await import('/app/ed-window.js'); window.__edw = m.openEdWindow({text: o, save: {run: async r => { window.__saves.push(r); return {ok: true}; }}}); await window.__edw.ready; }, LINES);
      await win(page).getByRole('button', {name: '저장', exact: true}).click();
      await expect(win(page)).toHaveCount(0);
      expect(await saves(page)).toEqual([]);
    });

    test('고치고 저장: 서식과 글자를 함께 넘기고 창이 닫힘, 글자만 저장이면 서식은 null', async ({page}) => {
      await start(page, {width, text: LINES});
      await input(page).click();
      await page.keyboard.press('Control+End');
      await page.keyboard.type('!');
      await win(page).getByRole('button', {name: '저장', exact: true}).click();
      await expect(win(page)).toHaveCount(0);
      const [one] = await saves(page);
      expect(one.text).toBe(LINES + '!');
      expect(one.value.v).toBe('ed1');
      expect(one.textOnly).toBe(false);
      expect((await closed(page))[0]).toMatchObject({saved: true, changed: false});
    });

    test('글자만 저장 모드: 안내가 보이고 저장에는 글자만 가고 서식은 null', async ({page}) => {
      await start(page, {width, text: '', textOnly: true, draft: true});
      await expect(win(page).locator('.ed-window-note')).toBeVisible();
      await input(page).click();
      await page.keyboard.type('요약 글');
      await win(page).getByRole('button', {name: '저장', exact: true}).click();
      await expect(win(page)).toHaveCount(0);
      const [one] = await saves(page);
      expect(one).toMatchObject({text: '요약 글', value: null, textOnly: true});
    });

    test('글자 한도: 넘으면 안내하고 저장하지 않으며 창은 그대로, 한도 안으로 줄이면 저장됨', async ({page}) => {
      await start(page, {width, text: '', limit: 5, draft: true});
      await input(page).click();
      await page.keyboard.type('가나다라마바사아');
      await win(page).getByRole('button', {name: '저장', exact: true}).click();
      await expect(win(page).locator('.ed-window-status')).toContainText('5자까지');
      await expect(win(page)).toBeVisible();
      expect(await saves(page)).toEqual([]);
      await input(page).click();
      await page.keyboard.press('Control+End');
      for (let i = 0; i < 3; i++) await page.keyboard.press('Backspace');
      await win(page).getByRole('button', {name: '저장', exact: true}).click();
      await expect(win(page)).toHaveCount(0);
      expect((await saves(page))[0].text).toBe('가나다라마');
    });

    test('고친 글을 ×로 닫으면 "저장하지 않고 닫을까요?"를 묻고, 계속 쓰기는 그대로·닫기는 저장 없이 닫힘', async ({page}) => {
      await start(page, {width, text: LINES});
      await input(page).click();
      await page.keyboard.type('수정');
      await win(page).getByRole('button', {name: '닫기', exact: true}).click();
      await expect(page.locator('#edwCloseSheet')).toBeVisible();
      await sheetPick(page, '#edwCloseSheet', '계속 쓰기');
      await expect(win(page)).toBeVisible();
      await win(page).getByRole('button', {name: '닫기', exact: true}).click();
      await sheetPick(page, '#edwCloseSheet', '저장하지 않고 닫기');
      await expect(win(page)).toHaveCount(0);
      expect(await saves(page)).toEqual([]);
      expect((await closed(page))[0]).toMatchObject({saved: false, changed: true});
      expect((await closed(page))[0].text).toContain('수정');
    });

    test('뒤로 가기: 안쪽 작은 상자가 열려 있으면 상자만 닫히고, 한 번 더 누르면 창이 닫힘', async ({page}) => {
      await start(page, {width, text: LINES});
      await input(page).click();
      await openBox(page, width);
      await page.evaluate(() => history.back());
      await expect(win(page).locator('.ed-pop:visible')).toHaveCount(0);
      await expect(win(page)).toBeVisible();
      expect(await closed(page)).toEqual([]);
      await page.evaluate(() => history.back());
      await expect(win(page)).toHaveCount(0);
      expect((await closed(page)).length).toBe(1);
      expect(await saves(page)).toEqual([]);
    });

    test('뒤로 가기: 표 칸 메뉴도 먼저 닫히고, 상자를 선택으로 닫으면 기록이 남지 않아 뒤로 가기 한 번에 창이 닫힘', async ({page}) => {
      await start(page, {width, doc: doc(table)});
      const cell = win(page).locator('td').first();
      await cell.click({button: 'right'});
      const ctx = page.getByRole('menu', {name: '표 칸 메뉴'});
      await expect(ctx).toBeVisible();
      await page.evaluate(() => history.back());
      await expect(ctx).toBeHidden();
      await expect(win(page)).toBeVisible();
      // A box closed by a choice gives its history entry back: one Back now closes the window.
      await openBox(page, width);
      await page.keyboard.press('Escape');
      await expect(win(page).locator('.ed-pop:visible')).toHaveCount(0);
      await expect(win(page)).toBeVisible();
      await page.evaluate(() => history.back());
      await expect(win(page)).toHaveCount(0);
    });

    test('뒤로 가기로 닫으면 고친 글은 onClose로 넘어옴(잃지 않음)', async ({page}) => {
      await start(page, {width, text: ''});
      await input(page).click();
      await page.keyboard.type('쓰던 글');
      await page.evaluate(() => history.back());
      await expect(win(page)).toHaveCount(0);
      expect((await closed(page))[0]).toMatchObject({changed: true, text: '쓰던 글', saved: false});
      expect(await saves(page)).toEqual([]);
    });

    test('Esc: 상자가 열려 있으면 상자만, 없으면 창이 닫힘', async ({page}) => {
      test.skip(width < 700, 'Esc is a keyboard rule (PC)');
      await start(page, {width, text: LINES});
      await input(page).click();
      await openBox(page, width);
      await page.keyboard.press('Escape');
      await expect(win(page)).toBeVisible();
      await expect(win(page).locator('.ed-pop:visible')).toHaveCount(0);
      await input(page).click();
      await page.keyboard.press('Escape');
      await expect(win(page)).toHaveCount(0);
    });

    test('내보내기: 텔레그램용·한글용 복사 줄이 나오고 HWP는 준비 중', async ({page}) => {
      await start(page, {width, text: LINES});
      await win(page).getByRole('button', {name: '내보내기', exact: true}).click();
      await expect(page.locator('#edwExportSheet')).toBeVisible();
      await expect(page.locator('#edwExportSheet .home-choice-row')).toHaveText(['텔레그램용 복사', '한글용 복사', 'HWP 파일로 받기']);
      await sheetPick(page, '#edwExportSheet', 'HWP 파일로 받기');
      await expect(win(page).locator('.ed-window-status')).toContainText('준비 중');
    });
  });
}

test.describe('폰 390: 하단바', () => {
  test.use({hasTouch: true});

  test('창과 작은 상자는 하단 탭을 가리지 않고, 자판이 열리면 탭이 숨고 창이 자판 위까지 씀', async ({page}) => {
    await start(page, {width: 390, text: LINES});
    const tabs = page.locator('.mobile-tabs');
    await expect(tabs).toBeVisible();
    const tabTop = (await tabs.boundingBox()).y;
    const box = await win(page).boundingBox();
    expect(box.y + box.height).toBeLessThanOrEqual(tabTop + 1);
    await input(page).click();
    await openBox(page, 390);
    const pop = await win(page).locator('.ed-pop:visible').first().boundingBox();
    expect(pop.y + pop.height).toBeLessThanOrEqual(tabTop);
    expect(pop.x).toBeGreaterThanOrEqual(0);
    expect(pop.x + pop.width).toBeLessThanOrEqual(390);
  });

  test('하단 탭을 누르면 창이 먼저 닫히고 그 탭으로 감, 고친 글이 있으면 먼저 물음', async ({page}) => {
    await start(page, {width: 390, text: LINES});
    await win(page).locator('.ed-input').click();
    await page.keyboard.type('수정');
    await page.locator('.mobile-tabs [data-view="basket"]').click();
    await expect(page.locator('#edwCloseSheet')).toBeVisible();
    await expect(win(page)).toBeVisible();
    await sheetPick(page, '#edwCloseSheet', '저장하지 않고 닫기');
    await expect(win(page)).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.KPTURouter.current)).toBe('basket');
    expect(await saves(page)).toEqual([]);
  });

  test('고치지 않았으면 묻지 않고 바로 그 탭으로 감', async ({page}) => {
    await start(page, {width: 390, text: LINES});
    await page.locator('.mobile-tabs [data-view="basket"]').click();
    await expect(win(page)).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.KPTURouter.current)).toBe('basket');
  });
});

test.describe('PC 1280: 앱 메뉴 옆', () => {
  test('창이 세로 메뉴를 가리지 않고 그 옆 본문 자리에서만 열림', async ({page}) => {
    await start(page, {width: 1280, text: LINES});
    const nav = await page.locator('#appView>.app-nav').boundingBox();
    const box = await win(page).boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(nav.x + nav.width);
    await expect(win(page)).toHaveAttribute('data-ed-nav', 'side');
  });
});
