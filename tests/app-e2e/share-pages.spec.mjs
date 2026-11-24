// SHARE-현장공유: the Web1 reader (share/, mock share-page-read). NOTE-게시 ③: the Web2 "공유 페이지" editor screen is gone
// (sharing is a note's [공유 링크 만들기], tests/app-e2e/note-publish.spec.mjs); the reader stays for every link already sent.
import {test, expect} from '@playwright/test';
import {existsSync, readFileSync} from 'node:fs';
import {testOrigin} from './helpers/test-origin.mjs';

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const ORIGIN = testOrigin;
const TOKEN = 'a'.repeat(32) + 'b'.repeat(32);

const READ = SB + '/functions/v1/share-page-read';
const XSS = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>';
const samplePage = {title:'민자철도 교섭 현황 ' + XSS, blocks:[
  {type:'summary', text:'3차 교섭 결렬 ' + XSS},
  {type:'stages', title:'', items:[{name:'요구안'}, {name:'교섭'}, {name:'조정'}], current:1},
  {type:'schedule', title:'다가오는 일정', items:[{date:'10/24', text:'조정 신청'}, {date:'10/31', text:'집회 ' + XSS}]},
  {type:'issues', title:'', items:[{title:'인력 충원', body:'2인1조 보장 ' + XSS}]},
  {type:'links', title:'', items:[{label:'요구안 PDF', url:'https://drive.google.com/file/d/x/view'}, {label:'나쁜 링크', url:'javascript:alert(1)'}, {label:'데이터', url:'data:text/html,hi'}]},
  {type:'updates', title:'', items:[{date:'10/19', text:'교섭 결렬'}]},
]};
async function openReader(page, {hash = '#t=' + TOKEN, reply} = {}) {
  const calls = [];
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.route(SB + '/**', async route => {
    const request = route.request();
    calls.push({url:request.url(), method:request.method(), body:request.postData(), headers:request.headers()});
    if (request.url() !== READ) return route.abort();
    return reply(route);
  });
  await page.goto(ORIGIN + '/share/' + hash);
  return {calls, errors};
}

test('Web1 reader draws the page as text only, with noindex and no stored link value', async ({page}) => {
  await page.setViewportSize({width:390, height:844});
  const {calls, errors} = await openReader(page, {reply:route => route.fulfill({status:200, contentType:'application/json', body:JSON.stringify({ok:true, page:samplePage})})});
  await expect(page.locator('h1.sr-title')).toHaveText(samplePage.title);
  expect(calls).toHaveLength(1);
  expect(calls[0].method).toBe('POST');
  expect(JSON.parse(calls[0].body)).toEqual({token:TOKEN});
  expect(calls[0].headers.referer).toBeUndefined();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer');
  // UI-선택표시톤다운: 요약은 꽉 칠한 초록 대신 연한 초록 바탕 + 왼쪽 얇은 초록 선 + 본문 글자색. 지금 단계는 막대로 표시.
  const summary = page.locator('.sr-summary');
  await expect(summary).toHaveText(samplePage.blocks[0].text);
  const tokens = await page.evaluate(() => { const s = getComputedStyle(document.documentElement); return {primary:s.getPropertyValue('--kptu-primary').trim(), soft:s.getPropertyValue('--kptu-primary-soft').trim()}; });
  // S67-64: 기본 색 먹(강조 #22262b, 연한 고른 바탕 #e7e5df).
  expect(tokens.primary).toBe('#22262b');expect(tokens.soft).toBe('#e7e5df');
  await expect(summary).toHaveCSS('background-color', 'rgb(231, 229, 223)');
  await expect(summary).toHaveCSS('box-shadow', 'rgb(34, 38, 43) 2px 0px 0px 0px inset');
  await expect(page.locator('.sr-stage')).toHaveCount(3);
  await expect(page.locator('.sr-stage[aria-current="step"]')).toHaveText('교섭');
  await expect(page.locator('.sr-stage.is-done')).toHaveCount(1);
  await expect(page.locator('.sr-schedule h2')).toHaveText('다가오는 일정');
  await expect(page.locator('.sr-table tr')).toHaveCount(2);
  await expect(page.locator('.sr-issue-title')).toHaveText('인력 충원');
  // Only the https link is drawn, opened safely.
  const links = page.locator('.sr-link');
  await expect(links).toHaveCount(1);
  await expect(links).toHaveAttribute('href', 'https://drive.google.com/file/d/x/view');
  await expect(links).toHaveAttribute('rel', /noopener/);
  await expect(links).toHaveAttribute('target', '_blank');
  await expect(page.locator('.sr-update')).toHaveCount(1);
  await expect(page.locator('.sr-update')).toHaveCSS('border-left-style', 'solid');
  await expect(page.locator('.sr-foot')).toHaveText('링크를 받은 사람만 볼 수 있는 페이지');
  // XSS strings are plain text: no element was made from them and nothing ran.
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  await expect(page.locator('#srMain img, #srMain script')).toHaveCount(0);
  await expect(page.locator('.sr-issue-body')).toContainText('<img src=x');
  // The link value lives only in the address bar.
  // Nothing is kept in the browser (cookies or per-origin storage); the source check below covers the session kind too.
  const kept = await page.context().storageState();
  expect(kept.cookies).toEqual([]);
  expect(kept.origins).toEqual([]);
  expect(await page.content()).not.toContain(TOKEN);
  expect(await page.title()).toBe(samplePage.title + ' · 공유 페이지');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

// BUG-공유페이지삼성: on Samsung Internet only the footer showed. Browser ad blockers apply Fanboy's social list, whose
// generic hide rules include "###sharePage" and "##.sharePage"; the page area used to be <main id="sharePage">.
const SOCIAL_HIDE = '#sharePage,.sharePage,.sharepage,#sharePageButtons,.share-page,[id^="share"],[class^="share"]{display:none!important}';
test('Web1 reader stays visible under an ad blocker that hides share widgets', async ({page}) => {
  await page.setViewportSize({width:390, height:844});
  // Ad blockers inject their rules with extension rights, past the page CSP; a constructed sheet does the same here.
  await page.addInitScript(css => { const sheet = new CSSStyleSheet(); sheet.replaceSync(css); document.adoptedStyleSheets = [sheet]; }, SOCIAL_HIDE);
  const {errors} = await openReader(page, {reply:route => route.fulfill({status:200, contentType:'application/json', body:JSON.stringify({ok:true, page:samplePage})})});
  await expect(page.locator('h1.sr-title')).toHaveText(samplePage.title);
  // The rule is really in force: an element named like a share widget is hidden.
  expect(await page.evaluate(() => { const p = document.createElement('p'); p.id = 'sharePage'; document.body.append(p); const d = getComputedStyle(p).display; p.remove(); return d; })).toBe('none');
  await expect(page.locator('h1.sr-title')).toBeVisible();
  await expect(page.locator('.sr-summary')).toBeVisible();
  await expect(page.locator('.sr-issue-title')).toBeVisible();
  expect(errors).toEqual([]);
});

test('Web1 reader draws on an older browser without the newer DOM and array helpers', async ({page}) => {
  await page.setViewportSize({width:390, height:844});
  await page.addInitScript(() => {
    for (const [owner, key] of [[Element.prototype, 'replaceChildren'], [Document.prototype, 'replaceChildren'], [DocumentFragment.prototype, 'replaceChildren'],
      [Array.prototype, 'at'], [Array.prototype, 'findLast'], [Array.prototype, 'toSorted'], [String.prototype, 'at'], [Object, 'hasOwn'],
      [globalThis, 'structuredClone'], [Promise, 'withResolvers'], [URL, 'parse'], [URL, 'canParse']]) delete owner[key];
  });
  const {errors} = await openReader(page, {reply:route => route.fulfill({status:200, contentType:'application/json', body:JSON.stringify({ok:true, page:samplePage})})});
  await expect(page.locator('h1.sr-title')).toHaveText(samplePage.title);
  await expect(page.locator('.sr-summary')).toHaveText(samplePage.blocks[0].text);
  await expect(page.locator('.sr-stage')).toHaveCount(3);
  await expect(page.locator('.sr-link')).toHaveCount(1);
  expect(await page.title()).toBe(samplePage.title + ' · 공유 페이지');
  expect(errors).toEqual([]);
});

test('Web1 reader keeps the title and other blocks when one block cannot be drawn', async ({page}) => {
  await page.setViewportSize({width:390, height:844});
  // The schedule block needs a <table>; make that one element fail the way a missing browser feature would.
  await page.addInitScript(() => {
    const make = Document.prototype.createElement;
    Document.prototype.createElement = function (tag, ...rest) {
      if (String(tag).toLowerCase() === 'table') throw new TypeError('no table here');
      return make.call(this, tag, ...rest);
    };
  });
  const {errors} = await openReader(page, {reply:route => route.fulfill({status:200, contentType:'application/json', body:JSON.stringify({ok:true, page:samplePage})})});
  await expect(page.locator('h1.sr-title')).toHaveText(samplePage.title);
  await expect(page.locator('.sr-summary')).toHaveText(samplePage.blocks[0].text);
  await expect(page.locator('.sr-schedule')).toHaveCount(0);
  const notice = page.locator('.sr-block-error');
  await expect(notice).toHaveCount(1);
  await expect(notice).toHaveText('일정 칸을 표시하지 못했어요. 페이지를 다시 열거나 보낸 사람에게 알려 주세요.');
  await expect(notice).toHaveAttribute('role', 'note');
  // Blocks after the failing one still show, in order.
  await expect(page.locator('#srMain > *')).toHaveCount(1 + samplePage.blocks.length);
  await expect(page.locator('#srMain > *').nth(3)).toHaveClass(/sr-block-error/);
  await expect(page.locator('.sr-issue-title')).toHaveText('인력 충원');
  await expect(page.locator('.sr-update')).toHaveCount(1);
  await expect(page.locator('.sr-closed')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Web1 reader is a narrow centre column on PC', async ({page}) => {
  await page.setViewportSize({width:1440, height:900});
  await openReader(page, {reply:route => route.fulfill({status:200, contentType:'application/json', body:JSON.stringify({ok:true, page:samplePage})})});
  await expect(page.locator('h1.sr-title')).toBeVisible();
  const box = await page.locator('#srMain').boundingBox();
  expect(box.width).toBeLessThanOrEqual(640);
  expect(Math.abs(box.x + box.width / 2 - 720)).toBeLessThan(2);
});

for (const [name, setup] of [
  ['404', {reply:route => route.fulfill({status:404, contentType:'application/json', body:'{"error":"not_found"}'})}],
  ['network error', {reply:route => route.abort('failed')}],
  ['server error', {reply:route => route.fulfill({status:503, contentType:'application/json', body:'{"error":"unavailable"}'})}],
  ['bad answer', {reply:route => route.fulfill({status:200, contentType:'application/json', body:'{"ok":true,"page":{"title":5}}'})}],
]) test('Web1 reader shows the same closed-link notice on ' + name, async ({page}) => {
  const {calls} = await openReader(page, setup);
  await expect(page.locator('h1.sr-title')).toHaveText('열 수 없는 링크예요');
  await expect(page.locator('.sr-closed')).toContainText('다시 받아 주세요');
  expect(calls).toHaveLength(1);
});

// SHARE-미리보기제목: links copied from Web2 carry ?t= so the Worker can title the preview card. In the browser the value
// moves after # at once (reloads and the page's own file requests no longer send it) and the page reads as before.
test('Web1 reader opens a ?t= link, moves the value after # and reads it once', async ({page}) => {
  const files = [];
  page.on('request', r => { if (r.url().startsWith(ORIGIN)) files.push(r.url()); });
  const {calls, errors} = await openReader(page, {hash:'?t=' + TOKEN, reply:route => route.fulfill({status:200, contentType:'application/json', body:JSON.stringify({ok:true, page:samplePage})})});
  await expect(page.locator('h1.sr-title')).toHaveText(samplePage.title);
  expect(new URL(page.url()).search).toBe('');
  expect(new URL(page.url()).hash).toBe('#t=' + TOKEN);
  expect(calls).toHaveLength(1);
  expect(JSON.parse(calls[0].body)).toEqual({token:TOKEN});
  expect(calls[0].headers.referer).toBeUndefined();
  // Only the page address itself carried the value; its scripts and styles did not.
  expect(files.filter(u => u.includes(TOKEN))).toEqual([ORIGIN + '/share/?t=' + TOKEN]);
  expect(errors).toEqual([]);
  await page.reload();
  await expect(page.locator('h1.sr-title')).toHaveText(samplePage.title);
  expect(new URL(page.url()).search).toBe('');
  expect(calls).toHaveLength(2);
});

for (const search of ['?t=short', '?t=' + 'A'.repeat(64), '?t=' + TOKEN + '&t=' + TOKEN, '?x=' + TOKEN]) test('Web1 reader never calls the server for a malformed ?t= address ' + JSON.stringify(search), async ({page}) => {
  const {calls} = await openReader(page, {hash:search, reply:route => route.fulfill({status:200, body:'{}'})});
  await expect(page.locator('h1.sr-title')).toHaveText('열 수 없는 링크예요');
  expect(calls).toHaveLength(0);
});

test('Web1 reader prefers the # value when an address has both', async ({page}) => {
  const other = 'c'.repeat(64);
  const {calls} = await openReader(page, {hash:'?t=' + other + '#t=' + TOKEN, reply:route => route.fulfill({status:200, contentType:'application/json', body:JSON.stringify({ok:true, page:samplePage})})});
  await expect(page.locator('h1.sr-title')).toHaveText(samplePage.title);
  expect(calls).toHaveLength(1);
  expect(JSON.parse(calls[0].body)).toEqual({token:TOKEN});
});

for (const hash of ['', '#t=short', '#t=' + 'A'.repeat(64), '#x=' + TOKEN, '#t=' + TOKEN + 'aa']) test('Web1 reader never calls the server for a malformed address ' + JSON.stringify(hash), async ({page}) => {
  const {calls} = await openReader(page, {hash, reply:route => route.fulfill({status:200, body:'{}'})});
  await expect(page.locator('h1.sr-title')).toHaveText('열 수 없는 링크예요');
  expect(calls).toHaveLength(0);
});

test('Web1 reader source draws server content with textContent only and keeps no link value', () => {
  // SHARE-보이는편집: the blocks are drawn by app/sr-render.mjs (shared with the Web2 editor), so it is checked as reader code.
  const source = ['share/share.js', 'app/sr-render.mjs'].map(file => readFileSync(file, 'utf8')).join('\n');
  for (const sink of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'console.', 'eval(', 'new Function', 'document.cookie']) expect(source, sink).not.toContain(sink);
  expect(source).not.toMatch(new RegExp(['local', 'session'].map(k => k + 'Storage').concat(['index' + 'edDB', 'caches\\s*\\.']).join('|')));
  const html = readFileSync('share/index.html', 'utf8');
  expect(html).toMatch(/<meta name="robots" content="noindex,nofollow,noarchive">/);
  expect(html).toMatch(/Content-Security-Policy/);
  // Link previews get one fixed card for every share page: never the link value or anything from the page.
  expect(html).not.toMatch(/canonical/);
  const meta = [...html.matchAll(/<meta (?:property|name)="((?:og|twitter):[a-z:_]+)" content="([^"]*)">/g)].map(m => [m[1], m[2]]);
  expect(Object.fromEntries(meta)).toEqual({
    'og:type':'website', 'og:locale':'ko_KR', 'og:title':'공유 페이지', 'og:description':'링크를 받은 사람만 볼 수 있는 페이지',
    'og:url':'https://work.bokdoong.com/work/share/', 'og:image':'https://work.bokdoong.com/work/app/icons/app-icon-512.png',
    'og:image:width':'512', 'og:image:height':'512',
    'twitter:card':'summary', 'twitter:title':'공유 페이지', 'twitter:description':'링크를 받은 사람만 볼 수 있는 페이지',
  });
  expect(existsSync('app/icons/app-icon-512.png')).toBe(true);
  expect(html).not.toMatch(/#t=/);
  // BUG-공유페이지삼성: ad blockers' social lists hide ids and classes such as #sharePage/.sharePage/.share-…, so the reader
  // names nothing after "share" (the footer outside <main> stayed while the whole page area was hidden).
  const names = [...(html + source).matchAll(/(?:id|class(?:Name)?)\s*=\s*"([^"]*)"|el\('[a-z0-9]+', '([^']*)'/g)].map(m => m[1] || m[2] || '');
  expect(names.length).toBeGreaterThan(10);
  for (const name of names) expect(name, name).not.toMatch(/share/i);
  // Older Samsung Internet (Chromium 7x) cannot parse ?. or ?? and has no replaceChildren: one SyntaxError would stop the page.
  for (const file of ['share/share.js', 'app/sr-render.mjs', 'app/share-pages-model.mjs']) {
    const code = readFileSync(file, 'utf8').replace(/^\s*\/\/.*$/gm, '');
    expect(code, file).not.toMatch(/\?\.[\w[(]|\?\?|replaceChildren|structuredClone|\.findLast|\.toSorted|\.at\(/);
  }
});
