// S48-21 (요청함 10/23 11:08 ③, 10/22 19:27 ②, 10/22 09:33): 편집기 서식 줄 [⌄] 펼침 상태를 서버 화면 설정(view_prefs ed_more)에 기억,
// [파일](본문 안 작은 파일 칸), 사진 나란히(여러 장 한꺼번에 → [나란히]/[한 장씩], 고른 사진 [따로 놓기]/[옆 사진과 나란히], 폰은 두 장씩 줄바꿈).
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

  test('[⌄] 줄은 바깥 누르기·Esc로 닫히지 않고 [⌄]로만 접히며, 서버 설정에 기억되고 다음 편집기도 같은 상태로 열린다', async ({page}) => {
    const box = await open(page, 'prefs=null');
    const first = page.locator('#host'), more = first.locator('.ed-tools .ed-more'), band = first.getByRole('group', {name: '서식 더 보기', exact: true});
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await expect(band).toBeHidden();
    await more.click();
    await expect(band).toBeVisible();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    // 글 안을 누르고 Esc를 눌러도, 줄 안 버튼을 눌러도 그대로.
    await box.click();
    await page.keyboard.press('Escape');
    await band.getByRole('button', {name: '취소선', exact: true}).click();
    await expect(band).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.prefPatches.at(-1)?.ed_more)).toBe(true);
    // 같은 방문의 다음 편집기도 펼친 채.
    await page.evaluate(() => window.makeSecond());
    await expect(page.locator('#host2 .ed-more')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#host2 .ed-more-menu')).toBeVisible();
    // [⌃]로 접으면 그 값도 기억.
    await more.click();
    await expect(band).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.prefPatches.at(-1)?.ed_more)).toBe(false);
  });

  test('서버에 펼침이 기억돼 있으면 처음부터 펼친 채 열린다', async ({page}) => {
    await open(page, `prefs=${encodeURIComponent(JSON.stringify({ed_more: true}))}`);
    await expect(page.locator('.ed-tools .ed-more')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('group', {name: '서식 더 보기', exact: true})).toBeVisible();
  });

  test('[파일]: 작은 아이콘 버튼, 고른 파일은 이름·크기 칸으로 들어가고 [열기]가 연다. 읽기 화면은 Drive로 가는 링크', async ({page}) => {
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

  test('[파일]이 없는 편집기(공유 페이지 등)에는 버튼이 없다', async ({page}) => {
    await open(page, 'photos=1');
    await expect(page.locator('.ed-bar').getByRole('button', {name: '파일 넣기', includeHidden: true})).toHaveCount(0);
  });

  test('사진 여러 장: [나란히]를 고르면 한 줄, 고른 사진 [따로 놓기]·[옆 사진과 나란히]로 풀고 붙인다', async ({page}) => {
    await open(page, 'photos=1');
    await pick(page, page.locator('.ed-tools').getByRole('button', {name: '사진 넣기', exact: true}), [png('a.png'), png('b.png'), png('c.png')]);
    const ask = page.getByRole('group', {name: '여러 장 놓기'});
    await expect(ask).toBeVisible();
    await expect(ask).toContainText('사진 3장');
    await ask.getByRole('button', {name: '나란히', exact: true}).click();
    await expect(ask).toBeHidden();
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

  test('사진 여러 장에 [한 장씩]을 고르면 전처럼 한 장씩, 한 장만 고르면 묻지 않는다', async ({page}) => {
    await open(page, 'photos=1');
    const photo = page.locator('.ed-tools').getByRole('button', {name: '사진 넣기', exact: true});
    await pick(page, photo, [png('a.png'), png('b.png')]);
    await page.getByRole('group', {name: '여러 장 놓기'}).getByRole('button', {name: '한 장씩'}).click();
    await expect.poll(async () => (await content(page)).map(n => n.type)).toEqual(['image', 'image', 'paragraph']);
    await pick(page, photo, [png('c.png')]);
    await expect(page.getByRole('group', {name: '여러 장 놓기'})).toBeHidden();
    await expect.poll(async () => (await content(page)).filter(n => n.type === 'image')).toHaveLength(3);
  });
});

test.describe('폰 390', () => {
  test.use({viewport: {width: 390, height: 844}, hasTouch: true, isMobile: true});

  test('[파일]은 [넣기 ▾] 안에, 세 장 줄은 두 장씩 내려가고 페이지는 옆으로 밀리지 않는다', async ({page}) => {
    const doc = {v: 'ed1', doc: {type: 'doc', content: [{type: 'photo_row', content: [1, 2, 3].map(i => ({type: 'image', attrs: {src: `share:p${i}`, alt: ''}}))}]}};
    await page.goto(`${fixture}?photos=1&files=1&doc=${encodeURIComponent(JSON.stringify(doc))}`);
    await expect(page.locator('body')).toHaveAttribute('data-ready', '1');
    await page.locator('.ed-tools').getByRole('button', {name: '넣을 것 고르기'}).click();
    await expect(page.getByRole('group', {name: '넣을 것'}).getByRole('button', {name: '파일 넣기'})).toBeVisible();
    await page.keyboard.press('Escape');
    const tops = await page.locator('.ed-input .ed-photo-row .ed-photo').evaluateAll(l => l.map(f => Math.round(f.getBoundingClientRect().top)));
    expect(tops).toHaveLength(3);
    expect(tops[0]).toBe(tops[1]);
    expect(tops[2]).toBeGreaterThan(tops[0]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
});
