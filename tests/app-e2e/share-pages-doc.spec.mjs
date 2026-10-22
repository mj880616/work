// ED-통합편집기 ①b: share page 글(doc) block — edited in place with the new editor, [새 편집기로 바꾸기]·[바꾸기 취소],
// and the Web1 reader drawing a doc block the same way (cleaned, text only, old-Samsung syntax). Mock Supabase only.
import {test, expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {clickView} from './helpers/shell-navigation.mjs';
import {loginEntry} from './helpers/login-entry.mjs';
import {signInWithSession} from './helpers/session-login.mjs';
import {testOrigin} from './helpers/test-origin.mjs';

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const ORIGIN = testOrigin;
const user = {id:'doc-user', email:'doc@example.org', user_metadata:{display_name:'글 블록 QA'}};
const WS = 'doc-workspace';
const TOKEN = 'd'.repeat(64);
const OLD = {id:'page-1', title:'○○ 교섭 현황', status:'published', project_id:null, updated_at:'2026-10-20T01:00:00.000Z', blocks:[
  {type:'summary', text:'3차 교섭 결렬'},
  {type:'stages', title:'', items:[{name:'요구안'}, {name:'교섭'}, {name:'조정'}], current:1},
  {type:'schedule', title:'다가오는 일정', items:[{date:'10/24', text:'조정 신청'}]},
  {type:'issues', title:'', items:[{title:'인력 충원', body:'2인 1조 보장'}]},
  {type:'links', title:'', items:[{label:'요구안 PDF', url:'https://example.org/demand.pdf'}]},
  {type:'updates', title:'', items:[{date:'10/19', text:'교섭 결렬'}]},
]};

function mockApp(page, state) {
  state.writes = [];
  return page.route(SB + '/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
    const ok = (data, status = 200) => route.fulfill({status, contentType:'application/json', body:JSON.stringify(data ?? null)});
    if (path === '/auth/v1/token') return ok({access_token:'d-access', refresh_token:'d-refresh', expires_in:3600, expires_at:Math.floor(Date.now() / 1000) + 3600, user});
    if (path === '/auth/v1/user') return ok(user);
    if (path === '/rest/v1/app_workspace_members') return ok([{workspace_id:WS, user_id:user.id, role:'owner', workspace:{id:WS, slug:'d', name:'웹2'}}]);
    if (path === '/rest/v1/app_workspaces') return ok([{id:WS, name:'웹2'}]);
    if (path === '/rest/v1/app_profiles') return ok([{user_id:user.id, display_name:'QA'}]);
    if (path === '/rest/v1/app_share_pages') {
      if (method === 'GET') { const id = url.searchParams.get('id')?.replace(/^eq\./, ''); return ok(id ? state.pages.filter(p => p.id === id) : state.pages); }
      const body = request.postDataJSON();
      state.writes.push({method, body});
      if (method === 'POST') { const row = {id:'page-' + (state.pages.length + 1), ...body, updated_at:'2026-10-22T01:00:00.000Z'}; delete row.workspace_id; state.pages.push(row); return ok([row], 201); }
      if (method === 'PATCH') { const id = url.searchParams.get('id').replace(/^eq\./, ''), row = state.pages.find(p => p.id === id); Object.assign(row, body); return ok([row]); }
    }
    if (path === '/rest/v1/app_share_page_links') return ok([]);
    if (path === '/functions/v1/google-calendar') return ok({connected:false, enabled:false, selected:[], calendars:[], events:[]});
    if (path.startsWith('/functions/v1/')) return ok({});
    if (path.startsWith('/rest/v1/rpc/')) return ok(null);
    if (path.startsWith('/rest/v1/')) return ok([]);
    return ok({});
  });
}
async function signIn(page, state) {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await mockApp(page, state);
  await page.goto(loginEntry(ORIGIN + '/app/'));
  await signInWithSession(page, user.email);
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, {timeout:20000});
  await clickView(page, 'pages');
  return errors;
}

for (const width of [390, 1280]) test('a new page is one 글 block on the full screen: buttons, format, table, saved as ed1 structure ' + width, async ({page}) => {
  await page.setViewportSize({width, height:900});
  const state = {pages:[]};
  const errors = await signIn(page, state);
  await page.getByRole('button', {name:'새 공유 페이지', exact:true}).click();
  const editor = page.locator('[data-sp-editor]');
  await expect(editor.locator('[data-sp-title]')).toBeFocused();
  await page.keyboard.type('글 블록 페이지');
  await page.keyboard.press('Enter');
  const box = editor.getByRole('textbox', {name:'본문', exact:true});
  await expect(box).toBeFocused();
  const tools = editor.locator('.ed-tools');
  await expect(tools).toBeVisible();
  // Small buttons on one row; on a phone the row scrolls sideways (no bar), on PC every button fits (no bar, no ⋯).
  const heights = await tools.locator('button:visible').evaluateAll(list => list.map(b => Math.round(b.getBoundingClientRect().height)));
  for (const h of heights) expect(h).toBeLessThanOrEqual(28);
  expect(await tools.evaluate(el => getComputedStyle(el).flexWrap)).toBe('nowrap');
  if (width >= 1280) {
    expect(await tools.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    await expect(tools.locator('.ed-more')).toBeHidden();
  } else expect(await tools.evaluate(el => getComputedStyle(el).scrollbarWidth)).toBe('none');
  await page.keyboard.type('회의 결과');
  await editor.locator('.ed-style').click();
  await editor.locator('.ed-menu').getByRole('button', {name:'제목 2', exact:true}).click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('1. 날짜는 글자 그대로 ');
  await tools.getByRole('button', {name:'굵게', exact:true}).click();
  await page.keyboard.type('굵게');
  await expect(box).toBeFocused();
  await tools.getByRole('button', {name:'표 넣기', exact:true}).click();
  await page.keyboard.type('항목');
  await expect(box.locator('h3.ed-h2')).toHaveText('회의 결과');
  await expect(box.locator('strong')).toHaveText('굵게');
  await expect(box.locator('ol')).toHaveCount(0);
  await expect(box.locator('table th').first()).toHaveText('항목');
  const node = await box.elementHandle();
  await editor.getByRole('button', {name:'저장', exact:true}).click();
  await expect(editor.locator('[data-sp-status-line]')).toContainText('저장했어요');
  const saved = state.pages[0].blocks;
  expect(state.pages[0].title).toBe('글 블록 페이지');
  expect(saved).toHaveLength(1);
  expect(saved[0].type).toBe('doc');
  expect(saved[0].doc.v).toBe('ed1');
  const content = saved[0].doc.doc.content;
  expect(content[0]).toEqual({type:'heading', attrs:{level:2}, content:[{type:'text', text:'회의 결과'}]});
  expect(content[1].content).toEqual([{type:'text', text:'1. 날짜는 글자 그대로 '}, {type:'text', text:'굵게', marks:[{type:'strong'}]}]);
  expect(content.some(n => n.type === 'table')).toBe(true);
  // Saving keeps the same editor (no redraw), so undo still has what was typed.
  expect(await node.evaluate(n => n.isConnected)).toBe(true);
  await expect(tools.getByRole('button', {name:'되돌리기', exact:true})).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('[취소] puts the 글 block back as it was; a moved block keeps what was typed', async ({page}) => {
  await page.setViewportSize({width:390, height:844});
  const state = {pages:[{...structuredClone(OLD), blocks:[{type:'doc', doc:{v:'ed1', doc:{type:'doc', content:[{type:'paragraph', attrs:{style:'body2'}, content:[{type:'text', text:'처음 글'}]}]}}}, OLD.blocks[0]]}]};
  const errors = await signIn(page, state);
  await page.locator('.sp-row').first().click();
  const editor = page.locator('[data-sp-editor]');
  await editor.getByRole('button', {name:'1번째 블록 글 고치기', exact:true}).click();
  const box = editor.getByRole('textbox', {name:'1번째 블록 글', exact:true});
  await expect(box).toBeFocused();
  await page.keyboard.press('End');
  await page.keyboard.type(' 더함');
  await editor.getByRole('button', {name:'1번째 블록 글 고친 것 취소', exact:true}).click();
  await expect(editor.locator('[data-sp-block="0"] .ed-doc')).toHaveText('처음 글');
  await editor.getByRole('button', {name:'1번째 블록 글 고치기', exact:true}).click();
  await expect(box).toBeFocused();
  await page.keyboard.press('End');
  await page.keyboard.type(' 남김');
  await editor.getByRole('button', {name:'1번째 블록 글 아래로', exact:true}).click();
  await expect(editor.locator('[data-sp-block="1"]')).toHaveAttribute('data-sp-type', 'doc');
  await editor.getByRole('button', {name:'저장', exact:true}).click();
  await expect(editor.locator('[data-sp-status-line]')).toContainText('저장했어요');
  expect(state.pages[0].blocks.map(b => b.type)).toEqual(['summary', 'doc']);
  expect(state.pages[0].blocks[1].doc.doc.content[0].content[0].text).toBe('처음 글 남김');
  expect(errors).toEqual([]);
});

test('[새 편집기로 바꾸기] turns the old blocks into one 글 block keeping every letter; [바꾸기 취소] before saving puts them back', async ({page}) => {
  await page.setViewportSize({width:390, height:844});
  const state = {pages:[structuredClone(OLD)]};
  const errors = await signIn(page, state);
  await page.locator('.sp-row').first().click();
  const editor = page.locator('[data-sp-editor]');
  await expect(editor.locator('.sp-vblock')).toHaveCount(6);
  page.once('dialog', d => d.dismiss());
  await editor.getByRole('button', {name:'새 편집기로 바꾸기', exact:true}).click();
  await expect(editor.locator('.sp-vblock')).toHaveCount(6);
  page.once('dialog', d => d.accept());
  await editor.getByRole('button', {name:'새 편집기로 바꾸기', exact:true}).click();
  await expect(editor.locator('[data-sp-block]')).toHaveCount(1);
  const doc = editor.locator('[data-sp-block="0"] .ed-doc');
  for (const text of ['3차 교섭 결렬', '요구안', '교섭 (지금)', '조정', '다가오는 일정', '10/24', '조정 신청', '인력 충원', '2인 1조 보장', '요구안 PDF', '10/19', '교섭 결렬'])
    await expect(doc).toContainText(text);
  await expect(doc.locator('ol li')).toHaveCount(3);
  await expect(doc.locator('ol li strong')).toHaveText('교섭 (지금)');
  await expect(doc.locator('table tr')).toHaveCount(2);
  await expect(doc.locator('a.ed-link')).toHaveAttribute('href', 'https://example.org/demand.pdf');
  await expect(editor.getByRole('button', {name:'새 편집기로 바꾸기', exact:true})).toBeHidden();
  await editor.getByRole('button', {name:'바꾸기 취소', exact:true}).click();
  await expect(editor.locator('.sp-vblock')).toHaveCount(6);
  expect(await editor.locator('[data-sp-block]').evaluateAll(n => n.map(x => x.dataset.spType))).toEqual(OLD.blocks.map(b => b.type));
  expect(state.writes).toEqual([]);
  // Convert again and save: one doc block is written.
  page.once('dialog', d => d.accept());
  await editor.getByRole('button', {name:'새 편집기로 바꾸기', exact:true}).click();
  await editor.getByRole('button', {name:'저장', exact:true}).click();
  await expect(editor.locator('[data-sp-status-line]')).toContainText('저장했어요');
  expect(state.pages[0].blocks.map(b => b.type)).toEqual(['doc']);
  // Saved as one 글 block: the full writing screen from now on.
  await expect(editor).toHaveClass(/is-full/);
  await expect(editor.getByRole('textbox', {name:'본문', exact:true})).toContainText('3차 교섭 결렬');
  await expect(editor.locator('[data-sp-convert-row]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

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
  // The reader CSP is unchanged: no outside images yet (share photos come in ②).
  expect(html).toMatch(/img-src 'self';/);
});
