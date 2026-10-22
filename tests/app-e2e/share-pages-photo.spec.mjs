// ED-통합편집기 ②: share photos in the editor ([사진] → shrunk and redrawn JPEG sent to share-page-media, shown through a short
// address, saved as share:<id>) and on the Web1 reader (img only from the short https address share-page-read hands out).
// Mock Supabase only: no storage, no production.
import {test, expect} from '@playwright/test';
import {clickView} from './helpers/shell-navigation.mjs';
import {loginEntry} from './helpers/login-entry.mjs';
import {signInWithSession} from './helpers/session-login.mjs';
import {testOrigin} from './helpers/test-origin.mjs';

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const ORIGIN = testOrigin;
const user = {id:'photo-user', email:'photo@example.org', user_metadata:{display_name:'사진 QA'}};
const WS = 'photo-workspace';
const PID = '30000000-0000-4000-8000-000000000001';
const PHOTO = '40000000-0000-4000-8000-000000000001';
const SIGNED = `${SB}/storage/v1/object/sign/share-page-media/${PID}/${PHOTO}.jpg?token=t`;
// A 4x3 PNG: any real picture the browser can open.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAFUlEQVR4nGP4z8Dwn4GBgYEBRIAAAC0cBPx1yJy8AAAAAElFTkSuQmCC', 'base64');
const docPage = text => ({id:PID, title:'사진 페이지', status:'published', project_id:null, updated_at:'2026-10-22T01:00:00.000Z', blocks:[
  {type:'doc', doc:{v:'ed1', doc:{type:'doc', content:[{type:'paragraph', attrs:{style:'body2'}, content:[{type:'text', text}]}]}}}]});

function mockApp(page, state) {
  state.edge = []; state.writes = [];
  return page.route(SB + '/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
    const ok = (data, status = 200) => route.fulfill({status, contentType:'application/json', body:JSON.stringify(data ?? null)});
    if (path.startsWith('/storage/v1/object/sign/')) return route.fulfill({status:200, contentType:'image/png', body:PNG});
    if (path === '/auth/v1/token') return ok({access_token:'p-access', refresh_token:'p-refresh', expires_in:3600, expires_at:Math.floor(Date.now() / 1000) + 3600, user});
    if (path === '/auth/v1/user') return ok(user);
    if (path === '/rest/v1/app_workspace_members') return ok([{workspace_id:WS, user_id:user.id, role:'owner', workspace:{id:WS, slug:'p', name:'웹2'}}]);
    if (path === '/rest/v1/app_workspaces') return ok([{id:WS, name:'웹2'}]);
    if (path === '/rest/v1/app_profiles') return ok([{user_id:user.id, display_name:'QA'}]);
    if (path === '/rest/v1/app_share_pages') {
      if (method === 'GET') { const id = url.searchParams.get('id')?.replace(/^eq\./, ''); return ok(id ? state.pages.filter(p => p.id === id) : state.pages); }
      const body = request.postDataJSON();
      state.writes.push({method, body});
      if (method === 'POST') { const row = {...docPage(''), ...body, updated_at:'2026-10-22T02:00:00.000Z'}; delete row.workspace_id; state.pages.push(row); return ok([row], 201); }
      if (method === 'PATCH') { const row = state.pages[0]; Object.assign(row, body); return ok([row]); }
    }
    if (path === '/rest/v1/app_share_page_links') return ok([]);
    if (path === '/functions/v1/share-page-media') {
      const type = request.headers()['content-type'] || '';
      if (type.startsWith('multipart/form-data')) {
        const buf = request.postDataBuffer(), text = buf.toString('latin1');
        const start = buf.indexOf(Buffer.from([0xff, 0xd8, 0xff]));
        state.edge.push({kind:'upload', pageId:(/name="page_id"\r\n\r\n([^\r]+)/.exec(text) || [])[1], jpeg:start >= 0, hasExif:text.includes('Exif') || text.includes('http://ns.adobe.com/xap'),
          auth:request.headers().authorization});
        return ok({ok:true, id:PHOTO, src:'share:' + PHOTO, width:4, height:3});
      }
      const body = request.postDataJSON();
      state.edge.push({kind:body.action, body});
      return ok({ok:true, urls:{[PHOTO]:SIGNED}});
    }
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
async function pickPhoto(page, editor) {
  const chooser = page.waitForEvent('filechooser');
  await editor.locator('.ed-tools').getByRole('button', {name:'사진 넣기', exact:true}).click();
  await (await chooser).setFiles({name:'현장.png', mimeType:'image/png', buffer:PNG});
}

for (const width of [390, 1280]) test('[사진] on a saved page: redrawn JPEG without EXIF goes to share-page-media, shows, saves as share:<id> ' + width, async ({page}) => {
  await page.setViewportSize({width, height:900});
  const state = {pages:[docPage('현장 글')]};
  const errors = await signIn(page, state);
  await page.locator('.sp-row').first().click();
  const editor = page.locator('[data-sp-editor]');
  const box = editor.getByRole('textbox', {name:'본문', exact:true});
  await expect(box).toBeVisible();
  await box.click();
  await pickPhoto(page, editor);
  const img = box.locator('figure.ed-photo img.ed-photo-img');
  await expect(img).toHaveCount(1);
  await expect(img).toHaveAttribute('src', SIGNED);
  await expect(img).toHaveAttribute('referrerpolicy', 'no-referrer');
  const upload = state.edge.find(e => e.kind === 'upload');
  expect(upload).toMatchObject({pageId:PID, jpeg:true, hasExif:false});
  expect(upload.auth).toMatch(/^Bearer /);
  await expect(editor.locator('.ed-status, [role=status]').first()).toBeVisible();
  await editor.getByRole('button', {name:'저장', exact:true}).click();
  await expect(editor.locator('[data-sp-status-line]')).toContainText('저장했어요');
  const saved = state.writes.at(-1).body.blocks[0].doc.doc.content;
  expect(saved.find(n => n.type === 'image').attrs.src).toBe('share:' + PHOTO);
  expect(JSON.stringify(state.writes)).not.toContain('https://');
  expect(await page.evaluate(() => Object.keys(localStorage).concat(Object.keys(sessionStorage)).filter(k => /photo|share|media/i.test(k)))).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('a page that was never saved says to save first and sends nothing', async ({page}) => {
  await page.setViewportSize({width:1280, height:900});
  const state = {pages:[]};
  await signIn(page, state);
  await page.getByRole('button', {name:'새 공유 페이지', exact:true}).click();
  const editor = page.locator('[data-sp-editor]');
  await expect(editor.getByRole('textbox', {name:'본문', exact:true})).toBeVisible();
  await pickPhoto(page, editor);
  await expect(editor.locator('.ed-note')).toContainText('먼저 [저장]');
  expect(state.edge).toEqual([]);
  await expect(editor.locator('figure.ed-photo')).toHaveCount(0);
});

test('a saved photo opens as a photo (address asked once) and a missing address shows a place, not a broken image', async ({page}) => {
  await page.setViewportSize({width:1280, height:900});
  const withPhoto = docPage('글');
  withPhoto.blocks[0].doc.doc.content.push({type:'image', attrs:{src:'share:' + PHOTO, alt:''}});
  const state = {pages:[withPhoto]};
  await signIn(page, state);
  await page.locator('.sp-row').first().click();
  const editor = page.locator('[data-sp-editor]');
  await expect(editor.locator('figure.ed-photo img')).toHaveAttribute('src', SIGNED);
  expect(state.edge.filter(e => e.kind === 'sign')).toHaveLength(1);
  expect(state.edge.filter(e => e.kind === 'sign')[0].body).toEqual({action:'sign', page_id:PID, ids:[PHOTO]});
});

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
