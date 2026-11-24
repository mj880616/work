// S48-21 (요청함 10/23 11:08 ③, 10/22 19:27 ②, 10/22 09:33): (편집기 서식 줄 [⌄] 펼침 기억은 NOTE-노션편집 ①(가)로 줄째 없어짐)
// [파일](본문 안 작은 파일 칸), 사진 나란히(여러 장 한꺼번에 → 묻지 않고 바로 나란히, S52-05 A·4장씩 줄 나눔, 고른 사진 [따로 놓기]/[옆 사진과 나란히], 폰은 두 장씩 줄바꿈).
// 편집기만 띄우는 시험 화면(ed-editor-fixture.html)에서 본다. 서버는 그 화면 안의 가짜(view_prefs 읽기·PATCH만)다.
import {test, expect} from '@playwright/test';
import {appOrigin} from './helpers/test-origin.mjs';

const fixture = `${appOrigin}/tests/app-e2e/ed-editor-fixture.html`;
async function open(page, query = '') {
  await page.goto(`${fixture}${query ? '?' + query : ''}`);
  await expect(page.locator('body')).toHaveAttribute('data-ready', '1');
  const box = page.getByRole('textbox', {name: '본문'});
  await box.click();
  return box;
}
const content = page => page.evaluate(() => window.ed.getValue().doc.content);
const png = name => ({name, mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a', 'hex')});
async function pick(page, trigger, files) {
  const chooser = page.waitForEvent('filechooser');
  await trigger.click();
  await (await chooser).setFiles(files);
}

test.describe('PC 1280', () => {
  test.use({viewport: {width: 1280, height: 800}});

  // NOTE-노션편집 ①(가): [⌄] 줄은 없어졌다(PC도 폰과 같은 묶음 줄). 옛 서버 기억(ed_more: true)이 있어도 줄은 그대로 묶음이고, 더는 쓰지 않는다.
  test('[⌄] 줄 없음: 옛 펼침 기억이 있어도 묶음 줄로 열리고, 버튼을 눌러도 ed_more를 쓰지 않는다', async ({page}) => {
    const box = await open(page, `prefs=${encodeURIComponent(JSON.stringify({ed_more: true}))}`);
    await expect(page.locator('.ed-more, .ed-more-menu')).toHaveCount(0);
    await page.locator('.ed-tools').getByRole('button', {name: '글자 서식 선택', exact: true}).click();
    await page.getByRole('group', {name: '글자 서식', exact: true}).getByRole('button', {name: '서식 삭제', exact: true}).click();
    await expect(box).toBeFocused();
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => (window.prefPatches || []).some(p => 'ed_more' in p))).toBe(false);
  });

  test('[파일]: 작은 아이콘 버튼, 선택한 파일은 이름·크기 칸으로 들어가고 [열기]가 연다. 읽기 화면은 Drive로 가는 링크', async ({page}) => {
    await open(page, 'files=1');
    const button = page.locator('.ed-tools').getByRole('button', {name: '파일 넣기', exact: true});
    await expect(button).toHaveAttribute('title', '파일 넣기');
    await expect(button.locator('svg.ed-tool-icon')).toBeVisible();
    expect(Math.round((await button.boundingBox()).height)).toBeLessThanOrEqual(28);
    await pick(page, button, [{name: '회의 자료.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(2048, 1)}]);
    const card = page.locator('.ed-input .ed-file');
    await expect(card).toContainText('회의 자료.pdf');
    await expect(card).toContainText('2.0 KB');
    expect((await content(page)).find(n => n.type === 'file')).toEqual({type: 'file', attrs: {src: 'drive:f1', name: '회의 자료.pdf', size: 2048}});
    await card.getByRole('button', {name: '회의 자료.pdf 열기'}).click();
    expect(await page.evaluate(() => window.opened)).toEqual(['drive:f1']);
    expect(await page.evaluate(() => window.plain())).toContain('[파일: 회의 자료.pdf (2.0 KB)]');
    await page.evaluate(() => window.renderOut());
    const link = page.locator('#out a.ed-file');
    await expect(link).toHaveAttribute('href', 'https://drive.google.com/file/d/f1/view');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  test('NOTE-파일그림넣기 ④: 첨부 줄이 있는 편집기(업데이트 창)의 [파일]은 선택한 파일을 그 첨부 줄로 보낸다(글 안 카드 없음)', async ({page}) => {
    await open(page, 'row=1');
    const button = page.locator('.ed-tools').getByRole('button', {name: '파일 넣기', exact: true});
    await expect(button).toBeVisible();
    await pick(page, button, [{name: '보고서.hwp', mimeType: 'application/x-hwp', buffer: Buffer.alloc(10, 1)}]);
    await expect.poll(() => page.evaluate(() => window.rowFiles)).toEqual(['보고서.hwp']);
    await expect(page.locator('.ed-input .ed-file')).toHaveCount(0);
    await expect(page.locator('.ed-tools').getByRole('button', {name: '사진 넣기', includeHidden: true})).toHaveCount(0);
  });

  test('[파일]이 없는 편집기(공유 페이지 등)에는 버튼이 없다', async ({page}) => {
    await open(page, 'photos=1');
    await expect(page.locator('.ed-bar').getByRole('button', {name: '파일 넣기', includeHidden: true})).toHaveCount(0);
  });

  test('사진 여러 장: 묻지 않고 바로 한 줄, 선택한 사진 [따로 놓기]·[옆 사진과 나란히]로 풀고 붙인다', async ({page}) => {
    await open(page, 'photos=1');
    await pick(page, page.locator('.ed-tools').getByRole('button', {name: '사진 넣기', exact: true}), [png('a.png'), png('b.png'), png('c.png')]);
    // S52-05 A: [나란히]/[한 장씩] 묻기 줄은 없다.
    await expect(page.getByRole('group', {name: '여러 장 놓기'})).toHaveCount(0);
    await expect(page.locator('.ed-bar').getByRole('button', {name: '한 장씩', includeHidden: true})).toHaveCount(0);
    await expect.poll(async () => (await content(page)).map(n => n.type)).toEqual(['photo_row', 'paragraph']);
    const row = page.locator('.ed-input .ed-photo-row');
    await expect(row.locator('.ed-photo')).toHaveCount(3);
    await expect(row.locator('img.ed-photo-img')).toHaveCount(3);
    await expect(row.locator('.ed-photo.is-place')).toHaveCount(0);
    // 한 줄: 세 장의 위쪽이 같고 높이도 같다.
    const boxes = await row.locator('.ed-photo').evaluateAll(l => l.map(f => { const r = f.getBoundingClientRect(); return {top: Math.round(r.top), h: Math.round(r.height)}; }));
    expect(new Set(boxes.map(b => b.top)).size).toBe(1);
    expect(new Set(boxes.map(b => b.h)).size).toBe(1);
    // 마지막 사진을 골라 [따로 놓기] → 두 장 줄 + 한 장.
    await row.locator('.ed-photo').nth(2).click();
    const tools = page.getByRole('group', {name: '사진 놓기'});
    await expect(tools).toBeVisible();
    await tools.getByRole('button', {name: '따로 놓기'}).click();
    await expect.poll(async () => (await content(page)).map(n => n.type)).toEqual(['photo_row', 'image', 'paragraph']);
    // 따로 놓인 사진을 골라 [옆 사진과 나란히] → 다시 세 장 한 줄.
    await page.locator('.ed-input > figure.ed-photo').click();
    await expect(tools.getByRole('button', {name: '옆 사진과 나란히'})).toBeEnabled();
    await tools.getByRole('button', {name: '옆 사진과 나란히'}).click();
    await expect.poll(async () => (await content(page)).map(n => n.type)).toEqual(['photo_row', 'paragraph']);
    expect((await content(page))[0].content).toHaveLength(3);
    // 읽기 화면도 같은 줄.
    await page.evaluate(() => window.renderOut());
    await expect(page.locator('#out .ed-photo-row .ed-photo')).toHaveCount(3);
    expect(await page.evaluate(() => window.plain())).toBe('[사진]\n[사진]\n[사진]');
  });

  test('사진 6장은 4장 줄 + 2장 줄, 5장은 4장 줄 + 한 장, 한 장만 선택하면 따로 한 장', async ({page}) => {
    await open(page, 'photos=1');
    const photo = page.locator('.ed-tools').getByRole('button', {name: '사진 넣기', exact: true});
    await pick(page, photo, [1, 2, 3, 4, 5, 6].map(i => png(`p${i}.png`)));
    await expect.poll(async () => (await content(page)).map(n => n.type === 'photo_row' ? `row${n.content.length}` : n.type)).toEqual(['row4', 'row2', 'paragraph']);
    await open(page, 'photos=1');
    await pick(page, photo, [1, 2, 3, 4, 5].map(i => png(`q${i}.png`)));
    await expect.poll(async () => (await content(page)).map(n => n.type === 'photo_row' ? `row${n.content.length}` : n.type)).toEqual(['row4', 'image', 'paragraph']);
    await pick(page, photo, [png('c.png')]);
    await expect.poll(async () => (await content(page)).map(n => n.type === 'photo_row' ? `row${n.content.length}` : n.type)).toEqual(['row4', 'image', 'image', 'paragraph']);
  });
});

test.describe('폰 390', () => {
  test.use({viewport: {width: 390, height: 844}, hasTouch: true, isMobile: true});

  test('[파일]은 [넣기 ▾] 안에, 세 장 줄은 두 장씩 내려가고 페이지는 옆으로 밀리지 않는다', async ({page}) => {
    const doc = {v: 'ed1', doc: {type: 'doc', content: [{type: 'photo_row', content: [1, 2, 3].map(i => ({type: 'image', attrs: {src: `share:p${i}`, alt: ''}}))}]}};
    await page.goto(`${fixture}?photos=1&files=1&doc=${encodeURIComponent(JSON.stringify(doc))}`);
    await expect(page.locator('body')).toHaveAttribute('data-ready', '1');
    await page.locator('.ed-tools').getByRole('button', {name: '넣을 것 선택'}).click();
    await expect(page.getByRole('group', {name: '넣을 것'}).getByRole('button', {name: '파일 넣기'})).toBeVisible();
    await page.keyboard.press('Escape');
    const tops = await page.locator('.ed-input .ed-photo-row .ed-photo').evaluateAll(l => l.map(f => Math.round(f.getBoundingClientRect().top)));
    expect(tops).toHaveLength(3);
    expect(tops[0]).toBe(tops[1]);
    expect(tops[2]).toBeGreaterThan(tops[0]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
});
