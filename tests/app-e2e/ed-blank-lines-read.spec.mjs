// ED-빈줄읽기 (요청함 11/16 19:11 "편집기 칸 바꿈이, 글 읽을 때도 그대로 적용되게"): 편집기에서 넣은 빈 줄(빈 문단)과 문단 끝 줄바꿈이
// 읽기 화면(ed-render.mjs, 하루 기록·노트·기록 보기·공유 페이지가 같이 씀)에서 편집기와 같은 자리·같은 높이로 보인다.
// Fixture page only: the same saved form drawn by the editor and by the reader, side by side at the same width.
import {test, expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {appOrigin} from './helpers/test-origin.mjs';

const url = `${appOrigin}/tests/app-e2e/ed-editor-fixture.html`;
const para = (...inline) => ({type: 'paragraph', attrs: {style: 'body2'}, ...(inline.length ? {content: inline} : {})});
const text = t => ({type: 'text', text: t});
const br = {type: 'hard_break'};
const ed1 = (...nodes) => ({v: 'ed1', doc: {type: 'doc', content: nodes}});

// Top of each block from the first block's top, in the editor and in the reading drawing (same width, same ed-doc.css).
async function tops(page, doc) {
  await page.goto(`${url}?doc=${encodeURIComponent(JSON.stringify(doc))}`);
  await expect(page.locator('body')).toHaveAttribute('data-ready', '1');
  return page.evaluate(() => {
    window.renderOut();
    const out = document.getElementById('out'), input = document.querySelector('.ed-input');
    const style = getComputedStyle(input);
    out.style.width = (input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)) + 'px';
    const list = root => { const kids = [...root.querySelector('.ed-doc').children], first = kids[0].getBoundingClientRect().top;
      return kids.map(k => { const r = k.getBoundingClientRect(); return {top: Math.round(r.top - first), height: Math.round(r.height)}; }); };
    const input2 = document.querySelector('.ed-input');
    const editKids = [...input2.children].filter(k => /^(P|H\d)$/.test(k.tagName)), first = editKids[0].getBoundingClientRect().top;
    return {edit: editKids.map(k => { const r = k.getBoundingClientRect(); return {top: Math.round(r.top - first), height: Math.round(r.height)}; }), read: list(out)};
  });
}

test('blank lines (empty paragraphs) and a line break at the end of a paragraph stand where the editor shows them', async ({page}) => {
  const doc = ed1(para(text('첫 문단')), para(), para(text('빈 줄 하나 다음')), para(), para(), para(text('빈 줄 둘 다음'), br),
    para(text('끝 줄바꿈 다음')), {type: 'heading', attrs: {level: 2}}, para(text('끝')));
  const {edit, read} = await tops(page, doc);
  expect(read).toHaveLength(edit.length);
  for (let i = 0; i < edit.length; i++) {
    expect(Math.abs(read[i].top - edit[i].top), `블록 ${i} 위치`).toBeLessThanOrEqual(1);
    expect(Math.abs(read[i].height - edit[i].height), `블록 ${i} 높이`).toBeLessThanOrEqual(1);
  }
  // An empty paragraph is one line high, not 0 (before: the reader drew an empty <p> with no height).
  expect(read[1].height).toBeGreaterThan(10);
  expect(read[5].height).toBeGreaterThan(read[2].height + 10);
});

test('the reading drawing keeps the saved letters: no text added, only a line break', async ({page}) => {
  await page.goto(`${url}?doc=${encodeURIComponent(JSON.stringify(ed1(para(text('가')), para(), para(text('나'), br))))}`);
  await expect(page.locator('body')).toHaveAttribute('data-ready', '1');
  const html = await page.evaluate(() => window.renderOut());
  expect(html).toBe('<div class="ed-doc"><p class="ed-p ed-body2">가</p><p class="ed-p ed-body2"><br class="ed-trail"></p>'
    + '<p class="ed-p ed-body2">나<br><br class="ed-trail"></p></div>');
  expect(await page.locator('#out').textContent()).toBe('가나');
});

// 세 폭 화면 사진(가짜 글만): CI 묶음 ui-audit-*에 남는다. 위는 편집기, 아래는 같은 글의 읽기 화면.
for (const width of [412, 880, 1440]) {
  test(`editor and reading side by side at ${width}`, async ({page}) => {
    await page.setViewportSize({width, height: 800});
    const doc = ed1(para(text('오전: 회의 준비')), para(), para(text('빈 줄 하나 뒤 문단')), para(), para(), para(text('빈 줄 둘 뒤 문단'), br),
      para(text('문단 끝 줄바꿈 뒤')));
    const {edit, read} = await tops(page, doc);
    expect(read.map(x => x.top)).toEqual(edit.map(x => x.top));
    await page.evaluate(() => {
      const label = t => { const d = document.createElement('div'); d.textContent = t; d.style.cssText = 'font:600 13px sans-serif;padding:8px 18px;background:#eee'; return d; };
      const host = document.getElementById('host'), out = document.getElementById('out');
      host.style.height = 'auto'; out.style.width = ''; out.style.padding = '16px 18px';
      host.before(label('편집기')); out.before(label('읽기 화면'));
    });
    const DIR = 'test-results/ui-audit'; mkdirSync(DIR, {recursive: true});
    await page.screenshot({path: `${DIR}/ed-blank-lines-read-${width}.png`, fullPage: true});
  });
}
