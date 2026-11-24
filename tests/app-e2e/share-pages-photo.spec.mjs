// ED-통합편집기 ②: share photos on the Web1 reader (img only from the short https address share-page-read hands out).
// NOTE-게시 ③: the share page editor screen is gone; note photos shown on a published note are in note-publish specs.
// Mock Supabase only: no storage, no production.
import {test, expect} from '@playwright/test';
import {testOrigin} from './helpers/test-origin.mjs';


const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const ORIGIN = testOrigin;
const PID = '30000000-0000-4000-8000-000000000001';
const PHOTO = '40000000-0000-4000-8000-000000000001';
const SIGNED = `${SB}/storage/v1/object/sign/share-page-media/${PID}/${PHOTO}.jpg?token=t`;
// A 4x3 PNG with valid checksums (the browser must be able to decode it: a broken one is refused as an unreadable format).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAEElEQVR4nGM4YaMBRww4OQAZ7g4RX8PtlgAAAABJRU5ErkJggg==', 'base64');
// ── Web1 reader ──
const READ = SB + '/functions/v1/share-page-read';
const TOKEN = 'e'.repeat(64);
test('Web1 reader draws a share photo only from the short https address, and a missing address stays a place', async ({page}) => {
  await page.setViewportSize({width:390, height:844});
  const errors = [], consoleErrors = [], images = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('request', r => { if (r.resourceType() === 'image') images.push(r.url()); });
  const other = '40000000-0000-4000-8000-000000000009';
  const blocks = [{type:'doc', doc:{v:'ed1', doc:{type:'doc', content:[
    {type:'image', attrs:{src:'share:' + PHOTO, alt:'현장'}},
    {type:'image', attrs:{src:'share:' + other, alt:'없는 사진'}},
    {type:'image', attrs:{src:'drive:abc', alt:'다른 글 사진'}}]}}}];
  await page.route(SB + '/**', route => {
    const url = route.request().url();
    if (url === READ) return route.fulfill({status:200, contentType:'application/json', body:JSON.stringify({ok:true, page:{title:'사진 보기', blocks}, media:{[PHOTO]:SIGNED, [other]:'http://evil.example/x.png', x:'https://evil.example/y.png'}})});
    if (url.startsWith(SB + '/storage/v1/object/sign/')) return route.fulfill({status:200, contentType:'image/png', body:PNG});
    return route.abort();
  });
  await page.goto(ORIGIN + '/share/#t=' + TOKEN);
  const doc = page.locator('.sr-doc .ed-doc');
  await expect(doc.locator('img.ed-photo-img')).toHaveCount(1);
  await expect(doc.locator('img.ed-photo-img')).toHaveAttribute('src', SIGNED);
  await expect(doc.locator('img.ed-photo-img')).toHaveAttribute('referrerpolicy', 'no-referrer');
  await expect(doc.locator('img.ed-photo-img')).toHaveAttribute('loading', 'lazy');
  await expect.poll(() => doc.locator('img.ed-photo-img').evaluate(i => i.naturalWidth)).toBeGreaterThan(0);
  await expect(doc.locator('figure.ed-photo.is-place')).toHaveCount(2);
  expect(images.filter(u => !u.startsWith(ORIGIN))).toEqual([SIGNED]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  expect(consoleErrors.filter(t => /Content Security Policy/i.test(t))).toEqual([]);
  expect(errors).toEqual([]);
});
