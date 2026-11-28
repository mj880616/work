// NOTE-인용해서쓰기 (standard-interactions.md Q1): 노트 편집기(공용 ed-editor.js)에서 글을 고르면 고른 글 바로 아래 작은 메뉴 [인용].
// [인용] = 원래 글은 그대로, 고른 글이 든 블록 바로 아래에 인용 블록(고른 글, 줄마다 한 줄) + 빈 줄, 글쓰기 자리는 그 빈 줄. ↶ 한 번에 둘 다 사라짐.
// PC는 고른 글 위 우클릭에도 [인용](표 칸 안이면 표 칸 메뉴 맨 위). 표·코드 블록 안에서 고르면 그 표·코드 블록 바로 아래.
import {test, expect} from '@playwright/test';
import {appOrigin} from './helpers/test-origin.mjs';

const url = `${appOrigin}/tests/app-e2e/ed-editor-fixture.html`;
const P = (text, extra = {}) => ({type: 'paragraph', attrs: {style: 'body2', ...extra}, content: text ? [{type: 'text', text}] : undefined});
const docOf = content => ({v: 'ed1', doc: {type: 'doc', content}});
const open = async (page, doc) => {
  await page.goto(doc ? `${url}?doc=${encodeURIComponent(JSON.stringify(doc))}` : url);
  await expect(page.locator('body')).toHaveAttribute('data-ready', '1');
  return page.getByRole('textbox', {name: '본문'});
};
const value = page => page.evaluate(() => window.ed.getValue());
const shape = page => page.evaluate(() => {
  const walk = n => n.type === 'text' ? n.text : n.type === 'hard_break' ? '\n' : {[n.type]: (n.content || []).map(walk)};
  return window.ed.getValue().doc.content.map(walk);
});
const menu = page => page.locator('.ed-qmenu');
const quoteButton = page => menu(page).getByRole('menuitem', {name: '고른 글 인용'});
// Chooses `text` inside the element matched by `selector` the way a drag or a long press leaves it (a DOM range over the letters).
const choose = (page, selector, text, endText = text, endSelector = selector) => page.evaluate(([selector, text, endText, endSelector]) => {
  const find = (sel, word, end) => {
    for (const el of document.querySelectorAll(`.ed-box ${sel}`)) {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) { const i = n.data.indexOf(word); if (i >= 0) return [n, end ? i + word.length : i]; }
    }
    throw new Error(`없음: ${word}`);
  };
  const [a, ai] = find(selector, text, false), [b, bi] = find(endSelector, endText, true);
  const range = document.createRange(); range.setStart(a, ai); range.setEnd(b, bi);
  const s = getSelection(); s.removeAllRanges(); s.addRange(range);
  // A key let go makes the editor read the browser's selection right away (ed-editor.js syncSelection), as after Shift+arrows.
  document.querySelector('.ed-box .ProseMirror').dispatchEvent(new KeyboardEvent('keyup', {bubbles: true}));
}, [selector, text, endText, endSelector]);

test.describe('PC 1280', () => {
  test.use({viewport: {width: 1280, height: 800}});

  test('Q1 끌어 고르기 → 아래 [인용] → 인용 블록 + 빈 줄 + 글쓰기 자리, ↶ 한 번에 되돌림', async ({page}) => {
    const box = await open(page, docOf([P('첫 문단 그대로'), P('이 문장에 대한 생각을 씁니다'), P('마지막 문단')]));
    const target = box.locator('p', {hasText: '이 문장에 대한'});
    const r = await target.boundingBox();
    // A real mouse drag over the first letters of the second paragraph.
    await page.mouse.move(r.x + 1, r.y + r.height / 2); await page.mouse.down();
    await page.mouse.move(r.x + 60, r.y + r.height / 2, {steps: 5});
    await expect(menu(page)).toBeHidden(); // 누르고 있는 동안은 안 뜬다
    await page.mouse.up();
    await expect(quoteButton(page)).toBeVisible();
    const chosen = await page.evaluate(() => getSelection().toString());
    expect(chosen.length).toBeGreaterThan(0);
    // 고른 글 바로 아래(폰 기본 메뉴는 위에 뜨므로 겹치지 않게).
    const m = await menu(page).boundingBox(), sel = await page.evaluate(() => { const b = getSelection().getRangeAt(0).getBoundingClientRect(); return {top: b.top, bottom: b.bottom}; });
    expect(m.y).toBeGreaterThanOrEqual(sel.bottom - 1);
    expect(m.y - sel.bottom).toBeLessThan(40);
    const before = await value(page);
    await quoteButton(page).click();
    await expect(menu(page)).toBeHidden();
    expect(await shape(page)).toEqual([{paragraph: ['첫 문단 그대로']}, {paragraph: ['이 문장에 대한 생각을 씁니다']},
      {blockquote: [{paragraph: [chosen]}]}, {paragraph: []}, {paragraph: ['마지막 문단']}]);
    await expect(box.locator('blockquote.ed-quote')).toHaveText(chosen);
    // 글쓰기 자리는 인용 아래 빈 줄: 바로 쓰면 그 줄에 들어간다.
    await page.keyboard.type('코멘트');
    await expect.poll(async () => (await shape(page))[3]).toEqual({paragraph: ['코멘트']});
    await page.keyboard.press('Control+z');
    await expect.poll(() => shape(page)).toEqual([{paragraph: ['첫 문단 그대로']}, {paragraph: ['이 문장에 대한 생각을 씁니다']},
      {blockquote: [{paragraph: [chosen]}]}, {paragraph: []}, {paragraph: ['마지막 문단']}]);
    // ↶ 한 번 = 인용 블록과 빈 줄이 함께 사라진다.
    await page.locator('.ed-tools').getByRole('button', {name: '되돌리기', exact: true}).click();
    expect((await value(page)).doc).toEqual(before.doc);
  });

  test('Q1 여러 줄·여러 블록을 고르면 글자만 줄을 지켜 한 인용 블록에, 고른 글이 끝난 블록 아래에', async ({page}) => {
    const box = await open(page, docOf([P('하나 둘'), {type: 'heading', attrs: {level: 2}, content: [{type: 'text', text: '소제목 셋'}]}, P('넷 다섯'), P('여섯')]));
    await box.focus(); // 누르기 없이 초점만(누르기의 늦은 커서 놓기가 고른 글을 덮지 않게)
    await choose(page, 'p', '둘', '넷', 'p:nth-of-type(2)');
    await expect(quoteButton(page)).toBeVisible();
    await quoteButton(page).click();
    expect(await shape(page)).toEqual([{paragraph: ['하나 둘']}, {heading: ['소제목 셋']}, {paragraph: ['넷 다섯']},
      {blockquote: [{paragraph: ['둘']}, {paragraph: ['소제목 셋']}, {paragraph: ['넷']}]}, {paragraph: []}, {paragraph: ['여섯']}]);
    // 인용 안 글은 글자만(굵게·제목 서식 없음).
    const quote = (await value(page)).doc.content[3];
    expect(quote.content.every(n => n.type === 'paragraph' && n.content.every(t => !t.marks))).toBe(true);
  });

  test('Q1 PC 우클릭: 고른 글 위 우클릭 메뉴에 [인용](누른 자리), Esc는 메뉴만 닫고 고른 글은 그대로', async ({page}) => {
    const box = await open(page, docOf([P('우클릭으로 인용할 문장'), P('')]));
    await box.focus(); // 누르기 없이 초점만(누르기의 늦은 커서 놓기가 고른 글을 덮지 않게)
    await choose(page, 'p', '인용할 문장');
    await expect(quoteButton(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu(page)).toBeHidden();
    expect(await page.evaluate(() => getSelection().toString())).toBe('인용할 문장');
    const sel = await page.evaluate(() => { const b = getSelection().getRangeAt(0).getBoundingClientRect(); return {x: b.left + 8, y: b.top + b.height / 2}; });
    await page.mouse.click(sel.x, sel.y, {button: 'right'});
    await expect(quoteButton(page)).toBeVisible();
    await expect(quoteButton(page)).toBeFocused();
    const m = await menu(page).boundingBox();
    expect(Math.abs(m.x - sel.x)).toBeLessThan(4); expect(Math.abs(m.y - sel.y)).toBeLessThan(4);
    await page.keyboard.press('Enter');
    expect(await shape(page)).toEqual([{paragraph: ['우클릭으로 인용할 문장']}, {blockquote: [{paragraph: ['인용할 문장']}]}, {paragraph: []}, {paragraph: []}]);
    await expect(box).toBeFocused();
  });

  test('Q1 표 칸 안에서 고르면 표 바로 아래, 표 칸 우클릭 메뉴 맨 위에 [인용]', async ({page}) => {
    const cell = text => ({type: 'table_cell', content: [P(text)]});
    const table = {type: 'table', content: [{type: 'table_row', content: [cell('가 칸 글'), cell('나 칸')]}, {type: 'table_row', content: [cell('다 칸'), cell('라 칸')]}]};
    const box = await open(page, docOf([P('표 위'), table, P('표 아래')]));
    await box.focus(); // 누르기 없이 초점만(누르기의 늦은 커서 놓기가 고른 글을 덮지 않게)
    await choose(page, 'td', '칸 글');
    await expect(quoteButton(page)).toBeVisible();
    const at = await page.evaluate(() => { const b = getSelection().getRangeAt(0).getBoundingClientRect(); return {x: b.left + 6, y: b.top + b.height / 2}; });
    await page.mouse.click(at.x, at.y, {button: 'right'});
    const ctx = page.getByRole('menu', {name: '표 칸 메뉴'});
    await expect(ctx).toBeVisible();
    await expect(ctx.getByRole('menuitem').first()).toHaveAccessibleName('고른 글 인용');
    await ctx.getByRole('menuitem', {name: '고른 글 인용'}).click();
    const kinds = (await value(page)).doc.content.map(n => n.type);
    expect(kinds).toEqual(['paragraph', 'table', 'blockquote', 'paragraph', 'paragraph']);
    expect((await shape(page))[2]).toEqual({blockquote: [{paragraph: ['칸 글']}]});
    // 인용 없이 표 칸 우클릭이면 [인용]은 없다.
    await box.locator('td', {hasText: '라 칸'}).click({button: 'right'});
    await expect(ctx).toBeVisible();
    await expect(ctx.getByRole('menuitem', {name: '고른 글 인용'})).toBeHidden();
  });

  test('Q1 코드 블록 안에서 고르면 코드 블록 바로 아래, 줄바꿈은 줄마다 한 줄', async ({page}) => {
    const box = await open(page, docOf([{type: 'code_block', content: [{type: 'text', text: 'let a = 1;\nlet b = 2;'}]}, P('끝')]));
    await box.focus(); // 누르기 없이 초점만(누르기의 늦은 커서 놓기가 고른 글을 덮지 않게)
    await choose(page, 'pre', 'a = 1', 'b = 2');
    await quoteButton(page).click();
    expect(await shape(page)).toEqual([{code_block: ['let a = 1;\nlet b = 2;']}, {blockquote: [{paragraph: ['a = 1;']}, {paragraph: ['let b = 2']}]}, {paragraph: []}, {paragraph: ['끝']}]);
  });

  test('Q1 빈칸만 고르면 메뉴가 없다, 고른 글을 풀면 메뉴가 닫힌다', async ({page}) => {
    const box = await open(page, docOf([P('가   나')]));
    await box.focus(); // 누르기 없이 초점만(누르기의 늦은 커서 놓기가 고른 글을 덮지 않게)
    await choose(page, 'p', '   ');
    await page.keyboard.press('Shift+ArrowLeft'); await page.keyboard.press('Shift+ArrowRight');
    await expect(menu(page)).toBeHidden();
    await choose(page, 'p', '가');
    await expect(quoteButton(page)).toBeVisible();
    await page.keyboard.press('End');
    await expect(menu(page)).toBeHidden();
  });
});

test.describe('폰 412', () => {
  test.use({viewport: {width: 412, height: 860}, hasTouch: true, isMobile: true});

  test('Q1 길게 눌러 고른 글 → 아래 [인용] 누르기 → 글쓰기 자리 그대로(자판 열린 채)', async ({page}) => {
    const box = await open(page, docOf([P('폰에서 고른 문장 하나'), P('다음 문단')]));
    await box.focus();
    await choose(page, 'p', '고른 문장');
    await expect(quoteButton(page)).toBeVisible();
    // 폰 기본 잘라내기·복사 줄(고른 글 위)과 겹치지 않게 고른 글 아래, 손잡이 자리를 비우고.
    const m = await menu(page).boundingBox(), sel = await page.evaluate(() => getSelection().getRangeAt(0).getBoundingClientRect().bottom);
    expect(m.y).toBeGreaterThan(sel + 10);
    expect(m.height).toBeLessThanOrEqual(40);
    await quoteButton(page).tap();
    await expect(box).toBeFocused();
    await expect.poll(() => shape(page)).toEqual([{paragraph: ['폰에서 고른 문장 하나']}, {blockquote: [{paragraph: ['고른 문장']}]}, {paragraph: []}, {paragraph: ['다음 문단']}]);
    await page.keyboard.insertText('폰 코멘트');
    await expect.poll(async () => (await shape(page))[2]).toEqual({paragraph: ['폰 코멘트']});
    // 폰은 길게 누르기 메뉴를 가로채지 않는다(우클릭 [인용]은 PC만).
    await choose(page, 'p', '다음');
    const hijacked = await page.evaluate(() => { const p = [...document.querySelectorAll('.ed-box p')].find(x => x.textContent === '다음 문단'); const e = new PointerEvent('contextmenu', {bubbles: true, cancelable: true, pointerType: 'touch'}); p.dispatchEvent(e); return e.defaultPrevented; });
    expect(hijacked).toBe(false);
  });
});
