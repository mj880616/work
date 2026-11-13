// NOTE-붙여넣기문단사라짐 (요청함 V28 11/13): a copy with several paragraphs keeps them, from every place's clipboard shape
// (tests/fixtures/ed-paste-sources.mjs). Same editor part for notes, 업무일지, 일기, 회의록, 사업 보고, 조직 기록, 업데이트, 큰 창.
import {test, expect} from '@playwright/test';
import {appOrigin} from './helpers/test-origin.mjs';
import {PASTE_SOURCES} from '../fixtures/ed-paste-sources.mjs';

const url = `${appOrigin}/tests/app-e2e/ed-editor-fixture.html`;
const open = async page => {
  await page.goto(url);
  await expect(page.locator('body')).toHaveAttribute('data-ready', '1');
  const box = page.getByRole('textbox', {name: '본문'});
  await box.click();
  return box;
};
const paste = (page, data) => page.evaluate(d => {
  const t = new DataTransfer(); for (const [k, v] of Object.entries(d)) if (v) t.setData(k, v);
  document.querySelector('.ed-input').dispatchEvent(new ClipboardEvent('paste', {clipboardData: t, bubbles: true, cancelable: true}));
}, data);
// The saved paragraphs' letters (a line break = "\n"), without the editor's own empty last line.
const paragraphs = page => page.evaluate(() => {
  const out = window.ed.getValue().doc.content.map(n => (n.content || []).map(c => (c.type === 'hard_break' ? '\n' : c.text || '')).join(''));
  while (out.length && out[out.length - 1] === '') out.pop();
  return out;
});

for (const src of PASTE_SOURCES) {
  test(`붙여넣기 문단: ${src.name}`, async ({page}) => {
    const box = await open(page);
    await paste(page, {'text/html': src.html, 'text/plain': src.text});
    const got = await paragraphs(page);
    expect(src.keepEmpty ? got : got.filter(Boolean)).toEqual(src.expect);
    if (src.strong) await expect(box.locator('strong')).toHaveText(src.strong);
    if (src.link) await expect(box.locator('a')).toHaveText(src.link);
  });
}

test('붙여넣기 문단: 문단 가운데에 붙이면 앞뒤 글이 첫·끝 문단에 이어짐, 되돌리기 한 번에 붙이기 전', async ({page}) => {
  const box = await open(page);
  await page.keyboard.type('앞뒤');
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(600); // past the editor's history grouping, so the typing is its own undo step
  await paste(page, {'text/html': '<span style="white-space: pre-wrap;">하나\n\n둘</span>', 'text/plain': '하나\n\n둘'});
  expect(await paragraphs(page)).toEqual(['앞하나', '둘뒤']);
  await page.keyboard.press('Control+z');
  expect(await paragraphs(page)).toEqual(['앞뒤']);
  await expect(box).toBeVisible();
});

test('붙여넣기 문단: 이 편집기에서 복사한 글(줄바꿈 두 번 포함)은 그대로', async ({page}) => {
  await open(page);
  const own = '<p class="ed-p" data-pm-slice="1 1 []">가<br><br>나</p>';
  await paste(page, {'text/html': own, 'text/plain': '가\n\n나'});
  expect(await page.evaluate(() => window.ed.getValue().doc.content[0].content.map(c => c.type))).toEqual(['text', 'hard_break', 'hard_break', 'text']);
});

test('붙여넣기 문단: 코드 칸(pre)의 줄바꿈은 지금처럼 코드 안에 그대로', async ({page}) => {
  const box = await open(page);
  await paste(page, {'text/html': '<pre>a = 1\n\nb = 2</pre>', 'text/plain': 'a = 1\n\nb = 2'});
  await expect(box.locator('pre')).toHaveCount(1);
  expect(await page.evaluate(() => window.ed.getValue().doc.content.find(n => n.type === 'code_block').content[0].text)).toBe('a = 1\n\nb = 2');
});

test('붙여넣기 문단: 폰 키보드 클립보드 줄(붙여넣기 없이 글자로 들어옴)의 여러 줄도 줄마다 나뉨', async ({page}) => {
  await open(page);
  await page.keyboard.insertText('첫 문단\n\n둘째 문단');
  const got = (await paragraphs(page)).filter(Boolean);
  expect(got.join('|')).toMatch(/^첫 문단\|(\n?)둘째 문단$/);
});
