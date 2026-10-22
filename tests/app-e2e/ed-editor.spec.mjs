// ED-통합편집기 ①a: the editor part on its own (fixture page, no app shell, no network beyond the static files).
// Button row (small, sideways scroll on a phone, focus kept), styles, marks, ①, lists, quote, table tools, photo place,
// undo, paste as typed + [서식으로 바꾸기], no format while typing, composition safety, and reading the saved form back.
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
  for (const name of ['굵게', '기울임', '밑줄', '취소선']) {
    await tool(page, name).click();
    await expect(tool(page, name)).toHaveAttribute('aria-pressed', 'true');
    await expect(box).toBeFocused();
  }
  const marks = (await value(page)).doc.content[0].content[0].marks.map(m => m.type).sort();
  expect(marks).toEqual(['em', 'strike', 'strong', 'underline']);
  await tool(page, '굵게').click();
  await expect(tool(page, '굵게')).toHaveAttribute('aria-pressed', 'false');
});

test('· ※ → put their sign; ① puts the next number after the nearest one', async ({page}) => {
  await open(page);
  await tool(page, '다음 동그라미 번호 넣기').click();
  await page.keyboard.type('첫째');
  await page.keyboard.press('Enter');
  await tool(page, '다음 동그라미 번호 넣기').click();
  await page.keyboard.type('둘째 ');
  await tool(page, '다음 동그라미 번호 넣기').click();
  await page.keyboard.type('셋째');
  await page.keyboard.press('Enter');
  await tool(page, '가운뎃점 넣기').click();
  await tool(page, '참고표 넣기').click();
  await tool(page, '화살표 넣기').click();
  const text = await page.evaluate(() => window.plain());
  expect(text).toBe('① 첫째\n\n② 둘째 ③ 셋째\n\n· ※ →');
});

test('lists, quote, rule and photo place; undo and redo', async ({page}) => {
  const box = await open(page);
  await page.keyboard.type('항목');
  await tool(page, '글머리 목록').click();
  await expect(box.locator('ul li')).toHaveCount(1);
  await tool(page, '번호 목록').click();
  await expect(box.locator('ol li')).toHaveCount(1);
  await expect(tool(page, '번호 목록')).toHaveAttribute('aria-pressed', 'true');
  await tool(page, '번호 목록').click();
  await expect(box.locator('ol')).toHaveCount(0);
  await tool(page, '인용').click();
  await expect(box.locator('blockquote')).toHaveCount(1);
  await tool(page, '구분선').click();
  await expect(box.locator('hr')).toHaveCount(1);
  await tool(page, '사진 자리 넣기').click();
  await expect(box.locator('figure.ed-photo')).toHaveCount(1);
  await expect(box.locator('img')).toHaveCount(0);
  await tool(page, '되돌리기').click();
  await expect(box.locator('figure.ed-photo')).toHaveCount(0);
  await tool(page, '다시하기').click();
  await expect(box.locator('figure.ed-photo')).toHaveCount(1);
  const types = JSON.stringify(await value(page));
  expect(types).toContain('"image"');
  expect(types).toContain('"src":null');
});

test('center and left alignment are saved on the paragraph', async ({page}) => {
  await open(page);
  await page.keyboard.type('가운데 글');
  await tool(page, '가운데 정렬').click();
  await expect(tool(page, '가운데 정렬')).toHaveAttribute('aria-pressed', 'true');
  expect((await value(page)).doc.content[0].attrs).toEqual({style: 'body2', align: 'center'});
  await tool(page, '왼쪽 정렬').click();
  expect((await value(page)).doc.content[0].attrs).toEqual({style: 'body2'});
});

test('table: insert, type in cells, add and remove rows and columns, head row; no merge tool', async ({page}) => {
  const box = await open(page);
  await tool(page, '표 넣기').click();
  await expect(box.locator('table tr')).toHaveCount(2);
  const tools = page.locator('.ed-table-tools');
  await expect(tools).toBeVisible();
  await expect(tools.getByRole('button')).toHaveText(['줄 추가', '칸 추가', '줄 삭제', '칸 삭제', '머리줄', '표 지우기']);
  await page.keyboard.type('가');
  await page.keyboard.press('Tab');
  await page.keyboard.type('나');
  expect(await page.evaluate(() => window.plain())).toBe('가 | 나\n |');
  await tools.getByRole('button', {name: '칸 추가'}).click();
  await expect(box.locator('table tr').first().locator('th,td')).toHaveCount(3);
  await tools.getByRole('button', {name: '줄 추가'}).click();
  await expect(box.locator('table tr')).toHaveCount(3);
  // 줄 삭제 removes the row the cursor is in (the first row here).
  await tools.getByRole('button', {name: '줄 삭제'}).click();
  await expect(box.locator('table tr')).toHaveCount(2);
  await expect(box.locator('table')).not.toContainText('가');
  await tools.getByRole('button', {name: '칸 삭제'}).click();
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

test('pasting markdown letters keeps them as typed, then [서식으로 바꾸기] converts once and undo puts the letters back', async ({page}) => {
  const box = await open(page);
  const md = '## 회의 결과\n\n**결정**: 진행\n\n1. 첫째\n2. 둘째\n\n| 항목 | 값 |\n|---|---|\n| 가 | 1 |';
  await page.evaluate(text => {
    const data = new DataTransfer(); data.setData('text/plain', text);
    document.querySelector('.ed-input').dispatchEvent(new ClipboardEvent('paste', {clipboardData: data, bubbles: true, cancelable: true}));
  }, md);
  await expect(box).toContainText('## 회의 결과');
  await expect(box.locator('h2,h3,ol,table,strong')).toHaveCount(0);
  const suggest = page.locator('.ed-suggest');
  await expect(suggest).toBeVisible();
  await suggest.getByRole('button', {name: '서식으로 바꾸기'}).click();
  await expect(box.locator('h3')).toHaveText('회의 결과');
  await expect(box.locator('strong')).toHaveText('결정');
  await expect(box.locator('ol li')).toHaveCount(2);
  await expect(box.locator('table th')).toHaveCount(2);
  await expect(suggest).toBeHidden();
  await tool(page, '되돌리기').click();
  await expect(box).toContainText('## 회의 결과');
  await expect(box.locator('h3')).toHaveCount(0);
});

test('plain letters without markdown marks paste as typed with no offer; dismiss hides the offer', async ({page}) => {
  const box = await open(page);
  const paste = text => page.evaluate(t => {
    const data = new DataTransfer(); data.setData('text/plain', t);
    document.querySelector('.ed-input').dispatchEvent(new ClipboardEvent('paste', {clipboardData: data, bubbles: true, cancelable: true}));
  }, text);
  await paste('2026.10.21. 회의\n- 참석: 3명');
  await expect(page.locator('.ed-suggest')).toBeHidden();
  expect(await page.evaluate(() => window.plain())).toBe('2026.10.21. 회의\n\n- 참석: 3명');
  await paste('\n**굵게**');
  await expect(page.locator('.ed-suggest')).toBeVisible();
  await page.locator('.ed-suggest').getByRole('button', {name: '그대로 두기'}).click();
  await expect(page.locator('.ed-suggest')).toBeHidden();
  await expect(box).toContainText('**굵게**');
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

test('phone width: one row of small buttons scrolls sideways, page itself never scrolls sideways', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await open(page);
  const row = page.locator('.ed-tools');
  const m = await row.evaluate(el => ({scroll: el.scrollWidth, client: el.clientWidth, wrap: getComputedStyle(el).flexWrap, overflow: getComputedStyle(el).overflowX}));
  expect(m.wrap).toBe('nowrap');
  expect(m.overflow).toBe('auto');
  expect(m.scroll).toBeGreaterThan(m.client);
  const heights = await row.locator('button:visible').evaluateAll(list => list.map(b => Math.round(b.getBoundingClientRect().height)));
  for (const h of heights) expect(h).toBeLessThanOrEqual(28);
  const tops = await row.locator('button:visible').evaluateAll(list => new Set(list.map(b => Math.round(b.getBoundingClientRect().top))).size);
  expect(tops).toBe(1);
  // SHARE-전체편집: on a phone the row is swiped sideways, with no scroll bar and no [⋯].
  expect(await row.evaluate(el => getComputedStyle(el).scrollbarWidth)).toBe('none');
  await expect(row.locator('.ed-more')).toBeHidden();
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
  const menu = page.getByRole('group', {name: '서식 더보기'});
  await menu.getByRole('button', {name: '되돌리기', exact: true}).click();
  await expect(box).toBeFocused();
  expect((await value(page)).doc.content[0].content).toBeUndefined();
  await expect(menu).toBeHidden();
  // Wide again: every button back on the row, [⋯] gone.
  await page.evaluate(() => { document.querySelector('.ed-editor').parentElement.style.width = ''; });
  await page.setViewportSize({width: 1280, height: 700});
  await expect(more).toBeHidden();
  await expect(row.getByRole('button', {name: '되돌리기', exact: true})).toBeVisible();
});
