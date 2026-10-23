// ED-서식줄펼침 (사용자 요청 2026-10-23 11:06~11:10): the unified editor's button row. Every button that opens choices carries a
// small ▾ and opens a small popover right under itself (over the text, closed by a press outside or Esc, never cut off at the
// right or bottom edge); [⌄]/[⌃] is the only button that opens a full-width row. 정렬 and 목록·번호 are vertical lists with ✓ on
// the current choice; list marker shapes are saved and read the same by readers and exports; a table's border chooses the
// whole table; inserting a table goes where the cursor is; a button pressed right after Shift+Home acts on the chosen letters.
// Fixture page only (no app shell). PC 1280 and phone 390.
import {test, expect} from '@playwright/test';
import {appOrigin} from './helpers/test-origin.mjs';

const url = `${appOrigin}/tests/app-e2e/ed-editor-fixture.html`;
const open = async (page, doc) => {
  await page.goto(doc ? `${url}?doc=${encodeURIComponent(JSON.stringify(doc))}` : url);
  await expect(page.locator('body')).toHaveAttribute('data-ready', '1');
  const box = page.getByRole('textbox', {name: '본문'});
  await box.click();
  return box;
};
const value = page => page.evaluate(() => window.ed.getValue());
const content = async page => (await value(page)).doc.content;
// A button of the editor's bar (the row or, on a phone, a group popover: ED-서식줄묶음).
const tool = (page, name) => page.locator('.ed-bar').getByRole('button', {name, exact: true});
const GROUP_BUTTONS = ['글자 서식 고르기', '문단 서식 고르기', '넣을 것 고르기', '기호 고르기'];
// On a phone most buttons sit in a group popover: open the group that holds this button (a no-op wider than a phone or when it shows).
const showTool = async (page, locator) => {
  if (page.viewportSize().width > 760 || await locator.isVisible()) return;
  for (const g of GROUP_BUTTONS) {
    await page.locator('.ed-tools').getByRole('button', {name: g, exact: true}).tap();
    if (await locator.isVisible()) return;
  }
  throw new Error('the button is on no phone group');
};
const group = (page, name) => page.getByRole('group', {name, exact: true});
const para = (text, attrs = {style: 'body2'}) => ({type: 'paragraph', attrs, ...(text ? {content: [{type: 'text', text}]} : {})});
const ed1 = (...nodes) => ({v: 'ed1', doc: {type: 'doc', content: nodes}});
const table = (rows, cols) => ({type: 'table', content: Array.from({length: rows}, (_, r) => ({type: 'table_row',
  content: Array.from({length: cols}, (_, c) => ({type: r ? 'table_cell' : 'table_header', attrs: {}, content: [para(`${r}${c}`)]}))}))});
// The editor reads the browser's cursor after a click or a Shift/End key (selectionchange); wait until it has.
const stateSel = page => page.evaluate(() => { const s = window.ed.view.state.selection; return {from: s.from, to: s.to, empty: s.empty}; });
const rect = async locator => locator.evaluate(el => { const r = el.getBoundingClientRect(); return {left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height}; });
// Brings a button of the row into view (a phone swipes the row sideways) and returns it.
const reveal = async (page, name) => {
  const b = tool(page, name);
  await showTool(page, b);
  await b.evaluate(el => el.scrollIntoView({inline: 'center', block: 'nearest'}));
  return b;
};

// [button on the row, popover group, a choice inside to press]
const OPENERS = [
  ['글 단계 고르기', '글 단계'], ['글자색 고르기', '글자색'], ['형광펜 고르기', '형광펜'], ['정렬 고르기', '정렬'],
  ['글머리 목록 고르기', '글머리 목록'], ['번호 목록 고르기', '번호 목록'], ['표 넣기', '표 크기 고르기'],
  ['점 기호 고르기', '점 기호'], ['참고 기호 고르기', '참고 기호'], ['화살표 고르기', '화살표'], ['동그라미 번호 고르기', '동그라미 번호'],
  ['링크 넣기', '링크'],
];

for (const [label, viewport, touch] of [['PC 1280', {width: 1280, height: 800}, false], ['폰 390', {width: 390, height: 844}, true]]) {
  test.describe(label, () => {
    test.use({viewport, hasTouch: touch, isMobile: touch});
    const press = async (locator) => { if (touch) { await showTool(locator.page(), locator); await locator.tap(); } else await locator.click(); };

    test('every opener: a small popover right under its button, over the text, inside the screen; outside press and Esc close it', async ({page}) => {
      const box = await open(page);
      await page.keyboard.type('본문 글');
      const textTop = (await rect(box)).top;
      const barHeight = (await rect(page.locator('.ed-bar'))).height;
      for (const [name, g] of OPENERS) {
        const trigger = await reveal(page, name), pop = group(page, g);
        await press(trigger);
        await expect(pop, name).toBeVisible();
        await expect(trigger).toHaveAttribute('aria-expanded', 'true');
        const t = await rect(trigger), p = await rect(pop);
        // Directly under the button (a few px), left edge on the button's left edge unless the screen's right edge pushed it left.
        expect(p.top, `${name} top`).toBeGreaterThanOrEqual(t.bottom);
        expect(p.top - t.bottom, `${name} gap`).toBeLessThanOrEqual(12);
        expect(p.left, `${name} left`).toBeGreaterThanOrEqual(0);
        if (p.left > t.left + 1) expect(p.right, `${name} pushed only by the edge`).toBeGreaterThan(viewport.width - 12);
        expect(p.right, `${name} right`).toBeLessThanOrEqual(viewport.width);
        expect(p.bottom, `${name} bottom`).toBeLessThanOrEqual(viewport.height);
        // A small box, not a full-width band, and the text did not move.
        expect(p.width, `${name} width`).toBeLessThan(viewport.width - 16);
        expect(await page.locator('.ed-bar').evaluate(el => el.getBoundingClientRect().height), `${name} bar`).toBe(barHeight);
        expect((await rect(box)).top, `${name} text`).toBe(textTop);
        // A press outside (in the text) closes it.
        // (at the right side of the text, away from the popover that may cover the middle)
        await box.click({position: {x: viewport.width - 30, y: 150}});
        await expect(pop, `${name} outside`).toBeHidden();
        await expect(trigger).toHaveAttribute('aria-expanded', 'false');
        // Esc closes it, and the text box keeps (or gets back) the focus.
        await press(trigger);
        await expect(pop, `${name} reopen`).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(pop, `${name} esc`).toBeHidden();
      }
    });

    test('every button that opens choices carries a small ▾; [⌄] is the only full-width row and turns to [⌃] while open', async ({page}) => {
      await open(page);
      for (const name of ['글 단계 고르기', '글자색 고르기', '형광펜 고르기', '정렬 고르기', '글머리 목록 고르기', '번호 목록 고르기', '표 넣기', '점 기호 고르기', '참고 기호 고르기', '화살표 고르기', '동그라미 번호 고르기']) {
        const b = tool(page, name);
        await showTool(page, b);
        await expect(b, name).toContainText('▾');
        await expect(b.locator('.ed-caret'), name).toHaveAttribute('aria-hidden', 'true');
      }
      const more = page.locator('.ed-tools .ed-more');
      // ED-서식줄묶음: a phone has no [⌄]; every button it held sits in a group popover (see the phone tests below).
      if (touch) { await expect(more).toBeHidden(); return; }
      await expect(more).toHaveAttribute('title', '서식 더 보기');
      await expect(more).toHaveAttribute('aria-label', '서식 더 보기');
      const idle = await more.evaluate(el => { const c = getComputedStyle(el); return {h: Math.round(el.getBoundingClientRect().height), border: c.borderTopColor, bg: c.backgroundColor, rot: getComputedStyle(el.querySelector('svg')).transform}; });
      expect(idle.h).toBeLessThanOrEqual(28);
      expect(idle.border).toBe('rgba(0, 0, 0, 0)');
      expect(idle.rot).toBe('none');
      await press(more);
      const band = group(page, '서식 더 보기');
      await expect(band).toBeVisible();
      const open_ = await more.evaluate(el => { const c = getComputedStyle(el); return {border: c.borderTopColor, bg: c.backgroundColor, rot: getComputedStyle(el.querySelector('svg')).transform}; });
      expect(open_.border).toBe('rgba(0, 0, 0, 0)');
      expect(open_.bg).not.toBe(idle.bg);
      await expect.poll(() => more.evaluate(el => getComputedStyle(el.querySelector('svg')).transform)).not.toBe('none');
      // The band spans the editor's width; a popover does not.
      const b = await rect(band), bar = await rect(page.locator('.ed-bar'));
      expect(Math.abs(b.width - bar.width)).toBeLessThanOrEqual(1);
      // 「」 under it opens its own popover under itself.
      await press(band.getByRole('button', {name: '괄호·단위 기호 고르기'}));
      const pop = group(page, '괄호·단위 기호');
      await expect(pop).toBeVisible();
      expect((await rect(pop)).width).toBeLessThanOrEqual(bar.width - 16);
      await expect(group(page, '서식 더 보기')).toBeVisible();
    });

    test('a popover is never cut off at the bottom: it goes above the button or scrolls inside itself', async ({page}) => {
      await page.setViewportSize({width: viewport.width, height: 250});
      await open(page);
      const trigger = await reveal(page, '번호 목록 고르기');
      await press(trigger);
      const pop = group(page, '번호 목록');
      await expect(pop).toBeVisible();
      const p = await rect(pop);
      expect(p.bottom).toBeLessThanOrEqual(250);
      expect(p.top).toBeGreaterThanOrEqual(0);
      expect(await pop.evaluate(el => el.scrollHeight >= el.clientHeight)).toBe(true);
      // Every choice is reachable (scrolled inside the popover).
      await pop.getByRole('button', {name: '번호 가.', exact: true}).scrollIntoViewIfNeeded();
      await press(pop.getByRole('button', {name: '번호 가.', exact: true}));
      expect((await content(page))[0].type).toBe('ordered_list');
      expect((await content(page))[0].attrs.marker).toBe('hangul');
    });

    test('정렬: a vertical list with an icon, the name and ✓ on the current one', async ({page}) => {
      await open(page);
      await page.keyboard.type('정렬 글');
      await press(tool(page, '정렬 고르기'));
      const pop = group(page, '정렬'), items = pop.getByRole('button');
      await expect(items).toHaveCount(4);
      await expect(items).toHaveText(['왼쪽', '가운데', '오른쪽', '양쪽'].map(t => `${t}✓`));
      const rects = await items.evaluateAll(list => list.map(b => { const r = b.getBoundingClientRect(); return {left: Math.round(r.left), top: r.top}; }));
      expect(new Set(rects.map(r => r.left)).size).toBe(1);
      for (let i = 1; i < rects.length; i++) expect(rects[i].top).toBeGreaterThan(rects[i - 1].top);
      for (let i = 0; i < 4; i++) await expect(items.nth(i).locator('svg')).toHaveCount(1);
      const checks = () => items.evaluateAll(list => list.map(b => getComputedStyle(b.querySelector('.ed-check')).visibility));
      expect(await checks()).toEqual(['visible', 'hidden', 'hidden', 'hidden']);
      await press(items.nth(1));
      await expect(pop).toBeHidden();
      await press(tool(page, '정렬 고르기'));
      expect(await checks()).toEqual(['hidden', 'visible', 'hidden', 'hidden']);
      expect((await content(page))[0].attrs.align).toBe('center');
    });

    test('목록 ▾ and 번호 ▾: shapes with a preview, ✓ on the current one, saved on the list; 목록 풀기 takes the item out', async ({page}) => {
      const box = await open(page);
      await page.keyboard.type('항목');
      await press(tool(page, '글머리 목록 고르기'));
      const bullets = group(page, '글머리 목록');
      await expect(bullets.locator('button[data-ed-list-marker]')).toHaveCount(4);
      await expect(bullets.getByRole('button', {name: /^글머리 /})).toHaveText(['• 항목\n• 항목✓', '- 항목\n- 항목✓', '◦ 항목\n◦ 항목✓', '▪ 항목\n▪ 항목✓'].map(t => t.replace('\n', '')));
      await expect(bullets.getByRole('button', {name: '목록 풀기'})).toBeHidden();
      await press(bullets.getByRole('button', {name: '글머리 ◦', exact: true}));
      await expect(box.locator('ul.ed-ul-circle li')).toHaveCount(1);
      expect((await content(page))[0]).toMatchObject({type: 'bullet_list', attrs: {marker: 'circle'}});
      await press(tool(page, '글머리 목록 고르기'));
      const ticked = await bullets.locator('button[data-ed-list-marker]').evaluateAll(list => list.map(b => getComputedStyle(b.querySelector('.ed-check')).visibility));
      expect(ticked).toEqual(['hidden', 'hidden', 'visible', 'hidden']);
      await press(bullets.getByRole('button', {name: '글머리 -', exact: true}));
      await expect(box.locator('ul.ed-ul-dash li')).toHaveCount(1);
      // The other kind changes the list in place.
      await press(tool(page, '번호 목록 고르기'));
      const numbers = group(page, '번호 목록');
      await expect(numbers.getByRole('button', {name: /^번호 /})).toHaveText(['1. 항목2. 항목✓', '1) 항목2) 항목✓', '(1) 항목(2) 항목✓', '① 항목② 항목✓', '가. 항목나. 항목✓']);
      await press(numbers.getByRole('button', {name: '번호 (1)', exact: true}));
      await expect(box.locator('ol.ed-ol-parens li')).toHaveCount(1);
      await expect(box.locator('ul')).toHaveCount(0);
      expect((await content(page))[0]).toMatchObject({type: 'ordered_list', attrs: {order: 1, marker: 'parens'}});
      await press(tool(page, '번호 목록 고르기'));
      await press(numbers.getByRole('button', {name: '목록 풀기'}));
      await expect(box.locator('ol,ul')).toHaveCount(0);
    });

    test('nested numbered items continue 1. → 1) → (1) → ① by themselves; bullets • → ◦ → ▪; readers and exports keep the shapes', async ({page}) => {
      const box = await open(page);
      await press(tool(page, '번호 목록 고르기'));
      await press(group(page, '번호 목록').getByRole('button', {name: '번호 1.', exact: true}));
      for (const text of ['가', '나', '다', '라']) {
        await page.keyboard.type(text);
        await page.keyboard.press('Enter');
        await page.keyboard.press('Tab');
      }
      // Four deep: ol > li > ol > li > ol > li > ol > li (the last Enter+Tab made a fifth, empty one).
      const styles = await box.locator('ol').evaluateAll(list => list.map(o => getComputedStyle(o).listStyleType));
      expect(styles.slice(0, 4)).toEqual(['ed-o-decimal', 'ed-o-paren', 'ed-o-parens', 'ed-o-circled']);
      const v = await value(page);
      const top = v.doc.content[0], second = top.content[0].content[1];
      expect(top.attrs.marker).toBe('decimal');
      expect(second.type).toBe('ordered_list');
      expect(second.attrs.marker).toBeUndefined();
      // Readers draw the same classes (and so the same shapes); exports write the shapes as letters.
      const html = await page.evaluate(() => window.renderOut());
      expect(html).toContain('class="ed-ol ed-ol-decimal"');
      expect(html).toContain('class="ed-ol ed-ol-auto"');
      const exp = await page.evaluate(async () => { const m = await import('/app/ed-text.mjs'); const val = window.ed.getValue(); return {hangul: m.toHangul(val), telegram: m.toTelegram(val)}; });
      for (const label of ['1. 가', '1) 나', '(1) 다', '① 라']) { expect(exp.hangul.text).toContain(label); expect(exp.hangul.html).toContain(label); expect(exp.telegram).toContain(label); }
    });

    test('Tab-nested bullets follow • → ◦ → ▪ and an explicit shape is kept in the saved document', async ({page}) => {
      const box = await open(page);
      await press(tool(page, '글머리 목록 고르기'));
      await press(group(page, '글머리 목록').getByRole('button', {name: '글머리 •', exact: true}));
      for (const text of ['가', '나', '다']) { await page.keyboard.type(text); await page.keyboard.press('Enter'); await page.keyboard.press('Tab'); }
      const styles = await box.locator('ul').evaluateAll(list => list.map(o => getComputedStyle(o).listStyleType));
      expect(styles.slice(0, 3)).toEqual(['ed-b-disc', 'ed-b-circle', 'ed-b-square']);
      const exp = await page.evaluate(async () => { const m = await import('/app/ed-text.mjs'); return m.toHangul(window.ed.getValue()).text; });
      expect(exp).toMatch(/• 가\n\s+◦ 나\n\s+▪ 다/);
    });

    test('table: pressing its border chooses the whole table (hand + faint outline over the border); [표 선택] does the same', async ({page}) => {
      const box = await open(page, ed1(para('앞'), table(2, 3), para('뒤')));
      const wrap = box.locator('.ed-table-wrap'), tbl = wrap.locator('table');
      await expect(page.getByRole('button', {name: '표 선택'})).toHaveCount(0);
      const r = await rect(tbl);
      const y = r.top + r.height / 2;
      if (!touch) {
        // Over the left border: hand pointer and an outline; inside a cell: neither.
        await page.mouse.move(r.left + 1, y);
        await expect(wrap).toHaveClass(/is-edge/);
        expect(await wrap.locator('td').first().evaluate(el => getComputedStyle(el).cursor)).toBe('pointer');
        expect(await tbl.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid');
        await page.mouse.move(r.left + 40, y);
        await expect(wrap).not.toHaveClass(/is-edge/);
        await page.mouse.move(r.left + r.width / 2, r.top + 1);
        await expect(wrap).toHaveClass(/is-edge/);
        await page.mouse.down(); await page.mouse.up();
      } else {
        // A finger gets a wider strip: 8px inside the left border is still the border.
        await page.touchscreen.tap(r.left + 8, y);
      }
      await expect(box.locator('.selectedCell')).toHaveCount(6);
      await page.keyboard.press('Delete');
      await expect(box.locator('table')).toHaveCount(0);
      await page.keyboard.press('Control+z');
      await expect(box.locator('table')).toHaveCount(1);
      // A press in the middle of a cell is still just a cursor.
      const c = await rect(box.locator('td').first());
      await press(box.locator('td').first());
      await expect(box.locator('.selectedCell')).toHaveCount(0);
      expect(c.width).toBeGreaterThan(20);
      // [표 선택] (named so everywhere) chooses it from the table row.
      const sel = page.locator('.ed-table-tools').getByRole('button', {name: '표 전체 선택'});
      await expect(sel).toHaveText('표 선택');
      await expect(page.locator('.ed-table-tools').getByRole('button', {name: '표 고르기'})).toHaveCount(0);
      await press(sel);
      await expect(box.locator('.selectedCell')).toHaveCount(6);
    });

    test('a table goes in where the cursor is: between two paragraphs, in the middle of a line, or on an empty line', async ({page}) => {
      const box = await open(page, ed1(para('앞줄'), para('뒷줄')));
      // Cursor at the end of the first line.
      await box.getByText('앞줄').click();
      await page.keyboard.press('End');
      await expect.poll(async () => (await stateSel(page)).empty).toBe(true);
      await press(tool(page, '표 넣기'));
      await press(group(page, '표 크기 고르기').getByRole('button', {name: '2줄 2칸 표', exact: true}));
      let types = (await content(page)).map(n => n.type);
      expect(types.slice(0, 3)).toEqual(['paragraph', 'table', 'paragraph']);
      expect((await content(page))[0].content[0].text).toBe('앞줄');
      expect((await content(page))[2].content[0].text).toBe('뒷줄');
      // Cursor in the middle of a line: the line is split around the table.
      const b2 = await open(page, ed1(para('가나다라')));
      await b2.getByText('가나다라').click();
      await page.keyboard.press('Home');
      await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
      await expect.poll(async () => (await stateSel(page)).from).toBe(3);
      await press(tool(page, '표 넣기'));
      await press(group(page, '표 크기 고르기').getByRole('button', {name: '2줄 2칸 표', exact: true}));
      types = (await content(page)).map(n => n.type);
      expect(types.slice(0, 3)).toEqual(['paragraph', 'table', 'paragraph']);
      expect((await content(page))[0].content[0].text).toBe('가나');
      expect((await content(page))[2].content[0].text).toBe('다라');
      // On an empty line between two lines: the table takes that line's place.
      const b3 = await open(page, ed1(para('위'), para(''), para('아래')));
      await b3.locator('p').nth(1).click();
      await expect.poll(async () => (await stateSel(page)).from).toBe(4);
      await press(tool(page, '표 넣기'));
      await press(group(page, '표 크기 고르기').getByRole('button', {name: '2줄 2칸 표', exact: true}));
      const doc = await content(page);
      expect(doc.map(n => n.type).slice(0, 3)).toEqual(['paragraph', 'table', 'paragraph']);
      expect(doc[0].content[0].text).toBe('위');
      expect(doc[2].content[0].text).toBe('아래');
    });

    test('a button pressed right after Shift+Home acts on the chosen letters, not on an empty cursor', async ({page}) => {
      const box = await open(page);
      await page.keyboard.type('굵고 기울고');
      // The browser's selection changes and a button is pressed in the same moment: the editor has not yet seen selectionchange.
      await page.evaluate(() => {
        const text = document.querySelector('.ed-input p').firstChild;
        getSelection().setBaseAndExtent(text, text.length, text, 0);
        const b = document.querySelector('.ed-tools [data-ed-cmd="strong"]');
        b.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, cancelable: true, pointerType: 'mouse'}));
        b.dispatchEvent(new MouseEvent('mousedown', {bubbles: true, cancelable: true}));
        b.click();
      });
      await expect(box.locator('strong')).toHaveText('굵고 기울고');
      const first = (await content(page))[0].content[0];
      expect(first.marks.map(m => m.type)).toEqual(['strong']);
      expect(first.text).toBe('굵고 기울고');
    });
  });
}
