// ED-통합편집기 ①b: the Web1 reader drawing a share page 글(doc) block (cleaned, text only, old-Samsung syntax). Mock Supabase only.
// NOTE-게시 ③: the share page editor screen (in-place 글 block editing) is gone; the reader stays.
import {test, expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {testOrigin} from './helpers/test-origin.mjs';

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const ORIGIN = testOrigin;
const TOKEN = 'd'.repeat(64);

// ── Web1 reader ──
const READ = SB + '/functions/v1/share-page-read';
const XSS = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>';
const docPage = {title:'글 블록 ' + XSS, blocks:[
  {type:'summary', text:'옛 블록도 함께'},
  {type:'doc', doc:{v:'ed1', doc:{type:'doc', content:[
    {type:'heading', attrs:{level:1, align:'center'}, content:[{type:'text', text:'큰 제목'}]},
    {type:'paragraph', attrs:{style:'body2'}, content:[{type:'text', text:'굵은 ' + XSS, marks:[{type:'strong'}]},
      {type:'text', text:'나쁜 링크', marks:[{type:'link', attrs:{href:'javascript:window.__xss=3'}}]},
      {type:'text', text:'좋은 링크', marks:[{type:'link', attrs:{href:'https://example.org/'}}]}]},
    {type:'image', attrs:{src:'https://evil.example/track.png', alt:'현장 사진'}},
    {type:'html', content:[{type:'text', text:'모르는 블록의 글'}]},
    {type:'table', content:[{type:'table_row', content:[{type:'table_header', content:[{type:'paragraph', content:[{type:'text', text:'항목'}]}]}]}]},
  ]}}},
]};
async function openReader(page, reply) {
  const calls = [], errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const images = []; page.on('request', r => { if (r.resourceType() === 'image') images.push(r.url()); });
  await page.route(SB + '/**', route => { calls.push(route.request().url()); return route.request().url() === READ ? reply(route) : route.abort(); });
  await page.goto(ORIGIN + '/share/#t=' + TOKEN);
  return {calls, errors, images};
}
const answer = route => route.fulfill({status:200, contentType:'application/json', body:JSON.stringify({ok:true, page:docPage})});

test('Web1 reader draws a 글 block cleaned, as text only, with no outside image or unsafe link', async ({page}) => {
  await page.setViewportSize({width:390, height:844});
  const {calls, errors, images} = await openReader(page, answer);
  await expect(page.locator('h1.sr-title')).toHaveText(docPage.title);
  await expect(page.locator('.sr-summary')).toHaveText('옛 블록도 함께');
  const doc = page.locator('.sr-doc .ed-doc');
  await expect(doc.locator('h2.ed-h1.ed-center')).toHaveText('큰 제목');
  await expect(doc.locator('strong')).toHaveText('굵은 ' + XSS);
  await expect(doc.locator('a')).toHaveCount(1);
  await expect(doc.locator('a')).toHaveAttribute('href', 'https://example.org/');
  await expect(doc.locator('a')).toHaveAttribute('rel', /noopener/);
  await expect(doc).toContainText('나쁜 링크');
  await expect(doc.locator('figure.ed-photo')).toHaveAttribute('aria-label', '사진: 현장 사진');
  await expect(doc).toContainText('모르는 블록의 글');
  await expect(doc.locator('table th')).toHaveText('항목');
  await expect(page.locator('#srMain img, #srMain script')).toHaveCount(0);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  expect(images.filter(u => !u.startsWith(ORIGIN))).toEqual([]);
  // The reader does not fetch the editor bundle.
  expect(calls).toEqual([READ]);
  expect(await page.evaluate(() => performance.getEntriesByType('resource').map(e => e.name).filter(n => /editor-lib|ed-editor/.test(n)))).toEqual([]);
  // The look comes from ed-doc.css (tokens), loaded by the reader page.
  await expect(doc.locator('h2.ed-h1')).toHaveCSS('font-size', '24px');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

test('Web1 reader draws a 글 block on an older browser without the newer helpers', async ({page}) => {
  await page.setViewportSize({width:390, height:844});
  await page.addInitScript(() => {
    for (const [owner, key] of [[Element.prototype, 'replaceChildren'], [Document.prototype, 'replaceChildren'], [Array.prototype, 'at'],
      [String.prototype, 'at'], [Object, 'hasOwn'], [globalThis, 'structuredClone'], [URL, 'parse'], [URL, 'canParse']]) delete owner[key];
  });
  const {errors} = await openReader(page, answer);
  await expect(page.locator('.sr-doc .ed-doc h2')).toHaveText('큰 제목');
  await expect(page.locator('.sr-doc a')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('Web1 reader and the modules it loads keep to old-Samsung syntax and never name anything "share"', () => {
  for (const file of ['app/ed-render.mjs', 'app/ed-schema.mjs', 'app/sr-render.mjs', 'app/share-pages-model.mjs']) {
    const code = readFileSync(file, 'utf8').replace(/^\s*\/\/.*$/gm, '');
    expect(code, file).not.toMatch(/\?\.[\w[(]|\?\?|replaceChildren|structuredClone|\.findLast|\.toSorted|\.at\(/);
    for (const sink of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function']) expect(readFileSync(file, 'utf8'), `${file} ${sink}`).not.toContain(sink);
  }
  const html = readFileSync('share/index.html', 'utf8');
  expect(html).toContain('<link rel="stylesheet" href="../app/ed-doc.css">');
  // ED-②: the reader CSP lets pictures come only from this site and the project's own address (the short signed photo address); nothing else.
  expect(html).toMatch(/img-src 'self' https:\/\/xmlkxfjeagycwttklxjw\.supabase\.co;/);
  expect(html).toMatch(/default-src 'none'/);
});
