import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {openWriteFromEntry} from './helpers/write-opener.mjs';
import {typeInto} from './helpers/note-editor.mjs';
// ED③ 업데이트(설계 11.4 순서 3): 업데이트를 쓰는 곳(상단 줄 [+ 추가] → [업데이트], 홈·바구니 [크게])은 새 편집기 창(#edWindow)을 연다.
// 위쪽 [기록할 곳 ▾]에서 고른 곳(없으면 바구니)으로, 바구니·여러 곳 저장은 글자와 서식(doc)을 함께, 조직·프로젝트 기록 한 곳은 글자만.
// 저장하면 닫힌다(저장하고 닫기). 저장 경로는 기존 그대로.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const quick=page=>page.locator('#homeView [data-home-quick]');
const win=page=>page.locator('#edWindow');
const text=page=>win(page).locator('.ed-window-body .ProseMirror');
const sheet=page=>page.locator('#edwPlaceSheet');
async function fixture(page,width){
 await page.setViewportSize({width,height:844});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 const home=await openHome(page),notes=[],orgs=[],projects=[];
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes',r=>{
  if(r.request().method()!=='POST')return r.fallback();
  const body=r.request().postDataJSON();notes.push(body);
  return r.fulfill({status:201,json:[{id:'new-'+notes.length,kind:'basket',occurred_at:'2026-10-06T01:00:00Z',updated_at:'2026-10-06T01:00:00Z',created_at:'2026-10-06T01:00:00Z',title:null,attachments:[],metadata:{},archived_at:null,ai_export_allowed:true,...body}]});
 });
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_suborganization_updates',r=>r.request().method()==='POST'?(orgs.push(r.request().postDataJSON()),r.fulfill({status:201,json:[]})):r.fallback());
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_project_progress_updates',r=>r.request().method()==='POST'?(projects.push(r.request().postDataJSON()),r.fulfill({status:201,json:[]})):r.fallback());
 return {...home,errors,notes,orgs,projects};
}

async function openWriter(page,width){
 await openWriteFromEntry(page,width);
 await expect(win(page)).toBeVisible();return win(page);
}
const fits=page=>page.evaluate(()=>{const h=document.querySelector('#edWindow .ed-window-head');return !!h&&h.scrollWidth<=h.clientWidth&&document.documentElement.scrollWidth<=innerWidth;});

for(const width of [390,1280]){
 test(`home [크게]: same window with the input text; update with no place saves to the basket with its form and closes ${width}`,async({page})=>{
  const f=await fixture(page,width),q=quick(page);
  await q.locator('[data-quick-input]').fill('홈에서 쓰던 업데이트');
  const big=q.locator('[data-quick-big]');await expect(big).toBeVisible();await expect(big).toHaveAccessibleName('큰 창에서 쓰기');
  // [할 일] hides it; [업데이트] shows it again.
  await q.locator('[data-quick-mode="task"]').click();await expect(big).toBeHidden();await q.locator('[data-quick-mode="update"]').click();await expect(big).toBeVisible();
  await big.click();
  const e=win(page);await expect(e).toBeVisible();
  await expect(text(page)).toContainText('홈에서 쓰던 업데이트');
  await expect(e.locator('[data-edw-place]')).toContainText('정리함(미분류)');
  await expect(e.locator('[data-edw-save]')).toHaveAccessibleName('업데이트로 저장');
  expect(await fits(page)).toBe(true);
  // Closing without saving hands the letters back to the input.
  await typeInto(page,text(page),'큰 창에서 고친 업데이트');
  await e.locator('[data-close="edWindow"]').click();
  await page.locator('#edwCloseSheet').getByRole('button',{name:'저장하지 않고 닫기',exact:true}).click();await expect(win(page)).toHaveCount(0);
  await expect(q.locator('[data-quick-input]')).toHaveValue('큰 창에서 고친 업데이트');
  expect(f.notes).toEqual([]);
  await big.click();await expect(text(page)).toContainText('큰 창에서 고친 업데이트');
  await win(page).locator('[data-edw-save]').click();
  await expect(win(page)).toHaveCount(0);
  await expect(page.locator('#toast')).toContainText('정리함에 저장');
  await expect(q.locator('[data-quick-input]')).toHaveValue('');
  expect(f.notes).toHaveLength(1);expect(f.notes[0]).toMatchObject({workspace_id:'w',raw_text:'큰 창에서 고친 업데이트'});expect(f.notes[0].doc).toMatchObject({v:'ed1'});
  expect(f.orgs).toEqual([]);expect(f.projects).toEqual([]);
  expect(f.errors).toEqual([]);
 });

 test(`home [크게]: a place chosen at home comes along; ▾ in the window changes it; one organization or project record keeps the form too ${width}`,async({page})=>{
  const f=await fixture(page,width),q=quick(page);
  await q.locator('[data-quick-input]').fill('조직 기록');
  await q.locator('[data-quick-org]').click();await page.getByRole('dialog').getByRole('button',{name:'테스트 조직',exact:true}).first().click();await page.getByRole('dialog').getByRole('button',{name:'저장',exact:true}).click();
  await expect(q).toHaveAttribute('data-mode','update');
  await q.locator('[data-quick-big]').click();
  const e=win(page);await expect(e).toBeVisible();
  await expect(e.locator('[data-edw-place]')).toContainText('테스트 조직');
  await expect(e.locator('[data-edw-place]')).toHaveAccessibleName('기록할 곳 선택: 테스트 조직');
  // ED③ 기록: one organization's record keeps the saved form with its letters.
  await e.locator('[data-edw-save]').click();
  await expect(win(page)).toHaveCount(0);
  expect(f.orgs).toHaveLength(1);expect(f.orgs[0]).toMatchObject({organization_id:'o',raw_text:'조직 기록',created_by:'home-test'});expect(f.orgs[0].doc).toMatchObject({v:'ed1'});expect(f.notes).toEqual([]);
  // A project picked inside the window: the home input follows the same place.
  await q.locator('[data-quick-input]').fill('프로젝트 진행');
  await q.locator('[data-quick-big]').click();await expect(e).toBeVisible();
  await e.locator('[data-edw-place]').click();await expect(sheet(page)).toBeVisible();
  await expect(sheet(page).locator('[data-sheet-basket] button')).toHaveText('정리함(미분류)');
  await sheet(page).locator('[data-sheet-projects]').getByRole('button',{name:'테스트 프로젝트',exact:true}).click();
  // UPD-여러곳고르기: the press only marks it; [저장] keeps it (the home input went back to the basket after the add above).
  await expect(sheet(page)).toBeVisible();await expect(sheet(page).locator('[data-sheet-count]')).toHaveText('1곳 선택됨');
  await sheet(page).getByRole('button',{name:'저장',exact:true}).click();await expect(sheet(page)).toBeHidden();
  await expect(e.locator('[data-edw-place]')).toContainText('테스트 프로젝트');
  await expect(e.locator('.ed-window-status')).toHaveText('테스트 프로젝트 기록에 저장돼요.');
  await e.locator('[data-edw-save]').click();await expect(win(page)).toHaveCount(0);
  expect(f.projects).toHaveLength(1);expect(f.projects[0]).toMatchObject({project_id:'p',workstream_id:null,author_id:'home-test',summary:'프로젝트 진행'});expect(f.projects[0].doc).toMatchObject({v:'ed1'});
  // UI-기록할곳되돌리기: after the add, the home input goes back to the basket; the project just used is first on the 최근 line.
  await expect(q.locator('[data-quick-org]')).toHaveAccessibleName('기록할 곳 선택');
  const home=page.locator('#homeChoiceSheet');await q.locator('[data-quick-org]').click();await expect(home).toBeVisible();
  await expect(home.locator('[data-sheet-recent] [data-sheet-value]').first()).toHaveText('테스트 프로젝트');
  await expect(home.locator('[data-sheet-basket] button')).toHaveAttribute('aria-pressed','true');
  await page.keyboard.press('Escape');await expect(home).toBeHidden();
  expect(f.errors).toEqual([]);
 });

 test(`[+ 추가] → [업데이트]: [기록할 곳 ▾]에서 조직을 고르면 조직 기록에도 서식까지, 정리함도 서식까지 ${width}`,async({page})=>{
  const f=await fixture(page,width);
  const e=await openWriter(page,width);
  await expect(e.locator('[data-edw-place]')).toContainText('정리함(미분류)');
  await typeInto(page,text(page),'쓰기에서 조직으로');
  await e.locator('[data-edw-place]').click();await expect(sheet(page)).toBeVisible();
  await sheet(page).getByRole('button',{name:'테스트 조직',exact:true}).first().click();await sheet(page).getByRole('button',{name:'저장',exact:true}).click();
  await expect(e.locator('[data-edw-place]')).toContainText('테스트 조직');
  expect(await fits(page)).toBe(true);
  await e.locator('[data-edw-save]').click();await expect(win(page)).toHaveCount(0);
  await expect(page.locator('#toast')).toContainText('테스트 조직 기록에 저장했어요.');
  expect(f.orgs).toHaveLength(1);expect(f.orgs[0]).toMatchObject({organization_id:'o',raw_text:'쓰기에서 조직으로',created_by:'home-test'});expect(f.orgs[0].doc).toMatchObject({v:'ed1'});expect(f.notes).toEqual([]);
  // The next [+ 추가] → [업데이트] starts again at the basket, and a basket save carries the form.
  const again=await openWriter(page,width);
  await expect(again.locator('[data-edw-place]')).toContainText('정리함(미분류)');
  await typeInto(page,text(page),'정리함 업데이트');
  await again.locator('[data-edw-save]').click();await expect(win(page)).toHaveCount(0);
  expect(f.notes).toHaveLength(1);expect(f.notes[0]).toMatchObject({workspace_id:'w',raw_text:'정리함 업데이트'});expect(f.notes[0].doc).toMatchObject({v:'ed1'});expect(f.notes[0].kind).toBeUndefined();
  expect(f.errors).toEqual([]);
 });
}

test('attachments in the home input stay when an organization is chosen in the window, and go with the update',async({page})=>{
 const f=await fixture(page,1280),q=quick(page),uploads=[];
 await page.route(u=>u.origin===SB&&u.pathname==='/functions/v1/basket-files',r=>{const raw=r.request().postDataBuffer()?.toString('utf8')||'';uploads.push(raw);return r.fulfill({json:{ok:true,note_id:'up-1',attachments:[{file_name:'메모.txt',size_bytes:2,drive_file_id:'file_1',mime_type:'text/plain'}]}});});
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes'&&u.search.includes('doc=is.null'),r=>r.request().method()==='PATCH'?r.fulfill({json:[{id:'up-1',updated_at:'2026-10-06T01:00:01Z'}]}):r.fallback());
 await q.locator('#quickBasketFiles').setInputFiles({name:'메모.txt',mimeType:'text/plain',buffer:Buffer.from('합성')});
 await q.locator('[data-quick-input]').fill('첨부와 함께');
 await q.locator('[data-quick-big]').click();
 const e=win(page);await expect(e).toBeVisible();
 await e.locator('[data-edw-place]').click();await sheet(page).getByRole('button',{name:'테스트 조직',exact:true}).first().click();await sheet(page).getByRole('button',{name:'저장',exact:true}).click();
 // BUG-업데이트첨부연결: the file stays with the organization chosen (saving there: update-attach-target.spec.mjs). Files make it a basket update, so the form is kept.
 await expect(e.locator('[data-edw-attach] [data-basket-file]')).toHaveCount(1);
 expect([f.notes,f.orgs,uploads]).toEqual([[],[],[]]);
 // Back to the basket: the text and file go through the basket upload path (one request with the text), then it closes.
 await e.locator('[data-edw-place]').click();await sheet(page).locator('[data-sheet-basket] button').click();await sheet(page).getByRole('button',{name:'저장',exact:true}).click();
 await e.locator('[data-edw-save]').click();await expect(win(page)).toHaveCount(0);
 expect(uploads).toHaveLength(1);expect(uploads[0]).toContain('filename="메모.txt"');expect(uploads[0]).toContain('name="raw_text"');
 expect(f.notes).toEqual([]);expect(f.orgs).toEqual([]);
 await expect(q.locator('[data-quick-input]')).toHaveValue('');await expect(q.locator('[data-basket-file]')).toHaveCount(0);
 expect(f.errors).toEqual([]);
});
