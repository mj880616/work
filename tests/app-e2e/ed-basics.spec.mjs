// ED-기본기보강 (2026-10-22 사용자 19:24~19:33): the basic editor features checked one by one against Google Docs·Naver
// Blog·한글 (대조표 docs/design/unified-editor.md 9절). Fixture page only (no app shell, no network beyond static files).
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
const tool = (page, name) => page.locator('.ed-tools').getByRole('button', {name, exact: true});
const menu = (page, name) => page.getByRole('group', {name, exact: true});
// A button on the row, or under [⋯] when it is kept there.
async function press(page, name) {
  const onRow = tool(page, name);
  if (await onRow.count() && await onRow.isVisible()) return onRow.click();
  const more = page.locator('.ed-more');
  if ((await more.getAttribute('aria-expanded')) !== 'true') await more.click();
  await menu(page, '서식 더 보기').getByRole('button', {name, exact: true}).click();
}
const para = (text, attrs = {style: 'body2'}) => ({type: 'paragraph', attrs, ...(text ? {content: [{type: 'text', text}]} : {})});
const ed1 = (...nodes) => ({v: 'ed1', doc: {type: 'doc', content: nodes}});
const table = (rows, cols, cellAttrs = () => ({})) => ({type: 'table', content: Array.from({length: rows}, (_, r) => ({type: 'table_row',
  content: Array.from({length: cols}, (_, c) => ({type: r ? 'table_cell' : 'table_header', attrs: cellAttrs(r, c), content: [para(`${r}${c}`)]}))}))});
// The editor reads the browser's cursor a moment after a click or a Shift/End key (selectionchange): wait until it has.
const stateSel = page => page.evaluate(() => { const s = window.ed.view.state.selection; return {from: s.from, to: s.to, empty: s.empty, cell: s.$from.node(Math.max(0, s.$from.depth - 1)).type.name, size: window.ed.view.state.doc.content.size}; });
// Ctrl+End moves the browser's cursor; the editor reads it a moment later (selectionchange). Wait for that.
const toEnd = async page => {
  await page.keyboard.press('Control+End');
  await expect.poll(() => page.evaluate(() => { const st = window.ed.view.state; return st.selection.from === st.doc.content.size - 1; })).toBe(true);
};
const paste = (page, data) => page.evaluate(d => {
  const t = new DataTransfer();
  for (const [k, v] of Object.entries(d)) t.setData(k, v);
  document.querySelector('.ed-input').dispatchEvent(new ClipboardEvent('paste', {clipboardData: t, bubbles: true, cancelable: true}));
}, data);

test.describe('PC 1280', () => {
  test.use({viewport: {width: 1280, height: 800}});

  test('정렬: 왼쪽·가운데·오른쪽·양쪽, 저장되고 읽는 쪽도 같게', async ({page}) => {
    await open(page);
    await page.keyboard.type('정렬 글');
    for (const [name, align] of [['가운데', 'center'], ['오른쪽', 'right'], ['양쪽', 'justify'], ['왼쪽', null]]) {
      await tool(page, '정렬 고르기').click();
      await menu(page, '정렬').getByRole('button', {name: `${name} 정렬`}).click();
      await expect(tool(page, '정렬 고르기')).toHaveText(`${name} ▾`);
      expect((await content(page))[0].attrs.align).toBe(align ?? undefined);
      if (align) expect(await page.evaluate(() => window.renderOut())).toContain(`ed-${align}`);
    }
    await expect(page.getByRole('textbox', {name: '본문'})).toBeFocused();
  });

  test('들여쓰기·내어쓰기: 버튼과 Tab·Shift+Tab, 목록 안에서는 목록 단계', async ({page}) => {
    const box = await open(page);
    await page.keyboard.type('들여 쓴 글');
    await press(page, '들여쓰기');
    await press(page, '들여쓰기');
    expect((await content(page))[0].attrs.indent).toBe(2);
    await expect(box.locator('p.ed-indent-2')).toHaveCount(1);
    await press(page, '내어쓰기');
    expect((await content(page))[0].attrs.indent).toBe(1);
    await page.keyboard.press('Shift+Tab');
    expect((await content(page))[0].attrs.indent).toBeUndefined();
    await page.keyboard.press('Tab');
    expect((await content(page))[0].attrs.indent).toBe(1);
    // In a list: Tab nests the item instead.
    await page.keyboard.press('End'); await page.keyboard.press('Enter');
    await page.keyboard.type('하나');
    await tool(page, '글머리 목록 고르기').click();
    await menu(page, '글머리 목록').getByRole('button', {name: '글머리 •', exact: true}).click();
    await page.keyboard.press('Enter'); await page.keyboard.type('둘');
    await page.keyboard.press('Tab');
    await expect(box.locator('ul ul li')).toHaveText('둘');
  });

  test('글자색·형광펜: 고르고 지우기, 다크 모드는 테마 색, 읽는 쪽도 같은 이름', async ({page}) => {
    const box = await open(page);
    await page.keyboard.type('빨간 글');
    await page.keyboard.press('Shift+Home');
    await expect.poll(async () => (await stateSel(page)).empty).toBe(false);
    await tool(page, '글자색 고르기').click();
    await menu(page, '글자색').getByRole('button', {name: '글자색 빨강'}).click();
    await expect(box.locator('span.ed-c-red')).toHaveText('빨간 글');
    await tool(page, '형광펜 고르기').click();
    await menu(page, '형광펜').getByRole('button', {name: '형광펜 노랑'}).click();
    await expect(box.locator('mark.ed-hl-yellow')).toHaveText('빨간 글');
    const marks = (await content(page))[0].content[0].marks;
    expect(marks).toEqual(expect.arrayContaining([{type: 'color', attrs: {color: 'red'}}, {type: 'highlight', attrs: {color: 'yellow'}}]));
    const html = await page.evaluate(() => window.renderOut());
    expect(html).toContain('ed-c ed-c-red');
    expect(html).toContain('<mark class="ed-hl ed-hl-yellow">');
    await tool(page, '글자색 고르기').click();
    await menu(page, '글자색').getByRole('button', {name: '색 없음'}).click();
    await expect(box.locator('span.ed-c-red')).toHaveCount(0);
    // Colors come from theme tokens: the dark scheme changes them.
    const light = await box.locator('mark').evaluate(el => getComputedStyle(el).backgroundColor);
    await page.emulateMedia({colorScheme: 'dark'});
    expect(await box.locator('mark').evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe(light);
  });

  test('링크: 고른 글에 주소 넣기·빼기, 위험한 주소는 안 받음, Ctrl+K', async ({page}) => {
    const box = await open(page);
    await page.keyboard.type('누리집');
    await page.keyboard.press('Shift+Home');
    await expect.poll(async () => (await stateSel(page)).empty).toBe(false);
    await tool(page, '링크 넣기').click();
    const input = page.getByRole('textbox', {name: '링크 주소'});
    await expect(input).toBeFocused();
    await input.fill('javascript:alert(1)');
    await page.keyboard.press('Enter');
    await expect(box.locator('a')).toHaveCount(0);
    await input.fill('example.org/a');
    await page.keyboard.press('Enter');
    await expect(box.locator('a')).toHaveAttribute('href', 'https://example.org/a');
    await expect(box).toBeFocused();
    await page.keyboard.press('Shift+Home');
    await expect.poll(async () => (await stateSel(page)).empty).toBe(false);
    await page.keyboard.press('Control+k');
    await expect(input).toHaveValue('https://example.org/a');
    await menu(page, '링크').getByRole('button', {name: '링크 빼기'}).click();
    await expect(box.locator('a')).toHaveCount(0);
    await expect(box).toHaveText('누리집');
  });

  test('서식 지우기: 굵게·색·정렬·들여쓰기를 걷고 글자는 남김', async ({page}) => {
    const box = await open(page, ed1({type: 'paragraph', attrs: {style: 'body2', align: 'center', indent: 2}, content: [
      {type: 'text', text: '꾸민 글', marks: [{type: 'strong'}, {type: 'em'}, {type: 'color', attrs: {color: 'blue'}}, {type: 'highlight', attrs: {color: 'pink'}}]}]}));
    await page.keyboard.press('Control+a');
    await press(page, '서식 지우기');
    const c = await content(page);
    expect(c[0]).toEqual(para('꾸민 글'));
    await expect(box.locator('strong,em,mark,span.ed-c')).toHaveCount(0);
  });

  test('단축키: Ctrl+B·I·U·Z·Y', async ({page}) => {
    const box = await open(page);
    await page.keyboard.type('가나');
    await page.keyboard.press('Shift+Home');
    await expect.poll(async () => (await stateSel(page)).empty).toBe(false);
    await page.keyboard.press('Control+b');
    await page.keyboard.press('Control+i');
    await page.keyboard.press('Control+u');
    await expect(box.locator('strong em u, strong u em, em strong u, em u strong, u strong em, u em strong')).toHaveCount(1);
    await page.keyboard.press('Control+z');
    await expect(box.locator('u')).toHaveCount(0);
    await page.keyboard.press('Control+y');
    await expect(box.locator('u')).toHaveCount(1);
  });

  test('붙여넣기: 서식 있는 글은 허용 서식만 유지, [글자만 붙여넣기]·Ctrl+Shift+V는 글자만', async ({page, context}) => {
    const box = await open(page);
    await paste(page, {'text/html': '<p><b>굵</b> <span style="color:#f00">빨강</span> <mark>표시</mark></p>', 'text/plain': '굵 빨강 표시'});
    await expect(box.locator('strong')).toHaveText('굵');
    await expect(box.locator('span[style]')).toHaveCount(0);
    await expect(box.locator('mark.ed-hl-yellow')).toHaveText('표시');
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.evaluate(() => navigator.clipboard.writeText('**글자만** 1. 그대로'));
    await press(page, '글자만 붙여넣기');
    await expect(box).toContainText('**글자만** 1. 그대로');
    expect(await box.locator('p').last().locator('strong').count()).toBe(0);
  });

  test('기호: [·][※][→] 비슷한 기호 펼치기, [①]은 ①~⑩ 펼치고 다음 번호 표시', async ({page}) => {
    const box = await open(page);
    await tool(page, '동그라미 번호 고르기').click();
    const circles = menu(page, '동그라미 번호');
    await expect(circles.getByRole('button')).toHaveText(['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩']);
    await expect(circles.locator('.is-next')).toHaveText('①');
    await circles.getByRole('button', {name: '① 넣기'}).click();
    await page.keyboard.type('첫째');
    await page.keyboard.press('Enter');
    await tool(page, '동그라미 번호 고르기').click();
    await expect(circles.locator('.is-next')).toHaveText('②');
    await circles.getByRole('button', {name: '② 넣기'}).click();
    await page.keyboard.type('둘째');
    await page.keyboard.press('Enter');
    await tool(page, '점 기호 고르기').click();
    await expect(menu(page, '점 기호').getByRole('button')).toHaveCount(13);
    await menu(page, '점 기호').getByRole('button', {name: '■ 넣기'}).click();
    await tool(page, '참고 기호 고르기').click();
    await menu(page, '참고 기호').getByRole('button', {name: '※ 넣기'}).click();
    await tool(page, '화살표 고르기').click();
    await menu(page, '화살표').getByRole('button', {name: '⇒ 넣기'}).click();
    await press(page, '괄호·단위 기호 고르기');
    await menu(page, '괄호·단위 기호').getByRole('button', {name: '「」 넣기'}).click();
    await page.keyboard.type('안');
    expect(await page.evaluate(() => window.plain())).toBe('① 첫째\n\n② 둘째\n\n■ ※ ⇒ 「안」');
    await expect(box).toBeFocused();
    // Esc closes a sign row.
    await tool(page, '화살표 고르기').click();
    await page.keyboard.press('Escape');
    await expect(menu(page, '화살표')).toBeHidden();
  });

  test('표: 격자로 줄×칸 골라 넣기, 넣은 표 아래 빈 줄과 앞뒤로 쓰기', async ({page}) => {
    const box = await open(page);
    await tool(page, '표 넣기').click();
    const grid = menu(page, '표 크기 고르기');
    await grid.getByRole('button', {name: '3줄 4칸 표'}).hover();
    await expect(grid.locator('.ed-grid-size')).toHaveText('3 × 4');
    await expect(grid.locator('.is-on')).toHaveCount(12);
    await grid.getByRole('button', {name: '3줄 4칸 표'}).click();
    await expect(box.locator('table tr')).toHaveCount(3);
    await expect(box.locator('table tr').first().locator('th')).toHaveCount(4);
    let c = await content(page);
    // A table at the very start: the text still ends with a line to type on.
    expect(c.map(n => n.type)).toEqual(['table', 'paragraph']);
    // ↓ from the last row leaves the table.
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
    await page.keyboard.type('표 아래 글');
    c = await content(page);
    expect(c[1]).toEqual(para('표 아래 글'));
    // Before a table at the start: ↑ from the first cell gives a gap cursor, typing makes a line there.
    await box.locator('table th').first().click();
    await expect.poll(async () => (await stateSel(page)).cell).toBe('table_header');
    await page.keyboard.press('ArrowUp');
    await expect.poll(() => page.evaluate(() => window.ed.view.state.selection.toJSON().type)).toBe('gapcursor');
    await page.keyboard.type('표 위 글');
    c = await content(page);
    expect(c.map(n => n.type)).toEqual(['paragraph', 'table', 'paragraph']);
    expect(c[0].content[0].text).toBe('표 위 글');
  });

  test('표 아래 빈 곳을 누르면 표 밖에 커서, 구분선·사진 자리 뒤도 같음', async ({page}) => {
    const box = await open(page, ed1(table(2, 2)));
    expect((await content(page)).map(n => n.type)).toEqual(['table', 'paragraph']);
    const tb = await box.locator('table').boundingBox();
    await page.mouse.click(tb.x + 20, tb.y + tb.height + 14);
    await page.keyboard.type('밖');
    expect((await content(page))[1]).toEqual(para('밖'));
    for (const doc of [ed1({type: 'horizontal_rule'}), ed1({type: 'image', attrs: {src: null, alt: '옛 사진'}})]) {
      await open(page, doc);
      const v = await content(page);
      expect(v[v.length - 1].type).toBe('paragraph');
      await page.keyboard.press('Control+End');
      await page.keyboard.type('뒤');
      expect((await content(page)).at(-1)).toEqual(para('뒤'));
    }
  });

  test('표 안: Tab 다음 칸·마지막 칸 Tab은 줄 추가, 칸 안 정렬', async ({page}) => {
    const box = await open(page, ed1(table(2, 2)));
    await box.locator('table td').last().click();
    await page.keyboard.press('End');
    // In the last cell, at the end of its letters ("11").
    await expect.poll(() => page.evaluate(() => { const s = window.ed.view.state.selection; return s.$from.parent.textContent === '11' && s.$from.parentOffset === 2 && s.$from.node(s.$from.depth - 1).type.name === 'table_cell'; })).toBe(true);
    await page.keyboard.press('Tab');
    await expect(box.locator('table tr')).toHaveCount(3);
    await page.keyboard.type('새 줄');
    await expect(box.locator('table tr').nth(2).locator('td').first()).toHaveText('새 줄');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.type('위');
    await expect(box.locator('table tr').nth(1).locator('td').last()).toContainText('위');
    await tool(page, '정렬 고르기').click();
    await menu(page, '정렬').getByRole('button', {name: '오른쪽 정렬'}).click();
    await expect(box.locator('table tr').nth(1).locator('td').last().locator('p')).toHaveClass(/ed-right/);
  });

  test('표 칸 우클릭 메뉴: 위·아래·왼·오른 넣기, 줄·칸 삭제, 칸 합치기·나누기, Esc로 닫힘', async ({page}) => {
    const box = await open(page, ed1(table(2, 2)));
    const ctx = page.getByRole('menu', {name: '표 칸 메뉴'});
    const cellMenu = async (loc, name) => { await loc.click({button: 'right'}); await expect(ctx).toBeVisible(); await ctx.getByRole('menuitem', {name, exact: true}).click(); await expect(ctx).toBeHidden(); };
    await cellMenu(box.locator('td').first(), '위에 줄 넣기');
    await expect(box.locator('tr')).toHaveCount(3);
    await cellMenu(box.locator('td').first(), '아래에 줄 넣기');
    await expect(box.locator('tr')).toHaveCount(4);
    await cellMenu(box.locator('td').first(), '왼쪽에 칸 넣기');
    await expect(box.locator('tr').first().locator('th,td')).toHaveCount(3);
    await cellMenu(box.locator('td').first(), '오른쪽에 칸 넣기');
    await expect(box.locator('tr').first().locator('th,td')).toHaveCount(4);
    await cellMenu(box.locator('tr').nth(1).locator('td').first(), '줄 삭제');
    await expect(box.locator('tr')).toHaveCount(3);
    await cellMenu(box.locator('td').first(), '칸 삭제');
    await expect(box.locator('tr').first().locator('th,td')).toHaveCount(3);
    // Merge: drag across two cells, then the menu.
    const a = await box.locator('tr').last().locator('td').nth(0).boundingBox(), b = await box.locator('tr').last().locator('td').nth(1).boundingBox();
    await page.mouse.move(a.x + 5, a.y + a.height / 2); await page.mouse.down();
    await page.mouse.move(b.x + b.width - 5, b.y + b.height / 2, {steps: 5}); await page.mouse.up();
    await expect(box.locator('.selectedCell')).toHaveCount(2);
    await box.locator('tr').last().locator('td').nth(1).click({button: 'right'});
    await ctx.getByRole('menuitem', {name: '칸 합치기'}).click();
    await expect(box.locator('tr').last().locator('td[colspan="2"]')).toHaveCount(1);
    await cellMenu(box.locator('td[colspan="2"]'), '칸 나누기');
    await expect(box.locator('td[colspan="2"]')).toHaveCount(0);
    await box.locator('td').first().click({button: 'right'});
    await page.keyboard.press('Escape');
    await expect(ctx).toBeHidden();
    await expect(box).toBeFocused();
  });

  test('표 선택·지우기: 모서리 손잡이로 전체 선택 → Delete, 여러 칸 끌어 고르면 내용만 지움, ↶로 복구', async ({page}) => {
    const box = await open(page, ed1(para('앞'), table(2, 3)));
    // Several cells chosen: Backspace empties them, the table stays.
    const a = await box.locator('td').nth(0).boundingBox(), b = await box.locator('td').nth(2).boundingBox();
    await page.mouse.move(a.x + 5, a.y + a.height / 2); await page.mouse.down();
    await page.mouse.move(b.x + b.width - 5, b.y + b.height / 2, {steps: 5}); await page.mouse.up();
    await page.keyboard.press('Backspace');
    await expect(box.locator('td').nth(0)).toHaveText('');
    await expect(box.locator('td').nth(2)).toHaveText('');
    await expect(box.locator('th').first()).toHaveText('00');
    // The grip at the table's top left corner chooses the whole table; Delete removes it.
    await box.locator('.ed-table-grip').click();
    await expect(box.locator('.selectedCell')).toHaveCount(6);
    await page.keyboard.press('Delete');
    await expect(box.locator('table')).toHaveCount(0);
    await page.keyboard.press('Control+z');
    await expect(box.locator('table')).toHaveCount(1);
  });

  test('표 아래 빈 줄에서 Backspace: 먼저 표를 고르고, 한 번 더 누르면 지움, ↶로 복구', async ({page}) => {
    const box = await open(page, ed1(para('앞'), table(2, 2)));
    await toEnd(page);
    await page.keyboard.press('Backspace');
    await expect(box.locator('table')).toHaveCount(1);
    await expect(box.locator('.selectedCell')).toHaveCount(4);
    await page.keyboard.press('Backspace');
    await expect(box.locator('table')).toHaveCount(0);
    expect((await content(page)).map(n => n.type)).toEqual(['paragraph', 'paragraph']);
    await tool(page, '되돌리기').click();
    await expect(box.locator('table')).toHaveCount(1);
    // A rule is chosen first the same way.
    await open(page, ed1(para('앞'), {type: 'horizontal_rule'}, para('')));
    await toEnd(page);
    await page.keyboard.press('Backspace');
    await expect(page.locator('.ed-input hr.ProseMirror-selectednode')).toHaveCount(1);
    await page.keyboard.press('Backspace');
    await expect(page.locator('.ed-input hr')).toHaveCount(0);
  });

  test('표 크기 끌기: 오른쪽 아래 손잡이로 표 전체가 같은 비율로 커지고, 편집기 폭을 넘지 않고, 읽는 쪽도 같은 크기', async ({page}) => {
    const box = await open(page, ed1(table(2, 3)));
    const tbl = box.locator('table').first();
    await tbl.hover();
    const handle = box.locator('.ed-table-resize').first();
    await expect(handle).toBeVisible();
    expect(await handle.evaluate(el => getComputedStyle(el).cursor)).toBe('nwse-resize');
    const before = await tbl.boundingBox();
    const h = await handle.boundingBox();
    const x = h.x + h.width / 2, y = h.y + h.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 60, y, {steps: 6});
    await expect(box.locator('.ed-table-wrap').first()).toHaveClass(/is-resizing/);
    await page.mouse.up();
    const widths = (await content(page))[0].content[0].content.map(c => c.attrs.colwidth[0]);
    expect(widths.every(w => w >= 32)).toBe(true);
    const small = await tbl.boundingBox();
    expect(small.width).toBeLessThan(before.width - 40);
    const total = widths.reduce((a, b) => a + b, 0);
    expect(Math.abs(total - small.width)).toBeLessThanOrEqual(3);
    // Grow far past the editor: stops at the text width.
    const h2 = await handle.boundingBox();
    await page.mouse.move(h2.x + h2.width / 2, h2.y + h2.height / 2);
    await page.mouse.down();
    await page.mouse.move(h2.x + 3000, h2.y + h2.height / 2, {steps: 6});
    await page.mouse.up();
    const big = await tbl.boundingBox(), editor = await box.boundingBox();
    expect(big.width).toBeGreaterThan(small.width + 40);
    expect(big.x + big.width).toBeLessThanOrEqual(editor.x + editor.width + 1);
    // The reader draws the same total width.
    await page.evaluate(() => window.renderOut());
    const read = await page.locator('#out table').first().boundingBox();
    expect(Math.abs(read.width - big.width)).toBeLessThanOrEqual(3);
  });

  test('칸 폭 끌기: 저장되고, 읽는 쪽도 같은 비율; 두 번 누르면 글자에 맞춤; [글자에 맞추기]로 원래대로', async ({page}) => {
    const box = await open(page, ed1(table(2, 3)));
    const th = box.locator('th').first();
    const r = await th.boundingBox();
    await page.mouse.move(r.x + r.width - 2, r.y + r.height / 2);
    await expect(box.locator('.column-resize-handle').first()).toBeVisible();
    await page.mouse.down();
    await page.mouse.move(r.x + r.width + 120, r.y + r.height / 2, {steps: 8});
    await page.mouse.up();
    const cells = (await content(page))[0].content[0].content;
    const widths = cells.map(c => c.attrs.colwidth[0]);
    expect(widths.every(w => w > 0)).toBe(true);
    expect(widths[0]).toBeGreaterThan(widths[1] + 80);
    // Every row's cells carry the same widths (prosemirror-tables shape).
    expect((await content(page))[0].content[1].content.map(c => c.attrs.colwidth[0])).toEqual(widths);
    // The editor and the reader show the same proportions.
    const shares = list => { const s = list.reduce((a, b) => a + b, 0); return list.map(w => w / s); };
    const edit = shares(await box.locator('tr').first().locator('th').evaluateAll(l => l.map(e => e.getBoundingClientRect().width)));
    await page.evaluate(() => window.renderOut());
    const read = shares(await page.locator('#out tr').first().locator('th').evaluateAll(l => l.map(e => e.getBoundingClientRect().width)));
    edit.forEach((v, i) => expect(Math.abs(v - read[i])).toBeLessThan(0.02));
    // A narrow reader (phone 390) keeps the same shares, with no sideways scroll.
    await page.setViewportSize({width: 390, height: 800});
    const phone = shares(await page.locator('#out tr').first().locator('th').evaluateAll(l => l.map(e => e.getBoundingClientRect().width)));
    phone.forEach((v, i) => expect(Math.abs(v - read[i])).toBeLessThan(0.03));
    expect(await page.locator('#out .ed-table-wrap').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await page.setViewportSize({width: 1280, height: 800});
    // Double click on an edge: that column fits its letters ("00" is short → narrower than now).
    const r2 = await box.locator('th').first().boundingBox();
    await page.mouse.move(r2.x + r2.width - 2, r2.y + r2.height / 2);
    await expect(box.locator('.column-resize-handle').first()).toBeVisible();
    await page.mouse.dblclick(r2.x + r2.width - 2, r2.y + r2.height / 2);
    await expect.poll(async () => (await content(page))[0].content[0].content[0].attrs.colwidth[0]).toBeLessThan(widths[0]);
    // [글자에 맞추기] clears the widths (the old look).
    await box.locator('td').first().click();
    await page.locator('.ed-table-tools').getByRole('button', {name: '표 폭을 글자에 맞추기'}).click();
    expect((await content(page))[0].content[0].content[0].attrs.colwidth).toBeUndefined();
  });

  test('표 붙여넣기·복사: 다른 곳 표(HTML)는 표로, 편집기 안 표 복사·붙여넣기도 표로', async ({page}) => {
    const box = await open(page);
    await paste(page, {'text/html': '<table><tr><th>항목</th><th>값</th></tr><tr><td>가</td><td>1</td></tr></table>', 'text/plain': '항목\t값\n가\t1'});
    await expect(box.locator('table th')).toHaveText(['항목', '값']);
    await expect(box.locator('table td')).toHaveText(['가', '1']);
    expect((await content(page)).at(-1).type).toBe('paragraph');
    // Copy the whole table and paste it below: a second table.
    await box.locator('.ed-table-grip').click();
    const html = await page.evaluate(() => { const ev = new ClipboardEvent('copy', {clipboardData: new DataTransfer(), bubbles: true, cancelable: true}); document.querySelector('.ed-input').dispatchEvent(ev); return ev.clipboardData.getData('text/html'); });
    expect(html).toContain('<table');
    await toEnd(page);
    await paste(page, {'text/html': html, 'text/plain': '항목 값'});
    await expect(box.locator('table')).toHaveCount(2);
  });

  test('[사진]·[파일]: ② 전까지 버튼 없음, 끌어 놓기·붙여넣기한 사진은 넣지 않고 안내, 옛 사진 자리는 그대로', async ({page}) => {
    const box = await open(page, ed1({type: 'image', attrs: {src: null, alt: '옛 자리'}}));
    await expect(page.locator('.ed-bar').getByRole('button', {name: /사진|파일/})).toHaveCount(0);
    await expect(box.locator('figure.ed-photo')).toHaveCount(1);
    const before = JSON.stringify(await value(page));
    // Paste a picture file (no letters).
    await page.evaluate(() => {
      const t = new DataTransfer();
      t.items.add(new File([new Uint8Array([0xff, 0xd8, 0xff])], 'a.jpg', {type: 'image/jpeg'}));
      document.querySelector('.ed-input').dispatchEvent(new ClipboardEvent('paste', {clipboardData: t, bubbles: true, cancelable: true}));
    });
    const note = page.locator('.ed-note');
    await expect(note).toBeVisible();
    await expect(note).toContainText('사진·파일을 넣을 수 없어요');
    // Drop a file.
    await page.evaluate(() => {
      const t = new DataTransfer();
      t.items.add(new File(['x'], 'b.pdf', {type: 'application/pdf'}));
      const el = document.querySelector('.ed-input p') || document.querySelector('.ed-input'), r = el.getBoundingClientRect();
      el.dispatchEvent(new DragEvent('drop', {dataTransfer: t, bubbles: true, cancelable: true, clientX: r.left + 5, clientY: r.top + 5}));
    });
    await expect(note).toBeVisible();
    expect(JSON.stringify(await value(page))).toBe(before);
    await expect(box.locator('img')).toHaveCount(0);
  });

  test('서식 줄: 자주 쓰는 것만 밖, 나머지는 [⋯] 안; 한 줄, 작은 버튼', async ({page}) => {
    await open(page);
    const row = page.locator('.ed-tools');
    await expect(row.getByRole('button')).toHaveText(['본문 2 ▾', '굵게', '기울임', '밑줄', '글자색 ▾', '형광펜 ▾', '왼쪽 ▾', '목록 ▾', '번호 ▾', '표 ▾', '링크', '· ▾', '※ ▾', '→ ▾', '① ▾', '↶', '↷', '']);
    expect(await row.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    for (const h of await row.locator('button:visible').evaluateAll(l => l.map(b => Math.round(b.getBoundingClientRect().height)))) expect(h).toBeLessThanOrEqual(28);
    await page.locator('.ed-more').click();
    await expect(menu(page, '서식 더 보기').getByRole('button')).toHaveText(['취소선', '인용', '구분선', '들여쓰기', '내어쓰기', '서식 지우기', '글자만 붙여넣기', '「」 ▾']);
    await page.screenshot({path: 'test-results/ed-basics-1280.png'});
  });
});

test.describe('폰 390', () => {
  test.use({viewport: {width: 390, height: 844}, hasTouch: true, isMobile: true});

  // ED-서식줄묶음: the phone row is grouped: [본문 2 ▾][굵게][·][▾][글자 ▾][문단 ▾][넣기 ▾][기호 ▾][↶][↷]; no [⌄]; one line down to 344px.
  test('서식 줄은 묶음 한 줄(344px까지 한 줄), 묶음 안에 모든 버튼, 페이지는 옆으로 안 밀림', async ({page}) => {
    await open(page);
    const row = page.locator('.ed-tools');
    expect(await row.evaluate(el => getComputedStyle(el).flexWrap)).toBe('nowrap');
    await expect(row.getByRole('button')).toHaveText(['본문 2 ▾', '굵게', '·', '▾', '글자 ▾', '문단 ▾', '넣기 ▾', '기호 ▾', '↶', '↷']);
    await expect(page.locator('.ed-more')).toBeHidden();
    for (const width of [390, 360, 344]) {
      await page.setViewportSize({width, height: 844});
      await expect.poll(() => row.evaluate(el => el.scrollWidth - el.clientWidth), `row at ${width}`).toBeLessThanOrEqual(0);
      expect(await row.locator('button:visible').evaluateAll(l => new Set(l.map(b => Math.round(b.getBoundingClientRect().top))).size)).toBe(1);
    }
    const GROUPS = {'글자 서식 고르기': ['기울임', '밑줄', '취소선', '글자색 ▾', '형광펜 ▾', '서식 지우기'],
      '문단 서식 고르기': ['정렬 왼쪽 ▾', '목록 ▾', '번호 ▾', '들여쓰기', '내어쓰기', '인용', '구분선'],
      '넣을 것 고르기': ['표 ▾', '링크', '글자만 붙여넣기'], '기호 고르기': ['※ ▾', '→ ▾', '① ▾', '「」 ▾']};
    for (const [name, texts] of Object.entries(GROUPS)) {
      await row.getByRole('button', {name, exact: true}).tap();
      await expect(page.locator('.ed-pop:not([hidden])').first().getByRole('button')).toHaveText(texts);
      await page.keyboard.press('Escape');
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({path: 'test-results/ed-basics-390.png'});
  });

  test('표 칸 길게 누르기(contextmenu) 메뉴가 화면 안·하단바 위에 뜨고 줄을 넣음', async ({page}) => {
    const box = await open(page, ed1(table(2, 2)));
    const cell = box.locator('td').first(), r = await cell.boundingBox();
    await cell.tap();
    await cell.dispatchEvent('contextmenu', {clientX: r.x + 10, clientY: r.y + 10, bubbles: true, cancelable: true});
    const ctx = page.getByRole('menu', {name: '표 칸 메뉴'});
    await expect(ctx).toBeVisible();
    const c = await ctx.boundingBox();
    expect(c.x).toBeGreaterThanOrEqual(0);
    expect(c.x + c.width).toBeLessThanOrEqual(390);
    expect(c.y + c.height).toBeLessThanOrEqual(844 - 60);
    await ctx.getByRole('menuitem', {name: '아래에 줄 넣기'}).tap();
    await expect(box.locator('tr')).toHaveCount(3);
  });

  test('[표] 격자는 폰에서도 눌러 고름', async ({page}) => {
    const box = await open(page);
    await tool(page, '넣을 것 고르기').tap();
    await page.locator('.ed-pop:not([hidden])').getByRole('button', {name: '표 넣기', exact: true}).tap();
    await menu(page, '표 크기 고르기').getByRole('button', {name: '2줄 3칸 표'}).tap();
    await expect(box.locator('tr')).toHaveCount(2);
    await expect(box.locator('tr').first().locator('th')).toHaveCount(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});

test('기존 글 열기 호환: 기본기보강 전 저장 글(왼·가운데, 표·사진 자리·코드)이 그대로 열리고 그대로 저장됨', async ({page}) => {
  const old = ed1(
    {type: 'heading', attrs: {level: 1, align: 'center'}, content: [{type: 'text', text: '제목'}]},
    {type: 'paragraph', attrs: {style: 'body1'}, content: [{type: 'text', text: '굵게', marks: [{type: 'strong'}]}, {type: 'text', text: ' 링크', marks: [{type: 'link', attrs: {href: 'https://example.org/'}}]}]},
    {type: 'table', content: [{type: 'table_row', content: [{type: 'table_header', attrs: {colspan: 1, rowspan: 1}, content: [para('항목')]}]},
      {type: 'table_row', content: [{type: 'table_cell', attrs: {colspan: 1, rowspan: 1}, content: [para('가')]}]}]},
    {type: 'image', attrs: {src: null, alt: '현장'}},
    {type: 'code_block', content: [{type: 'text', text: 'a **b**'}]},
    para('끝', {style: 'body2', align: 'center'}),
  );
  await open(page, old);
  expect(await value(page)).toEqual(old);
  const html = await page.evaluate(() => window.renderOut());
  expect(html).toContain('<h2 class="ed-h ed-h1 ed-center">제목</h2>');
  expect(html).not.toContain('ed-fixed');
});
