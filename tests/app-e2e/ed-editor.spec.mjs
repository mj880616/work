// ED-통합편집기 ①a: the editor part on its own (fixture page, no app shell, no network beyond the static files).
// Button row (small, sideways scroll on a phone, focus kept), styles, marks, ①, lists, quote, table tools, photo place,
// undo, markdown paste converted by itself (+ whole-text [서식으로 바꾸기]), no format while typing, composition safety, and reading the saved form back.
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
const tool = (page, name) => page.locator('.ed-tools').getByRole('button', {name, exact: true});
// ED-기본기보강: less used buttons are under [⋯] (취소선·인용·구분선…); signs open a row to pick from.
async function press(page, name) {
  const onRow = tool(page, name);
  if (await onRow.count() && await onRow.isVisible()) return onRow.click();
  if ((await page.locator('.ed-more').getAttribute('aria-expanded')) !== 'true') await page.locator('.ed-more').click();
  await page.getByRole('group', {name: '서식 더 보기', exact: true}).getByRole('button', {name, exact: true}).click();
}
const pick = async (page, opener, group, sign) => {
  await tool(page, opener).click();
  await page.getByRole('group', {name: group, exact: true}).getByRole('button', {name: `${sign} 넣기`, exact: true}).click();
};
// 목록 ▾ / 번호 ▾: open the popover under the button and pick a marker shape (aria-label "글머리 •" / "번호 1.").
const listPick = async (page, kind, label) => {
  await tool(page, kind === 'bullet' ? '글머리 목록 고르기' : '번호 목록 고르기').click();
  await page.getByRole('group', {name: kind === 'bullet' ? '글머리 목록' : '번호 목록', exact: true}).getByRole('button', {name: label, exact: true}).click();
};
const nextCircled = async page => {
  await tool(page, '동그라미 번호 고르기').click();
  await page.getByRole('group', {name: '동그라미 번호', exact: true}).locator('.is-next').click();
};
const insertTable = async (page, rows = 2, cols = 2) => {
  await tool(page, '표 넣기').click();
  await page.getByRole('group', {name: '표 크기 고르기', exact: true}).getByRole('button', {name: `${rows}줄 ${cols}칸 표`, exact: true}).click();
};

test('typing keeps letters: "1. ", "- ", "# " and dates are never turned into format', async ({page}) => {
  const box = await open(page);
  await page.keyboard.type('1. 하나');
  await page.keyboard.press('Enter');
  await page.keyboard.type('- 둘');
  await page.keyboard.press('Enter');
  await page.keyboard.type('# 셋');
  await page.keyboard.press('Enter');
  await page.keyboard.type('2026.10.21. 회의');
  const v = await value(page);
  expect(v.v).toBe('ed1');
  expect(v.doc.content.map(n => n.type)).toEqual(['paragraph', 'paragraph', 'paragraph', 'paragraph']);
  expect(await page.evaluate(() => window.plain())).toBe('1. 하나\n\n- 둘\n\n# 셋\n\n2026.10.21. 회의');
  expect(await page.evaluate(() => window.ed.getText())).toBe(await page.evaluate(() => window.plain()));
  await expect(box.locator('ol,ul,h2')).toHaveCount(0);
});

test('style menu shows the current level and switches 제목 1~3 · 본문 1~3; Enter after a heading goes back to 본문 2', async ({page}) => {
  await open(page);
  await page.keyboard.type('큰 제목');
  const style = page.locator('.ed-style');
  await expect(style).toHaveText('본문 2 ▾');
  await style.click();
  await expect(style).toHaveAttribute('aria-expanded', 'true');
  await page.locator('.ed-menu').getByRole('button', {name: '제목 1'}).click();
  await expect(style).toHaveText('제목 1 ▾');
  await expect(page.locator('.ed-menu[aria-label="글 단계"]')).toBeHidden();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(style).toHaveText('본문 2 ▾');
  await page.keyboard.type('작은 글');
  await style.click();
  await page.locator('.ed-menu').getByRole('button', {name: '본문 3'}).click();
  const v = await value(page);
  expect(v.doc.content[0]).toMatchObject({type: 'heading', attrs: {level: 1}});
  expect(v.doc.content[1]).toMatchObject({type: 'paragraph', attrs: {style: 'body3'}});
  // Enter inside 본문 3 keeps 본문 3.
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(style).toHaveText('본문 3 ▾');
});

test('bold, italic, underline, strike toggle on the selection and show as pressed; focus stays in the text', async ({page}) => {
  const box = await open(page);
  await page.keyboard.type('굵고 기울고');
  await page.keyboard.press('Shift+Home');
  // The editor learns of the browser's selection a moment later (selectionchange). A press before that used to mark an empty
  // cursor (CI flake: the first letters had no marks). Pressing right away is covered in ed-popovers.spec.mjs; here, wait.
  await expect.poll(async () => page.evaluate(() => window.ed.view.state.selection.empty)).toBe(false);
  for (const name of ['굵게', '기울임', '밑줄', '취소선']) {
    await press(page, name);
    await expect(page.locator('.ed-bar').getByRole('button', {name, exact: true, includeHidden: true})).toHaveAttribute('aria-pressed', 'true');
    await expect(box).toBeFocused();
  }
  const marks = (await value(page)).doc.content[0].content[0].marks.map(m => m.type).sort();
  expect(marks).toEqual(['em', 'strike', 'strong', 'underline']);
  await tool(page, '굵게').click();
  await expect(tool(page, '굵게')).toHaveAttribute('aria-pressed', 'false');
});

test('· ※ → put their sign; ① marks the next number after the nearest one', async ({page}) => {
  await open(page);
  await nextCircled(page);
  await page.keyboard.type('첫째');
  await page.keyboard.press('Enter');
  await nextCircled(page);
  await page.keyboard.type('둘째 ');
  await nextCircled(page);
  await page.keyboard.type('셋째');
  await page.keyboard.press('Enter');
  await pick(page, '점 기호 고르기', '점 기호', '·');
  await pick(page, '참고 기호 고르기', '참고 기호', '※');
  await pick(page, '화살표 고르기', '화살표', '→');
  const text = await page.evaluate(() => window.plain());
  expect(text).toBe('① 첫째\n\n② 둘째 ③ 셋째\n\n· ※ →');
});

test('lists, quote and rule; undo and redo', async ({page}) => {
  const box = await open(page);
  await page.keyboard.type('항목');
  await listPick(page, 'bullet', '글머리 •');
  await expect(box.locator('ul li')).toHaveCount(1);
  await listPick(page, 'ordered', '번호 1.');
  await expect(box.locator('ol li')).toHaveCount(1);
  await expect(tool(page, '번호 목록 고르기')).toHaveAttribute('aria-pressed', 'true');
  await tool(page, '번호 목록 고르기').click();
  await page.getByRole('group', {name: '번호 목록', exact: true}).getByRole('button', {name: '목록 풀기'}).click();
  await expect(box.locator('ol')).toHaveCount(0);
  await press(page, '인용');
  await expect(box.locator('blockquote')).toHaveCount(1);
  await press(page, '구분선');
  await expect(box.locator('hr')).toHaveCount(1);
  await tool(page, '되돌리기').click();
  await expect(box.locator('hr')).toHaveCount(0);
  await tool(page, '다시하기').click();
  await expect(box.locator('hr')).toHaveCount(1);
  // [사진] waits for ② (no button); ed-basics.spec.mjs checks drops and pastes.
  await expect(page.locator('.ed-bar').getByRole('button', {name: /사진/})).toHaveCount(0);
  expect(JSON.stringify(await value(page))).toContain('"horizontal_rule"');
});

test('center and left alignment are saved on the paragraph', async ({page}) => {
  await open(page);
  await page.keyboard.type('가운데 글');
  const align = async name => { await tool(page, '정렬 고르기').click(); await page.getByRole('group', {name: '정렬', exact: true}).getByRole('button', {name, exact: true}).click(); };
  await align('가운데 정렬');
  await expect(tool(page, '정렬 고르기')).toHaveText('가운데 ▾');
  expect((await value(page)).doc.content[0].attrs).toEqual({style: 'body2', align: 'center'});
  await align('왼쪽 정렬');
  expect((await value(page)).doc.content[0].attrs).toEqual({style: 'body2'});
});

test('table: insert, type in cells, add and remove rows and columns, head row', async ({page}) => {
  const box = await open(page);
  await insertTable(page);
  await expect(box.locator('table tr')).toHaveCount(2);
  const tools = page.locator('.ed-table-tools');
  await expect(tools).toBeVisible();
  await expect(tools.getByRole('button')).toHaveText(['위에 줄', '아래에 줄', '왼쪽에 칸', '오른쪽에 칸', '줄 삭제', '칸 삭제', '칸 합치기', '칸 나누기', '머리줄', '글자에 맞추기', '표 선택', '표 지우기']);
  await page.keyboard.type('가');
  await page.keyboard.press('Tab');
  await page.keyboard.type('나');
  expect(await page.evaluate(() => window.plain())).toBe('가 | 나\n |');
  await tools.getByRole('button', {name: '오른쪽에 칸 넣기'}).click();
  await expect(box.locator('table tr').first().locator('th,td')).toHaveCount(3);
  await tools.getByRole('button', {name: '아래에 줄 넣기'}).click();
  await expect(box.locator('table tr')).toHaveCount(3);
  // 줄 삭제 removes the row the cursor is in (the first row here).
  await tools.getByRole('button', {name: '줄 삭제', exact: true}).click();
  await expect(box.locator('table tr')).toHaveCount(2);
  await expect(box.locator('table')).not.toContainText('가');
  await tools.getByRole('button', {name: '칸 삭제', exact: true}).click();
  await expect(box.locator('table tr').first().locator('th,td')).toHaveCount(2);
  // The head row went with the deleted first row: 머리줄 makes the (new) first row the head row, and again turns it off.
  await expect(box.locator('table th')).toHaveCount(0);
  await tools.getByRole('button', {name: '머리줄'}).click();
  await expect(box.locator('table tr').first().locator('th')).toHaveCount(2);
  await expect(box.locator('table th')).toHaveCount(2);
  await tools.getByRole('button', {name: '머리줄'}).click();
  await expect(box.locator('table th')).toHaveCount(0);
  await tools.getByRole('button', {name: '표 지우기'}).click();
  await expect(box.locator('table')).toHaveCount(0);
  await expect(tools).toBeHidden();
});

// ED-폰마크다운붙여넣기 (2026-10-28): a markdown paste converts by itself, one undo step back to the letters.
const pasteData = (page, data) => page.evaluate(d => {
  const t = new DataTransfer(); for (const [k, v] of Object.entries(d)) t.setData(k, v);
  document.querySelector('.ed-input').dispatchEvent(new ClipboardEvent('paste', {clipboardData: t, bubbles: true, cancelable: true}));
}, data);
const MD = '## 회의 결과\n\n**결정**: 진행\n\n1. 첫째\n2. 둘째\n\n| 항목 | 값 |\n|---|---|\n| 가 | 1 |';

test('pasting markdown letters converts right away (no button); one undo puts the letters back', async ({page}) => {
  const box = await open(page);
  await pasteData(page, {'text/plain': MD});
  await expect(box.locator('h3')).toHaveText('회의 결과');
  await expect(box.locator('strong')).toHaveText('결정');
  await expect(box.locator('ol li')).toHaveCount(2);
  await expect(box.locator('table th')).toHaveCount(2);
  await expect(page.locator('.ed-suggest')).toBeHidden();
  await expect(page.locator('.ed-note')).toContainText('서식으로 바꿨어요');
  await tool(page, '되돌리기').click();
  await expect(box).toContainText('## 회의 결과');
  await expect(box.locator('h3,ol,table,strong')).toHaveCount(0);
  // The letters were the choice: no whole-text offer for them.
  await expect(page.locator('.ed-suggest')).toBeHidden();
});

test('a phone copy: a formatted copy that only wraps the same letters (signs and all) converts like plain letters', async ({page}) => {
  const box = await open(page);
  const html = '<meta charset="utf-8"><div><span>## 공통</span></div><div><span>**굵게** 한 줄</span></div><div><span>1. 첫째</span></div>';
  await pasteData(page, {'text/html': html, 'text/plain': '## 공통\n**굵게** 한 줄\n1. 첫째'});
  await expect(box.locator('h3')).toHaveText('공통');
  await expect(box.locator('strong')).toHaveText('굵게');
  await expect(box).not.toContainText('## 공통');
  await expect(box).not.toContainText('**');
});

test('a formatted copy that is already formatted (no signs in it) keeps its own format', async ({page}) => {
  const box = await open(page);
  await pasteData(page, {'text/html': '<p><b>결정</b>: 진행</p>', 'text/plain': '**결정**: 진행'});
  await expect(box.locator('strong')).toHaveText('결정');
  await expect(box).not.toContainText('**');
});

test('a keyboard clipboard row (letters put in as typed text, no paste event) converts too', async ({page}) => {
  const box = await open(page);
  await page.locator('.ed-input').focus();
  await page.evaluate(text => {
    document.querySelector('.ed-input').dispatchEvent(new InputEvent('beforeinput', {inputType: 'insertText', data: text, bubbles: true, cancelable: true}));
  }, '## 공통\n**굵게** 한 줄');
  await expect(box.locator('h3')).toHaveText('공통');
  await expect(box.locator('strong')).toHaveText('굵게');
  await tool(page, '되돌리기').click();
  await expect(box).toContainText('## 공통');
});

test('plain letters without markdown marks paste as typed; a later markdown paste converts only its own part', async ({page}) => {
  const box = await open(page);
  await pasteData(page, {'text/plain': '2026.10.21. 회의\n- 참석: 3명'});
  await expect(page.locator('.ed-suggest')).toBeHidden();
  expect(await page.evaluate(() => window.plain())).toBe('2026.10.21. 회의\n\n- 참석: 3명');
  await pasteData(page, {'text/plain': '\n**굵게**'});
  await expect(box.locator('strong')).toHaveText('굵게');
  await expect(box).toContainText('2026.10.21. 회의');
  await expect(box).toContainText('- 참석: 3명');
  await expect(box.locator('ul,ol')).toHaveCount(0);
});

test('a text saved as markdown letters shows a small [서식으로 바꾸기] that converts it whole; undo and dismiss', async ({page}) => {
  const para = text => ({type: 'paragraph', attrs: {style: 'body2'}, content: text ? [{type: 'text', text}] : []});
  const doc = {v: 'ed1', doc: {type: 'doc', content: [para('## 공통'), para(''), para('**굵게** 한 줄'), para('1. 첫째'), para('2. 둘째')]}};
  const box = await open(page, doc);
  const suggest = page.locator('.ed-suggest');
  await expect(suggest).toBeVisible();
  await expect(suggest).toContainText('이 글에 마크다운 기호가 보여요.');
  await suggest.getByRole('button', {name: '서식으로 바꾸기'}).click();
  await expect(box.locator('h3')).toHaveText('공통');
  await expect(box.locator('strong')).toHaveText('굵게');
  await expect(box.locator('ol li')).toHaveCount(2);
  await expect(suggest).toBeHidden();
  await tool(page, '되돌리기').click();
  await expect(box).toContainText('## 공통');
  await expect(box.locator('h3')).toHaveCount(0);
  // Open again and keep the letters: × hides the offer.
  await open(page, doc);
  await expect(suggest).toBeVisible();
  await suggest.getByRole('button', {name: '그대로 두기'}).click();
  await expect(suggest).toBeHidden();
  await expect(page.locator('.ed-input')).toContainText('## 공통');
});

test('a text with format already in it gets no whole-text offer', async ({page}) => {
  const doc = {v: 'ed1', doc: {type: 'doc', content: [{type: 'heading', attrs: {level: 2}, content: [{type: 'text', text: '제목'}]},
    {type: 'paragraph', attrs: {style: 'body2'}, content: [{type: 'text', text: '## 공통'}]}]}};
  await open(page, doc);
  await expect(page.locator('.ed-input h3, .ed-input h2').first()).toBeVisible();
  await expect(page.locator('.ed-suggest')).toBeHidden();
});

test('pasted HTML keeps allowed format only: no script, no outside image, unsafe links dropped', async ({page}) => {
  const box = await open(page);
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData('text/html', '<p><b>굵</b><img src="https://example.org/x.png" alt="사진설명" onerror="window.bad=1"><a href="javascript:alert(1)">나쁜</a> <a href="https://ok.example/">좋은</a></p><script>window.bad=2</script>');
    data.setData('text/plain', '굵 나쁜 좋은');
    document.querySelector('.ed-input').dispatchEvent(new ClipboardEvent('paste', {clipboardData: data, bubbles: true, cancelable: true}));
  });
  await expect(box.locator('strong')).toHaveText('굵');
  await expect(box.locator('img')).toHaveCount(0);
  await expect(box).toContainText('이미지: 사진설명 (https://example.org/x.png)');
  await expect(box.locator('a')).toHaveCount(1);
  await expect(box.locator('a')).toHaveAttribute('href', 'https://ok.example/');
  expect(await page.evaluate(() => window.bad)).toBeUndefined();
});

test('a button pressed during a 한글 composition waits for it to end and does not break the syllable', async ({page}) => {
  const box = await open(page);
  await page.keyboard.type('가');
  // Simulate an IME composition in progress (Chromium input method events), then press 굵게.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.imeSetComposition', {text: 'ㄴ', selectionStart: 1, selectionEnd: 1});
  await cdp.send('Input.imeSetComposition', {text: '나', selectionStart: 1, selectionEnd: 1});
  await tool(page, '굵게').click();
  await cdp.send('Input.insertText', {text: '나'});
  await expect(box).toBeFocused();
  const text = await page.evaluate(() => window.plain());
  expect(text.replace(/\s/g, '')).toMatch(/^가나/);
  expect(text).not.toMatch(/ㄴ/);
});

// ED-서식줄묶음: a phone's row is the grouped one — every button fits one line, down to a folded phone's width (344px).
test('phone width: the grouped row fits one line at 390, 360 and 344, page itself never scrolls sideways', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await open(page);
  const row = page.locator('.ed-tools');
  const m = await row.evaluate(el => ({scroll: el.scrollWidth, client: el.clientWidth, wrap: getComputedStyle(el).flexWrap, overflow: getComputedStyle(el).overflowX}));
  expect(m.wrap).toBe('nowrap');
  expect(m.overflow).toBe('auto');
  for (const width of [390, 360, 344]) {
    await page.setViewportSize({width, height: 844});
    await expect.poll(() => row.evaluate(el => el.scrollWidth - el.clientWidth), `row at ${width}`).toBeLessThanOrEqual(0);
  }
  await page.setViewportSize({width: 390, height: 844});
  await expect(row.getByRole('button')).toHaveText(['본문 2 ▾', '굵게', '·', '▾', '글자 ▾', '문단 ▾', '넣기 ▾', '기호 ▾', '↶', '↷']);
  const heights = await row.locator('button:visible').evaluateAll(list => list.map(b => Math.round(b.getBoundingClientRect().height)));
  for (const h of heights) expect(h).toBeLessThanOrEqual(28);
  const tops = await row.locator('button:visible').evaluateAll(list => new Set(list.map(b => Math.round(b.getBoundingClientRect().top))).size);
  expect(tops).toBe(1);
  // No scroll bar; [⌄] is gone on a phone (its buttons sit in the group popovers); nothing is moved under it.
  expect(await row.evaluate(el => getComputedStyle(el).scrollbarWidth)).toBe('none');
  await expect(row.locator('.ed-more')).toBeHidden();
  await expect(page.locator('.ed-more-menu [data-ed-moved]')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({path: 'test-results/ed-editor-390.png'});
});

test('PC width: the row fits and the document reads as it is drawn for readers', async ({page}) => {
  await page.setViewportSize({width: 1280, height: 800});
  const doc = {v: 'ed1', doc: {type: 'doc', content: [
    {type: 'heading', attrs: {level: 1, align: 'center'}, content: [{type: 'text', text: '제목'}]},
    {type: 'paragraph', attrs: {style: 'body1'}, content: [{type: 'text', text: '굵은', marks: [{type: 'strong'}]}, {type: 'text', text: ' 글'}]},
    {type: 'blockquote', content: [{type: 'paragraph', attrs: {style: 'body2'}, content: [{type: 'text', text: '인용'}]}]},
  ]}};
  const box = await open(page, doc);
  await expect(box.locator('h2.ed-h1.ed-center')).toHaveText('제목');
  const html = await page.evaluate(() => window.renderOut());
  expect(html).toContain('<h2 class="ed-h ed-h1 ed-center">제목</h2>');
  expect(html).toContain('<strong>굵은</strong>');
  expect(html).toContain('<blockquote class="ed-quote">');
  await page.screenshot({path: 'test-results/ed-editor-1280.png'});
});

// SHARE-전체편집: wider than a phone the row never scrolls sideways; what does not fit goes under [⋯] and still works.
test('narrow PC width: buttons that do not fit go under [⋯], no sideways scroll bar, and they still work', async ({page}) => {
  await page.setViewportSize({width: 800, height: 700});
  await page.goto(url);
  await expect(page.locator('body')).toHaveAttribute('data-ready', '1');
  await page.evaluate(() => { document.querySelector('.ed-editor').parentElement.style.width = '520px'; });
  const row = page.locator('.ed-tools'), more = row.locator('.ed-more');
  await expect(more).toBeVisible();
  await expect.poll(() => row.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  const box = page.getByRole('textbox', {name: '본문'});
  await box.click();
  await page.keyboard.type('가나다');
  await more.click();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  const menu = page.getByRole('group', {name: '서식 더 보기'});
  await menu.getByRole('button', {name: '되돌리기', exact: true}).click();
  await expect(box).toBeFocused();
  expect((await value(page)).doc.content[0].content).toBeUndefined();
  await expect(menu).toBeHidden();
  // Wide again: every row button back on the row ([⋯] keeps only its own buttons).
  await page.evaluate(() => { document.querySelector('.ed-editor').parentElement.style.width = ''; });
  await page.setViewportSize({width: 1280, height: 700});
  await expect(page.locator('.ed-more-menu [data-ed-moved]')).toHaveCount(0);
  await expect(row.getByRole('button', {name: '되돌리기', exact: true})).toBeVisible();
});
